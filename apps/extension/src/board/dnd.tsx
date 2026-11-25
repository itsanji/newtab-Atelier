import {
  createContext, useContext, useEffect, useRef, useState,
  type CSSProperties, type MouseEvent, type PointerEvent as ReactPointerEvent, type PointerEventHandler, type ReactNode,
} from 'react';
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, pointerWithin, closestCorners, useDroppable, useSensor, useSensors,
  type Active, type Announcements, type CollisionDetection, type DragEndEvent, type DragStartEvent, type Over,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Category, Item } from '@atelier/core';
import { useDb } from '../data/DbContext';
import type { AtelierDB } from '../data/db';
import { liveCategories } from '../data/queries';
import { saveTab, savedLabel } from '../chrome/tabs';
import { createCategory, levelItems, moveCategory, moveItem, tx } from '../data/repo';
import { IconButton } from '../ui/components/IconButton';
import { useNotify, useRun } from './Notice';
import { useCanEdit } from './useRole';
import { domainOf } from './url';

export type Placement = 'before' | 'after';
/** `folder` is a folder's drop zone (its icon grid); the folder itself drags as an `item`. */
export type DragType = 'item' | 'category' | 'tab' | 'workspace' | 'newcat' | 'folder';

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

type ItemTarget = { categoryId: string; folderId: string | null; overItemId: string | null } | { notice: string } | null;

/** The folder `item` really sits in (its folderId names a live folder of the same category), else null. */
async function folderOf(db: AtelierDB, item: Item): Promise<string | null> {
  if (item.kind === 'folder' || !item.folderId) return null;
  const f = await db.items.get(item.folderId);
  return f && f.deletedAt === null && f.kind === 'folder' && f.categoryId === item.categoryId ? f.id : null;
}

/**
 * Where an item or tab dropped on `over` lands; null when `over` can't take it. Only links (and tabs, which
 * become links) go in folders: anything else dropped on or in a folder lands next to the folder instead.
 */
