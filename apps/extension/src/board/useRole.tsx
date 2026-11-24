import { createContext, useContext, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Role } from '../sync/api';
import { roleFrom } from '../data/role';
import { useAccount } from '../account/account';
import { useDb } from '../data/DbContext';

export type { Role };
export const VIEW_ONLY = 'View only';

/**
 * The signed-in user's role in a workspace. Without an account (or while it loads) the board is
 * the user's own, so `owner`. With one it comes from the synced `members` table; a workspace
 * someone else owns, with no membership row for us, is read-only until its members arrive.
 */
export function useRole(workspaceId: string): Role {
  const db = useDb();
  const account = useAccount();
  const state = useLiveQuery(async () => ({
    ownerId: (await db.workspaces.get(workspaceId))?.ownerId ?? null,
    members: (await db.members.where('workspaceId').equals(workspaceId).toArray()).filter((m) => !m.deletedAt),
  }), [db, workspaceId]);
  if (!account || !state) return 'owner';
  return roleFrom(state.ownerId, state.members, account.userId);
}

const RoleContext = createContext<Role>('owner');

/** Provides the role of `workspaceId` to the board below it. */
export function RoleProvider({ workspaceId, children }: { workspaceId: string; children: ReactNode }) {
  return <RoleContext.Provider value={useRole(workspaceId)}>{children}</RoleContext.Provider>;
}

export const useCurrentRole = (): Role => useContext(RoleContext);
/** False for viewers: every edit affordance is hidden or disabled. */
export const useCanEdit = (): boolean => useContext(RoleContext) !== 'viewer';
