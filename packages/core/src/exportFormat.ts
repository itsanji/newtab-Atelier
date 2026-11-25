import { z } from 'zod';
import { generateKeyBetween } from 'fractional-indexing';
import { isLinkUrl, type Category, type Item, type Reminder, type Workspace } from './model';

const iso = z.string().datetime({ offset: true });
const uuid = z.string().uuid();

/** A key fractional-indexing can build on; anything else would make later moves throw. */
const sortKey = z.string().refine((key) => {
  try {
    generateKeyBetween(key, null);
    return true;
  } catch {
    return false;
  }
}, 'Invalid sort key');

const linkUrl = z.string().refine(isLinkUrl, 'Links must be http, https, file or ftp');

const rowBase = {
  id: uuid,
  createdAt: iso,
  updatedAt: iso,
  deletedAt: iso.nullable(),
  updatedBy: z.string().nullable(),
};

export const workspaceSchema = z.object({
  ...rowBase,
  name: z.string(),
  emoji: z.string().nullable(),
  ownerId: z.string().nullable(),
  sortKey,
});

const tabGroupColorSchema = z.enum(['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange']);

export const categorySchema = z.object({
  ...rowBase,
  workspaceId: uuid,
  name: z.string(),
  emoji: z.string().nullable(),
  sortKey,
  tabGroup: z.object({ title: z.string(), color: tabGroupColorSchema }).nullable(),
  shareToken: z.string().nullable(),
});

export const itemSchema = z.object({
  ...rowBase,
  categoryId: uuid,
  kind: z.enum(['link', 'note', 'todo']),
  sortKey,
  title: z.string(),
  url: linkUrl.nullable(),
  faviconUrl: z.string().nullable(),
  note: z.string().nullable(),
  body: z.unknown().nullable(),
  done: z.boolean(),
  restored: z.boolean().default(false),
});

export const reminderSchema = z.object({
  ...rowBase,
  itemId: uuid,
  userId: z.string(),
  remindAt: iso,
  remindedAt: iso.nullable(),
});

export const exportFileSchema = z.object({
  format: z.literal('atelier'),
  version: z.literal(1),
  exportedAt: iso,
  workspaces: z.array(workspaceSchema),
  categories: z.array(categorySchema),
  items: z.array(itemSchema),
  reminders: z.array(reminderSchema),
});

export type ExportFile = {
  format: 'atelier';
  version: 1;
  exportedAt: string;
  workspaces: Workspace[];
  categories: Category[];
  items: Item[];
  reminders: Reminder[];
};
