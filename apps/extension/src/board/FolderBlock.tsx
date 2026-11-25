import { useRef, useState } from 'react';
import { SortableContext, rectSortingStrategy, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { Item } from '@atelier/core';
import { faviconUrl, useFaviconVersion } from '../chrome/favicon';
import { useDb } from '../data/DbContext';
import { createItem, deleteFolder, updateItem } from '../data/repo';
import { Button } from '../ui/components/Button';
import { Dialog } from '../ui/components/Dialog';
import { Icon } from '../ui/components/Icon';
import { Menu } from '../ui/components/Menu';
import { useFolderDrop, useSortableItem } from './dnd';
import { InlineNameField } from './InlineNameField';
import { ItemRow } from './ItemRow';
import { LinkForm } from './LinkForm';
import { useRun } from './Notice';
import { useCanEdit, VIEW_ONLY } from './useRole';
import { domainOf } from './url';

export const folderName = (folder: Item, count: number) => folder.title.trim() || `${count} ${count === 1 ? 'site' : 'sites'}`;

/** One link as a site icon: click to open, drag to reorder or move it out. */
function FolderTile({ item }: { item: Item }) {
  const favVersion = useFaviconVersion();
  const [brokenAt, setBrokenAt] = useState<string | null>(null);
  const url = item.url ?? '';
  const domain = domainOf(url);
  const label = item.title || domain;
  const dnd = useSortableItem(item, true, { folderId: item.folderId, axis: 'x' });
  return (
    <a
      href={url}
      className="atl-tile"
      data-item-id={item.id}
      title={item.title && item.title !== domain ? `${item.title}\n${domain}` : domain}
      aria-label={label}
      draggable={false}
      ref={dnd.setNodeRef}
      style={dnd.style}
      {...dnd.rowProps}
    >
      {brokenAt === favVersion ? (
        <span className="atl-tile-letter" aria-hidden="true">{label.charAt(0).toUpperCase()}</span>
      ) : (
        <img src={faviconUrl(url)} alt="" width={24} height={24} onError={() => setBrokenAt(favVersion)} />
      )}
    </a>
  );
}

/**
 * A folder of links for quick access: a grid of site icons under a small heading. It can switch to a list
 * (full titles, edit and delete menus, drag handles), and links or tabs dropped on it go inside.
 */
export function FolderBlock({ folder, links, autoRename = false, onAutoRenamed }: {
  folder: Item; links: Item[]; autoRename?: boolean; onAutoRenamed?(): void;
}) {
  const db = useDb();
  const run = useRun();
  const canEdit = useCanEdit();
  // The heading drags the folder; a click on its name still renames.
  const dnd = useSortableItem(folder, true);
  const zone = useFolderDrop(folder, !canEdit);
  const [renaming, setRenaming] = useState(autoRename);
  const [asList, setAsList] = useState(false);
  const [adding, setAdding] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);
  const name = folderName(folder, links.length);

  const finishRename = (value: string | null) => {
    setRenaming(false);
    onAutoRenamed?.();
    if (value !== null && value !== folder.title) void run(updateItem(db, folder.id, { title: value }));
  };

  return (
    <div
      className="atl-folder"
      data-item-id={folder.id}
      ref={(el) => { box.current = el; dnd.setNodeRef(el); }}
      style={dnd.style}
      role="group"
      aria-label={`Folder ${name}`}
    >
      <div className="atl-folder-head" {...dnd.rowProps}>
        {dnd.handle}
        <Icon name="folder" size={16} className="atl-folder-icon" aria-hidden="true" />
        {renaming && canEdit ? (
          <InlineNameField
            label="Folder name"
            placeholder="Name this folder"
            initial={folder.title}
            onCancel={() => finishRename(null)}
            onCommit={(value) => finishRename(value)}
          />
        ) : (
          <button
            type="button"
            className="atl-folder-name"
            onClick={() => setRenaming(true)}
            disabled={!canEdit}
            title={canEdit ? name : VIEW_ONLY}
          >
            {name}
          </button>
        )}
        <span className="atl-folder-count" aria-label={`${links.length} links`}>{links.length}</span>
        {canEdit && (
          <Menu
            trigger={<Icon name="more" size={18} />}
            triggerLabel="Folder options"
            triggerClassName="atl-icon"
            items={[
              { label: 'Add link', onSelect: () => setAdding(true) },
              { label: 'Rename', onSelect: () => setRenaming(true) },
              { label: asList ? 'Show as icons' : 'Show as list', onSelect: () => setAsList((v) => !v) },
              { label: 'Remove folder, keep links', onSelect: () => void run(deleteFolder(db, folder.id)) },
              { label: 'Delete folder and links', danger: true, onSelect: () => (links.length ? setConfirming(true) : void run(deleteFolder(db, folder.id))) },
            ]}
          />
        )}
      </div>
      <div
        ref={zone.setNodeRef}
        className={['atl-folder-body', asList ? 'atl-folder-list' : 'atl-folder-grid', zone.isOver ? 'atl-folder-over' : ''].join(' ').trim()}
      >
        <SortableContext items={links.map((l) => l.id)} strategy={asList ? verticalListSortingStrategy : rectSortingStrategy}>
          {links.map((l) => (asList ? <ItemRow key={l.id} item={l} folderId={folder.id} /> : <FolderTile key={l.id} item={l} />))}
        </SortableContext>
        {!asList && canEdit && (
          <button type="button" className="atl-tile atl-tile-add" aria-label={`Add link to ${name}`} title="Add link" onClick={() => setAdding(true)}>
            <Icon name="plus" size={18} />
          </button>
        )}
        {asList && links.length === 0 && <p className="atl-folder-empty">Drop links here</p>}
      </div>
      {adding && (
        <LinkForm
          submitLabel="Add link"
          onCancel={() => setAdding(false)}
          onSubmit={async ({ url, title }) => {
            await run(createItem(db, { categoryId: folder.categoryId, folderId: folder.id, kind: 'link', title, url }));
            setAdding(false);
          }}
        />
      )}
      <Dialog
        open={confirming}
        title={`Delete ${name}?`}
        returnFocusTo={() => box.current?.querySelector<HTMLElement>('.atl-folder-name') ?? null}
        onClose={() => setConfirming(false)}
      >
        <p>This also deletes its {links.length} {links.length === 1 ? 'link' : 'links'}.</p>
        <div className="atl-form-actions">
          <Button variant="danger" onClick={() => { setConfirming(false); void run(deleteFolder(db, folder.id, { withLinks: true })); }}>Delete folder</Button>
          <Button variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>
        </div>
      </Dialog>
    </div>
  );
}
