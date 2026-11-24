import { beforeEach, expect, test } from 'vitest';
import { openDb, type AtelierDB } from './db';
import { clock, createCategory, createItem, createWorkspace, deleteItem, setReminder } from './repo';
import { exportAll, importFile, ImportError } from './exportImport';
import { liveCategories, liveItems, liveWorkspaces } from './queries';

let db: AtelierDB;
let t = 0;
beforeEach(() => {
  db = openDb('test-' + crypto.randomUUID());
  t = 0;
  clock.now = () => new Date(Date.UTC(2026, 0, 1, 0, 0, ++t)).toISOString();
});

async function populate(target: AtelierDB) {
  const prev = db;
  db = target;
  const ws = await createWorkspace(target, { name: 'W' });
  const cat = await createCategory(target, { workspaceId: ws.id, name: 'C' });
  const a = await createItem(target, { categoryId: cat.id, kind: 'link', title: 'a', url: 'https://a.test' });
  const b = await createItem(target, { categoryId: cat.id, kind: 'todo', title: 'b' });
  const gone = await createItem(target, { categoryId: cat.id, kind: 'note', title: 'gone' });
  await setReminder(target, a.id, '2027-01-01T00:00:00.000Z');
  await setReminder(target, gone.id, '2027-01-01T00:00:00.000Z');
  await deleteItem(target, gone.id);
  db = prev;
  return { ws, cat, a, b };
}

const snapshot = async (d: AtelierDB) => ({
  workspaces: await d.workspaces.toArray(), categories: await d.categories.toArray(),
  items: await d.items.toArray(), reminders: await d.reminders.toArray(), outbox: await d.outbox.toArray(),
});

test('export then import into empty db round-trips', async () => {
  const src = openDb('test-' + crypto.randomUUID());
  const { a } = await populate(src);
  const file = await exportAll(src);
  expect(file.items.map((i) => i.title).sort()).toEqual(['a', 'b']);
  expect(file.reminders).toHaveLength(1);
  const res = await importFile(db, JSON.parse(JSON.stringify(file)));
  expect(res).toEqual({ added: 5, updated: 0, skipped: 0 });
  expect(await db.items.get(a.id)).toEqual(file.items.find((i) => i.id === a.id));
  expect((await exportAll(db)).items).toEqual(file.items);
  expect(await db.outbox.count()).toBe(5);
});

test('re-importing the same file adds nothing', async () => {
  await populate(db);
  const file = await exportAll(db);
  const before = await snapshot(db);
  const res = await importFile(db, file);
  expect(res).toEqual({ added: 0, updated: 0, skipped: 5 });
  expect(await snapshot(db)).toEqual(before);
});

test('import rejects invalid file and writes nothing', async () => {
  const src = openDb('test-' + crypto.randomUUID());
  await populate(src);
  const file = await exportAll(src);
  await populate(db);
  const before = await snapshot(db);
  const bad = { ...file, items: [...file.items, { ...file.items[0]!, id: 'x', kind: 'bogus' }] };
  await expect(importFile(db, bad)).rejects.toThrow(new ImportError('This export has damaged entries'));
  await expect(importFile(db, { ...file, format: 'other' })).rejects.toThrow("This file isn't an Atelier export");
  await expect(importFile(db, { ...file, version: 2 })).rejects.toThrow("This file isn't an Atelier export");
  await expect(importFile(db, null)).rejects.toThrow(ImportError);
  expect(await snapshot(db)).toEqual(before);
});

test('newer incoming replaces, older or equal is skipped, tombstones are not resurrected', async () => {
  const { a, b } = await populate(db);
  const file = await exportAll(db);
  await deleteItem(db, b.id);
  const newer = { ...file, items: file.items.map((i) => (i.id === a.id ? { ...i, title: 'a2', updatedAt: '2030-01-01T00:00:00.000Z' } : i)) };
  const last = (await db.outbox.orderBy('seq').last())!.seq;
  const res = await importFile(db, newer);
  expect(res.updated).toBe(1);
  expect((await db.items.get(a.id))!.title).toBe('a2');
  expect((await db.items.get(b.id))!.deletedAt).not.toBeNull();
  const queued = await db.outbox.where('seq').above(last).toArray();
  expect(queued.map((e) => e.key)).toEqual([`items:${a.id}`]);
  expect((queued[0]!.row as { title: string }).title).toBe('a2');
});

test('orphan items land in Imported', async () => {
  const src = openDb('test-' + crypto.randomUUID());
  const { cat, a, b } = await populate(src);
  const file = await exportAll(src);
  const orphans = { ...file, workspaces: [], categories: [], items: file.items.filter((i) => i.categoryId === cat.id) };
  const res = await importFile(db, orphans);
  expect(res).toEqual({ added: 3, updated: 0, skipped: 0 });
  const [ws] = await liveWorkspaces(db);
  expect(ws!.name).toBe('Imported');
  const [ic] = await liveCategories(db, ws!.id);
  expect(ic!.name).toBe('Imported');
  expect((await liveItems(db, ic!.id)).map((i) => i.id)).toEqual([a.id, b.id]);
  // reminder survives with its item; a second orphan import reuses Imported
  expect(await db.reminders.count()).toBe(1);
  await importFile(db, { ...orphans, items: [{ ...orphans.items[0]!, id: 'other' }] });
  expect(await liveWorkspaces(db)).toHaveLength(1);
});

test('orphan categories land in the Imported workspace; reminders without items are skipped', async () => {
  const src = openDb('test-' + crypto.randomUUID());
  const { a } = await populate(src);
  const file = await exportAll(src);
  const res = await importFile(db, {
    ...file, workspaces: [], items: [],
    reminders: file.reminders.map((r) => ({ ...r, itemId: r.itemId === a.id ? 'missing' : r.itemId })),
  });
  expect(res).toEqual({ added: 1, updated: 0, skipped: 1 });
  const [ws] = await liveWorkspaces(db);
  expect(ws!.name).toBe('Imported');
  expect((await liveCategories(db, ws!.id)).map((c) => c.name)).toEqual(['C']);
});
