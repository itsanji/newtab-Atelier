import { beforeEach, describe, expect, test, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../newtab/App';
import { openDb, type AtelierDB } from '../data/db';
import { createCategory, createItem } from '../data/repo';
import { liveCategories, liveItems, liveWorkspaces } from '../data/queries';
import { ensureSeed } from '../data/seed';
import { applyDrop } from './dnd';
import { installChromeFake, type ChromeFake } from '../../test/chromeFake';

let fake: ChromeFake;
let db: AtelierDB;
beforeEach(() => {
  fake = installChromeFake();
  db = openDb('test-' + crypto.randomUUID());
});

describe('open tabs panel', () => {
  test('lists savable tabs and updates when a tab is created', async () => {
    await fake.tabs.create({ url: 'https://a.com', title: 'Alpha' });
    render(<App db={db} />);
    const panel = await screen.findByRole('region', { name: 'Open tabs' });
    expect(await within(panel).findByText('Alpha')).toBeInTheDocument();
    expect(within(panel).getByText('Open now')).toBeInTheDocument();
    expect(within(panel).getByText('Drag a tab onto the board to keep it.')).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Save all 1 and close' })).toBeInTheDocument();
    await act(async () => { await fake.tabs.create({ url: 'https://b.com', title: 'Beta' }); });
    expect(await within(panel).findByText('Beta')).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Save all 2 and close' })).toBeInTheDocument();
  });

  test('removes listeners on unmount', async () => {
    const events = [fake.tabs.onCreated, fake.tabs.onRemoved, fake.tabs.onUpdated, fake.tabs.onMoved];
    const added = events.map((e) => vi.spyOn(e, 'addListener'));
    const removed = events.map((e) => vi.spyOn(e, 'removeListener'));
    const { unmount } = render(<App db={db} />);
    await screen.findByRole('region', { name: 'Open tabs' });
    added.forEach((s) => expect(s).toHaveBeenCalledTimes(1));
    unmount();
    removed.forEach((s, i) => expect(s).toHaveBeenCalledWith(added[i]!.mock.calls[0]![0]));
  });

  test('Save all saves into the board and closes the tabs', async () => {
    const user = userEvent.setup();
    await fake.tabs.create({ url: 'https://a.com', title: 'Alpha' });
    render(<App db={db} />);
    await user.click(await screen.findByRole('button', { name: 'Save all 1 and close' }));
    expect(await screen.findByRole('button', { name: 'Nothing to save' })).toBeDisabled();
    expect(await screen.findByText('Alpha', { selector: '.atl-item-title' })).toBeInTheDocument();
    expect(await fake.tabs.query({})).toHaveLength(0);
  });

  test('Save all never reports tabs it did not save', async () => {
    const user = userEvent.setup();
    await fake.tabs.create({ url: 'https://a.com', title: 'Alpha' });
    render(<App db={db} />);
    const button = await screen.findByRole('button', { name: 'Save all 1 and close' });
    // The tab went away between listing and saving.
    fake.tabs.query.mockResolvedValueOnce([]);
    await user.click(button);
    await waitFor(() => expect(document.querySelector('.atl-notice')).toHaveTextContent('Nothing to save'));
    expect(document.querySelector('.atl-notice')).not.toHaveTextContent(/Saved/);
  });

  test('Open all opens the category links', async () => {
    const user = userEvent.setup();
    await ensureSeed(db);
    const ws = (await liveWorkspaces(db))[0]!;
    const c = await createCategory(db, { workspaceId: ws.id, name: 'Reading' });
    await createItem(db, { categoryId: c.id, kind: 'link', title: 'A', url: 'https://a.com' });
    render(<App db={db} />);
    const col = await screen.findByRole('region', { name: 'Reading' });
    await user.click(within(col).getByRole('button', { name: 'Open all' }));
    await waitFor(async () => expect((await fake.tabs.query({})).map((t) => t.url)).toEqual(['https://a.com']));
  });

  test('the Save all button is the only primary button', async () => {
    render(<App db={db} />);
    await screen.findByRole('region', { name: 'Open tabs' });
    expect(document.querySelectorAll('.im-btn-primary')).toHaveLength(1);
  });
});

describe('dropping a tab', () => {
  async function setup() {
    await ensureSeed(db);
    const ws = (await liveWorkspaces(db))[0]!;
    const a = await createCategory(db, { workspaceId: ws.id, name: 'Reading' });
    return { ws, a };
  }
  const tab = { url: 'https://t.com', title: 'T' };

  test('on a category saves it there', async () => {
    const { a } = await setup();
    await createItem(db, { categoryId: a.id, kind: 'link', title: 'x', url: 'https://x.com' });
    await applyDrop(db, { active: { type: 'tab', id: 'tab:1', tab }, over: { type: 'category', id: a.id }, placement: 'after' });
    expect((await liveItems(db, a.id)).map((i) => i.title)).toEqual(['x', 'T']);
  });

  test('on an item saves it at that position', async () => {
    const { a } = await setup();
    await createItem(db, { categoryId: a.id, kind: 'link', title: 'x', url: 'https://x.com' });
    const y = await createItem(db, { categoryId: a.id, kind: 'link', title: 'y', url: 'https://y.com' });
    await applyDrop(db, { active: { type: 'tab', id: 'tab:1', tab }, over: { type: 'item', id: y.id }, placement: 'before' });
    expect((await liveItems(db, a.id)).map((i) => i.title)).toEqual(['x', 'T', 'y']);
  });

  test('on a workspace goes to its first category, or notifies when empty', async () => {
    const { ws } = await setup();
    const first = (await liveCategories(db, ws.id))[0]!;
    await applyDrop(db, { active: { type: 'tab', id: 'tab:1', tab }, over: { type: 'workspace', id: ws.id }, placement: 'after' });
    expect((await liveItems(db, first.id)).map((i) => i.title)).toEqual(['T']);
    const { createWorkspace } = await import('../data/repo');
    const other = await createWorkspace(db, { name: 'Other' });
    expect(await applyDrop(db, { active: { type: 'tab', id: 'tab:1', tab }, over: { type: 'workspace', id: other.id }, placement: 'after' }))
      .toBe('Add a category to that workspace first');
  });
});
