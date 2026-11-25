import { isLinkUrl, itemSchema, type Category, type Item, type Iso, type Reminder, type TableName, type Workspace } from '@atelier/core';
import { enqueue, outboxKey, type AtelierDB, type Member, type OutboxEntry } from '../data/db';
import { appendKey, clock } from '../data/repo';
import { getMeta, liveCategories, liveItems, liveWorkspaces } from '../data/queries';
import { currentUserId, type Account } from '../account/account';
import { ApiError, OfflineError, UnauthorizedError, type ApiClient, type Change, type PullResponse, type PushResult } from './api';
import { withLock } from './lock';
import { addRecovered, addUnsyncable, setSyncStatus, type SyncState } from './status';

/** The part of the API client the engine needs (tests pass a fake). */
export type SyncApi = Pick<ApiClient, 'push' | 'pull'>;

export const CURSOR_KEY = 'syncCursor';
export const PUSH_CHUNK = 500;
/** Serialized size cap per push request (the server refuses bodies over 5 MB with 413). */
export const PUSH_MAX_BYTES = 4 * 1024 * 1024;
/** Meta key: outbox versions the server refused as too large (413 on their own). Not pushed again until edited. */
export const UNSYNCABLE_KEY = 'unsyncable';
export const RECOVERED_NAME = 'Recovered';

const TABLES: TableName[] = ['workspaces', 'categories', 'items', 'reminders'];
/** Parents before children, so the server never sees a child before its parent in one push. */
const RANK: Record<TableName, number> = { workspaces: 0, categories: 1, items: 2, reminders: 3 };

export interface PushSummary {
  /** Changes the server accepted (applied or restored). */
  pushed: number;
  restored: number;
  rejected: number;
  /** Rejected items copied into "Recovered". */
  recovered: number;
  remindersChanged: boolean;
  /** Titles of rows newly found too large to sync (they stay local, still in the outbox). */
  unsyncable: string[];
}

export interface UnsyncableEntry {
  key: string;
  seq: number;
  title: string;
}

export interface SyncResult extends PushSummary {
  ok: boolean;
  state: SyncState;
  /** Rows written locally by the pull. */
  pulled: number;
  error?: string;
}

const syncTables = (db: AtelierDB) => [db.workspaces, db.categories, db.items, db.reminders, db.outbox, db.members, db.meta];

const emptySummary = (): PushSummary => ({ pushed: 0, restored: 0, rejected: 0, recovered: 0, remindersChanged: false, unsyncable: [] });

const getUnsyncable = async (db: AtelierDB) => (await getMeta<UnsyncableEntry[]>(db, UNSYNCABLE_KEY)) ?? [];

/** The outbox key of the row's parent, if any (reminder → item → category → workspace). */
function parentKey(e: OutboxEntry): string | undefined {
  const row = e.row as { itemId?: string; categoryId?: string; workspaceId?: string };
  if (e.table === 'reminders' && row.itemId) return outboxKey('items', row.itemId);
  if (e.table === 'items' && row.categoryId) return outboxKey('categories', row.categoryId);
  if (e.table === 'categories' && row.workspaceId) return outboxKey('workspaces', row.workspaceId);
  return undefined;
}

/**
 * Hold back entries (sorted parents first) whose parent is held, adding them to `held`: a child of a
 * row that can't sync would be rejected as missing its parent, and `recover` would drop it.
 */
function holdBack(entries: OutboxEntry[], held: Set<string>): OutboxEntry[] {
  return entries.filter((e) => {
    const parent = parentKey(e);
    if (parent === undefined || !held.has(parent)) return true;
    held.add(e.key);
    return false;
  });
}

/**
 * What to push, parents first: every outbox entry except versions already refused as too large and
 * their descendants (which stay queued until the parent syncs). `held` is the keys left out. Also
 * forgets refusals whose entry is gone or was rewritten (a new version gets its own try).
 */
async function pushPlan(db: AtelierDB): Promise<{ entries: OutboxEntry[]; held: Set<string> }> {
  return db.transaction('rw', db.outbox, db.meta, async () => {
    const all = await db.outbox.toArray();
    const stuck = await getUnsyncable(db);
    const live = stuck.filter((s) => all.some((e) => e.key === s.key && e.seq === s.seq));
    if (live.length !== stuck.length) await db.meta.put({ key: UNSYNCABLE_KEY, value: live });
    const held = new Set(live.map((s) => s.key));
    const sorted = all
      .filter((e) => !live.some((s) => s.key === e.key && s.seq === e.seq))
      .sort((a, b) => RANK[a.table] - RANK[b.table] || a.seq - b.seq);
    return { entries: holdBack(sorted, held), held };
  });
}

