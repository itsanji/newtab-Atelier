import { Hono } from 'hono';
import type { SQL } from 'bun';
import type { Config } from '../config';
import { createSession, hashToken } from './sessions';
import { findOrCreateVerifiedUser } from './users';

const REDIRECT_RE = /^https:\/\/[a-p]{32}\.chromiumapp\.org\//;
const STATE_TTL_MS = 10 * 60 * 1000;
const CODE_TTL_MS = 60 * 1000;

const randomToken = (): string => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');

/** Returns the browser-facing routes (mounted at /auth/google) and the JSON API (mounted at /api/auth/google). */
export function googleRoutes(sql: SQL, config: Config, now: () => Date): { pages: Hono; api: Hono } {
  const pages = new Hono();
  const api = new Hono();
  const google = config.google;
  const secret = config.sessionSecret;
  const callbackUrl = `${config.publicUrl}/auth/google/callback`;

  pages.use('*', async (c, next) => (google ? next() : c.text('Not found', 404)));
  api.use('*', async (c, next) => (google ? next() : c.json({ error: 'Not found' }, 404)));
  if (!google) return { pages, api };

  pages.get('/start', async (c) => {
    const redirectUri = c.req.query('redirect_uri') ?? '';
    const clientState = c.req.query('state') ?? '';
    if (!REDIRECT_RE.test(redirectUri) || redirectUri.length > 500) return c.text('Invalid redirect_uri', 400);
    if (!clientState || clientState.length > 500) return c.text('Invalid state', 400);

    const state = randomToken();
    await sql`insert into oauth_states (state, redirect_uri, client_state, expires_at)
      values (${hashToken(secret, state)}, ${redirectUri}, ${clientState}, ${new Date(now().getTime() + STATE_TTL_MS)})`;
    const url = new URL(google.authUrl);
    url.search = new URLSearchParams({
      client_id: google.clientId,
      redirect_uri: callbackUrl,
      response_type: 'code',
      scope: 'openid email profile',
      state,
    }).toString();
    return c.redirect(url.toString(), 302);
  });

  pages.get('/callback', async (c) => {
    const code = c.req.query('code') ?? '';
    const state = c.req.query('state') ?? '';
    if (!state) return c.text('Sign-in failed', 400);
    // Single use: the state row is removed whatever happens next.
    const [stored] = await sql`delete from oauth_states where state = ${hashToken(secret, state)} and expires_at > ${now()}
      returning redirect_uri, client_state`;
    if (!stored) return c.text('Sign-in link expired. Start again from Atelier.', 400);
    if (!code) return c.text('Sign-in was cancelled', 400);

    try {
      const tokenRes = await fetch(google.tokenUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: google.clientId,
          client_secret: google.clientSecret,
          redirect_uri: callbackUrl,
          grant_type: 'authorization_code',
        }),
      });
      if (!tokenRes.ok) return c.text('Google sign-in failed', 400);
      const { access_token: accessToken } = (await tokenRes.json()) as { access_token?: string };
      if (!accessToken) return c.text('Google sign-in failed', 400);

      const infoRes = await fetch(google.userInfoUrl, { headers: { authorization: `Bearer ${accessToken}` } });
      if (!infoRes.ok) return c.text('Google sign-in failed', 400);
      const info = (await infoRes.json()) as { email?: unknown; email_verified?: unknown; name?: unknown };
      const verified = info.email_verified === true || info.email_verified === 'true';
      if (typeof info.email !== 'string' || !info.email.includes('@') || !verified) {
        return c.text('Your Google email address is not verified', 400);
      }

      const user = await findOrCreateVerifiedUser(sql, info.email, typeof info.name === 'string' ? info.name : '', now(), config.allowSignup);
      if (!user) return c.text('Sign-ups are closed on this server', 403);
      const oneTime = randomToken();
      await sql`insert into oauth_codes (code_hash, user_id, expires_at)
        values (${hashToken(secret, oneTime)}, ${user.id}, ${new Date(now().getTime() + CODE_TTL_MS)})`;
      const back = new URL(stored.redirect_uri);
      back.searchParams.set('code', oneTime);
      back.searchParams.set('state', stored.client_state);
      return c.redirect(back.toString(), 302);
    } catch (err) {
      console.error('Google sign-in failed', err instanceof Error ? err.message : 'unknown error');
      return c.text('Google sign-in failed', 502);
    }
  });

  api.post('/exchange', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { code?: unknown } | null;
    const code = typeof body?.code === 'string' ? body.code : '';
    if (!code) return c.json({ error: 'Invalid or expired code' }, 400);
    const [row] = await sql`delete from oauth_codes where code_hash = ${hashToken(secret, code)} and expires_at > ${now()}
      returning user_id`;
    if (!row) return c.json({ error: 'Invalid or expired code' }, 400);
    const [user] = await sql`select id, email, display_name from users where id = ${row.user_id}`;
    const token = await createSession(sql, secret, user.id, now());
    return c.json({ token, user: { id: user.id, email: user.email, displayName: user.display_name } });
  });

  return { pages, api };
}
