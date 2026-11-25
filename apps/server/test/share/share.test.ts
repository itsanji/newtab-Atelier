import { afterEach, describe, expect, test } from 'bun:test';
import { bearer, makeApp, signUp } from '../helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
afterEach(() => ctx.close());

const T0 = '2026-01-01T00:00:00.000Z';
const json = (token: string) => ({ 'content-type': 'application/json', ...bearer(token) });
const push = async (token: string, changes: unknown[]) => {
  const res = await ctx.app.request('/api/sync/push', { method: 'POST', headers: json(token), body: JSON.stringify({ changes }) });
  expect(res.status).toBe(200);
  return res;
};
const base = { createdAt: T0, updatedAt: T0, deletedAt: null, updatedBy: null };

async function seed(token: string) {
  const ws = crypto.randomUUID();
  const cat = crypto.randomUUID();
  await push(token, [
    { table: 'workspaces', row: { id: ws, name: 'Secret workspace', emoji: null, ownerId: null, sortKey: 'a0', ...base } },
    { table: 'categories', row: { id: cat, workspaceId: ws, name: 'Reading', emoji: '📚', sortKey: 'a0', tabGroup: null, shareToken: null, ...base } },
  ]);
  return { ws, cat };
}
const item = (categoryId: string, over: Record<string, unknown>) => ({
  table: 'items',
  row: { id: crypto.randomUUID(), categoryId, kind: 'link', sortKey: 'a0', title: 'T', url: null, faviconUrl: null, note: null, body: null, done: false, restored: false, ...base, ...over },
});
const share = (token: string, cat: string, method = 'POST') => ctx.app.request(`/api/categories/${cat}/share`, { method, headers: bearer(token) });
const invite = (token: string, ws: string, email: string, role: string) =>
  ctx.app.request(`/api/workspaces/${ws}/members`, { method: 'POST', headers: json(token), body: JSON.stringify({ email, role }) });

