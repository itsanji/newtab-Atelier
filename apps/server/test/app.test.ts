import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { makeApp } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
afterEach(() => ctx.close());

describe('app', () => {
  test('GET /health', async () => {
    ctx = await makeApp();
    const res = await ctx.app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  test('GET /api/config reports magicLink false and google false without smtp/google', async () => {
    ctx = await makeApp();
    const res = await ctx.app.request('/api/config');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: 'Atelier', signup: true, auth: { password: true, magicLink: false, google: false } });
  });

  test('GET /api/config reports magicLink and google when configured', async () => {
    ctx = await makeApp({
      config: {
        smtp: { url: 'smtp://localhost:25', from: 'a@b.test' },
        google: { clientId: 'i', clientSecret: 's', authUrl: 'a', tokenUrl: 't', userInfoUrl: 'u' },
      },
    });
    const body = (await (await ctx.app.request('/api/config')).json()) as { auth: object };
    expect(body.auth).toEqual({ password: true, magicLink: true, google: true });
  });

  test('GET /api/config reports signup false when closed', async () => {
    ctx = await makeApp({ config: { allowSignup: false } });
    expect(((await (await ctx.app.request('/api/config')).json()) as { signup: boolean }).signup).toBe(false);
  });

  test('unknown API routes return a JSON 404', async () => {
    ctx = await makeApp();
    const res = await ctx.app.request('/api/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
  });

  test('unhandled errors return a JSON 500 without details', async () => {
    ctx = await makeApp();
    ctx.app.get('/api/boom', () => {
      throw new Error('secret detail');
    });
    const log = spyOn(console, 'error').mockImplementation(() => {});
    const res = await ctx.app.request('/api/boom');
    log.mockRestore();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Something went wrong' });
  });
});
