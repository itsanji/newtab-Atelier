import { Hono } from 'hono';
import { getConnInfo } from 'hono/bun';
import type { SQL } from 'bun';
import type { Config } from '../config';
import { requireUser, type AuthEnv } from './middleware';
import { clientIp, RateLimiter } from './rateLimit';
import { attachPendingInvites, createSession, deleteSession } from './sessions';

const normaliseEmail = (v: string) => v.trim().toLowerCase();
const publicUser = (u: { id: string; email: string; display_name: string }) => ({
  id: u.id,
  email: u.email,
  displayName: u.display_name,
});

// Verified against when the email is unknown, so timing does not reveal which emails exist.
const DUMMY_HASH = await Bun.password.hash('not a real password', 'argon2id');

function socketAddress(c: Parameters<typeof getConnInfo>[0]): string | undefined {
  try {
    return getConnInfo(c).remote.address;
  } catch {
    return undefined; // no socket (in-process requests)
  }
}

async function readJson(c: { req: { json(): Promise<unknown> } }): Promise<Record<string, unknown>> {
  try {
    const body = await c.req.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function authRoutes(sql: SQL, config: Config, now: () => Date): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();
  const limiter = new RateLimiter(now);
  const secret = config.sessionSecret;

  routes.post('/signup', async (c) => {
    const body = await readJson(c);
    const email = typeof body.email === 'string' ? normaliseEmail(body.email) : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const displayName = typeof body.displayName === 'string' ? body.displayName.trim().slice(0, 100) : '';
    if (!email.includes('@') || email.length > 320) return c.json({ error: 'Enter a valid email address' }, 400);
    if (password.length < 8 || password.length > 200) return c.json({ error: 'Password must be 8 to 200 characters' }, 400);

    const hash = await Bun.password.hash(password, 'argon2id');
    const id = crypto.randomUUID();
    const [row] = await sql`insert into users (id, email, password_hash, display_name, created_at)
      values (${id}, ${email}, ${hash}, ${displayName}, ${now()})
      on conflict (email) do nothing
      returning id, email, display_name`;
    if (!row) return c.json({ error: 'That email already has an account' }, 409);
    await attachPendingInvites(sql, { id: row.id, email: row.email }, now());
    const token = await createSession(sql, secret, row.id, now());
    return c.json({ token, user: publicUser(row) }, 201);
  });

  routes.post('/login', async (c) => {
    const body = await readJson(c);
    const email = typeof body.email === 'string' ? normaliseEmail(body.email) : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const key = `${clientIp(c.req.raw.headers, socketAddress(c))}|${email}`;
    if (limiter.isBlocked(key)) return c.json({ error: 'Too many attempts. Try again later' }, 429);

    const [user] = await sql`select id, email, display_name, password_hash from users where email = ${email}`;
    const ok = await Bun.password.verify(password, user?.password_hash ?? DUMMY_HASH);
    if (!user || !user.password_hash || !ok) {
      limiter.recordFailure(key);
      return c.json({ error: 'Email or password is wrong' }, 401);
    }
    limiter.reset(key);
    const token = await createSession(sql, secret, user.id, now());
    return c.json({ token, user: publicUser(user) });
  });

  const auth = requireUser(sql, secret, now);
  routes.post('/logout', auth, async (c) => {
    await deleteSession(sql, secret, c.get('token'));
    return c.body(null, 204);
  });
  routes.get('/me', auth, (c) => c.json({ user: c.get('user') }));

  return routes;
}
