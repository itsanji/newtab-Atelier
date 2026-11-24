import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { installChromeFake, type ChromeFake } from '../../test/chromeFake';
import { openDb, type AtelierDB } from '../data/db';
import { createCategory } from '../data/repo';
import { getMeta, liveCategories, liveItems, liveWorkspaces } from '../data/queries';
import { ensureSeed } from '../data/seed';
import { Popup } from './Popup';

let fake: ChromeFake;
let db: AtelierDB;
beforeEach(async () => {
  fake = installChromeFake();
  db = openDb('test-' + crypto.randomUUID());
  await ensureSeed(db);
  window.close = vi.fn();
  window.history.replaceState({}, '', '/');
});

const cats = async () => {
  const ws = (await liveWorkspaces(db))[0]!;
  return liveCategories(db, ws.id);
};

describe('popup', () => {
  test('saves the active tab with a note into the chosen category and remembers it', async () => {
    const tab = await fake.tabs.create({ url: 'https://a.com/x', title: 'A page' });
    const [, notes] = await cats();
    const user = userEvent.setup();
    render(<Popup db={db} />);
    expect(await screen.findByText('A page')).toBeInTheDocument();
    expect(screen.getByText('Save to · My workspace')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Notes' }));
    await user.type(screen.getByLabelText('Note (optional)'), 'for later');
    await user.click(screen.getByRole('button', { name: 'Save tab' }));
    await waitFor(async () => expect(await liveItems(db, notes!.id)).toHaveLength(1));
    const [item] = await liveItems(db, notes!.id);
    expect(item).toMatchObject({ title: 'A page', url: 'https://a.com/x', note: 'for later' });
    expect(await getMeta(db, 'lastCategoryId')).toBe(notes!.id);
    await waitFor(() => expect(fake.tabs.remove).toHaveBeenCalledWith(tab.id));
    expect(window.close).toHaveBeenCalled();
  });

  test('keeps the tab and popup open when close-after-saving is unchecked', async () => {
    await fake.tabs.create({ url: 'https://a.com/x', title: 'A page' });
    const user = userEvent.setup();
    render(<Popup db={db} />);
    await user.click(await screen.findByRole('checkbox', { name: 'Close the tab after saving' }));
    await user.click(screen.getByRole('button', { name: 'Save tab' }));
    expect(await screen.findByText('Saved to Saved')).toBeInTheDocument();
    expect(fake.tabs.remove).not.toHaveBeenCalled();
    expect(window.close).not.toHaveBeenCalled();
    expect((await fake.storage.local.get('closeAfterSave')).closeAfterSave).toBe(false);
  });

  test('uses the tabId url param and preselects the last used category', async () => {
    await fake.tabs.create({ url: 'https://active.com/', title: 'Active' });
    const other = await fake.tabs.create({ url: 'https://other.com/', title: 'Other', active: false });
    const [, notes] = await cats();
    const { setMeta } = await import('../data/queries');
    await setMeta(db, 'lastCategoryId', notes!.id);
    window.history.replaceState({}, '', `/?tabId=${other.id}`);
    render(<Popup db={db} />);
    expect(await screen.findByText('Other')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Notes' })).toHaveAttribute('aria-checked', 'true');
  });

  test('disables Save for an unsavable tab', async () => {
    await fake.tabs.create({ url: 'chrome://newtab/', title: 'New tab' });
    render(<Popup db={db} />);
    expect(await screen.findByText("This page can't be saved")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save tab' })).toBeDisabled();
  });

  test('creates a new category with + New', async () => {
    await fake.tabs.create({ url: 'https://a.com/', title: 'A' });
    const user = userEvent.setup();
    render(<Popup db={db} />);
    await user.click(await screen.findByRole('radio', { name: '+ New' }));
    await user.type(screen.getByLabelText('New category name'), 'Fresh{Enter}');
    expect(await screen.findByRole('radio', { name: 'Fresh' })).toHaveAttribute('aria-checked', 'true');
    expect((await cats()).map((c) => c.name)).toContain('Fresh');
  });

  test('saves all tabs in the window into the workspace and closes', async () => {
    await fake.tabs.create({ url: 'https://a.com/', title: 'A' });
    await fake.tabs.create({ url: 'https://b.com/', title: 'B', active: false });
    await createCategory(db, { workspaceId: (await liveWorkspaces(db))[0]!.id, name: 'Extra' });
    const user = userEvent.setup();
    render(<Popup db={db} />);
    await user.click(await screen.findByRole('button', { name: 'Save all 2 tabs in this window' }));
    await waitFor(() => expect(window.close).toHaveBeenCalled());
    expect(await fake.tabs.query({})).toHaveLength(0);
  });

  test('Open the board opens a new tab', async () => {
    await fake.tabs.create({ url: 'https://a.com/', title: 'A' });
    const user = userEvent.setup();
    render(<Popup db={db} />);
    await user.click(await screen.findByRole('link', { name: 'Open the board' }));
    expect(fake.tabs.create).toHaveBeenLastCalledWith({});
  });
});
