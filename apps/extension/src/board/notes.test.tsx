import { beforeEach, describe, expect, test } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../newtab/App';
import { openDb, type AtelierDB } from '../data/db';
import { installChromeFake } from '../../test/chromeFake';

let db: AtelierDB;
beforeEach(() => {
  installChromeFake();
  db = openDb('test-' + crypto.randomUUID());
});

const items = () => db.table('items').toArray();

async function addVia(kind: 'Note' | 'To-do') {
  const user = userEvent.setup();
  const view = render(<App db={db} />);
  const col = await screen.findByRole('region', { name: 'Notes' });
  await user.click(within(col).getByRole('button', { name: 'Add' }));
  await user.click(screen.getByRole('menuitem', { name: kind }));
  return { user, col, view };
}

describe('to-dos', () => {
  test('adding a to-do and checking it persists done', async () => {
    const { user, col } = await addVia('To-do');
    await user.type(screen.getByRole('textbox', { name: 'To-do text' }), 'Buy stamps{Enter}');
    const box = await within(col).findByRole('checkbox', { name: 'Buy stamps' });
    expect(box).not.toBeChecked();
    await user.click(box);
    await waitFor(async () => expect((await items())[0].done).toBe(true));
    await waitFor(() => expect(box).toBeChecked());
    expect(screen.getByText('Buy stamps')).toHaveClass('atl-todo-done');
  });

  test('an empty to-do is discarded', async () => {
    const { user } = await addVia('To-do');
    await user.type(screen.getByRole('textbox', { name: 'To-do text' }), '{Escape}');
    expect(await items()).toHaveLength(0);
    expect((await db.table('items').toArray()).filter((i) => !i.deletedAt)).toHaveLength(0);
  });
});

describe('notes', () => {
  test('note text persists after blur and remount, title derived from first line', async () => {
    const { user, view } = await addVia('Note');
    const editor = await screen.findByRole('textbox', { name: 'Note' });
    await user.click(editor);
    await user.keyboard('First line{Enter}Second line');
    await user.tab();
    await waitFor(async () => expect((await items())[0].title).toBe('First line'));
    view.unmount();
    render(<App db={db} />);
    expect(await screen.findByText('Second line')).toBeInTheDocument();
  });

  test('title is capped at 80 characters', async () => {
    const { user } = await addVia('Note');
    await user.click(await screen.findByRole('textbox', { name: 'Note' }));
    await user.keyboard('x'.repeat(100));
    await user.tab();
    await waitFor(async () => expect((await items())[0].title).toBe('x'.repeat(80)));
  });
});
