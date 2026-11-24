import { beforeEach, describe, expect, test, vi } from 'vitest';
import { keyBetween } from '@atelier/core';
import { openDb, type AtelierDB } from './db';
import {
  clock, createCategory, createItem, createWorkspace, deleteCategory, deleteWorkspace,
  LastWorkspaceError, moveItem, updateItem, updateCategory, moveCategory, appendKey, onLocalWrite, tx,
} from './repo';
import { ensureSeed } from './seed';
import { liveCategories, liveItems, liveWorkspaces } from './queries';

let db: AtelierDB;
let t = 0;
beforeEach(() => {
  db = openDb('test-' + crypto.randomUUID());
  t = 0;
  clock.now = () => new Date(Date.UTC(2026, 0, 1, 0, 0, ++t)).toISOString();
});

async function setup() {
  const ws = await createWorkspace(db, { name: 'W' });
  const cat = await createCategory(db, { workspaceId: ws.id, name: 'C' });
  return { ws, cat };
}
const item = (categoryId: string, title: string) => createItem(db, { categoryId, kind: 'link', title });
/** Highest outbox seq so far, and the entries queued after it. */
const lastSeq = async () => (await db.outbox.orderBy('seq').last())?.seq ?? 0;
const since = async (seq: number) => db.outbox.where('seq').above(seq).sortBy('seq');

test('createItem appends at end and writes one outbox entry', async () => {
  const { cat } = await setup();
  const before = await lastSeq();
  const a = await item(cat.id, 'a');
  const b = await item(cat.id, 'b');
  expect(b.sortKey > a.sortKey).toBe(true);
  const rows = await since(before);
  expect(rows.map((r) => r.rowId)).toEqual([a.id, b.id]);
  expect(rows.every((r) => r.table === 'items')).toBe(true);
});

test('moveItem between two items writes only the moved row', async () => {
  const { cat } = await setup();
  const a = await item(cat.id, 'a');
  const b = await item(cat.id, 'b');
  const c = await item(cat.id, 'c');
  const before = await lastSeq();
  await moveItem(db, b.id, { categoryId: cat.id, beforeId: a.id, afterId: c.id });
  expect((await since(before)).map((r) => r.rowId)).toEqual([b.id]);
  expect((await liveItems(db, cat.id)).map((i) => i.title)).toEqual(['a', 'b', 'c']);
  await moveItem(db, b.id, { categoryId: cat.id, beforeId: c.id, afterId: null });
  expect((await liveItems(db, cat.id)).map((i) => i.title)).toEqual(['a', 'c', 'b']);
});

test('moveItem to another category changes categoryId', async () => {
  const { ws, cat } = await setup();
  const other = await createCategory(db, { workspaceId: ws.id, name: 'D' });
  const a = await item(cat.id, 'a');
  await moveItem(db, a.id, { categoryId: other.id, beforeId: null, afterId: null });
  expect((await db.items.get(a.id))!.categoryId).toBe(other.id);
  expect(await liveItems(db, cat.id)).toHaveLength(0);
  expect(await liveItems(db, other.id)).toHaveLength(1);
});

test('deleteCategory tombstones its items and liveItems hides them', async () => {
  const { cat } = await setup();
  await item(cat.id, 'a');
  await item(cat.id, 'b');
  await item(cat.id, 'c');
  const before = await lastSeq();
  await deleteCategory(db, cat.id);
  expect(await since(before)).toHaveLength(4);
  expect(await liveItems(db, cat.id)).toHaveLength(0);
  expect((await db.items.toArray()).every((i) => i.deletedAt !== null)).toBe(true);
});

test('deleteWorkspace refuses the last live workspace', async () => {
  const { ws } = await setup();
  await expect(deleteWorkspace(db, ws.id)).rejects.toBeInstanceOf(LastWorkspaceError);
  const ws2 = await createWorkspace(db, { name: 'W2' });
  await deleteWorkspace(db, ws.id);
  expect((await liveWorkspaces(db)).map((w) => w.id)).toEqual([ws2.id]);
  expect(await liveCategories(db, ws.id)).toHaveLength(0);
});

test('ensureSeed creates My workspace with Saved and Notes once', async () => {
  await ensureSeed(db);
  await ensureSeed(db);
  const wss = await liveWorkspaces(db);
  expect(wss).toHaveLength(1);
  expect(wss[0]!.name).toBe('My workspace');
  expect((await liveCategories(db, wss[0]!.id)).map((c) => c.name)).toEqual(['Saved', 'Notes']);
});

test('updateItem bumps updatedAt and keeps createdAt', async () => {
  const { cat } = await setup();
  const a = await item(cat.id, 'a');
  await updateItem(db, a.id, { title: 'z' });
  const got = (await db.items.get(a.id))!;
  expect(got.title).toBe('z');
  expect(got.createdAt).toBe(a.createdAt);
  expect(got.updatedAt > a.updatedAt).toBe(true);
});

test('concurrent ensureSeed seeds exactly once', async () => {
  await Promise.all([ensureSeed(db), ensureSeed(db)]);
  expect(await db.workspaces.count()).toBe(1);
  expect(await db.categories.count()).toBe(2);
});

test('createItem accepts a caller-supplied id', async () => {
  const { cat } = await setup();
  const id = crypto.randomUUID();
  const row = await createItem(db, { id, categoryId: cat.id, kind: 'note', title: '' });
  expect(row.id).toBe(id);
  expect(await db.items.get(id)).toBeTruthy();
});

