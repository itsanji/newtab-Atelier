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

/** A folder is an item that holds links: a grid of site icons for quick access, one level deep. */
export type ItemKind = 'link' | 'note' | 'todo' | 'folder';

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
  /**
   * The folder (an item of kind `folder` in the same category) this item sits in, or null at the top of the
   * category. A folderId that names no live folder in the same category reads as null, so a conflict never
   * hides an item.
   */
  folderId: string | null;
  /** Set by the server when a push put this item back under a parent another device had deleted. */
  restored: boolean;
}

export interface Reminder extends RowBase {
  itemId: string;
  userId: string;
  remindAt: Iso;
  remindedAt: Iso | null;
}

export type TableName = 'workspaces' | 'categories' | 'items' | 'reminders';

/** Protocols a saved link may use; anything else (javascript:, data:, chrome:) is refused. */
export const LINK_PROTOCOLS = ['http:', 'https:', 'file:', 'ftp:'] as const;

/** True when `url` parses and uses one of LINK_PROTOCOLS. */
export function isLinkUrl(url: string): boolean {
  try {
    return (LINK_PROTOCOLS as readonly string[]).includes(new URL(url).protocol);
  } catch {
    return false;
  }
}
