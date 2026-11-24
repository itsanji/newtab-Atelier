import { keyBetween, type Category, type Item, type Iso, type Reminder, type TableName, type Workspace } from '@atelier/core';
import Dexie from 'dexie';
import { enqueue, type AtelierDB } from './db';
import { currentUserId } from '../account/account';
import { liveCategories, liveItems, liveWorkspaces } from './queries';

export const clock = { now: (): string => new Date().toISOString() };

export class LastWorkspaceError extends Error {
  constructor() {
    super('Keep at least one workspace');
    this.name = 'LastWorkspaceError';
  }
}

export class NotFoundError extends Error {
  constructor(table: string, id: string) {
    super(`${table} row not found: ${id}`);
    this.name = 'NotFoundError';
  }
}

export type Row = { id: string; deletedAt: string | null; updatedAt: string; updatedBy: string | null };

/** Write a changed row and its outbox entry. Call inside a transaction. */
export async function save<R extends Row>(db: AtelierDB, table: TableName, row: R, now: string): Promise<R> {
  saves++;
  await db.table(table).put(row);
  await enqueue(db, table, row, now);
  return row;
}

async function live<R extends Row>(db: AtelierDB, table: TableName, id: string): Promise<R> {
  const row = (await db.table(table).get(id)) as R | undefined;
  if (!row || row.deletedAt !== null) throw new NotFoundError(table, id);
  return row;
}

function base(now: string) {
  return { id: crypto.randomUUID(), createdAt: now, updatedAt: now, deletedAt: null, updatedBy: currentUserId() };
}

export const stamp = (now: string) => ({ updatedAt: now, updatedBy: currentUserId() });

const writeListeners = new Set<() => void>();
/** Count of rows queued so far; a transaction that leaves it unchanged wrote nothing and notifies no one. */
let saves = 0;

/** Call `fn` after every committed local mutation (not sync writes). Returns an unsubscribe function. */
export function onLocalWrite(fn: () => void): () => void {
  writeListeners.add(fn);
  return () => void writeListeners.delete(fn);
}

/** Run a mutation in one rw transaction; the outermost one notifies `onLocalWrite` listeners once it commits. */
export function tx<T>(db: AtelierDB, fn: () => Promise<T>): Promise<T> {
  const nested = Dexie.currentTransaction != null;
  const before = saves;
  const done = db.transaction('rw', [db.workspaces, db.categories, db.items, db.reminders, db.outbox], fn);
  if (nested) return done;
  return done.then((result) => {
    if (saves === before) return result;
    for (const listener of [...writeListeners]) {
      try {
        listener();
      } catch (e) {
        console.error(e);
      }
    }
    return result;
  });
}

const KEY_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const randomChar = (chars: string) => chars[crypto.getRandomValues(new Uint32Array(1))[0]! % chars.length]!;

/**
 * A key after `last` with a random 3-char suffix, so two devices appending to the same list
 * don't produce equal keys. Falls back to the plain key if the suffix would make it invalid.
 */
export function appendKey(last: string | null): string {
  const plain = keyBetween(last, null);
  const key = plain + randomChar(KEY_CHARS) + randomChar(KEY_CHARS) + randomChar(KEY_CHARS.slice(1));
  try {
    keyBetween(key, null);
    return key;
  } catch {
    return plain;
  }
}

/**
 * `plain` with a random 3-char suffix, so keys generated on two devices for the same gap differ.
 * Kept only if it still sorts strictly between `lo` and `hi` and is a valid key.
 */
function jitter(plain: string, lo: string | null, hi: string | null): string {
  const key = plain + randomChar(KEY_CHARS) + randomChar(KEY_CHARS) + randomChar(KEY_CHARS.slice(1));
  if ((lo !== null && key <= lo) || (hi !== null && key >= hi)) return plain;
  try {
    keyBetween(key, null);
    return key;
  } catch {
    return plain;
  }
}

/** A key before `first` (the start of a list) with a random suffix. */
export function prependKey(first: string | null): string {
  return jitter(keyBetween(null, first), null, first);
}

