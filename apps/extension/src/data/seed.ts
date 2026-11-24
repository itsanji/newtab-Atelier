import type { AtelierDB } from './db';
import { createCategory, createWorkspace, tx } from './repo';

/** First run only: when no workspace exists at all, create a starter one (atomically). */
export function ensureSeed(db: AtelierDB): Promise<void> {
  return tx(db, async () => {
    if ((await db.workspaces.count()) > 0) return;
    const ws = await createWorkspace(db, { name: 'My workspace' });
    await createCategory(db, { workspaceId: ws.id, name: 'Saved' });
    await createCategory(db, { workspaceId: ws.id, name: 'Notes' });
  });
}
