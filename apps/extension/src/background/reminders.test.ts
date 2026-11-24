import { beforeEach, describe, expect, test } from 'vitest';
import { installChromeFake, type ChromeFake } from '../../test/chromeFake';
import { openDb, type AtelierDB } from '../data/db';
import { liveCategories, liveWorkspaces } from '../data/queries';
import { clearReminder, createItem, deleteItem, setReminder, updateItem } from '../data/repo';
import { ensureSeed } from '../data/seed';
import { checkReminders, fireDue, onNotificationClicked, syncAlarms } from './reminders';

let fake: ChromeFake;
let db: AtelierDB;
let categoryId: string;
beforeEach(async () => {
  fake = installChromeFake();
  db = openDb('test-' + crypto.randomUUID());
  await ensureSeed(db);
  categoryId = (await liveCategories(db, (await liveWorkspaces(db))[0]!.id))[0]!.id;
});
const todo = (title: string) => createItem(db, { categoryId, kind: 'todo', title });
const NOW = new Date('2026-11-24T10:00:00.000Z');
const past = '2026-11-24T09:00:00.000Z';
const future = '2026-11-25T09:00:00.000Z';

describe('syncAlarms', () => {
  test('creates one alarm per unfired reminder and clears the rest', async () => {
    const a = await todo('a');
    const b = await todo('b');
    await setReminder(db, a.id, future);
    await setReminder(db, b.id, future);
    await syncAlarms(db);
    expect((await fake.alarms.getAll()).map((x) => x.name).sort()).toEqual([`reminder:${a.id}`, `reminder:${b.id}`].sort());
    expect(fake.alarms.create).toHaveBeenCalledWith(`reminder:${a.id}`, { when: Date.parse(future) });
    await clearReminder(db, b.id);
    await syncAlarms(db);
    expect((await fake.alarms.getAll()).map((x) => x.name)).toEqual([`reminder:${a.id}`]);
  });
});

describe('syncAlarms with a damaged reminder', () => {
  test('skips a reminder whose remindAt is not a time and still schedules the others', async () => {
    const a = await todo('a');
    const b = await todo('b');
    await setReminder(db, a.id, future);
    const bad = await setReminder(db, b.id, future);
    await db.reminders.update(bad.id, { remindAt: 'not a date' });
    await expect(syncAlarms(db)).resolves.toBeUndefined();
    expect((await fake.alarms.getAll()).map((x) => x.name)).toEqual([`reminder:${a.id}`]);
  });
});

describe('reminders repo', () => {
  test('setReminder replaces, clearReminder tombstones, outbox keeps one latest entry for the row', async () => {
    const a = await todo('a');
    const before = await db.outbox.count();
    const r1 = await setReminder(db, a.id, future);
    const r2 = await setReminder(db, a.id, '2026-11-26T09:00:00.000Z');
    expect(r2.id).toBe(r1.id);
    expect(await db.reminders.count()).toBe(1);
    await clearReminder(db, a.id);
    expect((await db.reminders.get(r1.id))!.deletedAt).not.toBeNull();
    expect(await db.outbox.count()).toBe(before + 1);
    const entry = (await db.outbox.get(`reminders:${r1.id}`))!;
    expect((entry.row as { deletedAt: string | null }).deletedAt).not.toBeNull();
  });
});

describe('fireDue', () => {
  test('notifies and marks remindedAt', async () => {
    const a = await todo('Call the framer');
    const r = await setReminder(db, a.id, past);
    expect(await fireDue(db, NOW)).toEqual([a.id]);
    expect(fake.notifications.create).toHaveBeenCalledWith(`reminder:${a.id}`, expect.objectContaining({
      type: 'basic', title: 'Call the framer', message: 'Reminder from Atelier',
    }));
    expect((await db.reminders.get(r.id))!.remindedAt).not.toBeNull();
  });

  test('marking fired stamps updatedBy and queues the latest snapshot', async () => {
    const a = await todo('stamp');
    const r = await setReminder(db, a.id, past);
    await fireDue(db, NOW);
    const row = (await db.reminders.get(r.id))!;
    expect(row.updatedBy).toBe('local');
    expect(row.updatedAt).toBe(row.remindedAt);
    expect((await db.outbox.get(`reminders:${r.id}`))!.row).toEqual(row);
  });

  test('skips future, deleted and done to-dos (done and deleted are marked silently)', async () => {
    const fut = await todo('future');
    const del = await todo('deleted');
    const done = await todo('done');
    await setReminder(db, fut.id, future);
    await setReminder(db, del.id, past);
    await setReminder(db, done.id, past);
    await deleteItem(db, del.id);
    await updateItem(db, done.id, { done: true });
    expect(await fireDue(db, NOW)).toEqual([]);
    expect(fake.notifications.create).not.toHaveBeenCalled();
    expect((await db.reminders.where('itemId').equals(fut.id).first())!.remindedAt).toBeNull();
    expect((await db.reminders.where('itemId').equals(done.id).first())!.remindedAt).not.toBeNull();
  });

  test('a tombstoned reminder never fires', async () => {
    const a = await todo('a');
    await setReminder(db, a.id, past);
    await clearReminder(db, a.id);
    expect(await fireDue(db, NOW)).toEqual([]);
  });

  test('concurrent calls notify exactly once', async () => {
    const a = await todo('once');
    await setReminder(db, a.id, past);
    const results = await Promise.all([fireDue(db, NOW), fireDue(db, NOW)]);
    expect(results.flat()).toEqual([a.id]);
    expect(fake.notifications.create).toHaveBeenCalledTimes(1);
  });

  test('missed reminder fires on startup exactly once', async () => {
    const a = await todo('missed');
    await setReminder(db, a.id, past);
    await checkReminders(db, NOW);
    await checkReminders(db, NOW);
    expect(fake.notifications.create).toHaveBeenCalledTimes(1);
    expect(await fireDue(db, NOW)).toEqual([]);
    expect(await fake.alarms.getAll()).toEqual([]);
  });
});

test('notification click opens the board focused on the item', async () => {
  await onNotificationClicked('reminder:abc');
  expect(fake.tabs.create).toHaveBeenCalledWith({ url: 'chrome-extension://fake/src/newtab/index.html?item=abc' });
  expect(fake.notifications.clear).toHaveBeenCalledWith('reminder:abc');
  await onNotificationClicked('other');
  expect(fake.tabs.create).toHaveBeenCalledTimes(1);
});
