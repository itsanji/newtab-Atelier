import { createContext, useContext, type ReactNode } from 'react';
import type { AtelierDB } from './db';

const Ctx = createContext<AtelierDB | null>(null);

export function DbProvider({ db, children }: { db: AtelierDB; children: ReactNode }) {
  return <Ctx.Provider value={db}>{children}</Ctx.Provider>;
}

export function useDb(): AtelierDB {
  const db = useContext(Ctx);
  if (!db) throw new Error('useDb must be used inside <DbProvider>');
  return db;
}
