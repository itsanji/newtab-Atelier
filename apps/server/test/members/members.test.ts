import { afterEach, describe, expect, test } from 'bun:test';
import { bearer, makeApp, signUp } from '../helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
afterEach(() => ctx.close());

const T0 = '2026-01-01T00:00:00.000Z';
const json = (token: string) => ({ 'content-type': 'application/json', ...bearer(token) });

async function createWorkspace(token: string, name = 'Studio') {
  const id = crypto.randomUUID();
  const res = await ctx.app.request('/api/sync/push', {
    method: 'POST',
    headers: json(token),
    body: JSON.stringify({
      changes: [{ table: 'workspaces', row: { id, name, emoji: null, ownerId: null, sortKey: 'a0', createdAt: T0, updatedAt: T0, deletedAt: null, updatedBy: null } }],
    }),
  });
  expect(res.status).toBe(200);
  return id;
}

const invite = (token: string, ws: string, email: string, role = 'editor') =>
  ctx.app.request(`/api/workspaces/${ws}/members`, { method: 'POST', headers: json(token), body: JSON.stringify({ email, role }) });
const members = async (token: string, ws: string) =>
  ((await (await ctx.app.request(`/api/workspaces/${ws}/members`, { headers: bearer(token) })).json()) as { members: any[] }).members;
const pull = async (token: string, cursor = 0) =>
  (await (await ctx.app.request(`/api/sync/pull?cursor=${cursor}`, { headers: bearer(token) })).json()) as any;

