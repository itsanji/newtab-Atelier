import type { SQL } from 'bun';
import type { Role } from './rows';

/** The caller's role in a workspace through a live membership, or null. */
export async function roleIn(sql: SQL, userId: string, workspaceId: string): Promise<Role | null> {
  const [row] = await sql`select role from workspace_members
    where workspace_id = ${workspaceId} and user_id = ${userId} and deleted_at is null`;
  return (row?.role as Role | undefined) ?? null;
}

export const canEdit = (role: Role | null): boolean => role === 'owner' || role === 'editor';