/** Outbox entries the next push would send (see `pushPlan`). */
export async function pushableEntries(db: AtelierDB): Promise<OutboxEntry[]> {
  return (await pushPlan(db)).entries;
}

const utf8 = new TextEncoder();
const changeBytes = (e: OutboxEntry) => utf8.encode(JSON.stringify({ table: e.table, row: e.row })).length + 1;

/** Split into push requests of at most PUSH_CHUNK rows and PUSH_MAX_BYTES (a bigger row goes alone). */
export function chunkEntries(entries: OutboxEntry[]): OutboxEntry[][] {
  const chunks: OutboxEntry[][] = [];
  let cur: OutboxEntry[] = [];
  let bytes = 0;
  for (const e of entries) {
    const size = changeBytes(e);
    if (cur.length && (cur.length >= PUSH_CHUNK || bytes + size > PUSH_MAX_BYTES)) {
      chunks.push(cur);
      cur = [];
      bytes = 0;
    }
    cur.push(e);
    bytes += size;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

const nonEmpty = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** How to name a row in a notice. */
export function rowTitle(entry: Pick<OutboxEntry, 'table' | 'row'>): string {
  const row = entry.row as { title?: unknown; name?: unknown; kind?: unknown };
  const named = nonEmpty(row.title) ?? nonEmpty(row.name);
  if (named) return `“${named.length > 60 ? `${named.slice(0, 59)}…` : named}”`;
  if (entry.table === 'items') return row.kind === 'note' ? 'A note' : row.kind === 'todo' ? 'A to-do' : 'A link';
  return { workspaces: 'A workspace', categories: 'A category', reminders: 'A reminder' }[entry.table];
}

/** Remember that this version of a row is too large to sync. False if it was rewritten meanwhile. */
async function markUnsyncable(db: AtelierDB, entry: OutboxEntry): Promise<boolean> {
  return db.transaction('rw', db.outbox, db.meta, async () => {
    if ((await db.outbox.get(entry.key))?.seq !== entry.seq) return false;
    const stuck = (await getUnsyncable(db)).filter((s) => s.key !== entry.key);
    stuck.push({ key: entry.key, seq: entry.seq, title: rowTitle(entry) });
    await db.meta.put({ key: UNSYNCABLE_KEY, value: stuck });
    return true;
  });
}

/**
 * Upload the outbox, parents first, in chunks. An entry is removed only if it wasn't rewritten while
 * its push was in flight (its `seq` is unchanged); a rewritten row stays queued for the next push.
 */
export async function pushOutbox(
  db: AtelierDB, api: SyncApi, userId: string = currentUserId(), now: () => Iso = clock.now,
): Promise<PushSummary> {
  const summary = emptySummary();
  await pushInto(db, api, userId, now, summary);
  return summary;
}

/** `pushOutbox`, adding to `summary` as it goes (so a later chunk's failure keeps what earlier ones did). */
async function pushInto(db: AtelierDB, api: SyncApi, userId: string, now: () => Iso, summary: PushSummary): Promise<void> {
  const { entries, held } = await pushPlan(db);
  for (const chunk of chunkEntries(entries)) await pushChunk(db, api, chunk, userId, now, summary, held);
}

/**
 * Push one chunk. A 413 (body too large) splits it in half and retries each half; a single row that
 * still gets 413 is kept locally and in the outbox but marked unsyncable, so it no longer blocks pushes,
 * and its descendants (`held`) stay queued.
 */
async function pushChunk(
  db: AtelierDB, api: SyncApi, chunk: OutboxEntry[], userId: string, now: () => Iso, summary: PushSummary,
  held: Set<string>,
): Promise<void> {
  // A parent may have been found too large earlier in this round.
  chunk = holdBack(chunk, held);
  if (!chunk.length) return;
  let results: PushResult[];
  try {
    ({ results } = await api.push(chunk.map((e) => ({ table: e.table, row: e.row }))));
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 413) throw e;
    if (chunk.length > 1) {
      const mid = Math.ceil(chunk.length / 2);
      await pushChunk(db, api, chunk.slice(0, mid), userId, now, summary, held);
      await pushChunk(db, api, chunk.slice(mid), userId, now, summary, held);
      return;
    }
    held.add(chunk[0]!.key);
    if (await markUnsyncable(db, chunk[0]!)) {
      summary.unsyncable.push(rowTitle(chunk[0]!));
    }
    return;
  }
  if (!Array.isArray(results) || results.length !== chunk.length || results.some((r, j) => r?.id !== chunk[j]!.rowId)) {
    throw new ApiError(502, 'Unexpected push response');
  }
  await db.transaction('rw', syncTables(db), async () => {
    const rejected: Change[] = [];
    for (const [j, entry] of chunk.entries()) {
      const status = results[j]!.status;
      const unchanged = (await db.outbox.get(entry.key))?.seq === entry.seq;
      if (status === 'rejected') {
        // A newer local version is queued: it gets its own verdict on the next push.
        if (unchanged) rejected.push({ table: entry.table, row: entry.row });
        continue;
      }
      summary.pushed++;
      if (unchanged) await db.outbox.delete(entry.key);
      if (status === 'restored') {
        summary.restored++;
        await markRestored(db, entry, unchanged);
      }
    }
    if (rejected.length) {
      summary.rejected += rejected.length;
      summary.remindersChanged ||= rejected.some((c) => c.table === 'reminders');
      summary.recovered += await recover(db, rejected, userId, now);
    }
  });
}

/** The server put a row back under a parent another device deleted: mirror that locally, without enqueueing. */
async function markRestored(db: AtelierDB, entry: OutboxEntry, unchanged: boolean): Promise<void> {
  let categoryId: string | undefined;
  if (entry.table === 'items') {
    const item = entry.row as Item;
    // A newer pending edit of the item would clear the tag anyway.
    if (unchanged && (await db.items.get(item.id))) await db.items.update(item.id, { restored: true });
    categoryId = item.categoryId;
  }
  let workspaceId = entry.table === 'categories' ? (entry.row as Category).workspaceId : undefined;
  if (categoryId) {
    const cat = await db.categories.get(categoryId);
    if (cat) {
      await untombstone(db, 'categories', cat);
      workspaceId = cat.workspaceId;
    }
  }
  if (workspaceId) {
    const ws = await db.workspaces.get(workspaceId);
    if (ws) await untombstone(db, 'workspaces', ws);
  }
}

async function untombstone(db: AtelierDB, table: 'workspaces' | 'categories', row: Workspace | Category): Promise<void> {
  // A delete queued locally after the push still wins: leave it for the next push.
  if (row.deletedAt === null || (await db.outbox.get(outboxKey(table, row.id)))) return;
  await db.table(table).update(row.id, { deletedAt: null });
}

/**
 * Handle rows the server rejected. Rejected items (live ones) are copied with new ids into a
 * "Recovered" category of the user's first owned workspace (made valid, see `syncableItem`) and
 * queued, with any reminder rejected alongside re-pointed to the copy; every rejected row is
 * removed locally with its outbox entry. Resets the pull cursor so the next pull brings back the
 * server's copy of anything that was dropped. Returns the number of items copied.
 */
export async function recover(
  db: AtelierDB, rows: Change[], userId: string = currentUserId(), now: () => Iso = clock.now,
): Promise<number> {
  if (!rows.length) return 0;
  return db.transaction('rw', syncTables(db), async () => {
    const t = now();
    const items: Item[] = [];
    const reminders: Reminder[] = [];
    for (const { table, row } of rows) {
      const id = (row as { id: string }).id;
      await db.outbox.delete(outboxKey(table, id));
      await db.table(table).delete(id);
      // A rejected delete has nothing to keep.
      if ((row as { deletedAt?: unknown }).deletedAt != null) continue;
      if (table === 'items') items.push(row as Item);
      if (table === 'reminders') reminders.push(row as Reminder);
    }
    const copyOf = new Map<string, string>();
    if (items.length) {
      const cat = await recoveredCategory(db, userId, t);
      let last = (await liveItems(db, cat.id)).at(-1)?.sortKey ?? null;
      for (const item of items) {
        const copy = syncableItem({
          ...item, id: crypto.randomUUID(), categoryId: cat.id, sortKey: appendKey(last),
          createdAt: t, updatedAt: t, updatedBy: userId, deletedAt: null, restored: false,
        });
        last = copy.sortKey;
        copyOf.set(item.id, copy.id);
        await db.items.put(copy);
        await enqueue(db, 'items', copy, t);
      }
    }
    // A reminder rejected along with its item follows the copy.
    for (const rem of reminders) {
      const itemId = copyOf.get(rem.itemId);
      if (!itemId) continue;
      const copy: Reminder = { ...rem, id: crypto.randomUUID(), itemId, userId, createdAt: t, updatedAt: t, updatedBy: userId, deletedAt: null };
      await db.reminders.put(copy);
      await enqueue(db, 'reminders', copy, t);
    }
    await db.meta.put({ key: CURSOR_KEY, value: 0 });
    return items.length;
  });
}

const paragraphs = (texts: string[]) => ({
  type: 'doc',
  content: texts.filter(Boolean).map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })),
});
const asText = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));

