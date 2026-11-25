import type { SQL } from 'bun';
import { CHANGE_LOCK } from '../sync/lock';

export const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const REFRESH_AFTER_MS = 60 * 60 * 1000;

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
}

export function hashToken(secret: string, token: string): string {
  return new Bun.CryptoHasher('sha256', secret).update(token).digest('base64url');
}

/** Creates a session and returns the raw token (only its HMAC is stored). */
export async function createSession(sql: SQL, secret: string, userId: string, now: Date): Promise<string> {
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
  await sql`insert into sessions (token_hash, user_id, created_at, last_used_at, expires_at)
    values (${hashToken(secret, token)}, ${userId}, ${now}, ${now}, ${new Date(now.getTime() + SESSION_TTL_MS)})`;
  return token;
}

export async function deleteSession(sql: SQL, secret: string, token: string): Promise<void> {
  await sql`delete from sessions where token_hash = ${hashToken(secret, token)}`;
}

/** Resolves a live session, sliding its expiry at most once an hour. Null when unknown or expired. */
export async function userForToken(sql: SQL, secret: string, token: string, now: Date): Promise<SessionUser | null> {
  const hash = hashToken(secret, token);
  const [row] = await sql`
    select u.id, u.email, u.display_name, s.last_used_at
    from sessions s join users u on u.id = s.user_id
    where s.token_hash = ${hash} and s.expires_at > ${now}`;
  if (!row) return null;
  if (now.getTime() - new Date(row.last_used_at).getTime() >= REFRESH_AFTER_MS) {
    await sql`update sessions set last_used_at = ${now}, expires_at = ${new Date(now.getTime() + SESSION_TTL_MS)}
      where token_hash = ${hash}`;
  }
  return { id: row.id, email: row.email, displayName: row.display_name };
}

/** Links invites sent to this email before the account existed. Bumps `version` so members' clients pull the change. */
export async function attachPendingInvites(sql: SQL, user: { id: string; email: string }, now: Date = new Date()): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(${CHANGE_LOCK})`;
    await tx`update workspace_members
      set user_id = ${user.id}, version = nextval('change_seq'), updated_at = ${now}
      where email = ${user.email.toLowerCase()} and user_id is null`;
  });
}
