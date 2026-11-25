import { Hono } from 'hono';
import type { SQL } from 'bun';
import type { Config } from '../config';
import type { Hub } from '../live/hub';
import type { MailTransport } from '../mail';
import { requireUser, type AuthEnv } from '../auth/middleware';
import { CHANGE_LOCK } from '../sync/lock';
import { memberToWire, type Role } from '../sync/rows';

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const isInviteRole = (v: unknown): v is 'editor' | 'viewer' => v === 'editor' || v === 'viewer';

async function readJson(c: { req: { json(): Promise<unknown> } }): Promise<Record<string, unknown>> {
  const body = await c.req.json().catch(() => null);
  return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
}

export function memberRoutes(sql: SQL, config: Config, now: () => Date, hub: Hub, mail: MailTransport | null): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();
  routes.use('*', requireUser(sql, config.sessionSecret, now));

  /** The caller's live role in a live workspace, or null (not a member, or no such workspace). */
  async function callerRole(workspaceId: string, userId: string): Promise<Role | null> {
    if (!/^[0-9a-f-]{36}$/i.test(workspaceId)) return null;
    const [row] = await sql`select m.role from workspace_members m join workspaces w on w.id = m.workspace_id
      where m.workspace_id = ${workspaceId} and m.user_id = ${userId} and m.deleted_at is null and w.deleted_at is null`;
    return (row?.role as Role | undefined) ?? null;
  }

  /** Everyone who should hear about a membership change: current members plus any extra users. */
  async function notifyWorkspace(workspaceId: string, extra: (string | null)[] = []): Promise<void> {
    const rows = await sql`select user_id from workspace_members
      where workspace_id = ${workspaceId} and deleted_at is null and user_id is not null`;
    hub.notifyUsers([...rows.map((r: { user_id: string }) => r.user_id), ...extra.filter((x): x is string => !!x)]);
  }

  const memberOut = async (id: string) => {
    const [row] = await sql`select m.*, u.display_name from workspace_members m left join users u on u.id = m.user_id where m.id = ${id}`;
    return memberToWire(row);
  };

  routes.get('/:id/members', async (c) => {
    const workspaceId = c.req.param('id');
    if (!(await callerRole(workspaceId, c.get('user').id))) return c.json({ error: 'Workspace not found' }, 404);
    const rows = await sql`select m.*, u.display_name from workspace_members m left join users u on u.id = m.user_id
      where m.workspace_id = ${workspaceId} and m.deleted_at is null order by m.created_at, m.email`;
    return c.json({ members: rows.map(memberToWire) });
  });

  routes.post('/:id/members', async (c) => {
    const workspaceId = c.req.param('id');
    const user = c.get('user');
    const role = await callerRole(workspaceId, user.id);
    if (!role) return c.json({ error: 'Workspace not found' }, 404);
    if (role !== 'owner') return c.json({ error: 'Only the owner can invite people' }, 403);

    const body = await readJson(c);
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!email.includes('@') || email.length > 320) return c.json({ error: 'Enter a valid email address' }, 400);
    if (!isInviteRole(body.role)) return c.json({ error: 'Role must be editor or viewer' }, 400);
    const inviteRole = body.role;

    const t = now();
    const result = await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(${CHANGE_LOCK})`;
      const [existing] = await tx`select id, deleted_at from workspace_members where workspace_id = ${workspaceId} and email = ${email}`;
      if (existing && existing.deleted_at === null) return null;
      const [account] = await tx`select id from users where email = ${email}`;
      const userId = (account?.id as string | undefined) ?? null;
      if (existing) {
        await tx`update workspace_members
          set role = ${inviteRole}, user_id = ${userId}, invited_by = ${user.id}, deleted_at = null,
              created_at = ${t}, updated_at = ${t}, version = nextval('change_seq')
          where id = ${existing.id}`;
        return { id: existing.id as string, userId };
      }
      const id = crypto.randomUUID();
      await tx`insert into workspace_members (id, workspace_id, user_id, email, role, invited_by, created_at, updated_at, version)
        values (${id}, ${workspaceId}, ${userId}, ${email}, ${inviteRole}, ${user.id}, ${t}, ${t}, nextval('change_seq'))`;
      return { id, userId };
    });
    if (!result) return c.json({ error: 'That person is already a member' }, 409);

    if (mail) {
      const [ws] = await sql`select name from workspaces where id = ${workspaceId}`;
      const inviter = user.displayName || user.email;
      const subject = `${inviter} shared “${ws.name}” with you on Atelier`;
      const text = `${inviter} shared “${ws.name}” with you as ${inviteRole === 'editor' ? 'an editor' : 'a viewer'}.\n\nSign in at ${config.publicUrl} with this email address (${email}) to open it.\n`;
      const html = `<p>${escapeHtml(inviter)} shared “${escapeHtml(ws.name)}” with you as ${inviteRole === 'editor' ? 'an editor' : 'a viewer'}.</p><p>Sign in at <a href="${escapeHtml(config.publicUrl)}">${escapeHtml(config.publicUrl)}</a> with this email address (${escapeHtml(email)}) to open it.</p>`;
      try {
        await mail.send({ to: email, subject, text, html });
      } catch (err) {
        console.error('Could not send invite email', err);
      }
    }

    await notifyWorkspace(workspaceId, [result.userId]);
    return c.json({ member: await memberOut(result.id) }, 201);
  });

  routes.patch('/:id/members/:memberId', async (c) => {
    const workspaceId = c.req.param('id');
    const role = await callerRole(workspaceId, c.get('user').id);
    if (!role) return c.json({ error: 'Workspace not found' }, 404);
    if (role !== 'owner') return c.json({ error: 'Only the owner can change roles' }, 403);
    const body = await readJson(c);
    if (!isInviteRole(body.role)) return c.json({ error: 'Role must be editor or viewer' }, 400);
    const newRole = body.role;
    const memberId = c.req.param('memberId');
    if (!/^[0-9a-f-]{36}$/i.test(memberId)) return c.json({ error: 'Member not found' }, 404);

    const outcome = await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(${CHANGE_LOCK})`;
      const [m] = await tx`select role, user_id from workspace_members
        where id = ${memberId} and workspace_id = ${workspaceId} and deleted_at is null`;
      if (!m) return 'missing' as const;
      if (m.role === 'owner') return 'owner' as const;
      await tx`update workspace_members set role = ${newRole}, updated_at = ${now()}, version = nextval('change_seq') where id = ${memberId}`;
      return { userId: m.user_id as string | null };
    });
    if (outcome === 'missing') return c.json({ error: 'Member not found' }, 404);
    if (outcome === 'owner') return c.json({ error: 'The owner’s role cannot be changed' }, 400);
    await notifyWorkspace(workspaceId);
    return c.json({ member: await memberOut(memberId) });
  });

  routes.delete('/:id/members/:memberId', async (c) => {
    const workspaceId = c.req.param('id');
    const user = c.get('user');
    const role = await callerRole(workspaceId, user.id);
    if (!role) return c.json({ error: 'Workspace not found' }, 404);
    const memberId = c.req.param('memberId');
    if (!/^[0-9a-f-]{36}$/i.test(memberId)) return c.json({ error: 'Member not found' }, 404);

    const outcome = await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(${CHANGE_LOCK})`;
      const [m] = await tx`select role, user_id from workspace_members
        where id = ${memberId} and workspace_id = ${workspaceId} and deleted_at is null`;
      if (!m) return 'missing' as const;
      if (role !== 'owner' && m.user_id !== user.id) return 'forbidden' as const;
      if (m.role === 'owner') return 'owner' as const;
      const t = now();
      await tx`update workspace_members set deleted_at = ${t}, updated_at = ${t}, version = nextval('change_seq') where id = ${memberId}`;
      return { userId: m.user_id as string | null };
    });
    if (outcome === 'missing') return c.json({ error: 'Member not found' }, 404);
    if (outcome === 'forbidden') return c.json({ error: 'Only the owner can remove other people' }, 403);
    if (outcome === 'owner') return c.json({ error: 'The owner cannot be removed' }, 400);
    await notifyWorkspace(workspaceId, [outcome.userId]);
    return c.body(null, 204);
  });

  return routes;
}