async function keyFor<S extends { id: string; sortKey: string }>(
  db: AtelierDB, table: TableName, beforeId: string | null, afterId: string | null,
): Promise<string> {
  const before = beforeId ? await live<S & Row>(db, table, beforeId) : null;
  const after = afterId ? await live<S & Row>(db, table, afterId) : null;
  // Equal or inverted neighbour keys have no room between them: place it right after `before` instead.
  if (before && after && before.sortKey >= after.sortKey) return appendKey(before.sortKey);
  if (!after) return appendKey(before?.sortKey ?? null);
  return jitter(keyBetween(before?.sortKey ?? null, after.sortKey), before?.sortKey ?? null, after.sortKey);
}

// Workspaces

export function createWorkspace(db: AtelierDB, input: { name: string; emoji?: string | null }): Promise<Workspace> {
  return tx(db, async () => {
    const now = clock.now();
    const last = (await liveWorkspaces(db)).at(-1);
    const row: Workspace = {
      ...base(now), name: input.name, emoji: input.emoji ?? null, ownerId: null,
      sortKey: appendKey(last?.sortKey ?? null),
    };
    return save(db, 'workspaces', row, now);
  });
}

export function updateWorkspace(
  db: AtelierDB, id: string, patch: Partial<Pick<Workspace, 'name' | 'emoji'>>,
): Promise<Workspace> {
  return tx(db, async () => {
    const now = clock.now();
    const cur = await live<Workspace>(db, 'workspaces', id);
    return save(db, 'workspaces', { ...cur, ...patch, ...stamp(now) }, now);
  });
}

export function moveWorkspace(db: AtelierDB, id: string, beforeId: string | null, afterId: string | null): Promise<Workspace> {
  return tx(db, async () => {
    const now = clock.now();
    const cur = await live<Workspace>(db, 'workspaces', id);
    const sortKey = await keyFor(db, 'workspaces', beforeId, afterId);
    return save(db, 'workspaces', { ...cur, sortKey, ...stamp(now) }, now);
  });
}

async function tombstoneCategory(db: AtelierDB, cat: Category, now: string): Promise<void> {
  for (const it of await liveItems(db, cat.id)) {
    await save(db, 'items', { ...it, deletedAt: now, ...stamp(now) }, now);
  }
  await save(db, 'categories', { ...cat, deletedAt: now, ...stamp(now) }, now);
}

export function deleteWorkspace(db: AtelierDB, id: string): Promise<void> {
  return tx(db, async () => {
    const now = clock.now();
    const ws = await live<Workspace>(db, 'workspaces', id);
    if ((await liveWorkspaces(db)).length <= 1) throw new LastWorkspaceError();
    for (const cat of await liveCategories(db, id)) await tombstoneCategory(db, cat, now);
    await save(db, 'workspaces', { ...ws, deletedAt: now, ...stamp(now) }, now);
  });
}

// Categories

export function createCategory(
  db: AtelierDB,
  input: { workspaceId: string; name: string; emoji?: string | null; tabGroup?: Category['tabGroup'] },
  opts: { position?: 'start' | 'end' } = {},
): Promise<Category> {
  return tx(db, async () => {
    const now = clock.now();
    await live<Workspace>(db, 'workspaces', input.workspaceId);
    const siblings = await liveCategories(db, input.workspaceId);
    const sortKey = opts.position === 'start'
      ? prependKey(siblings[0]?.sortKey ?? null)
      : appendKey(siblings.at(-1)?.sortKey ?? null);
    const row: Category = {
      ...base(now), workspaceId: input.workspaceId, name: input.name, emoji: input.emoji ?? null,
      sortKey, tabGroup: input.tabGroup ?? null, shareToken: null,
    };
    return save(db, 'categories', row, now);
  });
}

export function updateCategory(
  db: AtelierDB, id: string, patch: Partial<Pick<Category, 'name' | 'emoji' | 'tabGroup'>>,
): Promise<Category> {
  return tx(db, async () => {
    const now = clock.now();
    const cur = await live<Category>(db, 'categories', id);
    return save(db, 'categories', { ...cur, ...patch, ...stamp(now) }, now);
  });
}

