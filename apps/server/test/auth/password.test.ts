import { afterEach, describe, expect, test } from 'bun:test';
import { bearer, makeApp, signUp } from '../helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
afterEach(() => ctx.close());

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  ctx.app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

describe('password auth', () => {
  test('signup returns token and me works', async () => {
    ctx = await makeApp();
    const res = await post('/api/auth/signup', { email: 'Ann@Example.com', password: 'longenough1', displayName: 'Ann' });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { token: string; user: { id: string; email: string; displayName: string } };
    expect(body.token.length).toBeGreaterThanOrEqual(43);
    expect(body.user).toEqual({ id: expect.any(String), email: 'ann@example.com', displayName: 'Ann' });

    const me = await ctx.app.request('/api/auth/me', { headers: bearer(body.token) });
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({ user: body.user });

    // only a hash of the token is stored
    const rows = await ctx.sql`select token_hash from sessions`;
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).not.toBe(body.token);
    const [u] = await ctx.sql`select password_hash from users`;
    expect(u.password_hash).toStartWith('$argon2id$');
  });

  test('signup validates input', async () => {
    ctx = await makeApp();
    expect((await post('/api/auth/signup', { email: 'nope', password: 'longenough1' })).status).toBe(400);
    expect((await post('/api/auth/signup', { email: 'a@b.test', password: 'short' })).status).toBe(400);
    expect((await post('/api/auth/signup', { email: 'a@b.test', password: 'x'.repeat(201) })).status).toBe(400);
    expect((await ctx.app.request('/api/auth/me')).status).toBe(401);
    expect((await ctx.app.request('/api/auth/me', { headers: bearer('garbage') })).status).toBe(401);
  });

  test('signup normalises email case and rejects duplicates', async () => {
    ctx = await makeApp();
    await signUp(ctx.app, ' Ann@Example.com ');
    const dup = await post('/api/auth/signup', { email: 'ANN@example.com', password: 'longenough1' });
    expect(dup.status).toBe(409);
    expect(((await dup.json()) as { error: string }).error).toBe('That email already has an account');
    const login = await post('/api/auth/login', { email: 'ann@EXAMPLE.com', password: 'correct horse battery' });
    expect(login.status).toBe(200);
  });

  test('login wrong password 401 same message as unknown email', async () => {
    ctx = await makeApp();
    await signUp(ctx.app, 'ann@example.com');
    const wrong = await post('/api/auth/login', { email: 'ann@example.com', password: 'wrong password' });
    const unknown = await post('/api/auth/login', { email: 'nobody@example.com', password: 'wrong password' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await wrong.json()).toEqual({ error: 'Email or password is wrong' });
    expect(await unknown.json()).toEqual({ error: 'Email or password is wrong' });
  });

  test('logout invalidates token', async () => {
    ctx = await makeApp();
    const { token } = await signUp(ctx.app, 'ann@example.com');
    const out = await ctx.app.request('/api/auth/logout', { method: 'POST', headers: bearer(token) });
    expect(out.status).toBe(204);
    expect((await ctx.app.request('/api/auth/me', { headers: bearer(token) })).status).toBe(401);
  });

  test('expired session 401, and use slides the expiry', async () => {
    let now = new Date('2026-01-01T00:00:00Z');
    ctx = await makeApp({ now: () => now });
    const { token } = await signUp(ctx.app, 'ann@example.com');

    now = new Date('2026-03-01T00:00:00Z'); // day 59: still valid, expiry slides
    expect((await ctx.app.request('/api/auth/me', { headers: bearer(token) })).status).toBe(200);
    now = new Date('2026-05-01T00:00:00Z'); // day 120 but only 61 days since last use
    expect((await ctx.app.request('/api/auth/me', { headers: bearer(token) })).status).toBe(200);
    now = new Date('2026-09-01T00:00:00Z'); // > 90 days since last use
    expect((await ctx.app.request('/api/auth/me', { headers: bearer(token) })).status).toBe(401);
  });

  test('login is rate limited', async () => {
    ctx = await makeApp();
    await signUp(ctx.app, 'ann@example.com');
    const ip = { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' };
    for (let i = 0; i < 10; i++) {
      expect((await post('/api/auth/login', { email: 'ann@example.com', password: 'nope nope' }, ip)).status).toBe(401);
    }
    const blocked = await post('/api/auth/login', { email: 'ann@example.com', password: 'correct horse battery' }, ip);
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: 'Too many attempts. Try again later' });
    // another IP is not affected
    const other = await post('/api/auth/login', { email: 'ann@example.com', password: 'correct horse battery' }, { 'x-forwarded-for': '203.0.113.10' });
    expect(other.status).toBe(200);
  });

  test('signup attaches pending invites', async () => {
    ctx = await makeApp();
    const owner = await signUp(ctx.app, 'owner@example.com');
    const wsId = crypto.randomUUID();
    const t = new Date();
    await ctx.sql`insert into workspaces (id, name, owner_id, sort_key, created_at, updated_at, version)
      values (${wsId}, 'Shared', ${owner.user.id}, 'a', ${t}, ${t}, nextval('change_seq'))`;
    const memberId = crypto.randomUUID();
    await ctx.sql`insert into workspace_members (id, workspace_id, user_id, email, role, created_at, updated_at, version)
      values (${memberId}, ${wsId}, null, 'guest@example.com', 'editor', ${t}, ${t}, nextval('change_seq'))`;
    const [before] = await ctx.sql`select version from workspace_members where id = ${memberId}`;

    const guest = await signUp(ctx.app, 'Guest@Example.com');
    const [after] = await ctx.sql`select user_id, version from workspace_members where id = ${memberId}`;
    expect(after.user_id).toBe(guest.user.id);
    expect(BigInt(after.version)).toBeGreaterThan(BigInt(before.version));
  });
});
