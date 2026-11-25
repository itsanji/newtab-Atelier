import { beforeEach, describe, expect, test } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
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

describe('custom category size', () => {
  test('the gear opens a slider from S to the board width; dragging it sets the width, and it is remembered', async () => {
    const user = userEvent.setup();
    const first = render(<App db={db} />);
    await screen.findByRole('region', { name: 'Saved' });
    const width = () => (document.querySelector('.atl-board') as HTMLElement).style.getPropertyValue('--atl-col-width');
    const sizes = screen.getByRole('group', { name: 'Category size' });
    await user.click(within(sizes).getByRole('button', { name: 'Custom' }));
    expect(within(sizes).getByRole('button', { name: 'Custom' })).toHaveAttribute('aria-pressed', 'true');
    const slider = screen.getByRole('slider', { name: 'Category width' });
    expect(slider).toHaveAttribute('min', '260');
    fireEvent.change(slider, { target: { value: '520' } });
    expect(width()).toBe('520px');
    expect(screen.getByText('520px')).toBeInTheDocument();
    // Esc closes the slider; the custom width stays.
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('slider', { name: 'Category width' })).toBeNull();
    expect(width()).toBe('520px');

    first.unmount();
    render(<App db={db} />);
    await screen.findByRole('region', { name: 'Saved' });
    expect(width()).toBe('520px');
    // Picking a preset leaves custom.
    await user.click(within(screen.getByRole('group', { name: 'Category size' })).getByRole('button', { name: 'Medium' }));
    expect(width()).toBe('300px');
  });
});
