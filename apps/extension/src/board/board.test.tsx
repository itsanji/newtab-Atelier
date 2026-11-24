import { beforeEach, describe, expect, test } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../newtab/App';
import { openDb, type AtelierDB } from '../data/db';
import { createItem } from '../data/repo';
import { liveCategories, liveWorkspaces } from '../data/queries';
import { ItemRow } from './ItemRow';
import { DbProvider } from '../data/DbContext';
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
    render(<DbProvider db={db}><ItemRow item={item} /></DbProvider>);
    const el = screen.getByTitle(long);
    expect(el).toHaveAttribute('title', long);
    expect(el.style.textOverflow).toBe('ellipsis');
    expect(el.style.whiteSpace).toBe('nowrap');
    expect(el.style.overflow).toBe('hidden');
  });
});
