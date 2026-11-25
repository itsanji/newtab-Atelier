import { beforeEach, describe, expect, test } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { arrangeItems } from '@atelier/core';
import { App } from '../newtab/App';
import { openDb, type AtelierDB } from '../data/db';
import { createCategory, createItem } from '../data/repo';
import { liveCategories, liveItems, liveWorkspaces } from '../data/queries';
import { ensureSeed } from '../data/seed';
import { applyDrop, collisions } from './dnd';
import { installChromeFake } from '../../test/chromeFake';

let db: AtelierDB;
beforeEach(() => {
  installChromeFake();
  db = openDb('test-' + crypto.randomUUID());
});

async function setup() {
  await ensureSeed(db);
  const ws = (await liveWorkspaces(db))[0]!;
  const saved = (await liveCategories(db, ws.id)).find((c) => c.name === 'Saved')!;
  const other = await createCategory(db, { workspaceId: ws.id, name: 'Later' });
  const link = (title: string, folderId: string | null = null, categoryId = saved.id) =>
    createItem(db, { categoryId, kind: 'link', title, url: `https://${title}.example/`, folderId });
  const folder = (title: string, categoryId = saved.id) => createItem(db, { categoryId, kind: 'folder', title });
  return { ws, saved, other, link, folder };
}
const view = async (categoryId: string) => {
  const { top, inFolder } = arrangeItems(await liveItems(db, categoryId));
  return { top: top.map((i) => i.title), inside: [...inFolder.values()].map((l) => l.map((i) => i.title)) };
};