/**
 * Make a recovered copy the server will accept, keeping everything the user wrote: a url that isn't
 * an allowed link (e.g. `javascript:`) moves into the text (a link becomes a note), other bad fields
 * are coerced. Anything still invalid becomes a note holding the original row as text.
 */
export function syncableItem(item: Item): Item {
  if (itemSchema.safeParse(item).success) return item;
  const fixed: Item = {
    ...item,
    kind: (['link', 'note', 'todo'] as const).includes(item.kind) ? item.kind : 'note',
    title: asText(item.title),
    faviconUrl: typeof item.faviconUrl === 'string' ? item.faviconUrl : null,
    note: item.note == null ? null : asText(item.note),
    done: typeof item.done === 'boolean' ? item.done : false,
  };
  if (fixed.url != null && (typeof fixed.url !== 'string' || !isLinkUrl(fixed.url))) {
    const urlText = asText(fixed.url);
    fixed.url = null;
    if (fixed.kind === 'link') {
      fixed.kind = 'note';
      fixed.body = fixed.body == null ? paragraphs([urlText]) : paragraphs([urlText, asText(fixed.body)]);
    } else {
      fixed.note = fixed.note ? `${fixed.note}\n${urlText}` : urlText;
    }
  }
  if (itemSchema.safeParse(fixed).success) return fixed;
  return {
    ...fixed, kind: 'note', url: null, faviconUrl: null, note: null, done: false,
    body: paragraphs([fixed.title, JSON.stringify(item)]),
  };
}

