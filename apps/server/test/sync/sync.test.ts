import { afterEach, describe, expect, test } from 'bun:test';
import { bearer, makeApp, signUp } from '../helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
afterEach(() => ctx.close());

type Table = 'workspaces' | 'categories' | 'items' | 'reminders';
type Change = { table: Table; row: unknown };
type Result = { table: Table; id: string; status: 'applied' | 'restored' | 'rejected'; reason?: string };
type Row = Record<string, unknown> & { id: string };
type Pull = {
  cursor: number;
  workspaces: Row[];
  categories: Row[];
  items: Row[];
  reminders: Row[];
  members: Row[];
  removedWorkspaceIds: string[];
};

const T0 = '2026-01-01T00:00:00.000Z';
const base = () => ({ id: crypto.randomUUID(), createdAt: T0, updatedAt: T0, deletedAt: null, updatedBy: null });
const ws = (over: Record<string, unknown> = {}) => ({ ...base(), name: 'Home', emoji: null, ownerId: null, sortKey: 'a0', ...over });
const cat = (workspaceId: string, over: Record<string, unknown> = {}) => ({
  ...base(),
  workspaceId,
  name: 'Reading',
  emoji: null,
  sortKey: 'a0',
  tabGroup: null,
  shareToken: null,
  ...over,
});
const item = (categoryId: string, over: Record<string, unknown> = {}) => ({
  ...base(),
  categoryId,
  kind: 'link',
  sortKey: 'a0',
  title: 'Example',
  url: 'https://example.com/',
  faviconUrl: null,
  note: null,
  body: null,
  done: false,
  restored: false,
  ...over,
});
const reminder = (itemId: string, over: Record<string, unknown> = {}) => ({
  ...base(),
  itemId,
  userId: 'ignored',
  remindAt: '2026-02-01T09:00:00.000Z',
  remindedAt: null,
  ...over,
});

async function push(token: string, changes: Change[]): Promise<Result[]> {
  const res = await ctx.app.request('/api/sync/push', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...bearer(token) },
    body: JSON.stringify({ changes }),
  });
  if (res.status !== 200) throw new Error(`push failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { results: Result[] }).results;
}

async function pull(token: string, cursor = 0): Promise<Pull> {
  const res = await ctx.app.request(`/api/sync/pull?cursor=${cursor}`, { headers: bearer(token) });
  if (res.status !== 200) throw new Error(`pull failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as Pull;
}

const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();

/** Adds a live member row straight in the database (the members API arrives in a later task). */
async function addMember(workspaceId: string, user: { id: string; email: string }, role: 'owner' | 'editor' | 'viewer') {
  const t = new Date();
  await ctx.sql`insert into workspace_members (id, workspace_id, user_id, email, role, created_at, updated_at, version)
    values (${crypto.randomUUID()}, ${workspaceId}, ${user.id}, ${user.email}, ${role}, ${t}, ${t}, nextval('change_seq'))`;
}

/** A user with one workspace, category and item. */
async function seed(email: string) {
  const u = await signUp(ctx.app, email);
  const w = ws();
  const c = cat(w.id);
  const i = item(c.id);
  const results = await push(u.token, [
    { table: 'workspaces', row: w },
    { table: 'categories', row: c },
    { table: 'items', row: i },
  ]);
  expect(results.map((r) => r.status)).toEqual(['applied', 'applied', 'applied']);
  return { ...u, w, c, i };
}

