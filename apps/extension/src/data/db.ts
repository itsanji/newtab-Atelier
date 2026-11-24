import Dexie, { type Table } from 'dexie';
import type { Category, Item, Iso, Reminder, TableName, Workspace } from '@atelier/core';

export const LOCAL_USER = 'local';

export interface OutboxEntry {
  seq?: number;
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
  outbox!: Table<OutboxEntry, number>;
  meta!: Table<MetaEntry, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      workspaces: 'id, updatedAt',
      categories: 'id, workspaceId, updatedAt',
      items: 'id, categoryId, updatedAt',
      reminders: 'id, itemId, updatedAt',
      outbox: '++seq',
      meta: 'key',
    });
  }
}

export function openDb(partition = 'local'): AtelierDB {
  return new AtelierDB(`atelier-${partition}`);
}