describe('folders on the board', () => {
  test('a folder shows its links as icons that open the site, and is counted by its links', async () => {
    const { saved, link, folder } = await setup();
    const f = await folder('SNS');
    await link('mail', f.id);
    await link('chat', f.id);
    await link('news');
    render(<App db={db} />);
    const col = await screen.findByRole('region', { name: 'Saved' });
    const group = await within(col).findByRole('group', { name: 'Folder SNS' });
    expect(within(group).getByRole('link', { name: 'mail' })).toHaveAttribute('href', 'https://mail.example/');
    expect(within(group).getByRole('link', { name: 'chat' })).toBeInTheDocument();
    expect(within(group).queryByRole('link', { name: 'news' })).toBeNull();
    // The column counts the three links, not the folder.
    expect(within(col).getByText('3')).toBeInTheDocument();
    expect(saved.name).toBe('Saved');
  });

  test('Add → Folder creates a folder and asks for its name; an unnamed folder reads "N sites"', async () => {
    const user = userEvent.setup();
    const { saved } = await setup();
    render(<App db={db} />);
    const col = await screen.findByRole('region', { name: 'Saved' });
    await user.click(within(col).getByRole('button', { name: 'Add' }));
    await user.click(screen.getByRole('menuitem', { name: 'Folder' }));
    const name = await within(col).findByRole('textbox', { name: 'Folder name' });
    expect(name).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(await within(col).findByRole('group', { name: 'Folder 0 sites' })).toBeInTheDocument();
    await user.click(within(col).getByRole('button', { name: '0 sites' }));
    await user.type(within(col).getByRole('textbox', { name: 'Folder name' }), 'Daily{Enter}');
    expect(await within(col).findByRole('group', { name: 'Folder Daily' })).toBeInTheDocument();
    expect((await liveItems(db, saved.id)).map((i) => [i.kind, i.title])).toEqual([['folder', 'Daily']]);
  });

  test('the + icon adds a link straight into the folder', async () => {
    const user = userEvent.setup();
    const { saved, folder } = await setup();
    await folder('Tools');
    render(<App db={db} />);
    const group = await screen.findByRole('group', { name: 'Folder Tools' });
    await user.click(within(group).getByRole('button', { name: 'Add link to Tools' }));
    await user.type(within(group).getByLabelText('Web address'), 'monkeytype.com');
    await user.click(within(group).getByRole('button', { name: 'Add link' }));
    expect(await within(group).findByRole('link', { name: 'monkeytype.com' })).toBeInTheDocument();
    expect(await view(saved.id)).toEqual({ top: ['Tools'], inside: [['monkeytype.com']] });
  });

  test('"Show as list" lists the links with their menus; "Remove folder, keep links" puts them back', async () => {
    const user = userEvent.setup();
    const { saved, link, folder } = await setup();
    const f = await folder('Docs');
    await link('a', f.id);
    await link('b', f.id);
    render(<App db={db} />);
    const group = await screen.findByRole('group', { name: 'Folder Docs' });
    await user.click(within(group).getByRole('button', { name: 'Folder options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Show as list' }));
    expect(within(group).getAllByRole('button', { name: 'Link options' })).toHaveLength(2);
    await user.click(within(group).getByRole('button', { name: 'Folder options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Remove folder, keep links' }));
    await waitFor(async () => expect(await view(saved.id)).toEqual({ top: ['a', 'b'], inside: [] }));
  });

  test('"Delete folder and links" asks first', async () => {
    const user = userEvent.setup();
    const { saved, link, folder } = await setup();
    const f = await folder('Old');
    await link('a', f.id);
    await link('stay');
    render(<App db={db} />);
    const group = await screen.findByRole('group', { name: 'Folder Old' });
    await user.click(within(group).getByRole('button', { name: 'Folder options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete folder and links' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete Old?' });
    expect(dialog).toHaveTextContent('This also deletes its 1 link.');
    await user.click(within(dialog).getByRole('button', { name: 'Delete folder' }));
    await waitFor(async () => expect(await view(saved.id)).toEqual({ top: ['stay'], inside: [] }));
  });
});

describe('dropping into and out of folders', () => {
  test('a link dropped on a folder goes inside, at the end', async () => {
    const { saved, other, link, folder } = await setup();
    const f = await folder('F');
    await link('in', f.id);
    const a = await link('a', null, other.id);
    await applyDrop(db, { active: { type: 'item', id: a.id }, over: { type: 'folder', id: f.id }, placement: 'after' });
    expect(await view(saved.id)).toEqual({ top: ['F'], inside: [['in', 'a']] });
  });

  test('a link dropped on an icon lands before or after it in that folder', async () => {
    const { saved, link, folder } = await setup();
    const f = await folder('F');
    const x = await link('x', f.id);
    await link('y', f.id);
    const a = await link('a');
    await applyDrop(db, { active: { type: 'item', id: a.id }, over: { type: 'item', id: x.id }, placement: 'after' });
    expect(await view(saved.id)).toEqual({ top: ['F'], inside: [['x', 'a', 'y']] });
  });

  test('a link dragged out of a folder onto a row leaves the folder', async () => {
    const { saved, link, folder } = await setup();
    const f = await folder('F');
    const x = await link('x', f.id);
    const top = await link('top');
    await applyDrop(db, { active: { type: 'item', id: x.id }, over: { type: 'item', id: top.id }, placement: 'after' });
    expect(await view(saved.id)).toEqual({ top: ['F', 'top', 'x'], inside: [[]] });
  });

  test('a note or a folder dropped on a folder lands next to it, never inside', async () => {
    const { saved, link, folder } = await setup();
    const f = await folder('F');
    const x = await link('x', f.id);
    const g = await folder('G');
    const note = await createItem(db, { categoryId: saved.id, kind: 'note', title: 'N' });
    await applyDrop(db, { active: { type: 'item', id: g.id }, over: { type: 'folder', id: f.id }, placement: 'before' });
    await applyDrop(db, { active: { type: 'item', id: note.id }, over: { type: 'item', id: x.id }, placement: 'after' });
    expect(await view(saved.id)).toEqual({ top: ['G', 'F', 'N'], inside: [[], ['x']] });
  });

  test('a tab dropped on a folder is saved inside it', async () => {
    const { saved, folder } = await setup();
    const f = await folder('F');
    await applyDrop(db, {
      active: { type: 'tab', id: 'tab:1', tab: { url: 'https://tab.example/', title: 'Tab' } },
      over: { type: 'folder', id: f.id }, placement: 'after',
    });
    expect(await view(saved.id)).toEqual({ top: ['F'], inside: [['Tab']] });
  });

  test('under the pointer, an icon beats its folder, and the folder beats rows and the column', () => {
    const rect = { top: 0, left: 0, right: 100, bottom: 100, width: 100, height: 100 };
    const c = (id: string, data: Record<string, unknown>) => ({ id, data: { current: data }, rect: { current: rect }, disabled: false, key: id, node: { current: null } });
    const containers = [
      c('col', { type: 'category' }), c('row', { type: 'item' }), c('folder:f', { type: 'folder', folderId: 'f' }),
      c('icon', { type: 'item', folderId: 'f' }),
    ];
    const hits = collisions({
      active: { id: 'a', data: { current: { type: 'item', kind: 'link' } } }, collisionRect: rect, droppableRects: new Map(containers.map((x) => [x.id, rect])),
      droppableContainers: containers, pointerCoordinates: { x: 50, y: 50 },
    } as never);
    expect(hits.map((h) => h.id)).toEqual(['icon', 'folder:f', 'row', 'col']);
  });
});
