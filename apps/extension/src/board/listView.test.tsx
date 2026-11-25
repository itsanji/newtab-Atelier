import { beforeEach, describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
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
});