async function itemTarget(db: AtelierDB, over: { type: DragType; id: string }, intoFolders: boolean): Promise<ItemTarget> {
  if (over.type === 'item') {
    const row = await db.items.get(over.id);
    if (!row || row.deletedAt !== null) return null;
    const folderId = await folderOf(db, row);
    if (folderId && !intoFolders) return { categoryId: row.categoryId, folderId: null, overItemId: folderId };
    return { categoryId: row.categoryId, folderId, overItemId: over.id };
  }
  if (over.type === 'folder') {
    const f = await db.items.get(over.id);
    if (!f || f.deletedAt !== null || f.kind !== 'folder') return null;
    return intoFolders
      ? { categoryId: f.categoryId, folderId: f.id, overItemId: null }
      : { categoryId: f.categoryId, folderId: null, overItemId: f.id };
  }
  if (over.type === 'category') return { categoryId: over.id, folderId: null, overItemId: null };
  if (over.type === 'workspace') {
    const first = (await liveCategories(db, over.id))[0];
    if (!first) return { notice: 'Add a category to that workspace first' };
    return { categoryId: first.id, folderId: null, overItemId: null };
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
    const cur = await db.items.get(active.id);
    if (!cur || cur.deletedAt !== null) return null;
    // A folder dropped on its own grid stays where it is.
    if (over.type === 'folder' && over.id === active.id) return null;
    const t = await itemTarget(db, over, cur.kind === 'link');
    if (!t) return null;
    if ('notice' in t) return t.notice;
    const { categoryId, folderId, overItemId } = t;
    if (overItemId === active.id) return null;
    const all = await levelItems(db, categoryId, folderId);
    const siblings = all.filter((s) => s.id !== active.id);
    const target = computeItemDrop({ categoryId, overItemId, placement }, siblings);
    const at = all.findIndex((s) => s.id === active.id);
    // Same level with the same neighbours means nothing moves: skip the write.
    if (at >= 0 && target.beforeId === (all[at - 1]?.id ?? null) && target.afterId === (all[at + 1]?.id ?? null)) return null;
    await moveItem(db, active.id, { ...target, folderId });
    return null;
  }

  if (active.type === 'tab') {
    if (!active.tab?.url) return null;
    const t = await itemTarget(db, over, true);
    if (!t) return null;
    if ('notice' in t) return t.notice;
    const { categoryId, folderId, overItemId } = t;
    // Saved straight at its place: one write, no separate move.
    const target = overItemId === null
      ? { categoryId, folderId }
      : { ...computeItemDrop({ categoryId, overItemId, placement }, await levelItems(db, categoryId, folderId)), folderId };
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
  /** On items: the folder an item sits in. On a folder's drop zone: the folder. */
  folderId?: string | null;
  /** On items: their kind. */
  kind?: Item['kind'];
  /** Icons in a folder's grid sit side by side: drop before or after by x, not y. */
  axis?: 'x' | 'y';
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
  const dataOf = (id: unknown) => args.droppableContainers.find((c) => c.id === id)?.data.current as DragData | undefined;
  // Most specific first: a sidebar workspace, an icon in a folder, a folder's grid, an item, then a column.
  const rank = (id: unknown) => {
    const d = dataOf(id);
    if (d?.type === 'workspace') return 0;
    if (d?.type === 'item' && d.folderId) return 1;
    if (d?.type === 'folder') return 2;
    if (d?.type === 'item') return 3;
    return 4;
  };
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

/**
 * Columns wrap onto rows, so a column drop follows the sortable preview (rectSortingStrategy moves
 * the dragged column into the target's slot): after the target when moving forward, else before it.
 */
function categoryPlacement(active: Active, over: Over): Placement {
  const index = (d: unknown) => (d as { sortable?: { index?: number } } | undefined)?.sortable?.index;
  const a = index(active.data.current);
  const o = index(over.data.current);
  if (a === undefined || o === undefined) return placementOf(active, over, 'x');
  return a < o ? 'after' : 'before';
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
      over: {
        type: o.type,
        id: o.type === 'newcat' ? (o.workspaceId ?? '') : o.type === 'folder' ? (o.folderId ?? '') : String(e.over.id),
      },
      placement: a.type === 'category' ? categoryPlacement(e.active, e.over) : placementOf(e.active, e.over, o.axis ?? 'y'),
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

/** Makes a folder's icon grid a drop target: links and tabs dropped on it go in the folder, at the end. */
export function useFolderDrop(folder: Item, disabled = false) {
  const categoryName = useContext(CategoryNameContext);
  return useDroppable({
    id: `folder:${folder.id}`, disabled,
    data: { type: 'folder', folderId: folder.id, title: folder.title ? `folder ${folder.title}` : 'the folder', categoryName } satisfies DragData,
  });
}

/** Makes the New category tile a drop target for items and tabs. */
export function useNewCategoryDrop(workspaceId: string, disabled = false) {
  return useDroppable({ id: `newcat:${workspaceId}`, disabled, data: { type: 'newcat', workspaceId, title: 'a new category' } });
}

export const CategoryNameContext = createContext('');

/**
 * Sortable wiring for an item: `rowProps` go on the row, `handle` renders the grip (for keyboard drags).
 * With `pointerOnRow` the whole row drags with the pointer, and the click that ends a drag is swallowed so
 * dropping a link never opens it.
 */
export function useSortableItem(item: Item, pointerOnRow: boolean, place: { folderId?: string | null; axis?: 'x' | 'y' } = {}) {
  const categoryName = useContext(CategoryNameContext);
  const label = item.title || (item.kind === 'link' ? domainOf(item.url ?? '') : '') || (item.kind === 'note' ? 'note' : item.kind === 'folder' ? 'folder' : 'item');
  const canEdit = useCanEdit();
  const data: DragData & { categoryId: string } = {
    type: 'item', title: label, categoryId: item.categoryId, categoryName, kind: item.kind, folderId: place.folderId ?? null, axis: place.axis,
  };
  const s = useSortable({ id: item.id, disabled: !canEdit, data });
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
  const dragged = useRef(false);
  useEffect(() => { if (s.isDragging) dragged.current = true; }, [s.isDragging]);
  const pointerDown = s.listeners?.onPointerDown as PointerEventHandler<HTMLElement> | undefined;
  const rowProps = canEdit && pointerOnRow && pointerDown
    ? {
      onPointerDown: (e: ReactPointerEvent<HTMLElement>) => { dragged.current = false; pointerDown(e); },
      onClickCapture: (e: MouseEvent) => {
        if (!dragged.current) return;
        dragged.current = false;
        e.preventDefault();
        e.stopPropagation();
      },
    }
    : {};
  return { setNodeRef: s.setNodeRef, style, handle, rowProps };
}
