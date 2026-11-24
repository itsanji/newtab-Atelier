import { sortByKey, type Category, type Item, type Reminder, type Workspace } from '@atelier/core';
import type { AtelierDB } from './db';
import { currentUserId } from '../account/account';

export async function liveWorkspaces(db: AtelierDB): Promise<Workspace[]> {
  return sortByKey(await db.workspaces.filter((r) => r.deletedAt === null).toArray());
}

export async function liveCategories(db: AtelierDB, workspaceId: string): Promise<Category[]> {
  return sortByKey(
    await db.categories.where('workspaceId').equals(workspaceId).filter((r) => r.deletedAt === null).toArray(),
  );
}

export async function liveItems(db: AtelierDB, categoryId: string): Promise<Item[]> {
  return sortByKey(
    await db.items.where('categoryId').equals(categoryId).filter((r) => r.deletedAt === null).toArray(),
  );
}

export async function getMeta<T = unknown>(db: AtelierDB, key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined;
}

export async function setMeta(db: AtelierDB, key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}

export async function liveReminders(db: AtelierDB): Promise<Reminder[]> {
  return db.reminders.filter((r) => r.deletedAt === null && r.userId === currentUserId()).toArray();
}
