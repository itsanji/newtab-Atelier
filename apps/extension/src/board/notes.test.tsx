import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
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
    const editor = await screen.findByRole('textbox', { name: 'New note' });
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
    await user.click(await screen.findByRole('textbox', { name: 'New note' }));
    await user.keyboard('x'.repeat(100));
    await user.tab();
    await waitFor(async () => expect((await items())[0].title).toBe('x'.repeat(80)));
  });

  const typeNote = async (text: string) => {
    const ctx = await addVia('Note');
    const editor = await screen.findByRole('textbox', { name: 'New note' });
    await ctx.user.click(editor);
    await ctx.user.keyboard(text);
    return ctx;
  };
  const body = async () => (await items())[0].body;

  test('saves after the 400 ms debounce, not before', async () => {
    await typeNote('abc');
    expect(await body()).toBeNull();
    await new Promise((r) => setTimeout(r, 250));
    expect(await body()).toBeNull();
    await waitFor(async () => expect(await body()).not.toBeNull(), { timeout: 1500 });
    expect((await items())[0].title).toBe('abc');
  });

  test('flushes pending edits on unmount', async () => {
    const { view } = await typeNote('lost?');
    expect(await body()).toBeNull();
    view.unmount();
    await waitFor(async () => expect((await items())[0].title).toBe('lost?'));
  });

  test('flushes pending edits on pagehide', async () => {
    await typeNote('closing');
    expect(await body()).toBeNull();
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    await waitFor(async () => expect((await items())[0].title).toBe('closing'));
  });

  test('flushes pending edits when the tab becomes hidden', async () => {
    await typeNote('hidden');
    expect(await body()).toBeNull();
    const spy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await waitFor(async () => expect((await items())[0].title).toBe('hidden'));
    spy.mockRestore();
  });

  test('deleting a note removes it without a notice or a late write', async () => {
    const { user, col } = await typeNote('doomed');
    await user.click(within(col).getByRole('button', { name: 'Note options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await waitFor(async () => expect((await items())[0].deletedAt).not.toBeNull());
    await new Promise((r) => setTimeout(r, 600));
    expect(screen.getByRole('status', { hidden: true })).toBeEmptyDOMElement();
    expect((await items())[0].deletedAt).not.toBeNull();
  });

  test('a new note is focused, and a remount does not refocus it', async () => {
    const { user } = await addVia('Note');
    const editor = await screen.findByRole('textbox', { name: 'New note' });
    await waitFor(() => expect(editor).toHaveFocus());
    // Leave the workspace and come back: the column remounts, and focus must not be requested again.
    await user.click(screen.getByRole('button', { name: /New workspace/ }));
    await user.keyboard('Second{Enter}');
    await user.click(await screen.findByRole('button', { name: /^Second/ }));
    await screen.findByRole('heading', { level: 1, name: 'Second' });
    await user.click(await screen.findByRole('button', { name: /^My workspace/ }));
    const again = await screen.findByRole('textbox', { name: 'New note' });
    await new Promise((r) => setTimeout(r, 100));
    expect(again).not.toHaveFocus();
  });

  test('each note editor is labelled with its title', async () => {
    await typeNote('Groceries');
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Note: Groceries' })).toBeInTheDocument());
  });
});