describe('sync', () => {
  test('push creates workspace with owner member', async () => {
    ctx = await makeApp();
    const a = await signUp(ctx.app, 'a@example.com');
    const w = ws({ name: 'Mine' });
    expect(await push(a.token, [{ table: 'workspaces', row: w }])).toEqual([
      { table: 'workspaces', id: w.id, status: 'applied' },
    ]);
    const [row] = await ctx.sql`select owner_id, name, updated_by from workspaces where id = ${w.id}`;
    expect(row).toEqual({ owner_id: a.user.id, name: 'Mine', updated_by: a.user.id });
    const members = await ctx.sql`select user_id, email, role, deleted_at from workspace_members where workspace_id = ${w.id}`;
    expect(members).toEqual([{ user_id: a.user.id, email: 'a@example.com', role: 'owner', deleted_at: null }]);
  });

  test('push validates the request shape', async () => {
    ctx = await makeApp();
    const a = await signUp(ctx.app, 'a@example.com');
    const send = (body: unknown) =>
      ctx.app.request('/api/sync/push', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...bearer(a.token) },
        body: JSON.stringify(body),
      });
    expect((await send({ changes: [] })).status).toBe(400);
    expect((await send({ changes: [{ table: 'users', row: {} }] })).status).toBe(400);
    expect((await send({ changes: Array.from({ length: 1001 }, () => ({ table: 'workspaces', row: ws() })) })).status).toBe(400);
    expect((await ctx.app.request('/api/sync/push', { method: 'POST', body: '{}' })).status).toBe(401);
    expect((await ctx.app.request('/api/sync/pull?cursor=0')).status).toBe(401);
    expect((await ctx.app.request('/api/sync/pull?cursor=-1', { headers: bearer(a.token) })).status).toBe(400);
    // an invalid row is rejected on its own, results stay in input order
    const good = ws();
    expect(await push(a.token, [{ table: 'categories', row: { id: 'x' } }, { table: 'workspaces', row: good }])).toEqual([
      { table: 'categories', id: 'x', status: 'rejected', reason: 'invalid' },
      { table: 'workspaces', id: good.id, status: 'applied' },
    ]);
  });

  test('pull returns own rows after cursor 0 and nothing new after returned cursor', async () => {
    ctx = await makeApp();
    const a = await seed('a@example.com');
    const r = reminder(a.i.id);
    await push(a.token, [{ table: 'reminders', row: r }]);

    const first = await pull(a.token, 0);
    expect(ids(first.workspaces)).toEqual([a.w.id]);
    expect(ids(first.categories)).toEqual([a.c.id]);
    expect(ids(first.items)).toEqual([a.i.id]);
    expect(ids(first.reminders)).toEqual([r.id]);
    expect(first.members).toEqual([
      { id: expect.any(String), workspaceId: a.w.id, userId: a.user.id, email: 'a@example.com', role: 'owner', displayName: null, deletedAt: null },
    ]);
    expect(first.removedWorkspaceIds).toEqual([]);
    expect(first.cursor).toBeGreaterThan(0);
    expect(first.items[0]).toMatchObject({ ...a.i, updatedAt: expect.any(String), updatedBy: a.user.id });
    expect(first.workspaces[0]).toMatchObject({ ...a.w, ownerId: a.user.id, updatedBy: a.user.id, updatedAt: expect.any(String) });

    const second = await pull(a.token, first.cursor);
    expect(second).toEqual({
      cursor: first.cursor,
      workspaces: [],
      categories: [],
      items: [],
      reminders: [],
      members: [],
      removedWorkspaceIds: [],
    });

    // an edit shows up after the cursor, and only the edited row
    await push(a.token, [{ table: 'items', row: { ...a.i, title: 'Renamed' } }]);
    const third = await pull(a.token, first.cursor);
    expect(third.items.map((i) => i.title)).toEqual(['Renamed']);
    expect(third.categories).toEqual([]);
    expect(third.cursor).toBeGreaterThan(first.cursor);
  });

  test('push rejects writes from viewers and non-members', async () => {
    ctx = await makeApp();
    const a = await seed('a@example.com');
    const viewer = await signUp(ctx.app, 'v@example.com');
    const stranger = await signUp(ctx.app, 'x@example.com');
    await addMember(a.w.id, viewer.user, 'viewer');
    const snapshot = () => ctx.sql`
      select id, version, updated_at from items where id = ${a.i.id}
      union all select id, version, updated_at from categories where id = ${a.c.id}
      union all select id, version, updated_at from workspaces where id = ${a.w.id} order by id`;
    const before = await snapshot();

    for (const u of [viewer, stranger]) {
      const results = await push(u.token, [
        { table: 'workspaces', row: { ...a.w, name: 'Hijacked' } },
        { table: 'categories', row: { ...a.c, name: 'Hijacked' } },
        { table: 'categories', row: cat(a.w.id) },
        { table: 'items', row: { ...a.i, title: 'Hijacked' } },
        { table: 'items', row: item(a.c.id) },
      ]);
      expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected', 'rejected', 'rejected', 'rejected']);
    }
    // a stranger cannot move A's category into their own workspace either
    const sw = ws();
    const sc = cat(sw.id);
    const moved = await push(stranger.token, [
      { table: 'workspaces', row: sw },
      { table: 'categories', row: sc },
      { table: 'categories', row: { ...a.c, workspaceId: sw.id } },
      { table: 'items', row: { ...a.i, categoryId: sc.id } },
    ]);
    expect(moved.map((r) => r.status)).toEqual(['applied', 'applied', 'rejected', 'rejected']);

    expect(await snapshot()).toEqual(before);
    const [w] = await ctx.sql`select name from workspaces where id = ${a.w.id}`;
    expect(w.name).toBe('Home');

    // the stranger sees nothing of A's
    const p = await pull(stranger.token, 0);
    expect(ids(p.workspaces)).toEqual([sw.id]);
    expect(ids(p.categories)).toEqual([sc.id]);
    expect(p.items).toEqual([]);
  });

  test('editors can edit but only owners delete a workspace', async () => {
    ctx = await makeApp();
    const a = await seed('a@example.com');
    const ed = await signUp(ctx.app, 'e@example.com');
    await addMember(a.w.id, ed.user, 'editor');
    const res = await push(ed.token, [
      { table: 'workspaces', row: { ...a.w, name: 'Ours' } },
      { table: 'workspaces', row: { ...a.w, deletedAt: T0 } },
      { table: 'items', row: { ...a.i, title: 'Edited' } },
    ]);
    expect(res.map((r) => r.status)).toEqual(['applied', 'rejected', 'applied']);
    const [w] = await ctx.sql`select name, deleted_at, owner_id from workspaces where id = ${a.w.id}`;
    expect(w).toEqual({ name: 'Ours', deleted_at: null, owner_id: a.user.id });
    expect((await push(a.token, [{ table: 'workspaces', row: { ...a.w, deletedAt: T0 } }]))[0]!.status).toBe('applied');
  });

  test('push restores a deleted parent', async () => {
    ctx = await makeApp();
    const a = await seed('a@example.com');
    // another device deletes the category and the workspace
    await push(a.token, [
      { table: 'workspaces', row: { ...a.w, deletedAt: T0 } },
      { table: 'categories', row: { ...a.c, deletedAt: T0 } },
    ]);
    const { cursor } = await pull(a.token, 0);

    // a tombstone push into the deleted category does not restore anything
    const gone = item(a.c.id, { deletedAt: T0 });
    expect((await push(a.token, [{ table: 'items', row: gone }]))[0]!.status).toBe('applied');
    const [stillDeleted] = await ctx.sql`select deleted_at from categories where id = ${a.c.id}`;
    expect(stillDeleted.deleted_at).not.toBeNull();

    // a live item pushed into it brings the chain back
    const fresh = item(a.c.id, { title: 'Written offline', restored: true });
    expect(await push(a.token, [{ table: 'items', row: fresh }])).toEqual([{ table: 'items', id: fresh.id, status: 'restored' }]);

    const p = await pull(a.token, cursor);
    expect(p.workspaces.map((w) => [w.id, w.deletedAt])).toEqual([[a.w.id, null]]);
    expect(p.categories.map((c) => [c.id, c.deletedAt])).toEqual([[a.c.id, null]]);
    const pulled = p.items.find((i) => i.id === fresh.id)!;
    expect(pulled).toMatchObject({ title: 'Written offline', restored: true, deletedAt: null });

    // clients may clear the tag; pushing true again does not set it
    await push(a.token, [{ table: 'items', row: { ...fresh, restored: false } }]);
    await push(a.token, [{ table: 'items', row: { ...fresh, restored: true } }]);
    const [stored] = await ctx.sql`select restored from items where id = ${fresh.id}`;
    expect(stored.restored).toBe(false);
    // a client cannot set it on a new row
    const claimed = item(a.c.id, { restored: true });
    expect((await push(a.token, [{ table: 'items', row: claimed }]))[0]!.status).toBe('applied');
    const [c2] = await ctx.sql`select restored from items where id = ${claimed.id}`;
    expect(c2.restored).toBe(false);
  });

  test('missing parent is rejected', async () => {
    ctx = await makeApp();
    const a = await signUp(ctx.app, 'a@example.com');
    const c = cat(crypto.randomUUID());
    const i = item(crypto.randomUUID());
    const r = reminder(crypto.randomUUID());
    expect(await push(a.token, [
      { table: 'reminders', row: r },
      { table: 'items', row: i },
      { table: 'categories', row: c },
    ])).toEqual([
      { table: 'reminders', id: r.id, status: 'rejected', reason: 'missing-parent' },
      { table: 'items', id: i.id, status: 'rejected', reason: 'missing-parent' },
      { table: 'categories', id: c.id, status: 'rejected', reason: 'missing-parent' },
    ]);
    // children listed before their parent in the same push are fine
    const w = ws();
    const c2 = cat(w.id);
    const i2 = item(c2.id);
    const res = await push(a.token, [
      { table: 'items', row: i2 },
      { table: 'categories', row: c2 },
      { table: 'workspaces', row: w },
    ]);
    expect(res.map((x) => [x.id, x.status])).toEqual([[i2.id, 'applied'], [c2.id, 'applied'], [w.id, 'applied']]);
  });

  test('server ignores client shareToken, ownerId, updatedAt', async () => {
    let clock = new Date('2026-03-01T12:00:00.000Z');
    ctx = await makeApp({ now: () => clock });
    const a = await signUp(ctx.app, 'a@example.com');
    const b = await signUp(ctx.app, 'b@example.com');
    const w = ws({ ownerId: b.user.id, updatedAt: '2030-01-01T00:00:00.000Z', updatedBy: b.user.id });
    const c = cat(w.id, { shareToken: 'chosen-by-client' });
    const i = item(c.id, { faviconUrl: 'javascript:alert(1)' });
    await push(a.token, [
      { table: 'workspaces', row: w },
      { table: 'categories', row: c },
      { table: 'items', row: i },
    ]);
    const [wr] = await ctx.sql`select owner_id, updated_at, updated_by from workspaces where id = ${w.id}`;
    expect(wr.owner_id).toBe(a.user.id);
    expect(wr.updated_by).toBe(a.user.id);
    expect(new Date(wr.updated_at).toISOString()).toBe('2026-03-01T12:00:00.000Z');
    const [cr] = await ctx.sql`select share_token from categories where id = ${c.id}`;
    expect(cr.share_token).toBeNull();
    const [ir] = await ctx.sql`select favicon_url from items where id = ${i.id}`;
    expect(ir.favicon_url).toBeNull();

    // a server-set share token survives a client push of null
    await ctx.sql`update categories set share_token = 'server-token' where id = ${c.id}`;
    await push(a.token, [{ table: 'categories', row: { ...c, name: 'Renamed' } }]);
    const [cr2] = await ctx.sql`select share_token, name from categories where id = ${c.id}`;
    expect(cr2).toEqual({ share_token: 'server-token', name: 'Renamed' });

    // updatedAt strictly increases even when the clock does not move or goes back
    clock = new Date('2026-03-01T11:00:00.000Z');
    await push(a.token, [{ table: 'workspaces', row: { ...w, name: 'Again' } }]);
    const [wr2] = await ctx.sql`select updated_at from workspaces where id = ${w.id}`;
    expect(new Date(wr2.updated_at).toISOString()).toBe('2026-03-01T12:00:00.001Z');
  });

  test('reminders are private to their user', async () => {
    ctx = await makeApp();
    const a = await seed('a@example.com');
    const b = await signUp(ctx.app, 'b@example.com');
    const stranger = await signUp(ctx.app, 'x@example.com');
    await addMember(a.w.id, b.user, 'viewer');

    const ra = reminder(a.i.id, { userId: b.user.id });
    const rb = reminder(a.i.id);
    expect((await push(a.token, [{ table: 'reminders', row: ra }]))[0]!.status).toBe('applied');
    // viewers can set their own reminders
    expect((await push(b.token, [{ table: 'reminders', row: rb }]))[0]!.status).toBe('applied');
    const [stored] = await ctx.sql`select user_id from reminders where id = ${ra.id}`;
    expect(stored.user_id).toBe(a.user.id);

    expect(ids((await pull(a.token, 0)).reminders)).toEqual([ra.id]);
    const pb = await pull(b.token, 0);
    expect(ids(pb.reminders)).toEqual([rb.id]);
    expect(pb.reminders[0]!.userId).toBe(b.user.id);

    // B cannot take over A's reminder; a stranger cannot remind on an item they cannot see
    expect(await push(b.token, [{ table: 'reminders', row: { ...ra, remindAt: '2027-01-01T00:00:00.000Z' } }])).toEqual([
      { table: 'reminders', id: ra.id, status: 'rejected', reason: 'forbidden' },
    ]);
    expect((await push(stranger.token, [{ table: 'reminders', row: reminder(a.i.id) }]))[0]!.status).toBe('rejected');
    const [still] = await ctx.sql`select user_id, remind_at from reminders where id = ${ra.id}`;
    expect(still.user_id).toBe(a.user.id);
    expect(new Date(still.remind_at).toISOString()).toBe('2026-02-01T09:00:00.000Z');
  });

  test('rejects non-http link url', async () => {
    ctx = await makeApp();
    const a = await seed('a@example.com');
    const bad = item(a.c.id, { url: 'javascript:alert(1)' });
    const data = item(a.c.id, { url: 'data:text/html,hi' });
    const ok = item(a.c.id, { url: 'ftp://files.example.com/x' });
    expect(await push(a.token, [
      { table: 'items', row: bad },
      { table: 'items', row: data },
      { table: 'items', row: ok },
      { table: 'items', row: { ...a.i, url: 'chrome://settings' } },
    ])).toEqual([
      { table: 'items', id: bad.id, status: 'rejected', reason: 'invalid' },
      { table: 'items', id: data.id, status: 'rejected', reason: 'invalid' },
      { table: 'items', id: ok.id, status: 'applied' },
      { table: 'items', id: a.i.id, status: 'rejected', reason: 'invalid' },
    ]);
    const [row] = await ctx.sql`select url from items where id = ${a.i.id}`;
    expect(row.url).toBe('https://example.com/');
  });

  test('newly shared workspace is pulled in full', async () => {
    ctx = await makeApp();
    const a = await seed('a@example.com');
    const b = await signUp(ctx.app, 'b@example.com');
    await ctx.sql`update users set display_name = 'Ann' where id = ${a.user.id}`;
    const own = ws();
    await push(b.token, [{ table: 'workspaces', row: own }]);
    const first = await pull(b.token, 0);
    expect(ids(first.workspaces)).toEqual([own.id]);

    await addMember(a.w.id, b.user, 'editor');
    const second = await pull(b.token, first.cursor);
    expect(ids(second.workspaces)).toEqual([a.w.id]);
    expect(ids(second.categories)).toEqual([a.c.id]);
    expect(ids(second.items)).toEqual([a.i.id]);
    expect(second.members.map((m) => [m.email, m.role, m.displayName]).sort()).toEqual([
      ['a@example.com', 'owner', 'Ann'],
      ['b@example.com', 'editor', null],
    ]);
    expect(second.cursor).toBeGreaterThan(first.cursor);
    // and nothing again after that
    const third = await pull(b.token, second.cursor);
    expect([third.workspaces, third.categories, third.items, third.members]).toEqual([[], [], [], []]);
  });

  test('removed member gets removedWorkspaceIds', async () => {
    ctx = await makeApp();
    const a = await seed('a@example.com');
    const b = await signUp(ctx.app, 'b@example.com');
    await addMember(a.w.id, b.user, 'editor');
    const first = await pull(b.token, 0);
    expect(ids(first.items)).toEqual([a.i.id]);

    await ctx.sql`update workspace_members set deleted_at = now(), version = nextval('change_seq')
      where workspace_id = ${a.w.id} and user_id = ${b.user.id}`;
    // A keeps editing; B must not see it
    await push(a.token, [{ table: 'items', row: { ...a.i, title: 'Private now' } }]);
    const second = await pull(b.token, first.cursor);
    expect(second.removedWorkspaceIds).toEqual([a.w.id]);
    expect([second.workspaces, second.categories, second.items, second.members]).toEqual([[], [], [], []]);
    expect(second.cursor).toBeGreaterThan(first.cursor);
    expect((await pull(b.token, second.cursor)).removedWorkspaceIds).toEqual([]);

    // and B's edits are now refused
    expect((await push(b.token, [{ table: 'items', row: { ...a.i, title: 'Late edit' } }]))[0]!.status).toBe('rejected');
  });

  test('push notifies live members of changed workspaces', async () => {
    const calls: string[][] = [];
    ctx = await makeApp({ hub: { notifyUsers: (userIds) => calls.push([...userIds].sort()) } });
    const a = await seed('a@example.com');
    const b = await signUp(ctx.app, 'b@example.com');
    await addMember(a.w.id, b.user, 'viewer');
    calls.length = 0;
    await push(a.token, [{ table: 'items', row: { ...a.i, title: 'New' } }]);
    expect(calls).toEqual([[a.user.id, b.user.id].sort()]);
    calls.length = 0;
    await push(b.token, [{ table: 'items', row: { ...a.i, title: 'Nope' } }]);
    expect(calls).toEqual([]);
  });

  test('concurrent pushes never let a pull skip a version', async () => {
    ctx = await makeApp();
    const a = await signUp(ctx.app, 'a@example.com');
    const expected = new Set<string>();
    const batches = Array.from({ length: 20 }, () => {
      const w = ws();
      const changes: Change[] = [{ table: 'workspaces', row: w }];
      expected.add(w.id);
      for (let k = 0; k < 3; k++) {
        const c = cat(w.id);
        changes.push({ table: 'categories', row: c });
        expected.add(c.id);
        for (let n = 0; n < 5; n++) {
          const i = item(c.id);
          changes.push({ table: 'items', row: i });
          expected.add(i.id);
        }
      }
      return changes;
    });

    const seen = new Set<string>();
    let cursor = 0;
    const record = (p: Pull) => {
      for (const r of [...p.workspaces, ...p.categories, ...p.items]) seen.add(r.id);
      expect(p.cursor).toBeGreaterThanOrEqual(cursor);
      cursor = p.cursor;
    };
    let done = false;
    const pushes = Promise.all(batches.map((changes) => push(a.token, changes))).finally(() => (done = true));
    while (!done) record(await pull(a.token, cursor));
    await pushes;
    record(await pull(a.token, cursor));

    expect(seen.size).toBe(expected.size);
    for (const id of expected) expect(seen.has(id)).toBe(true);
  });
});
