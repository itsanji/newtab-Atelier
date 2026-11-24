import { afterEach, describe, expect, test } from 'bun:test';
import { bearer, makeApp, signUp } from '../helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let fakeGoogle: ReturnType<typeof Bun.serve> | null = null;
afterEach(async () => {
  fakeGoogle?.stop(true);
  fakeGoogle = null;
  await ctx.close();
});

const json = (path: string, body: unknown) =>
  ctx.app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const smtp = { smtp: { url: 'smtp://x', from: 'Atelier <a@b.test>' } };
const tokenFromMail = () => new URL(/https?:\/\/\S+/.exec(ctx.mail.sent.at(-1)!.text)![0]).searchParams.get('token')!;
const verify = (token: string) =>
  ctx.app.request('/auth/magic', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }),
  });

describe('magic link', () => {
  test('magic link full flow', async () => {
    ctx = await makeApp({ config: smtp });
    const start = await json('/api/auth/magic/start', { email: ' Ann@Example.com ' });
    expect(start.status).toBe(200);
    const { requestId, pollSecret } = (await start.json()) as { requestId: string; pollSecret: string };
    expect(ctx.mail.sent).toHaveLength(1);
    expect(ctx.mail.sent[0]!.to).toBe('ann@example.com');
    expect(ctx.mail.sent[0]!.text).toContain('http://localhost:8787/auth/magic?token=');
    const token = tokenFromMail();

    // only hashes are stored
    const [row] = await ctx.sql`select token_hash, poll_hash from magic_links`;
    expect(row.token_hash).not.toBe(token);
    expect(row.poll_hash).not.toBe(pollSecret);

    const pending = await json('/api/auth/magic/poll', { requestId, pollSecret });
    expect(pending.status).toBe(202);
    expect(await pending.json()).toEqual({ status: 'pending' });

    const done = await verify(token);
    expect(done.status).toBe(200);
    expect(await done.text()).toContain('Return to Atelier');
    expect((await verify(token)).status).toBe(400); // single use

    const ok = await json('/api/auth/magic/poll', { requestId, pollSecret });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { token: string; user: { email: string } };
    expect(body.user.email).toBe('ann@example.com');
    const me = await ctx.app.request('/api/auth/me', { headers: bearer(body.token) });
    expect(me.status).toBe(200);
  });

  test('GET magic page does not sign in', async () => {
    ctx = await makeApp({ config: smtp });
    const { requestId, pollSecret } = (await (await json('/api/auth/magic/start', { email: 'a@b.test' })).json()) as {
      requestId: string;
      pollSecret: string;
    };
    const token = tokenFromMail();
    const page = await ctx.app.request(`/auth/magic?token=${token}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('<form method="post"');
    expect(html).toContain('Sign in');
    expect((await json('/api/auth/magic/poll', { requestId, pollSecret })).status).toBe(202);
    expect((await ctx.sql`select count(*)::int as n from users`)[0].n).toBe(0);
  });

  test('poll after consume is 410', async () => {
    ctx = await makeApp({ config: smtp });
    const { requestId, pollSecret } = (await (await json('/api/auth/magic/start', { email: 'a@b.test' })).json()) as {
      requestId: string;
      pollSecret: string;
    };
    await verify(tokenFromMail());
    expect((await json('/api/auth/magic/poll', { requestId, pollSecret: 'wrong' })).status).toBe(410);
    expect((await json('/api/auth/magic/poll', { requestId, pollSecret })).status).toBe(200);
    expect((await json('/api/auth/magic/poll', { requestId, pollSecret })).status).toBe(410);
  });

  test('expired links cannot be verified or polled; start is rate limited', async () => {
    let t = new Date('2026-01-01T00:00:00Z');
    ctx = await makeApp({ config: smtp, now: () => t });
    const { requestId, pollSecret } = (await (await json('/api/auth/magic/start', { email: 'a@b.test' })).json()) as {
      requestId: string;
      pollSecret: string;
    };
    const token = tokenFromMail();
    t = new Date(t.getTime() + 16 * 60 * 1000);
    expect((await verify(token)).status).toBe(400);
    expect((await json('/api/auth/magic/poll', { requestId, pollSecret })).status).toBe(410);

    for (let i = 0; i < 4; i++) expect((await json('/api/auth/magic/start', { email: 'r@b.test' })).status).toBe(200);
    expect((await json('/api/auth/magic/start', { email: 'r@b.test' })).status).toBe(200);
    expect((await json('/api/auth/magic/start', { email: 'r@b.test' })).status).toBe(429);
  });

  async function magicIn(email: string): Promise<Response> {
    const start = await json('/api/auth/magic/start', { email });
    expect(start.status).toBe(200);
    return verify(tokenFromMail());
  }

  test('first verified sign-in clears an unverified password and its sessions', async () => {
    ctx = await makeApp({ config: smtp });
    const attacker = await signUp(ctx.app, 'victim@example.com', 'attacker password');
    expect((await ctx.app.request('/api/auth/me', { headers: bearer(attacker.token) })).status).toBe(200);
    expect((await magicIn('victim@example.com')).status).toBe(200);
    const [u] = await ctx.sql`select password_hash, email_verified_at from users where email = 'victim@example.com'`;
    expect(u.password_hash).toBeNull();
    expect(u.email_verified_at).not.toBeNull();
    expect((await ctx.app.request('/api/auth/me', { headers: bearer(attacker.token) })).status).toBe(401);
    const login = await json('/api/auth/login', { email: 'victim@example.com', password: 'attacker password' });
    expect(login.status).toBe(401);
  });

  test('already-verified account keeps its password', async () => {
    ctx = await makeApp({ config: smtp });
    const u = await signUp(ctx.app, 'ann@example.com', 'ann password 1');
    await magicIn('ann@example.com'); // first verification clears the password
    await ctx.sql`update users set password_hash = ${await Bun.password.hash('ann password 2', 'argon2id')} where email = 'ann@example.com'`;
    const session = await json('/api/auth/login', { email: 'ann@example.com', password: 'ann password 2' });
    const { token } = (await session.json()) as { token: string };
    await magicIn('ann@example.com');
    const [row] = await ctx.sql`select password_hash from users where email = 'ann@example.com'`;
    expect(row.password_hash).not.toBeNull();
    expect((await ctx.app.request('/api/auth/me', { headers: bearer(token) })).status).toBe(200);
    expect(u.token).toBeTruthy();
  });

  test('closed sign-ups: magic link only admits existing users and invited emails', async () => {
    ctx = await makeApp({ config: { ...smtp, allowSignup: false } });
    expect((await magicIn('new@example.com')).status).toBe(400);
    expect((await ctx.sql`select count(*)::int as n from users`)[0].n).toBe(0);

    const t = new Date();
    const owner = crypto.randomUUID();
    await ctx.sql`insert into users (id, email, created_at, email_verified_at) values (${owner}, 'o@example.com', ${t}, ${t})`;
    const ws = crypto.randomUUID();
    await ctx.sql`insert into workspaces (id, name, owner_id, sort_key, created_at, updated_at, version)
      values (${ws}, 'Shared', ${owner}, 'a', ${t}, ${t}, nextval('change_seq'))`;
    await ctx.sql`insert into workspace_members (id, workspace_id, user_id, email, role, created_at, updated_at, version)
      values (${crypto.randomUUID()}, ${ws}, null, 'invited@example.com', 'editor', ${t}, ${t}, nextval('change_seq'))`;
    expect((await magicIn('invited@example.com')).status).toBe(200);
    expect((await magicIn('o@example.com')).status).toBe(200);
  });

  test('magic routes 404 without smtp', async () => {
    ctx = await makeApp();
    expect((await json('/api/auth/magic/start', { email: 'a@b.test' })).status).toBe(404);
    expect((await json('/api/auth/magic/poll', { requestId: 'x', pollSecret: 'y' })).status).toBe(404);
    expect((await ctx.app.request('/auth/magic?token=x')).status).toBe(404);
  });
});

function startFakeGoogle(profile: Record<string, unknown>) {
  fakeGoogle = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === '/token') {
        const form = new URLSearchParams(await req.text());
        if (form.get('code') !== 'good-code' || form.get('client_secret') !== 'csecret') return new Response('{}', { status: 400 });
        return Response.json({ access_token: 'at' });
      }
      if (url.pathname === '/userinfo') {
        return req.headers.get('authorization') === 'Bearer at' ? Response.json(profile) : new Response('{}', { status: 401 });
      }
      return new Response('nope', { status: 404 });
    },
  });
  const base = `http://127.0.0.1:${fakeGoogle.port}`;
  return {
    clientId: 'cid',
    clientSecret: 'csecret',
    authUrl: `${base}/auth`,
    tokenUrl: `${base}/token`,
    userInfoUrl: `${base}/userinfo`,
  };
}

const EXT = `https://${'a'.repeat(32)}.chromiumapp.org/cb`;

async function googleStart() {
  const res = await ctx.app.request(`/auth/google/start?redirect_uri=${encodeURIComponent(EXT)}&state=client-state`);
  expect(res.status).toBe(302);
  return new URL(res.headers.get('location')!);
}

describe('google sign-in', () => {
  test('google flow creates user and exchanges code once', async () => {
    const google = startFakeGoogle({ email: 'Gina@Example.com', email_verified: true, name: 'Gina' });
    ctx = await makeApp({ config: { google } });
    const auth = await googleStart();
    expect(auth.origin + auth.pathname).toBe(google.authUrl);
    expect(auth.searchParams.get('redirect_uri')).toBe('http://localhost:8787/auth/google/callback');
    expect(auth.searchParams.get('scope')).toBe('openid email profile');
    expect(auth.searchParams.get('client_id')).toBe('cid');
    const state = auth.searchParams.get('state')!;
    expect(state).not.toBe('client-state');

    const cb = await ctx.app.request(`/auth/google/callback?code=good-code&state=${state}`);
    expect(cb.status).toBe(302);
    const back = new URL(cb.headers.get('location')!);
    expect(back.origin + back.pathname).toBe(EXT);
    expect(back.searchParams.get('state')).toBe('client-state');
    const code = back.searchParams.get('code')!;
    const [stored] = await ctx.sql`select code_hash from oauth_codes`;
    expect(stored.code_hash).not.toBe(code);

    // state is single use
    expect((await ctx.app.request(`/auth/google/callback?code=good-code&state=${state}`)).status).toBe(400);

    const ex = await json('/api/auth/google/exchange', { code });
    expect(ex.status).toBe(200);
    const body = (await ex.json()) as { token: string; user: { email: string; displayName: string } };
    expect(body.user).toMatchObject({ email: 'gina@example.com', displayName: 'Gina' });
    expect((await ctx.app.request('/api/auth/me', { headers: bearer(body.token) })).status).toBe(200);
    expect((await json('/api/auth/google/exchange', { code })).status).toBe(400);
  });

  test('google start rejects foreign redirect_uri', async () => {
    ctx = await makeApp({ config: { google: startFakeGoogle({}) } });
    for (const bad of ['https://evil.example/cb', `https://${'a'.repeat(32)}.chromiumapp.org.evil.example/`, `http://${'a'.repeat(32)}.chromiumapp.org/`, '']) {
      const res = await ctx.app.request(`/auth/google/start?redirect_uri=${encodeURIComponent(bad)}&state=s`);
      expect(res.status).toBe(400);
    }
    expect((await ctx.sql`select count(*)::int as n from oauth_states`)[0].n).toBe(0);
  });

  test('unverified google email rejected', async () => {
    ctx = await makeApp({ config: { google: startFakeGoogle({ email: 'x@y.test', email_verified: false }) } });
    const state = (await googleStart()).searchParams.get('state')!;
    const cb = await ctx.app.request(`/auth/google/callback?code=good-code&state=${state}`);
    expect(cb.status).toBe(400);
    expect((await ctx.sql`select count(*)::int as n from users`)[0].n).toBe(0);
    expect((await ctx.sql`select count(*)::int as n from oauth_codes`)[0].n).toBe(0);
  });

  test('closed sign-ups: google does not create new users', async () => {
    const google = startFakeGoogle({ email: 'new@example.com', email_verified: true });
    ctx = await makeApp({ config: { google, allowSignup: false } });
    const state = (await googleStart()).searchParams.get('state')!;
    const cb = await ctx.app.request(`/auth/google/callback?code=good-code&state=${state}`);
    expect(cb.status).toBe(403);
    expect((await ctx.sql`select count(*)::int as n from users`)[0].n).toBe(0);
  });

  test('google routes 404 when not configured; expired exchange code rejected', async () => {
    ctx = await makeApp();
    expect((await ctx.app.request(`/auth/google/start?redirect_uri=${encodeURIComponent(EXT)}&state=s`)).status).toBe(404);
    expect((await json('/api/auth/google/exchange', { code: 'x' })).status).toBe(404);
  });
});
