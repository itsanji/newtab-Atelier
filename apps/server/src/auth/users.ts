import type { SQL } from 'bun';
import { attachPendingInvites } from './sessions';

export interface UserRow {
  id: string;
  email: string;
  displayName: string;
}

/** Finds the user for a verified email, creating the account (and attaching pending invites) when new. */
export async function findOrCreateVerifiedUser(sql: SQL, email: string, displayName: string, now: Date): Promise<UserRow> {
  const normalised = email.trim().toLowerCase();
  const [created] = await sql`insert into users (id, email, display_name, created_at)
    values (${crypto.randomUUID()}, ${normalised}, ${displayName.trim().slice(0, 100)}, ${now})
    on conflict (email) do nothing
    returning id, email, display_name`;
  const row = created ?? (await sql`select id, email, display_name from users where email = ${normalised}`)[0];
  const user = { id: row.id as string, email: row.email as string, displayName: row.display_name as string };
  await attachPendingInvites(sql, user, now);
  return user;
}
