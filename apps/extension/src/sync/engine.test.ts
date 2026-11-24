import { beforeEach, describe, expect, test, vi } from 'vitest';
import { itemSchema, type Category, type Item, type Reminder, type Workspace } from '@atelier/core';
import { noteText } from '../data/noteText';
import { installChromeFake, type ChromeFake } from '../../test/chromeFake';
import { openDb, outboxKey, type AtelierDB } from '../data/db';
import { clock, createCategory, createItem, createWorkspace, setReminder, updateItem } from '../data/repo';
import { liveCategories, liveItems } from '../data/queries';
import { partitionFor, setCurrentUserId, type Account } from '../account/account';
import { OfflineError, UnauthorizedError, type Change, type PullResponse, type PushResult } from './api';
import { applyPull, pushOutbox, recover, syncOnce, type SyncApi } from './engine';
import { getSyncStatus, takeRecovered } from './status';

const USER = 'user-1';
let db: AtelierDB;
let chromeFake: ChromeFake;
let account: Account;
let t = 0;

beforeEach(() => {
  chromeFake = installChromeFake();
  setCurrentUserId(USER);
  account = {
    serverUrl: 'https://s.example', userId: USER, email: 'u@x.io', displayName: 'U', token: 'tok',
    partition: partitionFor('https://s.example', USER) + '-' + crypto.randomUUID(),
  };
  db = openDb('test-' + crypto.randomUUID());
  t = 0;
  clock.now = () => new Date(Date.UTC(2026, 0, 1, 0, 0, ++t)).toISOString();
});

const emptyPull = (cursor = 0): PullResponse => ({
  cursor, workspaces: [], categories: [], items: [], reminders: [], members: [], removedWorkspaceIds: [],
});

/** A fake server: records pushes, answers `applied` unless `decide` says otherwise. */
function fakeApi(opts: {
  decide?: (c: Change) => PushResult['status'];
  pull?: (cursor: number) => PullResponse | Promise<PullResponse>;
} = {}) {
  const pushes: Change[][] = [];
  const api = {
    push: vi.fn(async (changes: Change[]) => {
      pushes.push(changes);
      return {
        results: changes.map((c) => ({
          table: c.table, id: (c.row as { id: string }).id, status: opts.decide?.(c) ?? 'applied',
        })) as PushResult[],
      };
    }),
    pull: vi.fn(async (cursor: number) => (opts.pull ? opts.pull(cursor) : emptyPull(cursor))),
  };
  return { api: api as SyncApi & typeof api, pushes };
}

async function setup() {
  const ws = await createWorkspace(db, { name: 'W' });
  const cat = await createCategory(db, { workspaceId: ws.id, name: 'C' });
  const item = await createItem(db, { categoryId: cat.id, kind: 'link', title: 'a', url: 'https://a.example' });
  return { ws, cat, item };
}

const ts = (s: number) => new Date(Date.UTC(2026, 5, 1, 0, 0, s)).toISOString();
const row = { createdAt: ts(0), updatedAt: ts(1), deletedAt: null, updatedBy: 'other' };
const serverWs = (id: string, extra: Partial<Workspace> = {}): Workspace => ({
  ...row, id, name: 'Server W', emoji: null, ownerId: 'other', sortKey: 'a0', ...extra,
});
const serverCat = (id: string, workspaceId: string, extra: Partial<Category> = {}): Category => ({
  ...row, id, workspaceId, name: 'Server C', emoji: null, sortKey: 'a0', tabGroup: null, shareToken: null, ...extra,
});
const serverItem = (id: string, categoryId: string, extra: Partial<Item> = {}): Item => ({
  ...row, id, categoryId, kind: 'link', sortKey: 'a0', title: 'Server item', url: 'https://s.example/x',
  faviconUrl: null, note: null, body: null, done: false, restored: false, ...extra,
});

