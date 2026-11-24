import { beforeEach, describe, expect, test } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { installChromeFake, type ChromeFake } from '../../test/chromeFake';
import { openDb, type AtelierDB } from '../data/db';
import { liveCategories, liveWorkspaces } from '../data/queries';
import { createCategory, createItem, createWorkspace, setReminder } from '../data/repo';
import { ensureSeed } from '../data/seed';
import { DbProvider } from '../data/DbContext';
import { App } from '../newtab/App';
import { NoticeProvider } from './Notice';
import { ReminderPicker } from './ReminderPicker';
import { reminderLabel, reminderPresets } from './reminderTime';

let fake: ChromeFake;
let db: AtelierDB;
beforeEach(() => {
  fake = installChromeFake();
  db = openDb('test-' + crypto.randomUUID());
});

// Local-time "now": Tue 24 Nov 2026 10:00
const NOW = new Date(2026, 10, 24, 10, 0);
const renderPicker = async (hasReminder = false) => {
  await ensureSeed(db);
  const cat = (await liveCategories(db, (await liveWorkspaces(db))[0]!.id))[0]!;
  const item = await createItem(db, { categoryId: cat.id, kind: 'todo', title: 'Frame' });
  render(
    <DbProvider db={db}><NoticeProvider><ReminderPicker itemId={item.id} hasReminder={hasReminder} now={() => NOW} /></NoticeProvider></DbProvider>,
  );
  return item;
};

describe('reminderTime', () => {
  test('presets and labels', () => {
    expect(reminderPresets(NOW).map((p) => [p.label, p.at.getTime()])).toEqual([
      ['Later today (18:00)', new Date(2026, 10, 24, 18).getTime()],
      ['Tomorrow 9:00', new Date(2026, 10, 25, 9).getTime()],
      ['Next week (Mon 9:00)', new Date(2026, 10, 30, 9).getTime()],
    ]);
    expect(reminderPresets(new Date(2026, 10, 24, 17)).map((p) => p.label)).not.toContain('Later today (18:00)');
    // On a Monday, next week is the following Monday.
    expect(reminderPresets(new Date(2026, 10, 30, 8)).at(-1)!.at.getDate()).toBe(7);
    expect(reminderLabel(new Date(2026, 10, 24, 18, 5).toISOString(), NOW)).toBe('Today 18:05');
    expect(reminderLabel(new Date(2026, 10, 25, 9).toISOString(), NOW)).toBe('Tomorrow 9:00');
    expect(reminderLabel(new Date(2026, 10, 28, 9).toISOString(), NOW)).toBe('28 Nov 9:00');
  });
});

describe('ReminderPicker', () => {
  test('picking Tomorrow 9:00 stores the right ISO time and informs the worker', async () => {
    const user = userEvent.setup();
    const item = await renderPicker();
    await user.click(screen.getByRole('button', { name: 'Set reminder' }));
    await user.click(screen.getByRole('button', { name: 'Tomorrow 9:00' }));
    await waitFor(async () => expect(await db.reminders.count()).toBe(1));
    expect((await db.reminders.toArray())[0]).toMatchObject({
      itemId: item.id, remindAt: new Date(2026, 10, 25, 9).toISOString(), remindedAt: null,
    });
    expect(fake.runtime.sendMessage).toHaveBeenCalledWith({ type: 'reminders-changed' });
  });

  test('rejects a custom time in the past', async () => {
    const user = userEvent.setup();
    await renderPicker();
    await user.click(screen.getByRole('button', { name: 'Set reminder' }));
    const input = screen.getByLabelText('Custom time');
    await user.clear(input);
    await user.type(input, '2026-11-24T09:00');
    await user.click(screen.getByRole('button', { name: 'Set time' }));
    expect(await screen.findByText('Pick a time in the future')).toBeInTheDocument();
    expect(await db.reminders.count()).toBe(0);
  });

  test('rejects an empty custom time without closing or throwing', async () => {
    const user = userEvent.setup();
    await renderPicker();
    await user.click(screen.getByRole('button', { name: 'Set reminder' }));
    await user.clear(screen.getByLabelText('Custom time'));
    await user.click(screen.getByRole('button', { name: 'Set time' }));
    expect(await screen.findByText('Pick a date and time')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Reminder' })).toBeInTheDocument();
    expect(await db.reminders.count()).toBe(0);
  });

  test('focuses the first preset on open', async () => {
    const user = userEvent.setup();
    await renderPicker();
    await user.click(screen.getByRole('button', { name: 'Set reminder' }));
    expect(screen.getByRole('button', { name: 'Later today (18:00)' })).toHaveFocus();
  });

  test('Remove reminder appears when set and tombstones it', async () => {
    const user = userEvent.setup();
    const item = await renderPicker(true);
    await setReminder(db, item.id, new Date(2026, 10, 25, 9).toISOString());
    await user.click(screen.getByRole('button', { name: 'Change reminder' }));
    await user.click(screen.getByRole('button', { name: 'Remove reminder' }));
    await waitFor(async () => expect((await db.reminders.toArray())[0]!.deletedAt).not.toBeNull());
  });
});

describe('board', () => {
  test('shows a reminder tag on the to-do', async () => {
    await ensureSeed(db);
    const cat = (await liveCategories(db, (await liveWorkspaces(db))[0]!.id))[0]!;
    const item = await createItem(db, { categoryId: cat.id, kind: 'todo', title: 'Frame' });
    await setReminder(db, item.id, new Date(Date.now() - 3600_000).toISOString());
    render(<App db={db} />);
    const label = await screen.findByText(/^(Today|Tomorrow|\d+ \w{3}) \d+:\d{2}$/);
    expect(label).toHaveClass('im-tag-rose');
  });

  test('?item=<id> selects the workspace, highlights the item and clears the param', async () => {
    await ensureSeed(db);
    const other = await createWorkspace(db, { name: 'Studio' });
    const cat = await createCategory(db, { workspaceId: other.id, name: 'Today' });
    const item = await createItem(db, { categoryId: cat.id, kind: 'todo', title: 'Order paper' });
    window.history.replaceState(null, '', `/?item=${item.id}`);
    render(<App db={db} />);
    const row = await screen.findByText('Order paper');
    await waitFor(() => expect(row.closest('[data-item-id]')).toHaveClass('atl-highlight'));
    expect(window.location.search).toBe('');
  });
});
