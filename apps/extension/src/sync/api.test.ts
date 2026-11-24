import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiClient,
  ApiError,
  InvalidServerUrl,
  OfflineError,
  UnauthorizedError,
  ensureHostPermission,
  normaliseServerUrl,
} from './api';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('normaliseServerUrl', () => {
  it.each([
    ['example.com', 'https://example.com'],
    ['http://10.0.0.2:8787/', 'http://10.0.0.2:8787'],
    ['https://x.y/path/', 'https://x.y'],
    ['  Example.com/  ', 'https://example.com'],
  ])('%s -> %s', (input, out) => expect(normaliseServerUrl(input)).toBe(out));

  it.each(['  ', '', 'ftp://x.y', 'http://'])('rejects %j', (input) =>
    expect(() => normaliseServerUrl(input)).toThrow(InvalidServerUrl),
  );
});

describe('ApiClient', () => {
  it('sends bearer token and json body', async () => {
    const fetchMock = vi.fn(async () => json({ results: [] }));
    vi.stubGlobal('fetch', fetchMock);
    await new ApiClient('example.com/', 'tok').push([{ table: 'items', row: { id: 'a' } }]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://example.com/api/sync/push');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body as string)).toEqual({ changes: [{ table: 'items', row: { id: 'a' } }] });
  });

  it('omits authorization without a token', async () => {
    const fetchMock = vi.fn(async () => json({ name: 'Atelier' }));
    vi.stubGlobal('fetch', fetchMock);
    await new ApiClient('https://s.test').config();
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it('maps 401 to UnauthorizedError', async () => {
    vi.stubGlobal('fetch', async () => json({ error: 'Email or password is wrong' }, 401));
    await expect(new ApiClient('https://s.test').logIn('a@b.c', 'x')).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('maps network failure to OfflineError', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(new ApiClient('https://s.test').pull(0)).rejects.toBeInstanceOf(OfflineError);
  });

  it('surfaces server error message', async () => {
    vi.stubGlobal('fetch', async () => json({ error: 'That email already has an account' }, 409));
    const err = await new ApiClient('https://s.test').signUp('a@b.c', 'password1', '').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, message: 'That email already has an account' });
  });

  it('handles 204 and builds urls', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const api = new ApiClient('http://10.0.0.2:8787/', 't');
    await expect(api.unshare('c/1')).resolves.toBeUndefined();
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('http://10.0.0.2:8787/api/categories/c%2F1/share');
    expect(api.liveUrl()).toBe('ws://10.0.0.2:8787/api/live');
    expect(new ApiClient('https://s.test').liveUrl()).toBe('wss://s.test/api/live');
    const g = new URL(api.googleStartUrl('https://abc.chromiumapp.org/cb', 's 1'));
    expect(g.pathname).toBe('/auth/google/start');
    expect(g.searchParams.get('state')).toBe('s 1');
  });
});

describe('ensureHostPermission', () => {
  const stub = (contains: boolean, request: boolean) => {
    const perms = { contains: vi.fn(async () => contains), request: vi.fn(async () => request) };
    vi.stubGlobal('chrome', { permissions: perms });
    return perms;
  };

  it('skips the prompt when already granted', async () => {
    const p = stub(true, false);
    expect(await ensureHostPermission('https://s.test/x')).toBe(true);
    expect(p.request).not.toHaveBeenCalled();
    expect(p.contains).toHaveBeenCalledWith({ origins: ['https://s.test/*'] });
  });

  it('requests the origin otherwise', async () => {
    const p = stub(false, true);
    expect(await ensureHostPermission('s.test')).toBe(true);
    expect(p.request).toHaveBeenCalledWith({ origins: ['https://s.test/*'] });
  });

  it('returns false when denied', async () => {
    stub(false, false);
    expect(await ensureHostPermission('s.test')).toBe(false);
  });
});
