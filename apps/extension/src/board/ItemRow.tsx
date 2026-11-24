import { useRef, useState } from 'react';
import type { Item } from '@atelier/core';
import { faviconUrl } from '../chrome/favicon';
import { useDb } from '../data/DbContext';
import { deleteItem, updateItem } from '../data/repo';
import { Menu } from '../ui/components/Menu';
import { Icon } from '../ui/components/Icon';
import { LinkForm } from './LinkForm';
import { useRun } from './Notice';
import { removeAndRefocus } from './removeItem';
import { useSortableItem } from './dnd';
import { Dialog } from '../ui/components/Dialog';
import { Tag } from '../ui/components/Tag';
import { useCanEdit } from './useRole';
import { domainOf, normalizeUrl } from './url';

const TONES = ['lily', 'sage', 'rose', 'ochre'] as const;

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function ItemRow({ item }: { item: Item }) {
  const db = useDb();
  const run = useRun();
  const row = useRef<HTMLDivElement | null>(null);
  const [broken, setBroken] = useState(false);
  const [editing, setEditing] = useState(false);
  const url = item.url ?? '';
  const domain = domainOf(url);
  const canEdit = useCanEdit();
  const dnd = useSortableItem(item, true);
  const tone = TONES[hash(item.id) % 4];

  const remove = () => removeAndRefocus(row.current, () => run(deleteItem(db, item.id)));

  return (
    <div
      className="atl-item"
      data-item-id={item.id}
      ref={(el) => { row.current = el; dnd.setNodeRef(el); }}
      style={dnd.style}
      {...dnd.rowProps}
    >
      {dnd.handle}
      <a href={url} className="atl-link atl-item-link" draggable={false}>
        <span className={`atl-fav atl-tone-${tone}`}>
          {broken ? (
            (item.title || domain).charAt(0).toUpperCase()
          ) : (
            <img src={faviconUrl(url)} alt="" width={20} height={20} onError={() => setBroken(true)} />
          )}
        </span>
        <span className="atl-item-text">
          <span
            className="atl-item-title"
            title={item.title}
            style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
          >
            {item.title}
          </span>
          <span className="atl-item-domain">{domain}</span>
        </span>
        {item.restored && <Tag tone="ochre">Restored</Tag>}
      </a>
      {canEdit && <div className="atl-item-menu">
        <Menu
          trigger={<Icon name="more" size={18} />}
          triggerLabel="Link options"
          triggerClassName="atl-icon"
          items={[
            { label: 'Edit', onSelect: () => setEditing(true) },
            { label: 'Delete', danger: true, onSelect: () => void remove() },
          ]}
        />
      </div>}
      <Dialog open={editing} title="Edit link" onClose={() => setEditing(false)}>
        <LinkForm
          initial={{ url, title: item.title }}
          submitLabel="Save link"
          onCancel={() => setEditing(false)}
          onSubmit={async ({ url: u, title }) => {
            await run(updateItem(db, item.id, { url: normalizeUrl(u) ?? u, title }));
            setEditing(false);
          }}
        />
      </Dialog>
    </div>
  );
}
