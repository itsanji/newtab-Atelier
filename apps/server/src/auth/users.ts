import type { SQL } from 'bun';
import { attachPendingInvites } from './sessions';

export interface UserRow {
  id: string;
  email: string;
  displayName: string;
}

/**
 * Finds the user for an email the caller has just proven they own, creating the account (and attaching pending
 * invites) when new. Returns null when sign-ups are closed and the email has no account or pending invite.
 *
 * The first verification of an account that registered with a password clears that password and every session,
 * so whoever pre-registered the address cannot keep access.
 */
export async function findOrCreateVerifiedUser(
  sql: SQL,
  email: string,
  displayName: string,
  now: Date,
  allowSignup = true,
): Promise<UserRow | null> {
  const normalised = email.trim().toLowerCase();
  let row = (await sql`select id, email, display_name from users where email = ${normalised}`)[0];
  if (!row && !allowSignup) {
    const [invite] = await sql`select 1 as found from workspace_members
      where email = ${normalised} and user_id is null and deleted_at is null limit 1`;
    if (!invite) return null;
  }
  if (!row) {
    row = (
      await sql`insert into users (id, email, display_name, created_at, email_verified_at)
        values (${crypto.randomUUID()}, ${normalised}, ${displayName.trim().slice(0, 100)}, ${now}, ${now})
        on conflict (email) do nothing
        returning id, email, display_name`
    )[0];
    row ??= (await sql`select id, email, display_name from users where email = ${normalised}`)[0];
  }
  const user = { id: row.id as string, email: row.email as string, displayName: row.display_name as string };
  await sql.begin(async (tx) => {
    const [first] = await tx`update users set email_verified_at = ${now}, password_hash = null
      where id = ${user.id} and email_verified_at is null returning id`;
    if (first) await tx`delete from sessions where user_id = ${user.id}`;
  });
  await attachPendingInvites(sql, user, now);
  return user;
}
