import { useEffect, useRef, useState } from 'react';
import { useDb } from '../data/DbContext';
import { clearReminder, setReminder } from '../data/repo';
import { Button } from '../ui/components/Button';
import { Field } from '../ui/components/Field';
import { IconButton } from '../ui/components/IconButton';
import { useRun } from './Notice';
import { reminderPresets, toLocalInput } from './reminderTime';

function announceChange() {
  try {
    void Promise.resolve(chrome.runtime.sendMessage({ type: 'reminders-changed' })).catch(() => {});
  } catch {
    // No receiver (worker asleep or absent): alarms are re-synced on next startup.
  }
}

export function ReminderPicker({
  itemId, hasReminder, now = () => new Date(),
}: { itemId: string; hasReminder: boolean; now?: () => Date }) {
  const db = useDb();
  const run = useRun();
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState('');
  const [error, setError] = useState<string>();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      trigger.current?.focus();
    };
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    setError(undefined);
    trigger.current?.focus();
  };

  const choose = async (at: Date) => {
    if (at.getTime() <= now().getTime()) return setError('Pick a time in the future');
    close();
    if (await run(setReminder(db, itemId, at.toISOString()))) announceChange();
  };

  const remove = async () => {
    close();
    if (await run(clearReminder(db, itemId))) announceChange();
  };

  return (
    <div className="im-menu atl-reminder" ref={root}>
      <IconButton
        ref={trigger}
        icon="bell"
        label={hasReminder ? 'Change reminder' : 'Set reminder'}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => { setCustom(toLocalInput(now())); setError(undefined); setOpen((o) => !o); }}
      />
      {open && (
        <div role="dialog" aria-label="Reminder" className="im-menu-list atl-reminder-pop">
          {reminderPresets(now()).map((p) => (
            <button key={p.label} type="button" className="im-menu-item" onClick={() => void choose(p.at)}>
              {p.label}
            </button>
          ))}
          <div className="atl-reminder-custom">
            <Field
              type="datetime-local"
              label="Custom time"
              value={custom}
              error={error}
              onChange={(e) => { setCustom(e.target.value); setError(undefined); }}
            />
            <Button onClick={() => void choose(new Date(custom))}>Set time</Button>
          </div>
          {hasReminder && (
            <button type="button" className="im-menu-item im-menu-item-danger" onClick={() => void remove()}>
              Remove reminder
            </button>
          )}
        </div>
      )}
    </div>
  );
}
