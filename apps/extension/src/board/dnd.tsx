import { createContext, useContext, useState, type CSSProperties, type PointerEventHandler, type ReactNode } from 'react';
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, pointerWithin, closestCorners, useDroppable, useSensor, useSensors,
  type Active, type Announcements, type CollisionDetection, type DragEndEvent, type DragStartEvent, type Over,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Category, Item } from '@atelier/core';
import { useDb } from '../data/DbContext';
import type { AtelierDB } from '../data/db';
import { liveCategories, liveItems } from '../data/queries';
import { saveTab, savedLabel } from '../chrome/tabs';
import { createCategory, moveCategory, moveItem, tx } from '../data/repo';
import { IconButton } from '../ui/components/IconButton';
import { useNotify, useRun } from './Notice';
import { useCanEdit } from './useRole';
import { domainOf } from './url';

export type Placement = 'before' | 'after';
export type DragType = 'item' | 'category' | 'tab' | 'workspace' | 'newcat';

export function computeItemDrop(
  target: { categoryId: string; overItemId: string | null; placement: Placement },
  siblings: Item[],
): { categoryId: string; beforeId: string | null; afterId: string | null } {
  const { categoryId } = target;
  const i = target.overItemId === null ? -1 : siblings.findIndex((s) => s.id === target.overItemId);
  if (i < 0) return { categoryId, beforeId: siblings.at(-1)?.id ?? null, afterId: null };
  const at = target.placement === 'before' ? i : i + 1;
  return { categoryId, beforeId: siblings[at - 1]?.id ?? null, afterId: siblings[at]?.id ?? null };
}

export function computeCategoryDrop(
  overId: string, placement: Placement, siblings: Category[],
): { beforeId: string | null; afterId: string | null } {
  const i = siblings.findIndex((s) => s.id === overId);
  if (i < 0) return { beforeId: siblings.at(-1)?.id ?? null, afterId: null };
  const at = placement === 'before' ? i : i + 1;
  return { beforeId: siblings[at - 1]?.id ?? null, afterId: siblings[at]?.id ?? null };
}

export type DropEnd = {
  active: { type: DragType; id: string; tab?: { url?: string; title?: string } };
  /** For `newcat`, `id` is the workspace the new category goes in. */
  over: { type: DragType; id: string } | null;
  placement: Placement;
};

type ItemTarget = { categoryId: string; overItemId: string | null } | { notice: string } | null;

/** Where an item or tab dropped on `over` lands; null when `over` can't take it. */
async function itemTarget(db: AtelierDB, over: { type: DragType; id: string }): Promise<ItemTarget> {
  if (over.type === 'item') {
    const row = await db.items.get(over.id);
    if (!row || row.deletedAt !== null) return null;
    return { categoryId: row.categoryId, overItemId: over.id };
  }
  if (over.type === 'category') return { categoryId: over.id, overItemId: null };
  if (over.type === 'workspace') {
    const first = (await liveCategories(db, over.id))[0];
    if (!first) return { notice: 'Add a category to that workspace first' };
    return { categoryId: first.id, overItemId: null };
  }
  return null;
}

/** Applies a finished drag to the data. Resolves to a notice to show, or nothing. */
export async function applyDrop(
  db: AtelierDB, { active, over, placement }: DropEnd, now: Date = new Date(),
): Promise<string | null> {
  if (!over || active.id === over.id) return null;

  // An item or tab dropped on the New category tile starts a category, first in the workspace.
  if (over.type === 'newcat' && (active.type === 'item' || (active.type === 'tab' && active.tab?.url))) {
    await tx(db, async () => {
      const cat = await createCategory(db, { workspaceId: over.id, name: savedLabel(now) }, { position: 'start' });
      if (active.type === 'item') await moveItem(db, active.id, { categoryId: cat.id, beforeId: null, afterId: null });
      else await saveTab(db, active.tab as chrome.tabs.Tab, { categoryId: cat.id });
    });
    return null;
  }

  if (active.type === 'item') {
    const t = await itemTarget(db, over);
    if (!t) return null;
    if ('notice' in t) return t.notice;
    const { categoryId, overItemId } = t;
    const all = await liveItems(db, categoryId);
    const siblings = all.filter((s) => s.id !== active.id);
    const target = computeItemDrop({ categoryId, overItemId, placement }, siblings);
    const at = all.findIndex((s) => s.id === active.id);
    // Same category with the same neighbours means nothing moves: skip the write.
    if (at >= 0 && target.beforeId === (all[at - 1]?.id ?? null) && target.afterId === (all[at + 1]?.id ?? null)) return null;
    await moveItem(db, active.id, target);
    return null;
  }

  if (active.type === 'tab') {
    if (!active.tab?.url) return null;
    const t = await itemTarget(db, over);
    if (!t) return null;
    if ('notice' in t) return t.notice;
    const { categoryId, overItemId } = t;
    // Saved straight at its place: one write, no separate move.
    const target = overItemId === null
      ? { categoryId }
      : computeItemDrop({ categoryId, overItemId, placement }, await liveItems(db, categoryId));
    await saveTab(db, active.tab as chrome.tabs.Tab, target);
    return null;
  }

  if (active.type === 'category' && over.type === 'category') {
    const cat = await db.categories.get(active.id);
    if (!cat || cat.deletedAt !== null) return null;
    const siblings = (await liveCategories(db, cat.workspaceId)).filter((s) => s.id !== active.id);
    const { beforeId, afterId } = computeCategoryDrop(over.id, placement, siblings);
    const all = await liveCategories(db, cat.workspaceId);
    const at = all.findIndex((s) => s.id === active.id);
    if (at >= 0 && beforeId === (all[at - 1]?.id ?? null) && afterId === (all[at + 1]?.id ?? null)) return null;
    await moveCategory(db, active.id, beforeId, afterId);
  }
  return null;
}