describe('pushOutbox', () => {
  test('push orders by table then seq', async () => {
    const { ws, cat, item } = await setup();
    await setReminder(db, item.id, ts(9));
    // Edit the parents after the child: they now have higher seqs than the item.
    await db.transaction('rw', db.outbox, async () => {
      const base = (await db.outbox.orderBy('seq').last())!.seq;
      await db.outbox.update(outboxKey('workspaces', ws.id), { seq: base + 10 });
      await db.outbox.update(outboxKey('categories', cat.id), { seq: base + 5 });
    });
    const { api, pushes } = fakeApi();
    await pushOutbox(db, api);
    expect(pushes).toHaveLength(1);
    expect(pushes[0]!.map((c) => c.table)).toEqual(['workspaces', 'categories', 'items', 'reminders']);
    expect(await db.outbox.count()).toBe(0);
  });

  test('push sends chunks of 500', async () => {
    const { cat } = await setup();
    await db.transaction('rw', db.items, db.outbox, async () => {
      const last = (await db.outbox.orderBy('seq').last())!.seq;
      for (let i = 0; i < 600; i++) {
        const it = { ...(await db.items.toCollection().first())!, id: crypto.randomUUID(), categoryId: cat.id };
        await db.outbox.put({ key: outboxKey('items', it.id), seq: last + 1 + i, table: 'items', rowId: it.id, row: it, queuedAt: ts(0) });
      }
    });
    const { api, pushes } = fakeApi();
    await pushOutbox(db, api);
    expect(pushes.map((p) => p.length)).toEqual([500, 103]);
    expect(await db.outbox.count()).toBe(0);
  });

  test('push success clears only unchanged outbox entries', async () => {
    const { item } = await setup();
    let edited = false;
    const { api } = fakeApi();
    const push = api.push.getMockImplementation()!;
    api.push.mockImplementation(async (changes) => {
      // The user edits the item while the push is in flight.
      if (!edited) { edited = true; await updateItem(db, item.id, { title: 'edited during push' }); }
      return push(changes);
    });
    await pushOutbox(db, api);
    const left = await db.outbox.toArray();
    expect(left.map((e) => e.key)).toEqual([outboxKey('items', item.id)]);
    expect((left[0]!.row as Item).title).toBe('edited during push');
  });

  test('restored result tags item and un-tombstones local parents without enqueueing', async () => {
    const { ws, cat, item } = await setup();
    // Another device deleted the category; locally it arrived as a tombstone.
    await db.categories.update(cat.id, { deletedAt: ts(5) });
    const { api } = fakeApi({ decide: (c) => (c.table === 'items' ? 'restored' : 'applied') });
    const r = await pushOutbox(db, api);
    expect(r.restored).toBe(1);
    expect((await db.items.get(item.id))!.restored).toBe(true);
    expect((await db.categories.get(cat.id))!.deletedAt).toBeNull();
    expect((await liveItems(db, cat.id)).map((i) => i.id)).toEqual([item.id]);
    expect((await db.workspaces.get(ws.id))!.deletedAt).toBeNull();
    expect(await db.outbox.count()).toBe(0);
  });

  test('rejected items are copied to Recovered', async () => {
    const { ws } = await setup();
    // A shared workspace where this user is only a viewer: their edit there is rejected.
    const shared = serverWs(crypto.randomUUID());
    const sharedCat = serverCat(crypto.randomUUID(), shared.id);
    await db.workspaces.put(shared);
    await db.categories.put(sharedCat);
    await db.members.put({ id: crypto.randomUUID(), workspaceId: shared.id, userId: USER, role: 'viewer' });
    await db.outbox.clear();
    const mine = await createItem(db, { categoryId: sharedCat.id, kind: 'note', title: 'my words', body: { type: 'doc' } });
    const { api } = fakeApi({ decide: (c) => ((c.row as { id: string }).id === mine.id ? 'rejected' : 'applied') });
    const r = await pushOutbox(db, api);
    expect(r.recovered).toBe(1);
    expect(await db.items.get(mine.id)).toBeUndefined();
    const recoveredCat = (await liveCategories(db, ws.id)).find((c) => c.name === 'Recovered')!;
    expect(recoveredCat).toBeDefined();
    expect((await liveCategories(db, ws.id)).at(-1)!.id).toBe(recoveredCat.id);
    const copies = await liveItems(db, recoveredCat.id);
    expect(copies).toHaveLength(1);
    expect(copies[0]!.id).not.toBe(mine.id);
    expect(copies[0]).toMatchObject({ title: 'my words', kind: 'note', body: { type: 'doc' } });
    // Copy and its category are queued for the next push; the rejected entry is gone.
    const keys = (await db.outbox.toArray()).map((e) => e.key).sort();
    expect(keys).toEqual([outboxKey('categories', recoveredCat.id), outboxKey('items', copies[0]!.id)].sort());
    expect(await takeRecovered(account.partition)).toBe(0); // only syncOnce reports to status
  });

  test('a push response that does not match the request keeps the outbox', async () => {
    await setup();
    const before = await db.outbox.count();
    const { api } = fakeApi();
    api.push.mockResolvedValueOnce({ results: [] });
    await expect(pushOutbox(db, api)).rejects.toThrow('Unexpected push response');
    api.push.mockImplementationOnce(async (changes: Change[]) => ({
      results: changes.map((c) => ({ table: c.table, id: 'someone-else', status: 'applied' as const })),
    }));
    await expect(pushOutbox(db, api)).rejects.toThrow('Unexpected push response');
    expect(await db.outbox.count()).toBe(before);
  });

  test('push failure keeps outbox', async () => {
    await setup();
    const before = await db.outbox.count();
    const { api } = fakeApi();
    api.push.mockRejectedValue(new OfflineError());
    await expect(pushOutbox(db, api)).rejects.toBeInstanceOf(OfflineError);
    expect(await db.outbox.count()).toBe(before);
  });
});

