import { useRef, useState, type CSSProperties } from 'react';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Category } from '@atelier/core';
import { useDb } from '../data/DbContext';
import { liveItems } from '../data/queries';
import { deleteCategory, updateCategory } from '../data/repo';
import { Button } from '../ui/components/Button';
import { Dialog } from '../ui/components/Dialog';
import { Tag } from '../ui/components/Tag';
import { InlineNameField } from './InlineNameField';
import { Menu } from '../ui/components/Menu';
import { Icon } from '../ui/components/Icon';
import { IconButton } from '../ui/components/IconButton';
import { EmojiPicker } from './EmojiPicker';
import { useRun } from './Notice';
import { AddItemMenu } from './AddItemMenu';
import { CategoryNameContext } from './dnd';
import { ItemRow } from './ItemRow';
import { NoteItem } from './NoteItem';
import { TodoItem } from './TodoItem';

export function CategoryColumn({ category, onOpenAll }: { category: Category; onOpenAll?: () => void }) {
  const db = useDb();
  const run = useRun();
  const section = useRef<HTMLElement | null>(null);
  const sort = useSortable({ id: category.id, data: { type: 'category', title: category.name } });
  const style: CSSProperties = { transform: CSS.Translate.toString(sort.transform), transition: sort.transition, opacity: sort.isDragging ? 0.4 : undefined };
  const items = useLiveQuery(() => liveItems(db, category.id), [db, category.id]) ?? [];
  const [renaming, setRenaming] = useState(false);
  const [freshNote, setFreshNote] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  /** Set when a confirmed delete starts: where focus goes once the column (and its dialog) unmounts. */
  const afterDelete = useRef<HTMLElement | null>(null);

  const startRename = () => setRenaming(true);

  // The column unmounts on delete, so hand focus to the next column heading, or else the New category tile.
  const nextFocus = () => {
    const next = section.current?.nextElementSibling;
    return next?.querySelector<HTMLElement>('.atl-title-btn') ?? next?.querySelector<HTMLElement>('.atl-newcat-btn') ?? null;
  };
  const remove = async () => {
    const target = nextFocus();
    if (await run(deleteCategory(db, category.id))) target?.focus();
  };
  // An empty category goes at once; one with saved items asks first.
  const askRemove = () => (items.length > 0 ? setConfirming(true) : void remove());
  const confirmRemove = async () => {
    afterDelete.current = nextFocus();
    // On success the column unmounts, closing the dialog, which then focuses `afterDelete`.
    if (!(await run(deleteCategory(db, category.id)))) {
      afterDelete.current = null;
      setConfirming(false);
    }
  };

  return (
    <section className="atl-column" ref={(el) => { section.current = el; sort.setNodeRef(el); }} style={style} aria-label={category.name}>
      <div className="atl-column-head">
        <IconButton label="Drag to reorder category" icon="grip" className="atl-grip" ref={sort.setActivatorNodeRef} {...sort.attributes} {...sort.listeners} />
        <EmojiPicker value={category.emoji} onChange={(emoji) => void run(updateCategory(db, category.id, { emoji }))} />
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
            { label: 'Delete', danger: true, onSelect: askRemove },
          ]}
        />
      </div>
      <CategoryNameContext.Provider value={category.name}>
      <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
      {items.map((item) => {
        if (item.kind === 'link') return <ItemRow key={item.id} item={item} />;
        if (item.kind === 'note') return <NoteItem key={item.id} item={item} autoFocus={item.id === freshNote} onAutoFocused={() => setFreshNote(null)} />;
        if (item.kind === 'todo') return <TodoItem key={item.id} item={item} />;
        return null;
      })}
      </SortableContext>
      </CategoryNameContext.Provider>
      <Dialog
        open={confirming}
        title={`Delete ${category.name}?`}
        returnFocusTo={() => afterDelete.current ?? section.current?.querySelector<HTMLElement>('.atl-title-btn') ?? null}
        onClose={() => setConfirming(false)}
      >
        <p>This also deletes its {items.length} saved {items.length === 1 ? 'item' : 'items'}.</p>
        <div className="atl-form-actions">
          <Button variant="danger" onClick={() => void confirmRemove()}>Delete category</Button>
          <Button variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>
        </div>
      </Dialog>
      <div className="atl-column-foot">
        <AddItemMenu categoryId={category.id} onCreated={setFreshNote} />
        <button type="button" className="atl-textlink" onClick={() => onOpenAll?.()}>Open all</button>
      </div>
    </section>
  );
}
