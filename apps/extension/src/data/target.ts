import type { Category } from '@atelier/core';
import type { AtelierDB } from './db';
import { getMeta, liveCategories, liveWorkspaces } from './queries';
import { editableWorkspaces } from './role';
import { ensureSeed } from './seed';

export const LAST_CATEGORY_KEY = 'lastCategoryId';

/**
 * Where a save with no explicit choice goes: the last used category if it is live and in a workspace
 * the user can edit, else the first editable one. Viewer workspaces are never targets.
 */
export async function resolveTargetCategory(db: AtelierDB): Promise<Category> {
  await ensureSeed(db);
  const editable = await editableWorkspaces(db, await liveWorkspaces(db));
  const lastId = await getMeta<string>(db, LAST_CATEGORY_KEY);
  if (lastId) {
    const last = await db.categories.get(lastId);
    if (last && last.deletedAt === null && editable.some((w) => w.id === last.workspaceId)) return last;
  }
  for (const ws of editable) {
    const first = (await liveCategories(db, ws.id))[0];
    if (first) return first;
  }
  throw new Error('No category available');
}