describe('members', () => {
  test('owner invites existing user who then pulls the workspace', async () => {
    ctx = await makeApp();
    const owner = await signUp(ctx.app, 'owner@example.com');
    const guest = await signUp(ctx.app, 'guest@example.com');
    const ws = await createWorkspace(owner.token);
    const res = await invite(owner.token, ws, 'Guest@Example.com', 'viewer');
    expect(res.status).toBe(201);
    const { member } = (await res.json()) as { member: any };
    expect(member).toMatchObject({ email: 'guest@example.com', role: 'viewer', userId: guest.user.id });
    const p = await pull(guest.token);
    expect(p.workspaces.map((w: any) => w.id)).toEqual([ws]);
    expect((await members(guest.token, ws)).map((m) => m.email).sort()).toEqual(['guest@example.com', 'owner@example.com']);
  });

  test('invite unknown email is pending then attached on signup', async () => {
    ctx = await makeApp();
    const owner = await signUp(ctx.app, 'owner@example.com');
    const ws = await createWorkspace(owner.token);
    const { member } = (await (await invite(owner.token, ws, 'later@example.com')).json()) as { member: any };
    expect(member.userId).toBeNull();
    const later = await signUp(ctx.app, 'later@example.com');
    expect((await pull(later.token)).workspaces.map((w: any) => w.id)).toEqual([ws]);
    expect((await members(owner.token, ws)).find((m) => m.email === 'later@example.com').userId).toBe(later.user.id);
  });

  test('editor cannot invite', async () => {
    ctx = await makeApp();
    const owner = await signUp(ctx.app, 'owner@example.com');
    const editor = await signUp(ctx.app, 'editor@example.com');
    const outsider = await signUp(ctx.app, 'out@example.com');
    const ws = await createWorkspace(owner.token);
    await invite(owner.token, ws, 'editor@example.com');
    expect((await invite(editor.token, ws, 'x@example.com')).status).toBe(403);
    expect((await invite(outsider.token, ws, 'x@example.com')).status).toBe(404);
    expect((await invite(owner.token, ws, 'x@example.com', 'owner')).status).toBe(400);
    expect((await invite(owner.token, ws, 'editor@example.com')).status).toBe(409);
  });

  test('member can leave, owner cannot be removed', async () => {
    ctx = await makeApp();
    const owner = await signUp(ctx.app, 'owner@example.com');
    const guest = await signUp(ctx.app, 'guest@example.com');
    const other = await signUp(ctx.app, 'other@example.com');
    const ws = await createWorkspace(owner.token);
    await invite(owner.token, ws, 'guest@example.com');
    await invite(owner.token, ws, 'other@example.com', 'viewer');
    const list = await members(owner.token, ws);
    const id = (email: string) => list.find((m) => m.email === email).id as string;
    const del = (token: string, memberId: string) =>
      ctx.app.request(`/api/workspaces/${ws}/members/${memberId}`, { method: 'DELETE', headers: bearer(token) });

    const cursor = (await pull(guest.token)).cursor;
    expect((await del(owner.token, id('owner@example.com'))).status).toBe(400);
    expect((await del(guest.token, id('owner@example.com'))).status).toBe(403);
    expect((await del(guest.token, id('other@example.com'))).status).toBe(403);
    expect((await del(guest.token, id('guest@example.com'))).status).toBe(204);
    expect((await pull(guest.token, cursor)).removedWorkspaceIds).toEqual([ws]);
    expect((await ctx.app.request(`/api/workspaces/${ws}/members`, { headers: bearer(guest.token) })).status).toBe(404);

    // Owner removes another, then re-invites: the row is revived with the new role.
    expect((await del(owner.token, id('other@example.com'))).status).toBe(204);
    expect((await members(owner.token, ws)).map((m) => m.email)).toEqual(['owner@example.com']);
    const re = await invite(owner.token, ws, 'other@example.com', 'editor');
    expect(re.status).toBe(201);
    expect(((await re.json()) as any).member).toMatchObject({ id: id('other@example.com'), role: 'editor', userId: other.user.id });

    // Role change: owner only, owner row fixed.
    const patch = (token: string, memberId: string, role: string) =>
      ctx.app.request(`/api/workspaces/${ws}/members/${memberId}`, { method: 'PATCH', headers: json(token), body: JSON.stringify({ role }) });
    expect((await patch(owner.token, id('other@example.com'), 'viewer')).status).toBe(200);
    expect((await members(owner.token, ws)).find((m) => m.email === 'other@example.com').role).toBe('viewer');
    expect((await patch(other.token, id('other@example.com'), 'editor')).status).toBe(403);
    expect((await patch(owner.token, id('owner@example.com'), 'viewer')).status).toBe(400);
  });

  test('invite email sent only when mail configured', async () => {
    ctx = await makeApp();
    const owner = await signUp(ctx.app, 'owner@example.com', 'correct horse battery');
    const ws = await createWorkspace(owner.token, 'Plans <b>');
    expect((await invite(owner.token, ws, 'guest@example.com')).status).toBe(201);
    expect(ctx.mail.sent).toHaveLength(1);
    const msg = ctx.mail.sent[0]!;
    expect(msg.to).toBe('guest@example.com');
    expect(msg.subject).toBe('owner@example.com shared “Plans <b>” with you on Atelier');
    expect(msg.text).toContain('http://localhost:8787');
    expect(msg.html).toContain('Plans &lt;b&gt;');
    await ctx.close();

    ctx = await makeApp({ mail: null });
    const o2 = await signUp(ctx.app, 'owner@example.com');
    const ws2 = await createWorkspace(o2.token);
    expect((await invite(o2.token, ws2, 'guest@example.com')).status).toBe(201);
    expect(ctx.mail.sent).toHaveLength(0);
  });

  test('websocket gets changed after a member push', async () => {
    ctx = await makeApp();
    const server = Bun.serve({ port: 0, fetch: ctx.app.fetch, websocket: ctx.websocket });
    try {
      const owner = await signUp(ctx.app, 'owner@example.com');
      const guest = await signUp(ctx.app, 'guest@example.com');
      const ws = await createWorkspace(owner.token);
      await invite(owner.token, ws, 'guest@example.com');

      const open = (token: string) =>
        new Promise<{ socket: WebSocket; messages: string[]; closed: Promise<number> }>((resolve, reject) => {
          const socket = new WebSocket(`ws://127.0.0.1:${server.port}/api/live`);
          const messages: string[] = [];
          const closed = new Promise<number>((r) => socket.addEventListener('close', (e) => r(e.code)));
          socket.addEventListener('open', () => socket.send(JSON.stringify({ type: 'auth', token })));
          socket.addEventListener('message', (e) => {
            const type = JSON.parse(String(e.data)).type;
            messages.push(type);
            if (type === 'ready') resolve({ socket, messages, closed });
          });
          socket.addEventListener('error', () => reject(new Error('socket error')));
          closed.then(() => reject(new Error('closed before ready')));
        });
      const waitFor = async (messages: string[], type: string) => {
        for (let i = 0; i < 100 && !messages.includes(type); i++) await Bun.sleep(20);
        expect(messages).toContain(type);
      };

      const g = await open(guest.token);
      await ctx.app.request('/api/sync/push', {
        method: 'POST',
        headers: json(owner.token),
        body: JSON.stringify({
          changes: [{ table: 'categories', row: { id: crypto.randomUUID(), workspaceId: ws, name: 'New', emoji: null, sortKey: 'a0', tabGroup: null, shareToken: null, createdAt: T0, updatedAt: T0, deletedAt: null, updatedBy: null } }],
        }),
      });
      await waitFor(g.messages, 'changed');
      g.socket.close();

      // A bad token is closed with 4401.
      const bad = new WebSocket(`ws://127.0.0.1:${server.port}/api/live`);
      const code = new Promise<number>((r) => bad.addEventListener('close', (e) => r(e.code)));
      bad.addEventListener('open', () => bad.send(JSON.stringify({ type: 'auth', token: 'nope' })));
      expect(await code).toBe(4401);
    } finally {
      server.stop(true);
    }
  });
});