describe('recover', () => {
  test('drops rejected workspaces, categories and reminders locally', async () => {
    const { ws, cat, item } = await setup();
    const rem = await setReminder(db, item.id, ts(9));
    const other = await createWorkspace(db, { name: 'Other' });
    const n = await recover(db, [
      { table: 'workspaces', row: other },
      { table: 'categories', row: cat },
      { table: 'reminders', row: rem },
    ], USER);
    expect(n).toBe(0);
    expect(await db.workspaces.get(other.id)).toBeUndefined();
    expect(await db.categories.get(cat.id)).toBeUndefined();
    expect(await db.reminders.get(rem.id)).toBeUndefined();
    expect(await db.workspaces.get(ws.id)).toBeDefined();
    for (const key of [outboxKey('workspaces', other.id), outboxKey('categories', cat.id), outboxKey('reminders', rem.id)]) {
      expect(await db.outbox.get(key)).toBeUndefined();
    }
  });

  test('rejected item with invalid url is recovered as a valid, queued row', async () => {
    const { ws, cat } = await setup();
    await db.outbox.clear();
    const link = { ...(await createItem(db, { categoryId: cat.id, kind: 'link', title: 'Bad link', url: 'https://ok.example' })), url: 'javascript:alert(1)', note: 'my note' };
    const todo = { ...(await createItem(db, { categoryId: cat.id, kind: 'todo', title: 'Do it' })), url: 'chrome://settings' };
    const weird = { ...link, id: crypto.randomUUID(), kind: 'bogus', title: 42, done: 'yes', faviconUrl: 7, url: null } as unknown as Item;
    await db.outbox.clear();
    expect(await recover(db, [{ table: 'items', row: link }, { table: 'items', row: todo }, { table: 'items', row: weird }], USER)).toBe(3);
    const recoveredCat = (await liveCategories(db, ws.id)).find((c) => c.name === 'Recovered')!;
    const copies = await liveItems(db, recoveredCat.id);
    expect(copies).toHaveLength(3);
    for (const c of copies) expect(itemSchema.safeParse(c).success).toBe(true);
    const [l, t, w] = copies;
    // The link's url text survives as a note item; nothing the user typed is lost.
    expect(l).toMatchObject({ kind: 'note', url: null, title: 'Bad link', note: 'my note' });
    expect(noteText(l!.body)).toContain('javascript:alert(1)');
    expect(t).toMatchObject({ kind: 'todo', url: null, title: 'Do it', note: 'chrome://settings' });
    expect(w).toMatchObject({ kind: 'note', title: '42', done: false, faviconUrl: null });
    // Every copy is queued.
    const queued = (await db.outbox.where('key').startsWith('items:').toArray()).map((e) => e.rowId).sort();
    expect(queued).toEqual(copies.map((c) => c.id).sort());
  });

  test('reminders rejected with their item follow the recovered copy', async () => {
    const { item } = await setup();
    const rem = await setReminder(db, item.id, ts(40));
    const n = await recover(db, [{ table: 'items', row: item }, { table: 'reminders', row: rem }], USER);
    expect(n).toBe(1);
    const copyRem = (await db.reminders.toArray()).filter((r) => r.deletedAt === null);
    expect(copyRem).toHaveLength(1);
    expect(copyRem[0]).toMatchObject({ remindAt: ts(40), userId: USER, remindedAt: null });
    expect(copyRem[0]!.itemId).not.toBe(item.id);
    expect((await db.items.get(copyRem[0]!.itemId))!.title).toBe(item.title);
    expect(await db.outbox.get(outboxKey('reminders', copyRem[0]!.id))).toBeDefined();
  });

  test('reuses an existing Recovered category', async () => {
    const { ws, item } = await setup();
    await recover(db, [{ table: 'items', row: { ...item, id: crypto.randomUUID() } }], USER);
    await recover(db, [{ table: 'items', row: { ...item, id: crypto.randomUUID() } }], USER);
    const recovered = (await liveCategories(db, ws.id)).filter((c) => c.name === 'Recovered');
    expect(recovered).toHaveLength(1);
    expect(await liveItems(db, recovered[0]!.id)).toHaveLength(2);
  });
});

