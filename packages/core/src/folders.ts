import type { Item } from './model';

export interface Arranged<T> {
  /** Items at the top of the category, folders included, in the input order. */
  top: T[];
  /** Each live folder's items, in the input order. Every folder in `top` has an entry. */
  inFolder: Map<string, T[]>;
}

/**
 * Splits one category's live items (already in sort order) into the top level and folder contents.
 * An item goes in a folder only when its folderId names a folder in the same list and it is not a folder
 * itself; anything else stays at the top, so an item whose folder was deleted or moved never disappears.
 */
export function arrangeItems<T extends Pick<Item, 'id' | 'kind' | 'folderId'>>(items: T[]): Arranged<T> {
  const inFolder = new Map<string, T[]>();
  for (const i of items) if (i.kind === 'folder') inFolder.set(i.id, []);
  const top: T[] = [];
  for (const i of items) {
    const folder = i.kind === 'folder' || !i.folderId ? undefined : inFolder.get(i.folderId);
    if (folder) folder.push(i);
    else top.push(i);
  }
  return { top, inFolder };
}
