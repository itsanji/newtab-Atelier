import { useEffect, useState, type ReactNode } from 'react';
import type { AtelierDB } from '../data/db';
import { DbProvider } from '../data/DbContext';
import { LOCAL_PARTITION } from './account';
import { openPartition } from './activeDb';
import { useAccount } from './useAccount';

/** For pages: resolves the active partition, and remounts children when it changes. */
export function ActiveDbProvider({ children }: { children: ReactNode }) {
  const account = useAccount();
  const [open_, setOpen] = useState<{ partition: string; db: AtelierDB } | null>(null);
  const partition = account === undefined ? undefined : (account?.partition ?? LOCAL_PARTITION);
  useEffect(() => {
    if (partition === undefined) return;
    setOpen({ partition, db: openPartition(partition, account?.userId ?? null) });
  }, [partition, account?.userId]);
  if (!open_ || open_.partition !== partition) return null;
  return <DbProvider key={open_.partition} db={open_.db}>{children}</DbProvider>;
}
