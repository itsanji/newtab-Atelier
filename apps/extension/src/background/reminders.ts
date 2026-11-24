import type { AtelierDB } from '../data/db';
import { clock, tx } from '../data/repo';
import { liveReminders } from '../data/queries';

const PREFIX = 'reminder:';

export const alarmName = (itemId: string) => PREFIX + itemId;

/** One alarm per live, unfired reminder; clears reminder alarms that no longer apply. */
export async function syncAlarms(db: AtelierDB): Promise<void> {
  const pending = (await liveReminders(db)).filter((r) => r.remindedAt === null);
  const wanted = new Map(pending.map((r) => [alarmName(r.itemId), Date.parse(r.remindAt)]));
  for (const alarm of await chrome.alarms.getAll()) {
    if (alarm.name.startsWith(PREFIX) && !wanted.has(alarm.name)) await chrome.alarms.clear(alarm.name);
  }
  for (const [name, when] of wanted) await chrome.alarms.create(name, { when });
}

/**
 * Notifies for every live, unfired reminder that is due. `remindedAt` is written first, in its own
 * transaction, so a crash between the two steps can never notify twice.
 */
export async function fireDue(db: AtelierDB, now: Date): Promise<string[]> {
  const due = (await liveReminders(db)).filter((r) => r.remindedAt === null && Date.parse(r.remindAt) <= now.getTime());
  const fired: string[] = [];
  for (const r of due) {
    const item = await tx(db, async () => {
      const cur = await db.reminders.get(r.id);
      if (!cur || cur.deletedAt !== null || cur.remindedAt !== null) return null;
      const stamp = clock.now();
      const next = { ...cur, remindedAt: stamp, updatedAt: stamp };
      await db.reminders.put(next);
      await db.outbox.add({ table: 'reminders', rowId: next.id, row: { ...next }, queuedAt: stamp });
      return db.items.get(r.itemId);
    });
    // A deleted or completed to-do has nothing left to remind about.
    if (!item || item.deletedAt !== null || item.done) continue;
    fired.push(r.itemId);
    await chrome.notifications.create(alarmName(r.itemId), {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
      title: item.title,
      message: 'Reminder from Atelier',
    });
  }
  return fired;
}

export async function checkReminders(db: AtelierDB, now = new Date()): Promise<void> {
  await fireDue(db, now);
  await syncAlarms(db);
}

export async function onReminderAlarm(db: AtelierDB, alarm: { name: string }): Promise<void> {
  if (alarm.name.startsWith(PREFIX)) await checkReminders(db);
}

export async function onNotificationClicked(id: string): Promise<void> {
  if (!id.startsWith(PREFIX)) return;
  await chrome.tabs.create({ url: `${chrome.runtime.getURL('src/newtab/index.html')}?item=${id.slice(PREFIX.length)}` });
  await chrome.notifications.clear(id);
}
