import type { Category, Item, Reminder, TableName, Workspace } from '@atelier/core';

/** Synced tables in the order a push applies them: parents before children. */
export const TABLES: readonly TableName[] = ['workspaces', 'categories', 'items', 'reminders'];

export type Role = 'owner' | 'editor' | 'viewer';

export interface Member {
  id: string;
  workspaceId: string;
  userId: string | null;
  email: string;
  role: Role;
  displayName: string | null;
  deletedAt: string | null;
}

// Rows as Bun.SQL returns them (timestamptz -> Date, jsonb -> parsed value).
type DbRow = Record<string, any>;

const iso = (d: Date | null): string | null => (d ? new Date(d).toISOString() : null);
const isoReq = (d: Date): string => new Date(d).toISOString();

const base = (r: DbRow) => ({
  id: r.id as string,
  createdAt: isoReq(r.created_at),
  updatedAt: isoReq(r.updated_at),
  deletedAt: iso(r.deleted_at),
  updatedBy: (r.updated_by as string | null) ?? null,
});

export const workspaceToWire = (r: DbRow): Workspace => ({
  ...base(r),
  name: r.name,
  emoji: r.emoji,
  ownerId: r.owner_id,
  sortKey: r.sort_key,
});

export const categoryToWire = (r: DbRow): Category => ({
  ...base(r),
  workspaceId: r.workspace_id,
  name: r.name,
  emoji: r.emoji,
  sortKey: r.sort_key,
  tabGroup: r.tab_group ?? null,
  shareToken: r.share_token,
});

export const itemToWire = (r: DbRow): Item => ({
  ...base(r),
  categoryId: r.category_id,
  kind: r.kind,
  sortKey: r.sort_key,
  title: r.title,
  url: r.url,
  faviconUrl: r.favicon_url,
  note: r.note,
  body: r.body ?? null,
  done: r.done,
  folderId: r.folder_id ?? null,
  restored: r.restored,
});

export const reminderToWire = (r: DbRow): Reminder => ({
  ...base(r),
  itemId: r.item_id,
  userId: r.user_id,
  remindAt: isoReq(r.remind_at),
  remindedAt: iso(r.reminded_at),
});

export const memberToWire = (r: DbRow): Member => ({
  id: r.id,
  workspaceId: r.workspace_id,
  userId: r.user_id,
  email: r.email,
  role: r.role,
  displayName: r.display_name || null,
  deletedAt: iso(r.deleted_at),
});

/** Bun.SQL sends a JSON string param as a jsonb string; cast through text so objects stay objects. */
export const jsonParam = (v: unknown): string | null => (v === null || v === undefined ? null : JSON.stringify(v));
