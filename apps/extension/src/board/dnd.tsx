import { createContext, useContext, useState, type CSSProperties, type PointerEventHandler, type ReactNode } from 'react';
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, pointerWithin, closestCorners, useSensor, useSensors,
  type Active, type Announcements, type CollisionDetection, type DragEndEvent, type DragStartEvent, type Over,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Category, Item } from '@atelier/core';
import { useDb } from '../data/DbContext';
import type { AtelierDB } from '../data/db';
import { liveCategories, liveItems } from '../data/queries';
import { moveCategory, moveItem } from '../data/repo';
import { IconButton } from '../ui/components/IconButton';
import { useNotify, useRun } from './Notice';
import { domainOf } from './url';

export type Placement = 'before' | 'after';
export type DragType = 'item' | 'category' | 'tab' | 'workspace';

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
  active: { type: DragType; id: string };
  over: { type: DragType; id: string } | null;
  placement: Placement;
};

/** Applies a finished drag to the data. Resolves to a notice to show, or nothing. */
export async function applyDrop(db: AtelierDB, { active, over, placement }: DropEnd): Promise<string | null> {
  if (!over || active.id === over.id) return null;

  if (active.type === 'item') {
    let categoryId: string;
    let overItemId: string | null = null;
    if (over.type === 'item') {
      const row = await db.items.get(over.id);
      if (!row || row.deletedAt !== null) return null;
      categoryId = row.categoryId;
      overItemId = over.id;
    } else if (over.type === 'category') {
      categoryId = over.id;
    } else if (over.type === 'workspace') {
      const first = (await liveCategories(db, over.id))[0];
      if (!first) return 'Add a category to that workspace first';
      categoryId = first.id;
    } else return null;
    const all = await liveItems(db, categoryId);
    const siblings = all.filter((s) => s.id !== active.id);
    const target = computeItemDrop({ categoryId, overItemId, placement }, siblings);
    const at = all.findIndex((s) => s.id === active.id);
    // Same category with the same neighbours means nothing moves: skip the write.
    if (at >= 0 && target.beforeId === (all[at - 1]?.id ?? null) && target.afterId === (all[at + 1]?.id ?? null)) return null;
    await moveItem(db, active.id, target);
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

type DragData = { type?: DragType; title?: string; categoryName?: string };

const collisions: CollisionDetection = (args) => {
  const type = (args.active.data.current as DragData | undefined)?.type;
  if (type === 'category') {
    return closestCorners({
      ...args,
      droppableContainers: args.droppableContainers.filter((c) => (c.data.current as DragData | undefined)?.type === 'category'),
    });
  }
  const hits = pointerWithin(args);
  const found = hits.length ? hits : closestCorners(args);
  const kindOf = (id: unknown) => (args.droppableContainers.find((c) => c.id === id)?.data.current as DragData | undefined)?.type;
  const rank = (id: unknown) => (kindOf(id) === 'workspace' ? 0 : kindOf(id) === 'item' ? 1 : 2);
  return [...found].sort((a, b) => rank(a.id) - rank(b.id));
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
      active: { type: a.type, id: String(e.active.id) },
      over: { type: o.type, id: String(e.over.id) },
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

/** Sortable wiring for an item row: `rowProps` go on the row, `handle` renders the grip. */
export const CategoryNameContext = createContext('');

export function useSortableItem(item: Item, pointerOnRow: boolean) {
  const categoryName = useContext(CategoryNameContext);
  const label = item.title || (item.kind === 'link' ? domainOf(item.url ?? '') : '') || (item.kind === 'note' ? 'note' : 'item');
  const s = useSortable({ id: item.id, data: { type: 'item', title: label, categoryId: item.categoryId, categoryName } });
  const style: CSSProperties = { transform: CSS.Translate.toString(s.transform), transition: s.transition, opacity: s.isDragging ? 0.4 : undefined };
  const handle = (
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
  const rowProps = pointerOnRow && onPointerDown ? { onPointerDown } : {};
  return { setNodeRef: s.setNodeRef, style, handle, rowProps };
}