/** True when the user owns the workspace, or it was created here and never synced. */
async function ownsWorkspace(db: AtelierDB, ws: Workspace, userId: string): Promise<boolean> {
  const members = (await db.members.where('workspaceId').equals(ws.id).toArray()).filter((m) => !m.deletedAt);
  const mine = members.find((m) => m.userId === userId);
  if (mine) return mine.role === 'owner';
  return ws.ownerId === userId || (ws.ownerId === null && members.length === 0);
}

async function recoveredCategory(db: AtelierDB, userId: string, t: Iso): Promise<Category> {
  const base = () => ({ id: crypto.randomUUID(), createdAt: t, updatedAt: t, deletedAt: null, updatedBy: userId });
  const workspaces = await liveWorkspaces(db);
  let ws: Workspace | undefined;
  for (const w of workspaces) {
    if (await ownsWorkspace(db, w, userId)) {
      ws = w;
      break;
    }
  }
  if (!ws) {
    ws = { ...base(), name: RECOVERED_NAME, emoji: null, ownerId: null, sortKey: appendKey(workspaces.at(-1)?.sortKey ?? null) };
    await db.workspaces.put(ws);
    await enqueue(db, 'workspaces', ws, t);
  }
  const cats = await liveCategories(db, ws.id);
  const existing = cats.find((c) => c.name === RECOVERED_NAME);
  if (existing) return existing;
  const cat: Category = {
    ...base(), workspaceId: ws.id, name: RECOVERED_NAME, emoji: null,
    sortKey: appendKey(cats.at(-1)?.sortKey ?? null), tabGroup: null, shareToken: null,
  };
  await db.categories.put(cat);
  await enqueue(db, 'categories', cat, t);
  return cat;
}

/**
 * Apply a pull in one transaction. Rows with a pending local edit are skipped (the edit wins and is
 * pushed next); removed workspaces are deleted with everything in them. Never enqueues.
 */
