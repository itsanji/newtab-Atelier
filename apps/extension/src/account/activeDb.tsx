import { useEffect, useState, type ReactNode } from 'react';
import { openDb, type AtelierDB } from '../data/db';
import { DbProvider } from '../data/DbContext';
import { getAccount, LOCAL_PARTITION, setCurrentUserId, useAccount } from './account';

let cached: { partition: string; db: AtelierDB } | undefined;

/** Open (or reuse) the database for a partition, closing the previous one, and set the current user. */
function open(partition: string, userId: string | null): AtelierDB {
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
  return open(account?.partition ?? LOCAL_PARTITION, account?.userId ?? null);
}

/** For pages: resolves the active partition, and remounts children when it changes. */
export function ActiveDbProvider({ children }: { children: ReactNode }) {
  const account = useAccount();
  const [open_, setOpen] = useState<{ partition: string; db: AtelierDB } | null>(null);
  const partition = account === undefined ? undefined : (account?.partition ?? LOCAL_PARTITION);
  useEffect(() => {
    if (partition === undefined) return;
    setOpen({ partition, db: open(partition, account?.userId ?? null) });
  }, [partition, account?.userId]);
  if (!open_ || open_.partition !== partition) return null;
  return <DbProvider key={open_.partition} db={open_.db}>{children}</DbProvider>;
}
