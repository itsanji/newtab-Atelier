import { beforeEach, describe, expect, test } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../newtab/App';
import { openDb, type AtelierDB } from '../data/db';
import { installChromeFake } from '../../test/chromeFake';

let db: AtelierDB;
beforeEach(() => {
  installChromeFake();
  localStorage.clear();
  db = openDb('test-' + crypto.randomUUID());
});

const board = () => document.querySelector('.atl-board')!;

describe('list view', () => {
  test('the header switch toggles between columns and the list, and the choice is remembered', async () => {
    const user = userEvent.setup();
    const first = render(<App db={db} />);
    await screen.findByRole('region', { name: 'Saved' });
    expect(board()).not.toHaveClass('atl-board-list');

    await user.click(screen.getByRole('button', { name: 'Show as list' }));
    expect(board()).toHaveClass('atl-board-list');
    // Everything is still there, in the same order.
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Saved', 'Notes']);

    first.unmount();
    render(<App db={db} />);
    await screen.findByRole('region', { name: 'Saved' });
    expect(board()).toHaveClass('atl-board-list');
    await user.click(screen.getByRole('button', { name: 'Show as columns' }));
    expect(board()).not.toHaveClass('atl-board-list');
  });

  test('the S / M / L switch sets every category\'s width, in both views, and is remembered', async () => {
    const user = userEvent.setup();
    const first = render(<App db={db} />);
    await screen.findByRole('region', { name: 'Saved' });
    const width = () => (board() as HTMLElement).style.getPropertyValue('--atl-col-width');
    expect(width()).toBe('300px');
    const sizes = screen.getByRole('group', { name: 'Category size' });
    expect(within(sizes).getByRole('button', { name: 'Medium' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(sizes).getByRole('button', { name: 'Large' }));
    expect(width()).toBe('380px');
    await user.click(screen.getByRole('button', { name: 'Show as list' }));
    expect(width()).toBe('380px');
    first.unmount();
    render(<App db={db} />);
    await screen.findByRole('region', { name: 'Saved' });
    expect(width()).toBe('380px');
    await user.click(within(screen.getByRole('group', { name: 'Category size' })).getByRole('button', { name: 'Small' }));
    expect(width()).toBe('260px');
  });
});
