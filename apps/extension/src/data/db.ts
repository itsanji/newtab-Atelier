import Dexie, { type Table } from 'dexie';
import type { Category, Item, Iso, Reminder, TableName, Workspace } from '@atelier/core';

export const LOCAL_USER = 'local';

/** One pending upload per row: `key` is `<table>:<rowId>`, so a newer write replaces the older snapshot. */
export interface OutboxEntry {
  key: string;
  /** Upload order; increases with every write. */
  seq: number;
  table: TableName;
  rowId: string;
  row: object;
  queuedAt: Iso;
}

export interface MetaEntry {
  key: string;
  value: unknown;
}

export class AtelierDB extends Dexie {
  workspaces!: Table<Workspace, string>;
  categories!: Table<Category, string>;
  items!: Table<Item, string>;
  reminders!: Table<Reminder, string>;
  outbox!: Table<OutboxEntry, string>;
  meta!: Table<MetaEntry, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      workspaces: 'id, updatedAt',
      categories: 'id, workspaceId, updatedAt',
      items: 'id, categoryId, updatedAt',
      reminders: 'id, itemId, updatedAt',
      outbox: 'key, seq',
      meta: 'key',
    });
  }
}

export const outboxKey = (table: TableName, rowId: string) => `${table}:${rowId}`;

/** Queue the latest snapshot of a row, replacing any older pending entry. Call inside a rw transaction. */
export async function enqueue(db: AtelierDB, table: TableName, row: { id: string }, now: Iso): Promise<void> {
  const last = await db.outbox.orderBy('seq').last();
  const seq = Math.max(Date.now(), (last?.seq ?? 0) + 1);
  await db.outbox.put({ key: outboxKey(table, row.id), seq, table, rowId: row.id, row: { ...row }, queuedAt: now });
}

export function openDb(partition = 'local'): AtelierDB {
  return new AtelierDB(`atelier-${partition}`);
}
