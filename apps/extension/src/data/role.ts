import type { Workspace } from '@atelier/core';
import { getAccount } from '../account/account';
import type { AtelierDB, Member } from './db';

export type Role = 'owner' | 'editor' | 'viewer';

/**
 * The user's role in a workspace, from its synced members. No user (no account) owns everything.
 * A workspace someone else owns, with no membership row for the user, is read-only. Shared by
 * the `useRole` hook and the non-React save paths (popup, context menu, shortcuts).
 */
export function roleFrom(ownerId: string | null, members: Member[], userId: string | null): Role {
  if (!userId) return 'owner';
  const mine = members.find((m) => !m.deletedAt && m.userId === userId);
  if (mine) return mine.role;
  return ownerId && ownerId !== userId ? 'viewer' : 'owner';
}

export async function roleIn(db: AtelierDB, ws: Workspace, userId: string | null): Promise<Role> {
  if (!userId) return 'owner';
  return roleFrom(ws.ownerId, await db.members.where('workspaceId').equals(ws.id).toArray(), userId);
}

/** Workspaces the active account may write to (all of them without an account). */
export async function editableWorkspaces(db: AtelierDB, workspaces: Workspace[]): Promise<Workspace[]> {
  const userId = (await getAccount())?.userId ?? null;
  const out: Workspace[] = [];
  for (const ws of workspaces) if ((await roleIn(db, ws, userId)) !== 'viewer') out.push(ws);
  return out;
}
