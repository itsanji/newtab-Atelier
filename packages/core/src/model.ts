export type Iso = string;

export interface RowBase {
  id: string;
  createdAt: Iso;
  updatedAt: Iso;
  deletedAt: Iso | null;
  updatedBy: string | null;
}

export interface Workspace extends RowBase {
  name: string;
  emoji: string | null;
  ownerId: string | null;
  sortKey: string;
}

export type TabGroupColor = 'grey' | 'blue' | 'red' | 'yellow' | 'green' | 'pink' | 'purple' | 'cyan' | 'orange';

export interface Category extends RowBase {
  workspaceId: string;
  name: string;
  emoji: string | null;
  sortKey: string;
  tabGroup: { title: string; color: TabGroupColor } | null;
  shareToken: string | null;
}

export type ItemKind = 'link' | 'note' | 'todo';

export interface Item extends RowBase {
  categoryId: string;
  kind: ItemKind;
  sortKey: string;
  title: string;
  url: string | null;
  faviconUrl: string | null;
  /** Short optional note on a link. */
  note: string | null;
  /** TipTap JSON for note items. */
  body: unknown | null;
  done: boolean;
}

export interface Reminder extends RowBase {
  itemId: string;
  userId: string;
  remindAt: Iso;
  remindedAt: Iso | null;
}

export type TableName = 'workspaces' | 'categories' | 'items' | 'reminders';