export function moveCategory(db: AtelierDB, id: string, beforeId: string | null, afterId: string | null): Promise<Category> {
  return tx(db, async () => {
    const now = clock.now();
    const cur = await live<Category>(db, 'categories', id);
    const sortKey = await keyFor(db, 'categories', beforeId, afterId);
    return save(db, 'categories', { ...cur, sortKey, ...stamp(now) }, now);
  });
}

export function deleteCategory(db: AtelierDB, id: string): Promise<void> {
  return tx(db, async () => {
    const now = clock.now();
    await tombstoneCategory(db, await live<Category>(db, 'categories', id), now);
  });
}

// Items

export function createItem(
  db: AtelierDB,
  input: {
    id?: string; categoryId: string; kind: Item['kind']; title: string; url?: string | null; faviconUrl?: string | null;
    note?: string | null; body?: unknown; position?: 'start' | 'end';
    /** Place between these neighbours (overrides `position`) when either is given. */
    beforeId?: string | null; afterId?: string | null;
  },
): Promise<Item> {
  return tx(db, async () => {
    const now = clock.now();
    await live<Category>(db, 'categories', input.categoryId);
    const siblings = await liveItems(db, input.categoryId);
    const sortKey = input.beforeId !== undefined || input.afterId !== undefined
      ? await keyFor(db, 'items', input.beforeId ?? null, input.afterId ?? null)
      : input.position === 'start'
        ? prependKey(siblings[0]?.sortKey ?? null)
        : appendKey(siblings.at(-1)?.sortKey ?? null);
    const row: Item = {
      ...base(now), ...(input.id ? { id: input.id } : {}), categoryId: input.categoryId, kind: input.kind, sortKey, title: input.title,
      url: input.url ?? null, faviconUrl: input.faviconUrl ?? null, note: input.note ?? null,
      body: input.body ?? null, done: false, restored: false,
    };
    return save(db, 'items', row, now);
  });
}

export function updateItem(
  db: AtelierDB, id: string, patch: Partial<Pick<Item, 'title' | 'url' | 'note' | 'body' | 'done'>>,
): Promise<Item> {
  return tx(db, async () => {
    const now = clock.now();
    const cur = await live<Item>(db, 'items', id);
    return save(db, 'items', { ...cur, ...patch, restored: false, ...stamp(now) }, now);
  });
}

export function moveItem(
  db: AtelierDB, id: string, target: { categoryId: string; beforeId: string | null; afterId: string | null },
): Promise<Item> {
  return tx(db, async () => {
    const now = clock.now();
    const cur = await live<Item>(db, 'items', id);
    await live<Category>(db, 'categories', target.categoryId);
    const sortKey = await keyFor(db, 'items', target.beforeId, target.afterId);
    return save(db, 'items', { ...cur, categoryId: target.categoryId, sortKey, restored: false, ...stamp(now) }, now);
  });
}

export function deleteItem(db: AtelierDB, id: string): Promise<void> {
  return tx(db, async () => {
    const now = clock.now();
    const cur = await live<Item>(db, 'items', id);
    await save(db, 'items', { ...cur, deletedAt: now, ...stamp(now) }, now);
  });
}

// Reminders: at most one live reminder per item per user.

async function liveReminder(db: AtelierDB, itemId: string): Promise<Reminder | undefined> {
  return (await db.reminders.where('itemId').equals(itemId).toArray())
    .find((r) => r.deletedAt === null && r.userId === currentUserId());
}

export function setReminder(db: AtelierDB, itemId: string, remindAt: Iso): Promise<Reminder> {
  return tx(db, async () => {
    const now = clock.now();
    await live<Item>(db, 'items', itemId);
    const cur = await liveReminder(db, itemId);
    if (cur) return save(db, 'reminders', { ...cur, remindAt, remindedAt: null, ...stamp(now) }, now);
    return save(db, 'reminders', { ...base(now), itemId, userId: currentUserId(), remindAt, remindedAt: null }, now);
  });
}

export function clearReminder(db: AtelierDB, itemId: string): Promise<void> {
  return tx(db, async () => {
    const now = clock.now();
    const cur = await liveReminder(db, itemId);
    if (cur) await save(db, 'reminders', { ...cur, deletedAt: now, ...stamp(now) }, now);
  });
}
