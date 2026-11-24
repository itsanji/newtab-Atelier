import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Item } from '@atelier/core';
import { useDb } from '../data/DbContext';
import { deleteItem, updateItem } from '../data/repo';
import { Menu } from '../ui/components/Menu';
import { Icon } from '../ui/components/Icon';
import { Tag } from '../ui/components/Tag';
import { liveReminders } from '../data/queries';
import { ReminderPicker } from './ReminderPicker';
import { reminderLabel } from './reminderTime';
import { InlineNameField } from './InlineNameField';
import { useRun } from './Notice';
import { removeAndRefocus } from './removeItem';
import { useSortableItem } from './dnd';

export function TodoItem({ item }: { item: Item }) {
  const db = useDb();
  const run = useRun();
  const row = useRef<HTMLDivElement | null>(null);
  const dnd = useSortableItem(item, false);
  const [editing, setEditing] = useState(false);
  const reminder = useLiveQuery(
    async () => (await liveReminders(db)).find((r) => r.itemId === item.id) ?? null,
    [db, item.id],
  );

  const remove = () => removeAndRefocus(row.current, () => run(deleteItem(db, item.id)));

  return (
    <div className="atl-item atl-todo" data-item-id={item.id} ref={(el) => { row.current = el; dnd.setNodeRef(el); }} style={dnd.style}>
      {dnd.handle}
      {editing ? (
        <InlineNameField
          label="To-do text"
          initial={item.title}
          onCancel={() => setEditing(false)}
          onCommit={(text) => {
            setEditing(false);
            if (text && text !== item.title) void run(updateItem(db, item.id, { title: text }));
          }}
        />
      ) : (
        <label className="atl-todo-label">
          <input
            type="checkbox"
            className="atl-check"
            checked={item.done}
            onChange={(e) => void run(updateItem(db, item.id, { done: e.target.checked }))}
          />
          <span className={item.done ? 'atl-todo-done' : undefined}>{item.title}</span>
          {reminder && !item.done && reminder.remindedAt === null && (
            <Tag tone={Date.parse(reminder.remindAt) <= Date.now() ? 'rose' : 'ochre'}>
              {reminderLabel(reminder.remindAt, new Date())}
            </Tag>
          )}
        </label>
      )}
      {!editing && (
        <div className="atl-item-menu">
          <ReminderPicker itemId={item.id} hasReminder={!!reminder && reminder.remindedAt === null} />
          <Menu
            trigger={<Icon name="more" size={18} />}
            triggerLabel="To-do options"
            triggerClassName="atl-icon"
            items={[
              { label: 'Edit', onSelect: () => setEditing(true) },
              { label: 'Delete', danger: true, onSelect: () => void remove() },
            ]}
          />
        </div>
      )}
    </div>
  );
}