type DragData = {
  type?: DragType; title?: string; categoryName?: string; workspaceId?: string; tab?: { url?: string; title?: string };
};

/**
 * Columns reorder by closest corners. Everything else drops only where the pointer is: a sidebar
 * workspace first, then an item, then a column or the New category tile. Over nothing, no target.
 * Keyboard drags (no pointer) take the closest target by corners.
 */
export const collisions: CollisionDetection = (args) => {
  const type = (args.active.data.current as DragData | undefined)?.type;
  if (type === 'category') {
    return closestCorners({
      ...args,
      droppableContainers: args.droppableContainers.filter((c) => (c.data.current as DragData | undefined)?.type === 'category'),
    });
  }
  // Keyboard drags have no pointer: they move by the sortable coordinates, so take the closest target.
  if (!args.pointerCoordinates) return closestCorners(args);
  const hits = pointerWithin(args);
  const kindOf = (id: unknown) => (args.droppableContainers.find((c) => c.id === id)?.data.current as DragData | undefined)?.type;
  const rank = (id: unknown) => (kindOf(id) === 'workspace' ? 0 : kindOf(id) === 'item' ? 1 : 2);
  return [...hits].sort((a, b) => rank(a.id) - rank(b.id));
};

function placementOf(active: Active, over: Over, axis: 'x' | 'y'): Placement {
  const a = active.rect.current.translated;
  if (!a) return 'after';
  const size = axis === 'x' ? 'width' : 'height';
  const pos = axis === 'x' ? 'left' : 'top';
  const centre = a[pos] + a[size] / 2;
  return centre < over.rect[pos] + over.rect[size] / 2 ? 'before' : 'after';
}

const titleOf = (e: { data: { current?: unknown } }) => (e.data.current as DragData | undefined)?.title ?? 'item';
/** Name of the place an item would land: the category for items and columns, the workspace for sidebar rows. */
const overTitle = (over: Over | null) => {
  const d = over?.data.current as DragData | undefined;
  return d?.type === 'item' ? (d.categoryName ?? 'that category') : (d?.title ?? 'that place');
};

export const announcements: Announcements = {
  onDragStart: ({ active }) => `Picked up ${titleOf(active)}.`,
  onDragOver: ({ active, over }) => (over ? `${titleOf(active)} is over ${overTitle(over)}.` : undefined),
  onDragEnd: ({ active, over }) => (over ? `Moved ${titleOf(active)} to ${overTitle(over)}.` : `Dropped ${titleOf(active)}.`),
  onDragCancel: ({ active }) => `Cancelled moving ${titleOf(active)}.`,
};

export function BoardDnd({ children }: { children: ReactNode }) {
  const db = useDb();
  const run = useRun();
  const notify = useNotify();
  const [dragging, setDragging] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const end = (e: DragEndEvent) => {
    setDragging(null);
    const a = e.active.data.current as DragData | undefined;
    const o = e.over?.data.current as DragData | undefined;
    if (!e.over || !a?.type || !o?.type) return;
    const drop: DropEnd = {
      active: { type: a.type, id: String(e.active.id), tab: a.tab },
      over: { type: o.type, id: o.type === 'newcat' ? (o.workspaceId ?? '') : String(e.over.id) },
      placement: placementOf(e.active, e.over, a.type === 'category' ? 'x' : 'y'),
    };
    void run(applyDrop(db, drop).then((msg) => { if (msg) notify(msg); }));
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisions}
      accessibility={{ announcements }}
      onDragStart={(e: DragStartEvent) => setDragging(titleOf(e.active))}
      onDragEnd={end}
      onDragCancel={() => setDragging(null)}
    >
      {children}
      <DragOverlay>{dragging !== null && <div className="atl-drag-overlay">{dragging}</div>}</DragOverlay>
    </DndContext>
  );
}

/** Makes the New category tile a drop target for items and tabs. */
export function useNewCategoryDrop(workspaceId: string, disabled = false) {
  return useDroppable({ id: `newcat:${workspaceId}`, disabled, data: { type: 'newcat', workspaceId, title: 'a new category' } });
}

/** Sortable wiring for an item row: `rowProps` go on the row, `handle` renders the grip. */
export const CategoryNameContext = createContext('');

export function useSortableItem(item: Item, pointerOnRow: boolean) {
  const categoryName = useContext(CategoryNameContext);
  const label = item.title || (item.kind === 'link' ? domainOf(item.url ?? '') : '') || (item.kind === 'note' ? 'note' : 'item');
  const canEdit = useCanEdit();
  const s = useSortable({ id: item.id, disabled: !canEdit, data: { type: 'item', title: label, categoryId: item.categoryId, categoryName } });
  const style: CSSProperties = { transform: CSS.Translate.toString(s.transform), transition: s.transition, opacity: s.isDragging ? 0.4 : undefined };
  const handle = !canEdit ? null : (
    <IconButton
      label="Drag to move"
      icon="grip"
      className="atl-grip"
      ref={s.setActivatorNodeRef}
      {...s.attributes}
      {...s.listeners}
    />
  );
  const onPointerDown = s.listeners?.onPointerDown as PointerEventHandler<HTMLElement> | undefined;
  const rowProps = canEdit && pointerOnRow && onPointerDown ? { onPointerDown } : {};
  return { setNodeRef: s.setNodeRef, style, handle, rowProps };
}
