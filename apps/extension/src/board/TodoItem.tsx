import { useRef, useState } from 'react';
import type { Item } from '@atelier/core';
import { useDb } from '../data/DbContext';
import { deleteItem, updateItem } from '../data/repo';
import { Menu } from '../ui/components/Menu';
import { Icon } from '../ui/components/Icon';
import { InlineNameField } from './InlineNameField';
import { useRun } from './Notice';
import { removeAndRefocus } from './removeItem';

export function TodoItem({ item }: { item: Item }) {
  const db = useDb();
  const run = useRun();
  const row = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);

  const remove = () => removeAndRefocus(row.current, () => run(deleteItem(db, item.id)));

  return (
    <div className="atl-item atl-todo" ref={row}>
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
          {/* Reminder tag slot (Task 9) */}
        </label>
      )}
      {!editing && (
        <div className="atl-item-menu">
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
