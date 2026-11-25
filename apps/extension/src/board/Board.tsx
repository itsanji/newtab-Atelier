import { useState, type WheelEvent } from 'react';
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

/**
 * The board scrolls sideways (its scrollbar is hidden). A plain wheel moves it sideways too, so a mouse
 * without a horizontal wheel reaches every column: over a column's items only once they can't scroll any
 * further that way, anywhere else on the board at once.
 */
function wheelSideways(e: WheelEvent<HTMLDivElement>) {
  if (e.deltaX !== 0 || e.shiftKey || e.ctrlKey || e.deltaY === 0) return;
  const target = e.target as Element;
  // Inside a menu, a picker or a text field the wheel stays theirs.
  if (target.closest('[role="menu"], [role="dialog"], textarea, .ProseMirror')) return;
  const list = target.closest('.atl-column-body');
  if (list) {
    const room = e.deltaY > 0 ? list.scrollHeight - list.clientHeight - list.scrollTop : list.scrollTop;
    if (room > 1) return;
  }
  e.currentTarget.scrollLeft += e.deltaY;
}

export function Board({ workspace }: { workspace: Workspace }) {
  const db = useDb();
  const run = useRun();
  const categories = useLiveQuery(() => liveCategories(db, workspace.id), [db, workspace.id]) ?? [];
  const [adding, setAdding] = useState(false);
  const canEdit = useCanEdit();
  const drop = useNewCategoryDrop(workspace.id, !canEdit);

  return (
    <div className="atl-board" data-popover-bounds onWheel={wheelSideways}>
      <SortableContext items={categories.map((c) => c.id)} strategy={rectSortingStrategy}>
        {categories.map((c) => <CategoryColumn key={c.id} category={c} onOpenAll={() => void run(openAll(db, c.id))} />)}
      </SortableContext>
      <div ref={drop.setNodeRef} className={drop.isOver ? 'atl-newcat atl-newcat-over' : 'atl-newcat'}>
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
