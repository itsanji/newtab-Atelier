import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../newtab/App';
import { openDb } from '../data/db';
import { liveCategories, liveWorkspaces } from '../data/queries';
import { EmojiPicker, EMOJI } from './EmojiPicker';
import { installChromeFake } from '../../test/chromeFake';

beforeEach(() => {
  installChromeFake();
  localStorage.clear();
  document.documentElement.className = '';
  window.matchMedia = (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
});

describe('EmojiPicker', () => {
  test('has 64 curated emoji, picks one, removes, and Escape returns focus', async () => {
    const user = userEvent.setup();
    expect(EMOJI).toHaveLength(64);
    const onChange = vi.fn();
    const { rerender } = render(<EmojiPicker value={null} onChange={onChange} />);
    const trigger = screen.getByRole('button', { name: 'Add emoji' });
    await user.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Choose emoji' });
    expect(within(dialog).getAllByRole('button').length).toBe(64);
    await user.click(within(dialog).getByRole('button', { name: 'books' }));
    expect(onChange).toHaveBeenCalledWith('📚');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    rerender(<EmojiPicker value="📚" onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Change emoji' }));
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onChange).toHaveBeenLastCalledWith(null);

    await user.click(screen.getByRole('button', { name: 'Change emoji' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change emoji' })).toHaveFocus();
  });

  test('arrow keys move across an 8 column grid', async () => {
    const user = userEvent.setup();
    render(<EmojiPicker value={null} onChange={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Add emoji' }));
    const grid = within(screen.getByRole('dialog')).getAllByRole('button');
    expect(grid[0]).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(grid[1]).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(grid[9]).toHaveFocus();
    await user.keyboard('{ArrowLeft}{ArrowUp}');
    expect(grid[0]).toHaveFocus();
  });
});

describe('theme and emoji on the board', () => {
  test('theme button cycles and applies the class', async () => {
    const user = userEvent.setup();
    const db = openDb('test-' + crypto.randomUUID());
    render(<App db={db} />);
    await user.click(await screen.findByRole('button', { name: 'Theme: System' }));
    expect(await screen.findByRole('button', { name: 'Theme: Giverny' })).toBeInTheDocument();
    await waitFor(() => expect(document.documentElement).toHaveClass('giverny'));
    await user.click(screen.getByRole('button', { name: 'Theme: Giverny' }));
    expect(await screen.findByRole('button', { name: 'Theme: Nocturne' })).toBeInTheDocument();
    await waitFor(() => expect(document.documentElement).toHaveClass('nocturne'));
  });

  test('picking an emoji updates a category', async () => {
    const user = userEvent.setup();
    const db = openDb('test-' + crypto.randomUUID());
    render(<App db={db} />);
    const col = await screen.findByRole('region', { name: 'Saved' });
    await user.click(within(col).getByRole('button', { name: 'Add emoji' }));
    await user.click(screen.getByRole('button', { name: 'star' }));
    await waitFor(async () => {
      const ws = (await liveWorkspaces(db))[0]!;
      expect((await liveCategories(db, ws.id)).find((c) => c.name === 'Saved')?.emoji).toBe('⭐');
    });
  });

  test('picking an emoji updates a workspace and shows it in the sidebar', async () => {
    const user = userEvent.setup();
    const db = openDb('test-' + crypto.randomUUID());
    render(<App db={db} />);
    await user.click(await screen.findByRole('button', { name: 'Workspace options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Edit' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit workspace' });
    await user.click(within(dialog).getByRole('button', { name: 'Add emoji' }));
    await user.click(screen.getByRole('button', { name: 'books' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save workspace' }));
    await waitFor(async () => expect((await liveWorkspaces(db))[0]!.emoji).toBe('📚'));
    expect(await screen.findByText(/📚/, undefined, { timeout: 3000 })).toBeInTheDocument();
  });
});
