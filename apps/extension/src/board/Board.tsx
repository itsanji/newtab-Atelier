import { useEffect, useRef, useState, type RefObject } from 'react';
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
 * The board scrolls sideways (its scrollbar is hidden) with Shift+wheel, from anywhere on it, columns
 * included; a plain wheel only ever scrolls up and down. A trackpad's sideways swipe (deltaX) is left to
 * the browser. Registered as a non-passive listener so the page doesn't also scroll.
 */
function useShiftWheelSideways(board: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const el = board.current;
    if (!el) return;
    const onWheel = (e: globalThis.WheelEvent) => {
      if (!e.shiftKey || e.ctrlKey || e.deltaX !== 0 || e.deltaY === 0) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [board]);
}

export function Board({ workspace }: { workspace: Workspace }) {
  const db = useDb();
  const run = useRun();
  const categories = useLiveQuery(() => liveCategories(db, workspace.id), [db, workspace.id]) ?? [];
  const [adding, setAdding] = useState(false);
  const canEdit = useCanEdit();
  const drop = useNewCategoryDrop(workspace.id, !canEdit);
  const boardRef = useRef<HTMLDivElement | null>(null);
  useShiftWheelSideways(boardRef);

  return (
    <div className="atl-board" data-popover-bounds ref={boardRef}>
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
