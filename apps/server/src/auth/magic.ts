import { Hono, type Context } from 'hono';
import { timingSafeEqual } from 'node:crypto';
import type { SQL } from 'bun';
import type { Config } from '../config';
import type { MailTransport } from '../mail';
import { escapeHtml } from '../share/page';
import { magicConfirmPage, magicDonePage, magicInvalidPage } from './pages';
import { createSession, hashToken } from './sessions';
import { findOrCreateVerifiedUser } from './users';

const LINK_TTL_MS = 15 * 60 * 1000;
const MAX_STARTS = 5;
const PAGE_HEADERS = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };

const randomToken = (): string => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Sliding-window start counter per email. */
class StartLimiter {
  private starts = new Map<string, number[]>();
  constructor(private now: () => Date) {}
  /** Records a start and returns false when the email is over the limit. */
  allow(key: string): boolean {
    const t = this.now().getTime();
    const kept = (this.starts.get(key) ?? []).filter((x) => x > t - LINK_TTL_MS);
    if (kept.length >= MAX_STARTS) {
      this.starts.set(key, kept);
      return false;
    }
    kept.push(t);
    this.starts.set(key, kept);
    return true;
  }
}

/** Returns the JSON API routes (mounted at /api/auth/magic) and the public HTML routes (mounted at /auth/magic). */
export function magicRoutes(sql: SQL, config: Config, now: () => Date, mail: MailTransport | null): { api: Hono; pages: Hono } {
  const api = new Hono();
  const pages = new Hono();
  const secret = config.sessionSecret;
  const enabled = config.smtp !== null && mail !== null;
  const limiter = new StartLimiter(now);

  api.use('*', async (c, next) => (enabled ? next() : c.json({ error: 'Not found' }, 404)));
  pages.use('*', async (c, next) => (enabled ? next() : c.text('Not found', 404)));

  api.post('/start', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { email?: unknown } | null;
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!email.includes('@') || email.length > 320) return c.json({ error: 'Enter a valid email address' }, 400);
    if (!limiter.allow(email)) return c.json({ error: 'Too many attempts. Try again later' }, 429);

    const token = randomToken();
    const pollSecret = randomToken();
    const id = crypto.randomUUID();
    const t = now();
    await sql`insert into magic_links (id, email, token_hash, poll_hash, expires_at)
      values (${id}, ${email}, ${hashToken(secret, token)}, ${hashToken(secret, pollSecret)}, ${new Date(t.getTime() + LINK_TTL_MS)})`;

    const link = `${config.publicUrl}/auth/magic?token=${token}`;
    try {
      await mail!.send({
        to: email,
        subject: 'Your Atelier sign-in link',
        text: `Open this link to sign in to Atelier. It works once and expires in 15 minutes.\n\n${link}\n\nIf you did not ask for it, you can ignore this email.\n`,
        html: `<p>Open this link to sign in to Atelier. It works once and expires in 15 minutes.</p><p><a href="${escapeHtml(link)}">Sign in to Atelier</a></p><p>If you did not ask for it, you can ignore this email.</p>`,
      });
    } catch (err) {
      console.error('Could not send magic link email', err instanceof Error ? err.message : 'unknown error');
      await sql`delete from magic_links where id = ${id}`;
      return c.json({ error: 'Could not send the email' }, 502);
    }
    return c.json({ requestId: id, pollSecret });
  });

  api.post('/poll', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { requestId?: unknown; pollSecret?: unknown } | null;
    const id = typeof body?.requestId === 'string' ? body.requestId : '';
    const pollSecret = typeof body?.pollSecret === 'string' ? body.pollSecret : '';
    const gone = () => c.json({ error: 'This sign-in request has expired' }, 410);
    if (!/^[0-9a-f-]{36}$/i.test(id) || !pollSecret) return gone();

    const [row] = await sql`select poll_hash, expires_at, verified_user_id, consumed_at from magic_links where id = ${id}`;
    if (!row || !safeEqual(row.poll_hash, hashToken(secret, pollSecret))) return gone();
    if (row.consumed_at || new Date(row.expires_at) <= now()) return gone();
    if (!row.verified_user_id) return c.json({ status: 'pending' }, 202);

    // Atomic claim so two polls cannot both receive a session.
    const [claimed] = await sql`update magic_links set consumed_at = ${now()}
      where id = ${id} and consumed_at is null returning verified_user_id`;
    if (!claimed) return gone();
    const [user] = await sql`select id, email, display_name from users where id = ${claimed.verified_user_id}`;
    const token = await createSession(sql, secret, user.id, now());
    return c.json({ token, user: { id: user.id, email: user.email, displayName: user.display_name } });
  });

  const html = (c: Context, s: string, status: 200 | 400 = 200) =>
    c.html(s, status, PAGE_HEADERS);

  // The GET changes nothing: mail scanners prefetch links.
  pages.get('/', (c) => {
    const token = c.req.query('token') ?? '';
    return html(c, token ? magicConfirmPage(token) : magicInvalidPage(), token ? 200 : 400);
  });

  pages.post('/', async (c) => {
    const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const token = typeof form.token === 'string' ? form.token : '';
    if (!token) return html(c, magicInvalidPage(), 400);

    const t = now();
    const [link] = await sql`select id, email from magic_links
      where token_hash = ${hashToken(secret, token)} and expires_at > ${t} and verified_user_id is null and consumed_at is null`;
    if (!link) return html(c, magicInvalidPage(), 400);

    const user = await findOrCreateVerifiedUser(sql, link.email, '', t, config.allowSignup);
    if (!user) return html(c, magicInvalidPage(), 400);
    const [done] = await sql`update magic_links set verified_user_id = ${user.id}
      where id = ${link.id} and verified_user_id is null returning id`;
    if (!done) return html(c, magicInvalidPage(), 400);
    return html(c, magicDonePage());
  });

  return { api, pages };
}