describe('applyPull', () => {
  test('pull applies rows and cursor', async () => {
    const ws = serverWs(crypto.randomUUID());
    const cat = serverCat(crypto.randomUUID(), ws.id);
    const it = serverItem(crypto.randomUUID(), cat.id);
    const rem: Reminder = { ...row, id: crypto.randomUUID(), itemId: it.id, userId: USER, remindAt: ts(30), remindedAt: null };
    const member = { id: crypto.randomUUID(), workspaceId: ws.id, userId: USER, email: 'u@x.io', role: 'editor' as const, displayName: null, deletedAt: null };
    await applyPull(db, { ...emptyPull(42), workspaces: [ws], categories: [cat], items: [it], reminders: [rem], members: [member] });
    expect(await db.workspaces.get(ws.id)).toEqual(ws);
    expect(await db.categories.get(cat.id)).toEqual(cat);
    expect(await db.items.get(it.id)).toEqual(it);
    expect(await db.reminders.get(rem.id)).toEqual(rem);
    expect((await db.members.get(member.id))!.role).toBe('editor');
    expect((await db.meta.get('syncCursor'))!.value).toBe(42);
    expect(await db.outbox.count()).toBe(0);
  });

  test('pull never overwrites a row with a pending outbox entry', async () => {
    const { item } = await setup();
    await updateItem(db, item.id, { title: 'local edit' });
    const older = { ...(await db.items.get(item.id))!, title: 'older server copy', updatedAt: ts(0) };
    await applyPull(db, { ...emptyPull(7), items: [older] });
    expect((await db.items.get(item.id))!.title).toBe('local edit');
    // After the push the server has the local edit; a pull then brings that copy back.
    const { api, pushes } = fakeApi();
    await pushOutbox(db, api);
    const sent = pushes[0]!.find((c) => c.table === 'items')!.row as Item;
    expect(sent.title).toBe('local edit');
    await applyPull(db, { ...emptyPull(8), items: [{ ...sent, version: 8 } as Item] });
    expect((await db.items.get(item.id))!.title).toBe('local edit');
  });

  test('member updates upsert and tombstoned members are removed', async () => {
    const wsId = crypto.randomUUID();
    const m = (id: string, extra = {}) => ({ id, workspaceId: wsId, userId: id, email: `${id}@x.io`, role: 'editor' as const, displayName: null, deletedAt: null, ...extra });
    await applyPull(db, { ...emptyPull(1), members: [m('a'), m('b')] });
    await applyPull(db, { ...emptyPull(2), members: [m('b', { deletedAt: ts(3) }), m('c')] });
    expect((await db.members.where('workspaceId').equals(wsId).toArray()).map((x) => x.id).sort()).toEqual(['a', 'c']);
  });

  test('removed workspace is deleted locally', async () => {
    const ws = serverWs(crypto.randomUUID());
    const cat = serverCat(crypto.randomUUID(), ws.id);
    const it = serverItem(crypto.randomUUID(), cat.id);
    const rem: Reminder = { ...row, id: crypto.randomUUID(), itemId: it.id, userId: USER, remindAt: ts(30), remindedAt: null };
    const member = { id: crypto.randomUUID(), workspaceId: ws.id, userId: USER, email: 'u@x.io', role: 'viewer' as const, displayName: null, deletedAt: null };
    const keep = await setup();
    await applyPull(db, { ...emptyPull(1), workspaces: [ws], categories: [cat], items: [it], reminders: [rem], members: [member] });
    await applyPull(db, { ...emptyPull(2), removedWorkspaceIds: [ws.id] });
    expect(await db.workspaces.get(ws.id)).toBeUndefined();
    expect(await db.categories.get(cat.id)).toBeUndefined();
    expect(await db.items.get(it.id)).toBeUndefined();
    expect(await db.reminders.get(rem.id)).toBeUndefined();
    expect(await db.members.get(member.id)).toBeUndefined();
    expect(await db.items.get(keep.item.id)).toBeDefined();
  });
});

