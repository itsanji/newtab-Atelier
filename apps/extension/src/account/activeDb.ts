import { openDb, type AtelierDB } from '../data/db';
import { getAccount, LOCAL_PARTITION, setCurrentUserId } from './account';

let cached: { partition: string; db: AtelierDB } | undefined;

/** Open (or reuse) the database for a partition, closing the previous one, and set the current user. */
export function openPartition(partition: string, userId: string | null): AtelierDB {
  setCurrentUserId(userId);
  if (cached?.partition === partition) return cached.db;
  cached?.db.close();
  cached = { partition, db: openDb(partition) };
  return cached.db;
}

/**
 * Close and drop the cached database of a partition, so the next `getActiveDb()` opens a fresh one.
 * Call before deleting a partition: a deleted database's old instance stays closed for good.
 */
export function forgetDb(partition: string): void {
  if (cached?.partition !== partition) return;
  cached.db.close();
  cached = undefined;
}

/** For the service worker: the database of the active account, or the local one. */
export async function getActiveDb(): Promise<AtelierDB> {
  const account = await getAccount();
  return openPartition(account?.partition ?? LOCAL_PARTITION, account?.userId ?? null);
}
