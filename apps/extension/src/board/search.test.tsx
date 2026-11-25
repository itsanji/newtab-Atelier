import { beforeEach, describe, expect, test } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../newtab/App';
import { openDb, type AtelierDB } from '../data/db';
import { createCategory, createItem, createWorkspace } from '../data/repo';
import { liveWorkspaces } from '../data/queries';
import { installChromeFake } from '../../test/chromeFake';

let db: AtelierDB;
let otherWs: string;
beforeEach(async () => {
  installChromeFake();
  db = openDb('test-' + crypto.randomUUID());
  const { ensureSeed } = await import('../data/seed');
  await ensureSeed(db);
  const first = (await liveWorkspaces(db))[0]!;
  const cat = await createCategory(db, { workspaceId: first.id, name: 'Saved stuff' });
  await createItem(db, { categoryId: cat.id, kind: 'link', title: 'Home page', url: 'https://home.example.com' });
  const other = await createWorkspace(db, { name: 'Side projects' });
  otherWs = other.id;
  const oc = await createCategory(db, { workspaceId: other.id, name: 'Reading' });
  await createItem(db, { id: 'target-item', categoryId: oc.id, kind: 'link', title: 'Zephyr guide', url: 'https://zephyr.dev' });
});

describe('search UI', () => {
  test('typing replaces columns with results across workspaces', async () => {
    const user = userEvent.setup();
    render(<App db={db} />);
    const box = await screen.findByRole('searchbox', { name: 'Search' });
    expect(box).toHaveAttribute('placeholder', 'Search saved tabs and notes');
    await user.type(box, 'zephyr');
    expect(await screen.findByText('1 result')).toBeInTheDocument();
    expect(screen.getByText('Side projects · Reading')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: 'Saved stuff' })).not.toBeInTheDocument();
  });

  test('empty state', async () => {
    const user = userEvent.setup();
    render(<App db={db} />);
    await user.type(await screen.findByRole('searchbox', { name: 'Search' }), 'qqqq');
    expect(await screen.findByText('Nothing matches “qqqq”')).toBeInTheDocument();
  });

  test('clicking a result selects its workspace and highlights the item', async () => {
    const user = userEvent.setup();
    render(<App db={db} />);
    const box = await screen.findByRole('searchbox', { name: 'Search' });
    await user.type(box, 'zephyr');
    await user.click(await screen.findByRole('button', { name: /Zephyr guide/ }));
    expect(box).toHaveValue('');
    expect(await screen.findByRole('heading', { level: 1, name: 'Side projects' })).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('[data-item-id="target-item"]')).toHaveClass('atl-highlight'));
    expect((await db.meta.get('selectedWorkspaceId'))?.value).toBe(otherWs);
  });

  test('"/" focuses the search field; Esc clears and keeps focus', async () => {
    const user = userEvent.setup();
    render(<App db={db} />);
    const box = await screen.findByRole('searchbox', { name: 'Search' });
    await user.keyboard('/');
    expect(box).toHaveFocus();
    expect(box).toHaveValue('');
    await user.type(box, 'zeph');
    await user.keyboard('{Escape}');
    expect(box).toHaveValue('');
    expect(box).toHaveFocus();
  });
});
