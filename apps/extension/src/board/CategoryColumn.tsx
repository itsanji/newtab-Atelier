import { useRef, useState, type CSSProperties } from 'react';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useLiveQuery } from 'dexie-react-hooks';
import { arrangeItems, type Category } from '@atelier/core';
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
import { useNotify, useRun } from './Notice';
import { useCanEdit, useCurrentRole, VIEW_ONLY } from './useRole';
import { useAccount } from '../account/useAccount';
import { ApiClient } from '../sync/api';
import { syncNow } from '../sync/localWrites';
import { AddItemMenu } from './AddItemMenu';
import { CategoryNameContext } from './dnd';
import { FolderBlock } from './FolderBlock';
import { ItemRow } from './ItemRow';
import { NoteItem } from './NoteItem';
import { TodoItem } from './TodoItem';

/** `place` positions the column in the list view's masonry; the board's columns leave it out. */
export function CategoryColumn({ category, onOpenAll, place }: { category: Category; onOpenAll?: () => void; place?: CSSProperties }) {
  const db = useDb();
  const run = useRun();
  const notify = useNotify();
  const canEdit = useCanEdit();
  const role = useCurrentRole();
  const account = useAccount();
  const section = useRef<HTMLElement | null>(null);
  const sort = useSortable({ id: category.id, disabled: !canEdit, data: { type: 'category', title: category.name } });
  const style: CSSProperties = { ...place, transform: CSS.Translate.toString(sort.transform), transition: sort.transition, opacity: sort.isDragging ? 0.4 : undefined };
  const all = useLiveQuery(() => liveItems(db, category.id), [db, category.id]) ?? [];
  const { top, inFolder } = arrangeItems(all);
  /** What the user saved here: folders hold items but don't count as one. */
  const items = all.filter((i) => i.kind !== 'folder');
  const [renaming, setRenaming] = useState(false);
  /** A note or folder just added from the Add menu: its editor or name field opens once it mounts. */
  const [freshNote, setFreshNote] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  /** Set when a confirmed delete starts: where focus goes once the column (and its dialog) unmounts. */
  const afterDelete = useRef<HTMLElement | null>(null);

  const startRename = () => setRenaming(true);

  // Public links: only for signed-in editors and owners; the server mints the token and the url.
  const publicLink = async (action: 'create' | 'copy' | 'stop') => {
    if (!account) return;
    const api = new ApiClient(account.serverUrl, account.token);
    try {
      if (action === 'stop') {
        await api.unshare(category.id);
        await db.categories.update(category.id, { shareToken: null });
        notify('Public link stopped');
      } else {
        const { shareToken, url } = await api.share(category.id);
        await db.categories.update(category.id, { shareToken });
        try {
          await navigator.clipboard.writeText(url);
          notify('Link copied');
        } catch {
          notify(`Couldn't copy the link: ${url}`);
        }
      }
      syncNow();
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Something went wrong. Try again.');
    }
  };
  const linkItems = account && role !== 'viewer'
    ? category.shareToken
      ? [{ label: 'Copy public link', onSelect: () => void publicLink('copy') }, { label: 'Stop sharing', onSelect: () => void publicLink('stop') }]
      : [{ label: 'Create public link', onSelect: () => void publicLink('create') }]
    : [];

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
        {canEdit && <IconButton label="Drag to reorder category" icon="grip" className="atl-grip" ref={sort.setActivatorNodeRef} {...sort.attributes} {...sort.listeners} />}
        {canEdit
          ? <EmojiPicker value={category.emoji} onChange={(emoji) => void run(updateCategory(db, category.id, { emoji }))} />
          : category.emoji && <span aria-hidden="true">{category.emoji}</span>}
        {renaming && canEdit ? (
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
            <button type="button" className="atl-title-btn" onClick={startRename} disabled={!canEdit} title={canEdit ? category.name : VIEW_ONLY}>{category.name}</button>
          </h2>
        )}
        {category.tabGroup ? <Tag tone="lily">Tab group · {items.length}</Tag> : <Tag>{items.length}</Tag>}
        {category.shareToken && <Tag tone="sage">Public</Tag>}
        {canEdit && (
          <Menu
            trigger={<Icon name="more" size={18} />}
            triggerLabel="Category options"
            triggerClassName="atl-icon"
            items={[
              { label: 'Rename', onSelect: startRename },
              ...linkItems,
              { label: 'Delete', danger: true, onSelect: askRemove },
            ]}
          />
        )}
      </div>
      <CategoryNameContext.Provider value={category.name}>
      <div className="atl-column-body">
      <SortableContext items={top.map((i) => i.id)} strategy={verticalListSortingStrategy}>
      {top.map((item) => {
        if (item.kind === 'folder') {
          return (
            <FolderBlock
              key={item.id} folder={item} links={inFolder.get(item.id) ?? []}
              autoRename={item.id === freshNote} onAutoRenamed={() => setFreshNote(null)}
            />
          );
        }
        if (item.kind === 'link') return <ItemRow key={item.id} item={item} />;
        if (item.kind === 'note') return <NoteItem key={item.id} item={item} autoFocus={item.id === freshNote} onAutoFocused={() => setFreshNote(null)} />;
        if (item.kind === 'todo') return <TodoItem key={item.id} item={item} />;
        return null;
      })}
      </SortableContext>
      </div>
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
