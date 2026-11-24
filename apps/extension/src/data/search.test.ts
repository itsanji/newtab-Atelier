import { beforeEach, describe, expect, test } from 'vitest';
import { openDb, type AtelierDB } from './db';
import { createCategory, createItem, createWorkspace, deleteItem } from './repo';
import { buildIndex, search } from './search';
import { installChromeFake } from '../../test/chromeFake';

let db: AtelierDB;
async function rows() {
  return {
    workspaces: await db.workspaces.toArray(),
    categories: await db.categories.toArray(),
    items: await db.items.filter((i) => i.deletedAt === null).toArray(),
  };
}
beforeEach(() => {
  installChromeFake();
  db = openDb('test-' + crypto.randomUUID());
});

describe('search', () => {
  test('finds a link by domain fragment, with names and ids', async () => {
    const ws = await createWorkspace(db, { name: 'Work' });
    const cat = await createCategory(db, { workspaceId: ws.id, name: 'Reading' });
    const link = await createItem(db, { categoryId: cat.id, kind: 'link', title: 'Docs', url: 'https://tanstack.com/query' });
    const hits = search(buildIndex(await rows()), 'tanstack');
    expect(hits).toEqual([
      { itemId: link.id, title: 'Docs', kind: 'link', categoryName: 'Reading', workspaceName: 'Work', workspaceId: ws.id, categoryId: cat.id },
    ]);
  });

  test('multi-word queries need every word to match', async () => {
    const ws = await createWorkspace(db, { name: 'W' });
    const cat = await createCategory(db, { workspaceId: ws.id, name: 'C' });
    const both = await createItem(db, { categoryId: cat.id, kind: 'link', title: 'React hooks guide', url: 'https://a.test' });
    await createItem(db, { categoryId: cat.id, kind: 'link', title: 'React compiler', url: 'https://b.test' });
    await createItem(db, { categoryId: cat.id, kind: 'link', title: 'Fishing hooks', url: 'https://c.test' });
    expect(search(buildIndex(await rows()), 'react hooks').map((h) => h.itemId)).toEqual([both.id]);
  });

  test('finds a note by a word in its body', async () => {
    const ws = await createWorkspace(db, { name: 'W' });
    const cat = await createCategory(db, { workspaceId: ws.id, name: 'C' });
    const body = { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Shopping' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'remember marmalade' }] },
    ] };
    const note = await createItem(db, { categoryId: cat.id, kind: 'note', title: 'Shopping', body });
    expect(search(buildIndex(await rows()), 'marmalade').map((h) => h.itemId)).toEqual([note.id]);
  });

  test('finds a to-do by title', async () => {
    const ws = await createWorkspace(db, { name: 'W' });
    const cat = await createCategory(db, { workspaceId: ws.id, name: 'C' });
    const todo = await createItem(db, { categoryId: cat.id, kind: 'todo', title: 'Renew passport' });
    const hits = search(buildIndex(await rows()), 'passport');
    expect(hits.map((h) => [h.itemId, h.kind])).toEqual([[todo.id, 'todo']]);
  });

  test('excludes tombstoned items, categories and workspaces', async () => {
    const ws = await createWorkspace(db, { name: 'W' });
    const cat = await createCategory(db, { workspaceId: ws.id, name: 'C' });
    const gone = await createItem(db, { categoryId: cat.id, kind: 'todo', title: 'Zebra errand' });
    await deleteItem(db, gone.id);
    const all = { workspaces: await db.workspaces.toArray(), categories: await db.categories.toArray(), items: await db.items.toArray() };
    expect(search(buildIndex(all), 'zebra')).toEqual([]);
  });

  test('prefix "atel" matches "Atelier"', async () => {
    const ws = await createWorkspace(db, { name: 'W' });
    const cat = await createCategory(db, { workspaceId: ws.id, name: 'C' });
    const item = await createItem(db, { categoryId: cat.id, kind: 'link', title: 'Atelier', url: 'https://example.com' });
    expect(search(buildIndex(await rows()), 'atel').map((h) => h.itemId)).toEqual([item.id]);
  });
});