test('two updates to one row leave one outbox entry holding the latest snapshot', async () => {
  const { cat } = await setup();
  const a = await item(cat.id, 'a');
  await updateItem(db, a.id, { title: 'b' });
  await updateItem(db, a.id, { title: 'c' });
  const entries = (await db.outbox.toArray()).filter((e) => e.rowId === a.id);
  expect(entries).toHaveLength(1);
  expect(entries[0]!.key).toBe(`items:${a.id}`);
  expect((entries[0]!.row as { title: string }).title).toBe('c');
  // The rewritten entry moves to the end of the upload order.
  expect((await db.outbox.orderBy('seq').last())!.rowId).toBe(a.id);
});

test('outbox seq increases with every write', async () => {
  const { cat } = await setup();
  const a = await item(cat.id, 'a');
  const s1 = (await db.outbox.get(`items:${a.id}`))!.seq;
  await updateCategory(db, cat.id, { name: 'D' });
  const s2 = (await db.outbox.get(`categories:${cat.id}`))!.seq;
  expect(s2).toBeGreaterThan(s1);
});

test('moving between two items with equal sort keys succeeds and lands after the first', async () => {
  const { cat } = await setup();
  const a = await item(cat.id, 'a');
  const b = await item(cat.id, 'b');
  const c = await item(cat.id, 'c');
  await db.items.update(b.id, { sortKey: a.sortKey });
  await moveItem(db, c.id, { categoryId: cat.id, beforeId: a.id, afterId: b.id });
  const moved = (await db.items.get(c.id))!;
  expect(moved.sortKey > a.sortKey).toBe(true);
});

test('createCategory position start puts it first; default is last', async () => {
  const { ws, cat } = await setup();
  const last = await createCategory(db, { workspaceId: ws.id, name: 'End' });
  const first = await createCategory(db, { workspaceId: ws.id, name: 'Start' }, { position: 'start' });
  expect((await liveCategories(db, ws.id)).map((c) => c.id)).toEqual([first.id, cat.id, last.id]);
  await moveCategory(db, first.id, last.id, null);
  expect((await liveCategories(db, ws.id)).at(-1)!.id).toBe(first.id);
});

test('createItem with neighbours places it between them in one write', async () => {
  const { cat } = await setup();
  const a = await item(cat.id, 'a');
  const b = await item(cat.id, 'b');
  const before = await lastSeq();
  const x = await createItem(db, { categoryId: cat.id, kind: 'link', title: 'x', beforeId: a.id, afterId: b.id });
  expect((await liveItems(db, cat.id)).map((i) => i.title)).toEqual(['a', 'x', 'b']);
  expect((await since(before)).map((r) => r.rowId)).toEqual([x.id]);
});

describe('sort-key jitter and local-write hook', () => {
  test('appended sort keys are unique across devices', async () => {
    // Two devices with the same synced state append to the same category.
    const { ws, cat } = await setup();
    const a0 = await item(cat.id, 'a');
    const other = openDb('test-' + crypto.randomUUID());
    await other.workspaces.put((await db.workspaces.get(ws.id))!);
    await other.categories.put((await db.categories.get(cat.id))!);
    await other.items.put(a0);
    const keys = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const x = await createItem(db, { categoryId: cat.id, kind: 'link', title: `x${i}` });
      const y = await createItem(other, { categoryId: cat.id, kind: 'link', title: `y${i}` });
      expect(x.sortKey).not.toBe(y.sortKey);
      keys.add(x.sortKey).add(y.sortKey);
      // Still valid keys that sort after the previous last item.
      expect(x.sortKey > a0.sortKey && y.sortKey > a0.sortKey).toBe(true);
      expect(() => keyBetween(x.sortKey, null)).not.toThrow();
    }
    expect(keys.size).toBe(40);
    // Workspaces and categories appended on two devices differ too.
    const w1 = await createWorkspace(db, { name: 'n' });
    const w2 = await createWorkspace(other, { name: 'n' });
    expect(w1.sortKey).not.toBe(w2.sortKey);
    const c1 = await createCategory(db, { workspaceId: ws.id, name: 'n' });
    const c2 = await createCategory(other, { workspaceId: ws.id, name: 'n' });
    expect(c1.sortKey).not.toBe(c2.sortKey);
  });

  test('appendKey adds three chars not ending in 0 and stays valid', () => {
    for (let i = 0; i < 200; i++) {
      const plain = keyBetween('a5', null);
      const k = appendKey('a5');
      expect(k.startsWith(plain)).toBe(true);
      expect(k).toMatch(/^[0-9A-Za-z]+$/);
      expect(k.length).toBe(plain.length + 3);
      expect(k.endsWith('0')).toBe(false);
      expect(() => keyBetween(k, null)).not.toThrow();
      expect(k > 'a5').toBe(true);
    }
    expect(() => keyBetween(appendKey(null), null)).not.toThrow();
  });

  test('onLocalWrite fires once per committed write, not for nested or failed ones', async () => {
    const calls = vi.fn();
    const off = onLocalWrite(calls);
    try {
      const { cat } = await setup();
      expect(calls).toHaveBeenCalledTimes(2);
      await tx(db, async () => {
        await createItem(db, { categoryId: cat.id, kind: 'link', title: 'nested' });
        await createItem(db, { categoryId: cat.id, kind: 'link', title: 'nested 2' });
      });
      expect(calls).toHaveBeenCalledTimes(3);
      await expect(updateItem(db, 'missing', { title: 'x' })).rejects.toThrow();
      expect(calls).toHaveBeenCalledTimes(3);
    } finally {
      off();
    }
    await createWorkspace(db, { name: 'after off' });
    expect(calls).toHaveBeenCalledTimes(3);
  });
});
