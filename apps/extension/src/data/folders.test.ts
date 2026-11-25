import { beforeEach, describe, expect, test } from 'vitest';
import { arrangeItems } from '@atelier/core';
import { openDb, type AtelierDB } from './db';
import { clock, createCategory, createItem, createWorkspace, deleteFolder, moveItem } from './repo';
import { liveItems } from './queries';

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
  const other = await createCategory(db, { workspaceId: ws.id, name: 'D' });
  const link = (title: string, folderId: string | null = null, categoryId = cat.id) =>
    createItem(db, { categoryId, kind: 'link', title, url: `https://${title}.example/`, folderId });
  const folder = (title: string, categoryId = cat.id) => createItem(db, { categoryId, kind: 'folder', title });
  return { cat, other, link, folder };
}
const view = async (categoryId: string) => {
  const { top, inFolder } = arrangeItems(await liveItems(db, categoryId));
  return {
    top: top.map((i) => i.title),
    folders: Object.fromEntries([...inFolder].map(([id, items]) => [top.find((i) => i.id === id)!.title, items.map((i) => i.title)])),
  };
};

describe('folders', () => {
  test('links are created in a folder, after its other links', async () => {
    const { cat, link, folder } = await setup();
    await link('a');
    const f = await folder('SNS');
    await link('b', f.id);
    await link('c', f.id);
    await link('d');
    expect(await view(cat.id)).toEqual({ top: ['a', 'SNS', 'd'], folders: { SNS: ['b', 'c'] } });
  });

  test('only links go in folders, and a folder id from another category is ignored', async () => {
    const { cat, other, link, folder } = await setup();
    const f = await folder('F');
    const elsewhere = await folder('X', other.id);
    const note = await createItem(db, { categoryId: cat.id, kind: 'note', title: 'n', folderId: f.id });
    const nested = await createItem(db, { categoryId: cat.id, kind: 'folder', title: 'G', folderId: f.id });
    const stray = await link('s', elsewhere.id);
    expect(nested.folderId).toBeNull();
    expect(stray.folderId).toBeNull();
    // A note can't be moved in either.
    expect((await moveItem(db, note.id, { categoryId: cat.id, beforeId: null, afterId: null, folderId: f.id })).folderId).toBeNull();
  });

  test('moving a link into and out of a folder', async () => {
    const { cat, link, folder } = await setup();
    const f = await folder('F');
    const a = await link('a');
    const b = await link('b', f.id);
    await moveItem(db, a.id, { categoryId: cat.id, beforeId: null, afterId: b.id, folderId: f.id });
    expect(await view(cat.id)).toEqual({ top: ['F'], folders: { F: ['a', 'b'] } });
    await moveItem(db, b.id, { categoryId: cat.id, beforeId: f.id, afterId: null });
    expect(await view(cat.id)).toEqual({ top: ['F', 'b'], folders: { F: ['a'] } });
  });

  test('a folder moved to another category takes its links along', async () => {
    const { cat, other, link, folder } = await setup();
    const f = await folder('F');
    await link('a', f.id);
    await link('top');
    await moveItem(db, f.id, { categoryId: other.id, beforeId: null, afterId: null });
    expect(await view(other.id)).toEqual({ top: ['F'], folders: { F: ['a'] } });
    expect(await view(cat.id)).toEqual({ top: ['top'], folders: {} });
  });

  test('deleting a folder puts its links where the folder was, in order', async () => {
    const { cat, link, folder } = await setup();
    await link('first');
    const f = await folder('F');
    await link('a', f.id);
    await link('b', f.id);
    await link('last');
    await deleteFolder(db, f.id);
    expect(await view(cat.id)).toEqual({ top: ['first', 'a', 'b', 'last'], folders: {} });
    // Every change is queued for sync.
    expect((await db.outbox.toArray()).find((e) => e.rowId === f.id)?.row).toMatchObject({ deletedAt: expect.any(String) });
  });

  test('deleting a folder with its links', async () => {
    const { cat, link, folder } = await setup();
    const f = await folder('F');
    await link('a', f.id);
    await link('keep');
    await deleteFolder(db, f.id, { withLinks: true });
    expect(await view(cat.id)).toEqual({ top: ['keep'], folders: {} });
  });
});
