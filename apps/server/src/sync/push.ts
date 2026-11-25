import type { SQL } from 'bun';
import {
  categorySchema,
  itemSchema,
  reminderSchema,
  workspaceSchema,
  type Category,
  type Item,
  type Reminder,
  type TableName,
  type Workspace,
} from '@atelier/core';
import { canEdit, roleIn } from './permissions';
import { jsonParam, TABLES } from './rows';

import { CHANGE_LOCK } from './lock';

export { CHANGE_LOCK };

export interface PushChange {
  table: TableName;
  row: unknown;
}

export type PushStatus = 'applied' | 'restored' | 'rejected';
export type RejectReason = 'invalid' | 'missing-parent' | 'forbidden';

export interface PushResult {
  table: TableName;
  id: string;
  status: PushStatus;
  reason?: RejectReason;
}

export interface PushOutcome {
  results: PushResult[];
  /** Workspaces whose rows changed (including restored parents and both ends of a move). */
  workspaceIds: Set<string>;
  /** True when one of the caller's reminders changed. */
  remindersChanged: boolean;
}

type Outcome = { status: 'applied' | 'restored' } | { status: 'rejected'; reason: RejectReason };
const applied: Outcome = { status: 'applied' };
const rejected = (reason: RejectReason): Outcome => ({ status: 'rejected', reason });

const SCHEMAS = {
  workspaces: workspaceSchema,
  categories: categorySchema,
  items: itemSchema,
  reminders: reminderSchema,
} as const;

/**
 * Postgres text and jsonb cannot hold U+0000, and jsonb rejects lone UTF-16 surrogates (22P02).
 * Strip NUL and replace lone surrogates with U+FFFD in every string and key before validating.
 */
const clean = (s: string): string => (s.includes('\u0000') ? s.replaceAll('\u0000', '') : s).toWellFormed();

function stripNul(value: unknown): unknown {
  if (typeof value === 'string') return clean(value);
  if (Array.isArray(value)) return value.map(stripNul);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [clean(k), stripNul(v)]));
  }
  return value;
}

