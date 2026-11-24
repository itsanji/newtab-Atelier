import { beforeEach, expect, test } from 'vitest';
import { openDb, type AtelierDB } from './db';
import {
  clock, createCategory, createItem, createWorkspace, deleteCategory, deleteWorkspace,
  LastWorkspaceError, moveItem, updateItem,
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

test('createItem appends at end and writes one outbox entry', async () => {
  const { cat } = await setup();
  const before = await db.outbox.count();
  const a = await item(cat.id, 'a');
  const b = await item(cat.id, 'b');
  expect(b.sortKey > a.sortKey).toBe(true);
  const rows = (await db.outbox.toArray()).slice(before);
  expect(rows).toHaveLength(2);
  expect(rows.every((r) => r.table === 'items')).toBe(true);
});

test('moveItem between two items writes only the moved row', async () => {
  const { cat } = await setup();
  const a = await item(cat.id, 'a');
  const b = await item(cat.id, 'b');
  const c = await item(cat.id, 'c');
  const before = await db.outbox.count();
  await moveItem(db, b.id, { categoryId: cat.id, beforeId: a.id, afterId: c.id });
  expect(await db.outbox.count()).toBe(before + 1);
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
  const before = await db.outbox.count();
  await deleteCategory(db, cat.id);
  expect(await db.outbox.count()).toBe(before + 4);
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
