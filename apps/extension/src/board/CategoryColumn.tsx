import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Category } from '@atelier/core';
import { useDb } from '../data/DbContext';
import { liveItems } from '../data/queries';
import { deleteCategory, updateCategory } from '../data/repo';
import { Tag } from '../ui/components/Tag';
import { InlineNameField } from './InlineNameField';
import { Menu } from '../ui/components/Menu';
import { Icon } from '../ui/components/Icon';
import { useRun } from './Notice';
import { AddItemMenu } from './AddItemMenu';
import { ItemRow } from './ItemRow';
import { NoteItem } from './NoteItem';
import { TodoItem } from './TodoItem';

export function CategoryColumn({ category, onOpenAll }: { category: Category; onOpenAll?: () => void }) {
  const db = useDb();
  const run = useRun();
  const section = useRef<HTMLElement>(null);
  const items = useLiveQuery(() => liveItems(db, category.id), [db, category.id]) ?? [];
  const [renaming, setRenaming] = useState(false);
  const [freshNote, setFreshNote] = useState<string | null>(null);

  const startRename = () => setRenaming(true);

  // The column unmounts on delete, so hand focus to the next column heading, or else the New category tile.
  const remove = async () => {
    const next = section.current?.nextElementSibling;
    const target = next?.querySelector<HTMLElement>('.atl-title-btn') ?? next?.querySelector<HTMLElement>('.atl-newcat-btn');
    if (await run(deleteCategory(db, category.id))) target?.focus();
  };

  return (
    <section className="atl-column" ref={section} aria-label={category.name}>
      <div className="atl-column-head">
        {category.emoji && <span aria-hidden="true">{category.emoji}</span>}
        {renaming ? (
          <InlineNameField
            label="Category name"
            initial={category.name}
            onCancel={() => setRenaming(false)}
            onCommit={(name) => {
              setRenaming(false);
              if (name && name !== category.name) void run(updateCategory(db, category.id, { name }));
            }}
          />
        ) : (
          <h2 className="atl-column-title">
            <button type="button" className="atl-title-btn" onClick={startRename}>{category.name}</button>
          </h2>
        )}
        {category.tabGroup ? <Tag tone="lily">Tab group · {items.length}</Tag> : <Tag>{items.length}</Tag>}
        <Menu
          trigger={<Icon name="more" size={18} />}
          triggerLabel="Category options"
          triggerClassName="atl-icon"
          items={[
            { label: 'Rename', onSelect: startRename },
            { label: 'Delete', danger: true, onSelect: () => void remove() },
          ]}
        />
      </div>
      {items.map((item) => {
        if (item.kind === 'link') return <ItemRow key={item.id} item={item} />;
        if (item.kind === 'note') return <NoteItem key={item.id} item={item} autoFocus={item.id === freshNote} onAutoFocused={() => setFreshNote(null)} />;
        if (item.kind === 'todo') return <TodoItem key={item.id} item={item} />;
        return null;
      })}
      <div className="atl-column-foot">
        <AddItemMenu categoryId={category.id} onCreated={setFreshNote} />
        <button type="button" className="atl-textlink" onClick={() => onOpenAll?.()}>Open all</button>
      </div>
    </section>
  );
}