export async function applyPull(db: AtelierDB, res: PullResponse): Promise<{ pulled: number; remindersChanged: boolean }> {
  return db.transaction('rw', syncTables(db), async () => {
    const pending = new Set(await db.outbox.toCollection().primaryKeys());
    let pulled = 0;
    let remindersChanged = false;
    for (const table of TABLES) {
      for (const row of (res[table] ?? []) as Array<{ id: string }>) {
        if (pending.has(outboxKey(table, row.id))) continue;
        await db.table(table).put(row);
        pulled++;
        if (table === 'reminders') remindersChanged = true;
      }
    }
    for (const m of (res.members ?? []) as Array<Member & { deletedAt?: string | null }>) {
      if (m.deletedAt) await db.members.delete(m.id);
      else await db.members.put(m);
    }
    for (const wsId of res.removedWorkspaceIds ?? []) {
      const catIds = await db.categories.where('workspaceId').equals(wsId).primaryKeys();
      const itemIds = await db.items.where('categoryId').anyOf(catIds).primaryKeys();
      const reminderIds = await db.reminders.where('itemId').anyOf(itemIds).primaryKeys();
      if (reminderIds.length) remindersChanged = true;
      await db.reminders.bulkDelete(reminderIds);
      await db.items.bulkDelete(itemIds);
      await db.categories.bulkDelete(catIds);
      await db.members.where('workspaceId').equals(wsId).delete();
      await db.workspaces.delete(wsId);
    }
    // Rows moved into a workspace this user can't see: drop them (and what hangs off them) unless edited here.
    const keep = (table: TableName, id: string) => pending.has(outboxKey(table, id));
    const dropItems = async (itemIds: string[]) => {
      const ids = itemIds.filter((id) => !keep('items', id));
      const reminderIds = (await db.reminders.where('itemId').anyOf(ids).primaryKeys()).filter((id) => !keep('reminders', id));
      if (reminderIds.length) remindersChanged = true;
      await db.reminders.bulkDelete(reminderIds);
      await db.items.bulkDelete(ids);
    };
    for (const gone of res.goneRows ?? []) {
      if (gone.table === 'items') await dropItems([gone.id]);
      else if (gone.table === 'categories') {
        await dropItems(await db.items.where('categoryId').equals(gone.id).primaryKeys());
        if (!keep('categories', gone.id)) await db.categories.delete(gone.id);
      }
    }
    await db.meta.put({ key: CURSOR_KEY, value: res.cursor });
    return { pulled, remindersChanged };
  });
}

// Calls that arrive while a sync is queued (not yet started) for a partition share that run.
const queued = new Map<string, Promise<SyncResult>>();

/**
 * One sync round for a partition: push, pull, and push again if the outbox grew meanwhile.
 * Single flight per partition across the worker and pages (Web Locks). Never throws.
 */
export function syncOnce(db: AtelierDB, account: Account, api: SyncApi, now: () => Iso = clock.now): Promise<SyncResult> {
  const name = `atelier-sync:${account.partition}`;
  const waiting = queued.get(name);
  if (waiting) return waiting;
  const run: Promise<SyncResult> = withLock(name, () => {
    if (queued.get(name) === run) queued.delete(name);
    return runSync(db, account, api, now);
  }).catch(async (e: unknown) => {
    // The lock itself failed (aborted, unavailable): report it instead of throwing.
    console.error(e);
    const message = e instanceof Error ? e.message : String(e);
    await status(account.partition, 'error', message);
    return { ok: false, state: 'error' as const, pulled: 0, ...emptySummary(), error: message };
  });
  queued.set(name, run);
  void run.finally(() => {
    if (queued.get(name) === run) queued.delete(name);
  });
  return run;
}

async function status(partition: string, state: SyncState, message?: string): Promise<void> {
  try {
    await setSyncStatus(partition, state, message);
  } catch (e) {
    console.error(e);
  }
}

async function runSync(db: AtelierDB, account: Account, api: SyncApi, now: () => Iso): Promise<SyncResult> {
  const result: SyncResult = { ok: true, state: 'idle', pulled: 0, ...emptySummary() };
  await status(account.partition, 'syncing');
  try {
    // A failed push (other than signed out / offline) must not stop this device receiving changes:
    // pull anyway (rows still queued here are skipped by the pull) and report the push error after.
    let pushError: unknown;
    try {
      await pushInto(db, api, account.userId, now, result);
    } catch (e) {
      if (e instanceof UnauthorizedError || e instanceof OfflineError) throw e;
      pushError = e;
    }
    const cursor = Number((await getMeta<number>(db, CURSOR_KEY)) ?? 0) || 0;
    const pulled = await applyPull(db, await api.pull(cursor));
    result.pulled = pulled.pulled;
    result.remindersChanged ||= pulled.remindersChanged;
    if (pushError) throw pushError;
    if ((await pushableEntries(db)).length > 0) {
      const before = result.recovered;
      await pushInto(db, api, account.userId, now, result);
      // That push may have queued Recovered copies (e.g. edits in a workspace the pull just removed): send them too.
      if (result.recovered > before) await pushInto(db, api, account.userId, now, result);
    }
  } catch (e) {
    result.ok = false;
    result.state = e instanceof UnauthorizedError ? 'paused' : e instanceof OfflineError ? 'offline' : 'error';
    result.error = e instanceof Error ? e.message : String(e);
    if (result.state === 'error') console.error(e);
  }
  if (result.recovered > 0) {
    try {
      await addRecovered(account.partition, result.recovered);
    } catch (e) {
      console.error(e);
    }
  }
  if (result.unsyncable.length) {
    try {
      await addUnsyncable(account.partition, result.unsyncable);
    } catch (e) {
      console.error(e);
    }
  }
  await status(account.partition, result.state, result.error);
  return result;
}