test('moved-out rows are deleted locally', async () => {
  const ws = serverWs(crypto.randomUUID());
  const movedCat = serverCat(crypto.randomUUID(), ws.id);
  const inMoved = serverItem(crypto.randomUUID(), movedCat.id);
  const keepCat = serverCat(crypto.randomUUID(), ws.id);
  const movedItem = serverItem(crypto.randomUUID(), keepCat.id);
  const stays = serverItem(crypto.randomUUID(), keepCat.id);
  const editedHere = serverItem(crypto.randomUUID(), keepCat.id);
  const rem: Reminder = { ...row, id: crypto.randomUUID(), itemId: inMoved.id, userId: USER, remindAt: ts(30), remindedAt: null };
  await applyPull(db, {
    ...emptyPull(1), workspaces: [ws], categories: [movedCat, keepCat],
    items: [inMoved, movedItem, stays, editedHere], reminders: [rem],
  });
  setCurrentUserId(USER);
  await updateItem(db, editedHere.id, { title: 'pending local edit' });
  await applyPull(db, {
    ...emptyPull(2),
    goneRows: [{ table: 'categories', id: movedCat.id }, { table: 'items', id: movedItem.id }, { table: 'items', id: editedHere.id }],
  });
  expect(await db.categories.get(movedCat.id)).toBeUndefined();
  expect(await db.items.get(inMoved.id)).toBeUndefined();
  expect(await db.reminders.get(rem.id)).toBeUndefined();
  expect(await db.items.get(movedItem.id)).toBeUndefined();
  expect(await db.items.get(stays.id)).toBeDefined();
  expect((await db.items.get(editedHere.id))!.title).toBe('pending local edit');
  expect(await db.categories.get(keepCat.id)).toBeDefined();
  // A pull without goneRows (older server) is fine.
  const { goneRows: _, ...old } = emptyPull(3) as PullResponse;
  await applyPull(db, old as PullResponse);
  expect((await db.meta.get('syncCursor'))!.value).toBe(3);
});

