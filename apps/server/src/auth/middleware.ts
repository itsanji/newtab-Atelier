import { createMiddleware } from 'hono/factory';
import type { SQL } from 'bun';
import { userForToken, type SessionUser } from './sessions';

export type AuthEnv = { Variables: { user: SessionUser; token: string } };

export function bearerToken(header: string | undefined): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? '');
  return match ? match[1]! : null;
}

export function requireUser(sql: SQL, secret: string, now: () => Date) {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const token = bearerToken(c.req.header('authorization'));
    const user = token ? await userForToken(sql, secret, token, now()) : null;
    if (!token || !user) return c.json({ error: 'Not signed in' }, 401);
    c.set('user', user);
    c.set('token', token);
    await next();
  });
}
