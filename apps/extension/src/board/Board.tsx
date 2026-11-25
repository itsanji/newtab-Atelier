import { useState, type CSSProperties } from 'react';
import { CATEGORY_WIDTH, type BoardView, type CategorySize } from '../data/boardView';
import { useMasonry } from './useMasonry';
import { SortableContext, rectSortingStrategy } from '@dnd-kit/sortable';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Workspace } from '@atelier/core';
import { useDb } from '../data/DbContext';
import { liveCategories } from '../data/queries';
import { createCategory } from '../data/repo';
import { InlineNameField } from './InlineNameField';
import { Icon } from '../ui/components/Icon';
import { useRun } from './Notice';
import { openAll } from '../chrome/tabs';
import { CategoryColumn } from './CategoryColumn';
import { useNewCategoryDrop } from './dnd';
import { useCanEdit, VIEW_ONLY } from './useRole';

/** Space between categories, in both views (--space-5). */
const GAP = 24;

export function Board({ workspace, view = 'columns', size = 'm' }: { workspace: Workspace; view?: BoardView; size?: CategorySize }) {
  const db = useDb();
  const run = useRun();
  const categories = useLiveQuery(() => liveCategories(db, workspace.id), [db, workspace.id]) ?? [];
  const [adding, setAdding] = useState(false);
  const canEdit = useCanEdit();
  const drop = useNewCategoryDrop(workspace.id, !canEdit);
  const width = CATEGORY_WIDTH[size];
  const masonry = useMasonry(view === 'list', width, GAP, categories.length + 1);
  const place = (i: number): CSSProperties | undefined => masonry.places?.[i];
  const boardStyle = { '--atl-col-width': `${width}px`, ...(masonry.height !== null ? { height: masonry.height } : {}) } as CSSProperties;

  return (
    <div
      className={view === 'list' ? 'atl-board atl-board-list' : 'atl-board'}
      data-popover-bounds
      ref={masonry.ref}
      style={boardStyle}
    >
      <SortableContext items={categories.map((c) => c.id)} strategy={rectSortingStrategy}>
        {categories.map((c, i) => <CategoryColumn key={c.id} category={c} place={place(i)} onOpenAll={() => void run(openAll(db, c.id))} />)}
      </SortableContext>
      <div ref={drop.setNodeRef} style={place(categories.length)} className={drop.isOver ? 'atl-newcat atl-newcat-over' : 'atl-newcat'}>
        {adding ? (
          <InlineNameField
            label="Category name"
            placeholder="Name this category"
            onCancel={() => setAdding(false)}
            onCommit={(name) => {
              setAdding(false);
              if (name) void run(createCategory(db, { workspaceId: workspace.id, name }));
            }}
          />
        ) : (
          <button type="button" className="atl-newcat-btn" onClick={() => setAdding(true)} disabled={!canEdit} title={canEdit ? undefined : VIEW_ONLY}>
            <Icon name="plus" size={24} />
            <span className="atl-newcat-title">New category</span>
            <span className="atl-newcat-hint">{canEdit ? 'Or drop tabs here to start one' : VIEW_ONLY}</span>
          </button>
        )}
      </div>
    </div>
  );
}
