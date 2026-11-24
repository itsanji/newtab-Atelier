import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../newtab/App';
import { openDb, type AtelierDB } from '../data/db';
import { createItem, deleteItem } from '../data/repo';
import { liveCategories, liveWorkspaces } from '../data/queries';
import { ItemRow } from './ItemRow';
import { DbProvider } from '../data/DbContext';
import { NoticeProvider } from './Notice';
import { faviconUrl } from '../chrome/favicon';
import { installChromeFake } from '../../test/chromeFake';

let db: AtelierDB;
beforeEach(() => {
  installChromeFake();
  db = openDb('test-' + crypto.randomUUID());
});

describe('faviconUrl', () => {
  test('builds the _favicon endpoint url', () => {
    expect(faviconUrl('https://a.com/x y')).toBe(
      chrome.runtime.getURL('/_favicon/') + '?pageUrl=' + encodeURIComponent('https://a.com/x y') + '&size=32',
    );
    expect(faviconUrl('https://a.com', 16)).toMatch(/&size=16$/);
  });
});

describe('board', () => {
  test('shows seeded workspace and its categories', async () => {
    render(<App db={db} />);
    expect(await screen.findByRole('heading', { level: 1, name: 'My workspace' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 2, name: 'Saved' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 2, name: 'Notes' })).toBeInTheDocument();
    expect(screen.getByText('Workspace · 0 saved')).toBeInTheDocument();
  });

  test('add category via New category tile', async () => {
    const user = userEvent.setup();
    render(<App db={db} />);
    await user.click(await screen.findByRole('button', { name: /New category/ }));
    await user.type(screen.getByRole('textbox', { name: 'Category name' }), 'Reading list{Enter}');
    expect(await screen.findByRole('heading', { level: 2, name: 'Reading list' })).toBeInTheDocument();
  });

  test('add link via Add menu', async () => {
    const user = userEvent.setup();
    render(<App db={db} />);
    const col = await screen.findByRole('region', { name: 'Saved' });
    await user.click(within(col).getByRole('button', { name: 'Add' }));
    await user.click(screen.getByRole('menuitem', { name: 'Link' }));
    await user.type(screen.getByLabelText('Web address'), 'https://example.com/a');
    await user.type(screen.getByLabelText('Title'), 'Example');
    await user.click(screen.getByRole('button', { name: 'Add link' }));
    const link = await within(col).findByRole('link', { name: /Example/ });
    expect(link).toHaveAttribute('href', 'https://example.com/a');
    expect(within(link).getByText('example.com')).toBeInTheDocument();
    expect(await screen.findByText('Workspace · 1 saved')).toBeInTheDocument();
  });

  test('add link adds https and defaults the title to the hostname; rejects bad addresses', async () => {
    const user = userEvent.setup();
    render(<App db={db} />);
    const col = await screen.findByRole('region', { name: 'Saved' });
    await user.click(within(col).getByRole('button', { name: 'Add' }));
    await user.click(screen.getByRole('menuitem', { name: 'Link' }));
    await user.type(screen.getByLabelText('Web address'), 'not a url');
    await user.click(screen.getByRole('button', { name: 'Add link' }));
    expect(screen.getByText('Enter a web address, like example.com')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Web address'));
    await user.type(screen.getByLabelText('Web address'), 'example.com/b{Enter}');
    const link = await within(col).findByRole('link', { name: /example\.com/ });
    expect(link).toHaveAttribute('href', 'https://example.com/b');
  });

  test('rename category inline', async () => {
    const user = userEvent.setup();
    render(<App db={db} />);
    await user.click(await screen.findByRole('button', { name: 'Saved' }));
    const input = screen.getByRole('textbox', { name: 'Category name' });
    await user.clear(input);
    await user.type(input, 'Bookmarks{Enter}');
    expect(await screen.findByRole('heading', { level: 2, name: 'Bookmarks' })).toBeInTheDocument();
  });

  test('selecting a workspace persists across reload', async () => {
    const user = userEvent.setup();
    const first = render(<App db={db} />);
    await user.click(await screen.findByRole('button', { name: /New workspace/ }));
    await user.type(screen.getByRole('textbox', { name: 'Workspace name' }), 'Second{Enter}');
    await user.click(await screen.findByRole('button', { name: /^Second/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Second' })).toBeInTheDocument();
    first.unmount();
    render(<App db={db} />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Second' })).toBeInTheDocument();
    expect((await liveWorkspaces(db)).length).toBe(2);
  });

  test('delete workspace is disabled when only one exists', async () => {
    const user = userEvent.setup();
    render(<App db={db} />);
    await user.click(await screen.findByRole('button', { name: 'Workspace options' }));
    const del = screen.getByRole('menuitem', { name: /Delete/ });
    expect(del).toBeDisabled();
    expect(screen.getByText('Keep at least one workspace')).toBeInTheDocument();
  });

  test('delete workspace works when more than one exists', async () => {
    const user = userEvent.setup();
    render(<App db={db} />);
    await user.click(await screen.findByRole('button', { name: /New workspace/ }));
    await user.type(screen.getByRole('textbox', { name: 'Workspace name' }), 'Second{Enter}');
    await screen.findByRole('button', { name: /^Second/ });
    await user.click(screen.getAllByRole('button', { name: 'Workspace options' })[1]!);
    await user.click(screen.getByRole('menuitem', { name: /Delete/ }));
    await user.click(await screen.findByRole('button', { name: 'Delete workspace' }));
    await screen.findByRole('heading', { level: 1, name: 'My workspace' });
    expect((await liveWorkspaces(db)).length).toBe(1);
  });

  test('edit and delete a link from its menu', async () => {
    const user = userEvent.setup();
    render(<App db={db} />);
    const cats = await (async () => { await screen.findByRole('region', { name: 'Saved' }); return liveCategories(db, (await liveWorkspaces(db))[0]!.id); })();
    await createItem(db, { categoryId: cats[0]!.id, kind: 'link', title: 'Old', url: 'https://old.com' });
    const col = screen.getByRole('region', { name: 'Saved' });
    await within(col).findByRole('link', { name: /Old/ });
    await user.click(within(col).getByRole('button', { name: 'Link options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Edit' }));
    const title = screen.getByLabelText('Title');
    await user.clear(title);
    await user.type(title, 'New{Enter}');
    expect(await within(col).findByRole('link', { name: /New/ })).toBeInTheDocument();
    await user.click(within(col).getByRole('button', { name: 'Link options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await waitFor(() => expect(within(col).queryByRole('link')).not.toBeInTheDocument());
  });
});

describe('ItemRow', () => {
  test('truncates long titles and keeps full title as tooltip', async () => {
    const cat = await (async () => {
      const { ensureSeed } = await import('../data/seed');
      await ensureSeed(db);
      const ws = (await liveWorkspaces(db))[0]!;
      return (await liveCategories(db, ws.id))[0]!;
    })();
    const long = 'Very long title '.repeat(20).trim().slice(0, 300);
    const item = await createItem(db, { categoryId: cat.id, kind: 'link', title: long, url: 'https://example.com' });
    render(<DbProvider db={db}><NoticeProvider><ItemRow item={item} /></NoticeProvider></DbProvider>);
    const el = screen.getByTitle(long);
    expect(el).toHaveAttribute('title', long);
    expect(el.style.textOverflow).toBe('ellipsis');
    expect(el.style.whiteSpace).toBe('nowrap');
    expect(el.style.overflow).toBe('hidden');
  });
});

describe('failure feedback', () => {
  async function seededItem() {
    const { ensureSeed } = await import('../data/seed');
    await ensureSeed(db);
    const ws = (await liveWorkspaces(db))[0]!;
    const cat = (await liveCategories(db, ws.id))[0]!;
    return createItem(db, { categoryId: cat.id, kind: 'link', title: 'Gone', url: 'https://gone.com' });
  }
  async function deleteFromMenu() {
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Link options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
  }

  test('NotFoundError shows the removed-in-another-tab notice', async () => {
    const item = await seededItem();
    await deleteItem(db, item.id);
    render(<DbProvider db={db}><NoticeProvider><ItemRow item={item} /></NoticeProvider></DbProvider>);
    await deleteFromMenu();
    expect(await screen.findByRole('status')).toHaveTextContent('That item was removed in another tab');
  });

  test('a generic failure shows a retry notice and logs the error', async () => {
    const item = await seededItem();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<DbProvider db={db}><NoticeProvider><ItemRow item={item} /></NoticeProvider></DbProvider>);
    db.close();
    await deleteFromMenu();
    expect(await screen.findByRole('status')).toHaveTextContent('Something went wrong. Try again.');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('focus after delete', () => {
  test('deleting an item focuses the next row, else the column heading', async () => {
    const user = userEvent.setup();
    render(<App db={db} />);
    const col = await screen.findByRole('region', { name: 'Saved' });
    const cat = (await liveCategories(db, (await liveWorkspaces(db))[0]!.id))[0]!;
    await createItem(db, { categoryId: cat.id, kind: 'link', title: 'First', url: 'https://one.com' });
    await createItem(db, { categoryId: cat.id, kind: 'link', title: 'Second', url: 'https://two.com' });
    await within(col).findByRole('link', { name: /Second/ });
    await user.click(within(col).getAllByRole('button', { name: 'Link options' })[0]!);
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await waitFor(() => expect(within(col).queryByRole('link', { name: /First/ })).not.toBeInTheDocument());
    await waitFor(() => expect(within(col).getByRole('link', { name: /Second/ })).toHaveFocus());
    await user.click(within(col).getByRole('button', { name: 'Link options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await waitFor(() => expect(within(col).getByRole('button', { name: 'Saved' })).toHaveFocus());
  });

  test('deleting a category focuses the next heading, else the New category tile', async () => {
    const user = userEvent.setup();
    render(<App db={db} />);
    await screen.findByRole('region', { name: 'Saved' });
    await user.click(within(screen.getByRole('region', { name: 'Saved' })).getByRole('button', { name: 'Category options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Notes' })).toHaveFocus());
    await user.click(within(screen.getByRole('region', { name: 'Notes' })).getByRole('button', { name: 'Category options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /New category/ })).toHaveFocus());
  });
});

describe('deleting a category', () => {
  async function withItems(n: number) {
    render(<App db={db} />);
    const col = await screen.findByRole('region', { name: 'Saved' });
    const cat = (await liveCategories(db, (await liveWorkspaces(db))[0]!.id))[0]!;
    for (let i = 0; i < n; i++) await createItem(db, { categoryId: cat.id, kind: 'link', title: `L${i}`, url: `https://l${i}.com` });
    if (n) await within(col).findByRole('link', { name: new RegExp(`L${n - 1}`) });
    return { col, cat };
  }
  const openDelete = async (user: ReturnType<typeof userEvent.setup>, col: HTMLElement) => {
    await user.click(within(col).getByRole('button', { name: 'Category options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
  };

  test('with items, asks first; Cancel keeps it', async () => {
    const user = userEvent.setup();
    const { col, cat } = await withItems(2);
    await openDelete(user, col);
    const dialog = await screen.findByRole('dialog', { name: 'Delete Saved?' });
    expect(dialog).toHaveTextContent('This also deletes its 2 saved items.');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect((await db.categories.get(cat.id))!.deletedAt).toBeNull();
  });

  test('with items, Delete category deletes it and its items and focuses the next heading', async () => {
    const user = userEvent.setup();
    const { col, cat } = await withItems(1);
    await openDelete(user, col);
    const dialog = await screen.findByRole('dialog', { name: 'Delete Saved?' });
    expect(dialog).toHaveTextContent('This also deletes its 1 saved item.');
    await user.click(within(dialog).getByRole('button', { name: 'Delete category' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Saved' })).not.toBeInTheDocument());
    expect((await db.categories.get(cat.id))!.deletedAt).not.toBeNull();
    expect((await db.items.where('categoryId').equals(cat.id).toArray()).every((i) => i.deletedAt !== null)).toBe(true);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Notes' })).toHaveFocus());
  });

  test('an empty category is deleted without asking', async () => {
    const user = userEvent.setup();
    const { col, cat } = await withItems(0);
    await openDelete(user, col);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(async () => expect((await db.categories.get(cat.id))!.deletedAt).not.toBeNull());
  });
});

describe('workspace forms', () => {
  test('editing with an empty name shows an error and stays open', async () => {
    const user = userEvent.setup();
    render(<App db={db} />);
    await user.click(await screen.findByRole('button', { name: 'Workspace options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Edit' }));
    await user.clear(screen.getByLabelText('Name'));
    await user.click(screen.getByRole('button', { name: 'Save workspace' }));
    expect(screen.getByText('Give the workspace a name')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Edit workspace' })).toBeInTheDocument();
  });

  test('creating a workspace does not commit on blur; Create commits', async () => {
    const user = userEvent.setup();
    render(<App db={db} />);
    await user.click(await screen.findByRole('button', { name: /New workspace/ }));
    await user.type(screen.getByRole('textbox', { name: 'Workspace name' }), 'Stray');
    await user.click(document.body);
    expect(screen.getByRole('textbox', { name: 'Workspace name' })).toHaveValue('Stray');
    expect((await liveWorkspaces(db)).length).toBe(1);
    await user.click(screen.getByRole('button', { name: 'Create workspace' }));
    await screen.findByRole('heading', { level: 1, name: 'Stray' });
    expect((await liveWorkspaces(db)).length).toBe(2);
  });

  test('blur with an empty field cancels; Escape cancels', async () => {
    const user = userEvent.setup();
    render(<App db={db} />);
    await user.click(await screen.findByRole('button', { name: /New workspace/ }));
    await user.click(document.body);
    expect(screen.queryByRole('textbox', { name: 'Workspace name' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /New workspace/ }));
    await user.type(screen.getByRole('textbox', { name: 'Workspace name' }), 'x{Escape}');
    expect(screen.queryByRole('textbox', { name: 'Workspace name' })).not.toBeInTheDocument();
    expect((await liveWorkspaces(db)).length).toBe(1);
  });
});
