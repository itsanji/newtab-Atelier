const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const at = (base: Date, dayOffset: number, hour: number) =>
  new Date(base.getFullYear(), base.getMonth(), base.getDate() + dayOffset, hour, 0, 0, 0);

export interface ReminderPreset { label: string; at: Date }

/** Preset times in local time; "Later today" disappears from 17:00 on. */
export function reminderPresets(now: Date): ReminderPreset[] {
  const presets: ReminderPreset[] = [];
  if (now.getHours() < 17) presets.push({ label: 'Later today (18:00)', at: at(now, 0, 18) });
  presets.push({ label: 'Tomorrow 9:00', at: at(now, 1, 9) });
  const untilMonday = ((8 - now.getDay()) % 7) || 7;
  presets.push({ label: 'Next week (Mon 9:00)', at: at(now, untilMonday, 9) });
  return presets;
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export function reminderLabel(remindAt: string, now: Date): string {
  const d = new Date(remindAt);
  const time = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (sameDay(d, now)) return `Today ${time}`;
  if (sameDay(d, at(now, 1, 0))) return `Tomorrow ${time}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${time}`;
}

/** Value for a `datetime-local` input, in local time. */
export function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