/** SQLSTATE class 22: the row's data is bad (invalid text representation, datetime out of range, ...). */
function isDataError(err: unknown): boolean {
  const code = (err as { errno?: unknown; code?: unknown } | null)?.errno ?? (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' && code.startsWith('22');
}

interface Ctx {
  tx: SQL;
  user: { id: string; email: string };
  now: Date;
  touched: Set<string>;
}

/** Applies a batch of client changes in one transaction. Results come back in input order. */
export async function applyPush(
  sql: SQL,
  user: { id: string; email: string },
  changes: PushChange[],
  now: Date,
): Promise<PushOutcome> {
  const order = changes
    .map((change, index) => ({ change, index }))
    .sort((a, b) => TABLES.indexOf(a.change.table) - TABLES.indexOf(b.change.table) || a.index - b.index);
  const results: PushResult[] = new Array(changes.length);
  const touched = new Set<string>();
  let remindersChanged = false;

  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(${CHANGE_LOCK})`;
    const ctx: Ctx = { tx, user, now, touched };
    for (const { change, index } of order) {
      const raw = change.row as { id?: unknown } | null;
      const id = raw && typeof raw === 'object' && typeof raw.id === 'string' ? raw.id : '';
      const parsed = SCHEMAS[change.table].safeParse(stripNul(change.row));
      let outcome: Outcome = rejected('invalid');
      if (parsed.success) {
        const data = parsed.data;
        try {
          // Own savepoint: a data error undoes only this row and leaves the transaction (and lock) usable.
          outcome = await tx.savepoint((sp: SQL) => apply({ ...ctx, tx: sp }, change.table, data));
        } catch (err) {
          if (!isDataError(err)) throw err;
        }
      }
      if (change.table === 'reminders' && outcome.status !== 'rejected') remindersChanged = true;
      results[index] = { table: change.table, id, ...outcome };
    }
  });

  return { results, workspaceIds: touched, remindersChanged };
}

function apply(ctx: Ctx, table: TableName, row: unknown): Promise<Outcome> {
  switch (table) {
    case 'workspaces':
      return applyWorkspace(ctx, row as Workspace);
    case 'categories':
      return applyCategory(ctx, row as Category);
    case 'items':
      return applyItem(ctx, row as Item);
    case 'reminders':
      return applyReminder(ctx, row as Reminder);
  }
}

// Every accepted write: updated_at = greatest(now, previous + 1ms) so it strictly increases per row,
// updated_by = caller, version = next global sequence value.

async function restoreWorkspace({ tx, user, now, touched }: Ctx, id: string): Promise<void> {
  await tx`update workspaces set deleted_at = null, updated_by = ${user.id}, version = nextval('change_seq'),
    updated_at = greatest(${now}, updated_at + interval '1 millisecond') where id = ${id}`;
  touched.add(id);
}

async function restoreCategory({ tx, user, now }: Ctx, id: string): Promise<void> {
  await tx`update categories set deleted_at = null, updated_by = ${user.id}, version = nextval('change_seq'),
    updated_at = greatest(${now}, updated_at + interval '1 millisecond') where id = ${id}`;
}

/** Remembers a move out of a workspace at the row's new version, so pull can tell those left behind. */
async function recordMove(tx: SQL, table: 'categories' | 'items', id: string, fromWorkspaceId: string): Promise<void> {
  await tx`insert into row_moves (table_name, row_id, from_workspace_id, version)
    values (${table}, ${id}, ${fromWorkspaceId}, currval('change_seq'))`;
}

async function applyWorkspace(ctx: Ctx, w: Workspace): Promise<Outcome> {
  const { tx, user, now, touched } = ctx;
  const [existing] = await tx`select deleted_at from workspaces where id = ${w.id}`;
  if (!existing) {
    await tx`insert into workspaces (id, name, emoji, owner_id, sort_key, created_at, updated_at, deleted_at, updated_by, version)
      values (${w.id}, ${w.name}, ${w.emoji}, ${user.id}, ${w.sortKey}, ${w.createdAt}, ${now}, ${w.deletedAt},
        ${user.id}, nextval('change_seq'))`;
    await tx`insert into workspace_members (id, workspace_id, user_id, email, role, created_at, updated_at, version)
      values (${crypto.randomUUID()}, ${w.id}, ${user.id}, ${user.email}, 'owner', ${now}, ${now}, nextval('change_seq'))`;
    touched.add(w.id);
    return applied;
  }
  const role = await roleIn(tx, user.id, w.id);
  if (!canEdit(role)) return rejected('forbidden');
  if (w.deletedAt !== null && existing.deleted_at === null && role !== 'owner') return rejected('forbidden');
  await tx`update workspaces set name = ${w.name}, emoji = ${w.emoji}, sort_key = ${w.sortKey}, deleted_at = ${w.deletedAt},
    updated_by = ${user.id}, version = nextval('change_seq'), updated_at = greatest(${now}, updated_at + interval '1 millisecond')
    where id = ${w.id}`;
  touched.add(w.id);
  return applied;
}

async function applyCategory(ctx: Ctx, c: Category): Promise<Outcome> {
  const { tx, user, now, touched } = ctx;
  const [target] = await tx`select deleted_at from workspaces where id = ${c.workspaceId}`;
  if (!target) return rejected('missing-parent');
  if (!canEdit(await roleIn(tx, user.id, c.workspaceId))) return rejected('forbidden');
  const [existing] = await tx`select workspace_id from categories where id = ${c.id}`;
  const moved = existing && existing.workspace_id !== c.workspaceId;
  if (moved && !canEdit(await roleIn(tx, user.id, existing.workspace_id))) return rejected('forbidden');

  let restored = false;
  if (c.deletedAt === null && target.deleted_at !== null) {
    await restoreWorkspace(ctx, c.workspaceId);
    restored = true;
  }
  const tabGroup = jsonParam(c.tabGroup);
  if (existing) {
    await tx`update categories set workspace_id = ${c.workspaceId}, name = ${c.name}, emoji = ${c.emoji},
      sort_key = ${c.sortKey}, tab_group = ${tabGroup}::text::jsonb, deleted_at = ${c.deletedAt}, updated_by = ${user.id},
      version = nextval('change_seq'), updated_at = greatest(${now}, updated_at + interval '1 millisecond')
      where id = ${c.id}`;
  } else {
    await tx`insert into categories (id, workspace_id, name, emoji, sort_key, tab_group, share_token, created_at, updated_at,
        deleted_at, updated_by, version)
      values (${c.id}, ${c.workspaceId}, ${c.name}, ${c.emoji}, ${c.sortKey}, ${tabGroup}::text::jsonb, null, ${c.createdAt},
        ${now}, ${c.deletedAt}, ${user.id}, nextval('change_seq'))`;
  }
  if (moved) {
    await recordMove(tx, 'categories', c.id, existing.workspace_id);
    // Members of the destination pull by version: give the moved category's items one they have not seen.
    await tx`update items set version = nextval('change_seq') where category_id = ${c.id}`;
    touched.add(existing.workspace_id);
  }
  touched.add(c.workspaceId);
  return restored ? { status: 'restored' } : applied;
}

async function applyItem(ctx: Ctx, i: Item): Promise<Outcome> {
  const { tx, user, now, touched } = ctx;
  const [parent] = await tx`select c.workspace_id, c.deleted_at, w.deleted_at as workspace_deleted_at
    from categories c join workspaces w on w.id = c.workspace_id where c.id = ${i.categoryId}`;
  if (!parent) return rejected('missing-parent');
  if (!canEdit(await roleIn(tx, user.id, parent.workspace_id))) return rejected('forbidden');
  const [existing] = await tx`select i.restored, c.workspace_id
    from items i join categories c on c.id = i.category_id where i.id = ${i.id}`;
  const moved = existing && existing.workspace_id !== parent.workspace_id;
  if (moved && !canEdit(await roleIn(tx, user.id, existing.workspace_id))) return rejected('forbidden');

  let restoredNow = false;
  if (i.deletedAt === null) {
    if (parent.workspace_deleted_at !== null) {
      await restoreWorkspace(ctx, parent.workspace_id);
      restoredNow = true;
    }
    if (parent.deleted_at !== null) {
      await restoreCategory(ctx, i.categoryId);
      restoredNow = true;
    }
  }
  // Only the server sets the tag; a client may clear it by pushing false.
  const restored = restoredNow || (i.restored ? (existing?.restored ?? false) : false);
  const body = jsonParam(i.body);
  if (existing) {
    await tx`update items set category_id = ${i.categoryId}, kind = ${i.kind}, sort_key = ${i.sortKey}, title = ${i.title},
      url = ${i.url}, favicon_url = null, note = ${i.note}, body = ${body}::text::jsonb, done = ${i.done}, folder_id = ${i.folderId},
      restored = ${restored}, deleted_at = ${i.deletedAt}, updated_by = ${user.id}, version = nextval('change_seq'),
      updated_at = greatest(${now}, updated_at + interval '1 millisecond')
      where id = ${i.id}`;
  } else {
    await tx`insert into items (id, category_id, kind, sort_key, title, url, favicon_url, note, body, done, folder_id, restored,
        created_at, updated_at, deleted_at, updated_by, version)
      values (${i.id}, ${i.categoryId}, ${i.kind}, ${i.sortKey}, ${i.title}, ${i.url}, null, ${i.note},
        ${body}::text::jsonb, ${i.done}, ${i.folderId}, ${restored}, ${i.createdAt}, ${now}, ${i.deletedAt}, ${user.id},
        nextval('change_seq'))`;
  }
  if (moved) {
    await recordMove(tx, 'items', i.id, existing.workspace_id);
    touched.add(existing.workspace_id);
  }
  touched.add(parent.workspace_id);
  return restoredNow ? { status: 'restored' } : applied;
}

async function applyReminder(ctx: Ctx, r: Reminder): Promise<Outcome> {
  const { tx, user, now } = ctx;
  const [target] = await tx`select c.workspace_id from items i join categories c on c.id = i.category_id
    where i.id = ${r.itemId}`;
  if (!target) return rejected('missing-parent');
  if ((await roleIn(tx, user.id, target.workspace_id)) === null) return rejected('forbidden');
  const [existing] = await tx`select user_id from reminders where id = ${r.id}`;
  if (existing && existing.user_id !== user.id) return rejected('forbidden');
  if (existing) {
    await tx`update reminders set item_id = ${r.itemId}, remind_at = ${r.remindAt}, reminded_at = ${r.remindedAt},
      deleted_at = ${r.deletedAt}, updated_by = ${user.id}, version = nextval('change_seq'),
      updated_at = greatest(${now}, updated_at + interval '1 millisecond')
      where id = ${r.id}`;
  } else {
    await tx`insert into reminders (id, item_id, user_id, remind_at, reminded_at, created_at, updated_at, deleted_at,
        updated_by, version)
      values (${r.id}, ${r.itemId}, ${user.id}, ${r.remindAt}, ${r.remindedAt}, ${r.createdAt}, ${now}, ${r.deletedAt},
        ${user.id}, nextval('change_seq'))`;
  }
  return applied;
}