describe('syncOnce', () => {
  test('pushes, pulls from the saved cursor and reports idle', async () => {
    await setup();
    await db.meta.put({ key: 'syncCursor', value: 5 });
    const { api } = fakeApi({ pull: (c) => emptyPull(c + 3) });
    const r = await syncOnce(db, account, api);
    expect(r.ok).toBe(true);
    expect(api.pull).toHaveBeenCalledWith(5);
    expect((await db.meta.get('syncCursor'))!.value).toBe(8);
    expect(await db.outbox.count()).toBe(0);
    expect((await getSyncStatus())!).toMatchObject({ state: 'idle', partition: account.partition });
  });

  test('push failure keeps outbox (offline status)', async () => {
    await setup();
    const before = await db.outbox.count();
    const { api } = fakeApi();
    api.push.mockRejectedValue(new OfflineError());
    const r = await syncOnce(db, account, api);
    expect(r).toMatchObject({ ok: false, state: 'offline' });
    expect(await db.outbox.count()).toBe(before);
    expect((await getSyncStatus())!.state).toBe('offline');
  });

  test('401 pauses sync', async () => {
    await setup();
    const before = await db.outbox.count();
    const { api } = fakeApi();
    api.push.mockRejectedValue(new UnauthorizedError());
    const r = await syncOnce(db, account, api);
    expect(r).toMatchObject({ ok: false, state: 'paused' });
    expect(await db.outbox.count()).toBe(before);
    expect((await getSyncStatus())!.state).toBe('paused');
    expect(api.pull).not.toHaveBeenCalled();
  });

  test('pushes again once when the outbox grew during the sync, and reports recovered items', async () => {
    const { cat } = await setup();
    const doomed = await createItem(db, { categoryId: cat.id, kind: 'todo', title: 'doomed' });
    await db.meta.put({ key: 'syncCursor', value: 5 });
    const { api, pushes } = fakeApi({ decide: (c) => ((c.row as { id: string }).id === doomed.id ? 'rejected' : 'applied') });
    const r = await syncOnce(db, account, api);
    expect(r.recovered).toBe(1);
    expect(pushes).toHaveLength(2);
    expect(pushes[1]!.map((c) => c.table)).toEqual(['categories', 'items']);
    expect(await db.outbox.count()).toBe(0);
    expect(await takeRecovered(account.partition)).toBe(1);
    expect(await takeRecovered(account.partition)).toBe(0);
    // A rejection resets the cursor so the next pull brings back the server's copy of what was dropped.
    expect(api.pull).toHaveBeenCalledWith(0);
  });

  test('syncOnce is single-flight', async () => {
    await setup();
    let active = 0;
    let maxActive = 0;
    const { api } = fakeApi();
    const push = api.push.getMockImplementation()!;
    api.push.mockImplementation(async (changes) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 20));
      active--;
      return push(changes);
    });
    const pull = api.pull.getMockImplementation()!;
    api.pull.mockImplementation(async (c) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 20));
      active--;
      return pull(c);
    });
    const runs = [syncOnce(db, account, api), syncOnce(db, account, api), syncOnce(db, account, api)];
    const results = await Promise.all(runs);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(maxActive).toBe(1);
    // The first run pushed everything; the queued ones coalesced into one follow-up run.
    expect(api.pull.mock.calls.length).toBeLessThanOrEqual(2);
  });

  test('edits in a workspace the user was removed from end up in Recovered', async () => {
    const { ws } = await setup();
    const shared = serverWs(crypto.randomUUID());
    const sharedCat = serverCat(crypto.randomUUID(), shared.id);
    await applyPull(db, { ...emptyPull(3), workspaces: [shared], categories: [sharedCat],
      members: [{ id: crypto.randomUUID(), workspaceId: shared.id, userId: USER, email: 'u@x.io', role: 'editor', displayName: null, deletedAt: null }] });
    await pushOutbox(db, fakeApi().api);
    let written: Item | undefined;
    const { api } = fakeApi({
      // The server no longer lets this user write to the shared workspace.
      decide: (c) => (c.table === 'items' && (c.row as Item).categoryId === sharedCat.id ? 'rejected' : 'applied'),
      pull: async (cursor) => {
        if (cursor === 3) {
          // The user writes in the shared category while the pull that removes them is in flight.
          written = await createItem(db, { categoryId: sharedCat.id, kind: 'note', title: 'written meanwhile', body: { type: 'doc' } });
          return { ...emptyPull(6), removedWorkspaceIds: [shared.id] };
        }
        return emptyPull(cursor);
      },
    });
    const r = await syncOnce(db, account, api);
    expect(r).toMatchObject({ ok: true, recovered: 1 });
    expect(await db.workspaces.get(shared.id)).toBeUndefined();
    expect(await db.items.get(written!.id)).toBeUndefined();
    const recoveredCat = (await liveCategories(db, ws.id)).find((c) => c.name === 'Recovered')!;
    expect((await liveItems(db, recoveredCat.id)).map((i) => i.title)).toEqual(['written meanwhile']);
    expect(await db.outbox.count()).toBe(0);
  });

  test('a failed lock request does not jam later syncs', async () => {
    await setup();
    const nav = globalThis.navigator as Navigator & { locks?: unknown };
    const had = Object.getOwnPropertyDescriptor(nav, 'locks');
    Object.defineProperty(nav, 'locks', { configurable: true, value: { request: () => Promise.reject(new Error('lock aborted')) } });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const r = await syncOnce(db, account, fakeApi().api);
      expect(r).toMatchObject({ ok: false, state: 'error' });
    } finally {
      logged.mockRestore();
      if (had) Object.defineProperty(nav, 'locks', had);
      else delete (nav as { locks?: unknown }).locks;
    }
    expect((await syncOnce(db, account, fakeApi().api)).ok).toBe(true);
  });

  test('a stored status with no chrome.storage.session does not break sync', async () => {
    await setup();
    (chromeFake.storage as { session?: unknown }).session = undefined;
    const { api } = fakeApi();
    expect((await syncOnce(db, account, api)).ok).toBe(true);
  });
});
