import type { Category } from '@atelier/core';
import type { AtelierDB } from './db';
import { getMeta, liveCategories, liveWorkspaces } from './queries';
import { ensureSeed } from './seed';

export const LAST_CATEGORY_KEY = 'lastCategoryId';

/** Where a save with no explicit choice goes: the last used category if it is live, else the first one. */
export async function resolveTargetCategory(db: AtelierDB): Promise<Category> {
  await ensureSeed(db);
  const lastId = await getMeta<string>(db, LAST_CATEGORY_KEY);
  if (lastId) {
    const last = await db.categories.get(lastId);
    if (last && last.deletedAt === null) return last;
  }
  for (const ws of await liveWorkspaces(db)) {
    const first = (await liveCategories(db, ws.id))[0];
    if (first) return first;
  }
  throw new Error('No category available');
}
