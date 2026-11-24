import type { AtelierDB } from './db';
import { createCategory, createWorkspace } from './repo';

/** First run only: when no workspace exists at all, create a starter one. */
export async function ensureSeed(db: AtelierDB): Promise<void> {
  if ((await db.workspaces.count()) > 0) return;
  const ws = await createWorkspace(db, { name: 'My workspace' });
  await createCategory(db, { workspaceId: ws.id, name: 'Saved' });
  await createCategory(db, { workspaceId: ws.id, name: 'Notes' });
}