describe('share links', () => {
  test('owner creates and revokes share link', async () => {
    ctx = await makeApp();
    const owner = await signUp(ctx.app, 'owner@example.com');
    const { cat } = await seed(owner.token);
    const res = await share(owner.token, cat);
    expect(res.status).toBe(200);
    const { shareToken, url } = (await res.json()) as { shareToken: string; url: string };
    expect(url).toBe(`http://localhost:8787/s/${shareToken}`);
    expect(shareToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(((await (await share(owner.token, cat)).json()) as any).shareToken).toBe(shareToken);

    const pulled = (await (await ctx.app.request('/api/sync/pull?cursor=0', { headers: bearer(owner.token) })).json()) as any;
    expect(pulled.categories[0].shareToken).toBe(shareToken);

    expect((await ctx.app.request(`/s/${shareToken}`)).status).toBe(200);
    expect((await share(owner.token, cat, 'DELETE')).status).toBe(204);
    expect((await ctx.app.request(`/s/${shareToken}`)).status).toBe(404);
    const after = (await (await ctx.app.request('/api/sync/pull?cursor=0', { headers: bearer(owner.token) })).json()) as any;
    expect(after.categories[0].shareToken).toBeNull();
    expect(after.categories[0].updatedAt > pulled.categories[0].updatedAt).toBe(true);
    expect(after.cursor > pulled.cursor).toBe(true);
  });

  test('viewer cannot create share link', async () => {
    ctx = await makeApp();
    const owner = await signUp(ctx.app, 'owner@example.com');
    const viewer = await signUp(ctx.app, 'viewer@example.com');
    const outsider = await signUp(ctx.app, 'out@example.com');
    const { ws, cat } = await seed(owner.token);
    await invite(owner.token, ws, 'viewer@example.com', 'viewer');
    expect((await share(viewer.token, cat)).status).toBe(403);
    expect((await share(outsider.token, cat)).status).toBe(404);
    expect((await ctx.app.request(`/api/categories/${cat}/share`, { method: 'POST' })).status).toBe(401);
    await share(owner.token, cat);
    expect((await share(viewer.token, cat, 'DELETE')).status).toBe(403);
  });

  test('share page shows only that category\'s live items', async () => {
    ctx = await makeApp();
    const owner = await signUp(ctx.app, 'owner@example.com');
    const { ws, cat } = await seed(owner.token);
    const other = crypto.randomUUID();
    await push(owner.token, [
      { table: 'categories', row: { id: other, workspaceId: ws, name: 'Other cat', emoji: null, sortKey: 'a1', tabGroup: null, shareToken: null, ...base } },
      item(cat, { title: 'Second link', sortKey: 'a1', url: 'https://example.org/path', note: 'a note' }),
      item(cat, { title: 'First todo', sortKey: 'a0', kind: 'todo', done: true }),
      item(cat, { title: 'Gone', sortKey: 'a2', deletedAt: T0 }),
      item(cat, {
        title: 'A note', sortKey: 'a3', kind: 'note',
        body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello body' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'second para' }] }] },
      }),
      item(other, { title: 'Elsewhere' }),
      { table: 'reminders', row: { id: crypto.randomUUID(), itemId: crypto.randomUUID(), userId: owner.user.id, remindAt: T0, remindedAt: null, ...base } },
    ]);
    const { shareToken } = (await (await share(owner.token, cat)).json()) as any;
    const html = await (await ctx.app.request(`/s/${shareToken}`)).text();
    expect(html).toContain('Reading');
    expect(html).toContain('📚');
    expect(html.indexOf('First todo')).toBeLessThan(html.indexOf('Second link'));
    expect(html.indexOf('Second link')).toBeLessThan(html.indexOf('A note'));
    expect(html).toContain('href="https://example.org/path" target="_blank" rel="noopener noreferrer nofollow"');
    expect(html).toContain('example.org');
    expect(html).toContain('a note');
    expect(html).toContain('<p>hello body</p><p>second para</p>');
    expect(html).toContain('aria-label="Done"');
    for (const hidden of ['Gone', 'Elsewhere', 'Other cat', 'Secret workspace', 'owner@example.com']) expect(html).not.toContain(hidden);
    expect(html).toContain('Shared with Atelier');
    expect(html.replace('<!doctype html>', '')).not.toContain('!');
  });

  test('folders sync both ways and show their links on the share page', async () => {
    ctx = await makeApp();
    const owner = await signUp(ctx.app, 'owner@example.com');
    const { cat } = await seed(owner.token);
    const folder = crypto.randomUUID();
    await push(owner.token, [
      item(cat, { id: folder, kind: 'folder', title: 'SNS', sortKey: 'a1' }),
      item(cat, { title: 'Inside one', sortKey: 'a0', url: 'https://in.example/', folderId: folder }),
      item(cat, { title: 'Top link', sortKey: 'a0', url: 'https://top.example/' }),
      item(cat, { title: 'Lost folder link', sortKey: 'a2', url: 'https://lost.example/', folderId: crypto.randomUUID() }),
    ]);
    const pulled = (await (await ctx.app.request('/api/sync/pull?cursor=0', { headers: bearer(owner.token) })).json()) as any;
    const inside = pulled.items.find((i: any) => i.title === 'Inside one');
    expect(inside.folderId).toBe(folder);
    expect(pulled.items.find((i: any) => i.id === folder).kind).toBe('folder');
    expect(pulled.items.find((i: any) => i.title === 'Top link').folderId).toBeNull();

    const { shareToken } = (await (await share(owner.token, cat)).json()) as any;
    const html = await (await ctx.app.request(`/s/${shareToken}`)).text();
    // Top link, then the folder holding its link, then the link whose folder doesn't exist.
    expect(html).toMatch(/Top link[\s\S]*<li class="folder"><h2 class="item-title">SNS<\/h2><ul><li><a[^>]*>Inside one[\s\S]*Lost folder link/);
  });

  test('a push without folderId (an older client) is accepted as top level', async () => {
    ctx = await makeApp();
    const owner = await signUp(ctx.app, 'owner@example.com');
    const { cat } = await seed(owner.token);
    const old = item(cat, { title: 'Old client' });
    delete (old.row as Record<string, unknown>).folderId;
    await push(owner.token, [old]);
    const pulled = (await (await ctx.app.request('/api/sync/pull?cursor=0', { headers: bearer(owner.token) })).json()) as any;
    expect(pulled.items[0].folderId).toBeNull();
  });

  test('share page 404s for revoked and deleted, escapes content', async () => {
    ctx = await makeApp();
    const owner = await signUp(ctx.app, 'owner@example.com');
    const { ws, cat } = await seed(owner.token);
    await push(owner.token, [
      item(cat, { title: '<script>alert(1)</script>', kind: 'note', body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '<img src=x onerror=1>' }] }] } }),
      item(cat, { title: '"><b>x</b>', url: 'https://e.com/?a="b"&c=<d>', note: '<i>n</i>' }),
    ]);
    // The push route refuses such urls; a row that got in some other way still must not become a link.
    await push(owner.token, [item(cat, { title: 'bad-link', sortKey: 'a4', url: 'https://e.com/' })]);
    await ctx.sql`update items set url = 'javascript:alert(1)' where title = 'bad-link'`;
    const { shareToken } = (await (await share(owner.token, cat)).json()) as any;
    const html = await (await ctx.app.request(`/s/${shareToken}`)).text();
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<i>n');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('<b>x');
    expect(html).toContain('&quot;&gt;&lt;b&gt;x&lt;/b&gt;');
    expect(html).toContain('bad-link');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x onerror=1&gt;');

    const unknown = await ctx.app.request('/s/' + 'x'.repeat(43));
    expect(unknown.status).toBe(404);
    expect(await unknown.text()).toContain("This link isn't available");

    // Deleted category.
    await push(owner.token, [{ table: 'categories', row: { id: cat, workspaceId: ws, name: 'Reading', emoji: null, sortKey: 'a0', tabGroup: null, shareToken: null, ...base, deletedAt: T0 } }]);
    expect((await ctx.app.request(`/s/${shareToken}`)).status).toBe(404);

    // Deleted workspace with a still-live category.
    const cat2 = crypto.randomUUID();
    await push(owner.token, [{ table: 'categories', row: { id: cat2, workspaceId: ws, name: 'Two', emoji: null, sortKey: 'a1', tabGroup: null, shareToken: null, ...base } }]);
    const { shareToken: t2 } = (await (await share(owner.token, cat2)).json()) as any;
    expect((await ctx.app.request(`/s/${t2}`)).status).toBe(200);
    await push(owner.token, [{ table: 'workspaces', row: { id: ws, name: 'Secret workspace', emoji: null, ownerId: null, sortKey: 'a0', ...base, deletedAt: T0 } }]);
    expect((await ctx.app.request(`/s/${t2}`)).status).toBe(404);
  });

  test('share page sets security headers', async () => {
    ctx = await makeApp();
    const owner = await signUp(ctx.app, 'owner@example.com');
    const { cat } = await seed(owner.token);
    const { shareToken } = (await (await share(owner.token, cat)).json()) as any;
    for (const path of [`/s/${shareToken}`, '/s/' + 'y'.repeat(43)]) {
      const res = await ctx.app.request(path);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('x-robots-tag')).toBe('noindex');
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');
      expect(res.headers.get('content-security-policy')).toBe("default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; img-src 'self'");
      expect(res.headers.get('content-type')).toContain('text/html');
      const html = await res.text();
      expect(html).not.toMatch(/(src|href)="https?:\/\/[^"]*\.(woff2?|css|js)"/);
    }
    const font = await ctx.app.request('/static/fonts/jost-latin-400-normal.woff2');
    expect(font.status).toBe(200);
    expect(font.headers.get('cache-control')).toContain('immutable');
    expect(font.headers.get('content-type')).toBe('font/woff2');
    expect((await font.arrayBuffer()).byteLength).toBeGreaterThan(1000);
    expect((await ctx.app.request('/static/fonts/..%2Fpackage.json')).status).toBe(404);
    expect((await ctx.app.request('/static/fonts/nope.woff2')).status).toBe(404);
  });

  test('share and unshare notify members', async () => {
    ctx = await makeApp();
    const owner = await signUp(ctx.app, 'owner@example.com');
    const { cat } = await seed(owner.token);
    const seen: string[][] = [];
    ctx.hub.notifyUsers = (ids) => void seen.push(ids);
    await share(owner.token, cat);
    await share(owner.token, cat, 'DELETE');
    expect(seen).toEqual([[owner.user.id], [owner.user.id]]);
  });
});
