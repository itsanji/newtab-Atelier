import { Hono } from 'hono';
import type { SQL } from 'bun';
import type { Config } from '../config';
import type { Hub } from '../live/hub';
import { requireUser, type AuthEnv } from '../auth/middleware';
import { CHANGE_LOCK } from '../sync/lock';
import { canEdit, roleIn } from '../sync/permissions';
import { renderNotFoundPage, renderSharePage, type ShareItem } from './page';

const UUID = /^[0-9a-f-]{36}$/i;
const FONT = /^[a-z0-9-]+\.woff2$/;
const FONT_DIR = new URL('../../static/fonts/', import.meta.url);

const PAGE_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; img-src 'self'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

/** Authenticated share management, mounted at /api/categories. */
export function shareApiRoutes(sql: SQL, config: Config, now: () => Date, hub: Hub): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();
  routes.use('*', requireUser(sql, config.sessionSecret, now));

  /** Notifies every live member of the category's workspace. */
  async function notifyMembers(workspaceId: string): Promise<void> {
    const rows = await sql`select user_id from workspace_members where workspace_id = ${workspaceId} and deleted_at is null and user_id is not null`;
    hub.notifyUsers(rows.map((r: { user_id: string }) => r.user_id));
  }

  /** The live category plus the caller's role, or null when the caller cannot see it. */
  async function resolve(id: string, userId: string) {
    if (!UUID.test(id)) return null;
    const [cat] = await sql`select c.id, c.workspace_id, c.share_token from categories c join workspaces w on w.id = c.workspace_id
      where c.id = ${id} and c.deleted_at is null and w.deleted_at is null`;
    if (!cat) return null;
    const role = await roleIn(sql, userId, cat.workspace_id);
    return role ? { cat, role } : null;
  }

  routes.post('/:id/share', async (c) => {
    const user = c.get('user');
    const found = await resolve(c.req.param('id'), user.id);
    if (!found) return c.json({ error: 'Category not found' }, 404);
    if (!canEdit(found.role)) return c.json({ error: 'Only editors can share a category' }, 403);
    const t = now();
    const token = await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(${CHANGE_LOCK})`;
      const [cur] = await tx`select share_token from categories where id = ${found.cat.id} and deleted_at is null`;
      if (!cur) return null;
      if (cur.share_token) return { value: cur.share_token as string, changed: false };
      const value = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
      await tx`update categories set share_token = ${value}, updated_by = ${user.id}, version = nextval('change_seq'),
        updated_at = greatest(${t}, updated_at + interval '1 millisecond') where id = ${found.cat.id}`;
      return { value, changed: true };
    });
    if (!token) return c.json({ error: 'Category not found' }, 404);
    if (token.changed) await notifyMembers(found.cat.workspace_id);
    return c.json({ shareToken: token.value, url: `${config.publicUrl}/s/${token.value}` });
  });

  routes.delete('/:id/share', async (c) => {
    const user = c.get('user');
    const found = await resolve(c.req.param('id'), user.id);
    if (!found) return c.json({ error: 'Category not found' }, 404);
    if (!canEdit(found.role)) return c.json({ error: 'Only editors can stop sharing a category' }, 403);
    const t = now();
    const changed = await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(${CHANGE_LOCK})`;
      const rows = await tx`update categories set share_token = null, updated_by = ${user.id}, version = nextval('change_seq'),
        updated_at = greatest(${t}, updated_at + interval '1 millisecond')
        where id = ${found.cat.id} and share_token is not null returning id`;
      return rows.length > 0;
    });
    if (changed) await notifyMembers(found.cat.workspace_id);
    return c.body(null, 204);
  });

  return routes;
}

/** Public, unauthenticated pages and assets. */
export function sharePublicRoutes(sql: SQL): Hono {
  const routes = new Hono();

  routes.get('/static/fonts/:file', async (c) => {
    const name = c.req.param('file');
    if (!FONT.test(name)) return c.text('Not found', 404);
    const file = Bun.file(new URL(name, FONT_DIR));
    if (!(await file.exists())) return c.text('Not found', 404);
    return new Response(file, {
      headers: { 'Content-Type': 'font/woff2', 'Cache-Control': 'public, max-age=31536000, immutable' },
    });
  });

  routes.get('/s/:token', async (c) => {
    const html = (body: string, status: 200 | 404) => c.html(body, status, PAGE_HEADERS);
    const token = c.req.param('token');
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return html(renderNotFoundPage(), 404);
    const [cat] = await sql`select c.id, c.name, c.emoji from categories c join workspaces w on w.id = c.workspace_id
      where c.share_token = ${token} and c.deleted_at is null and w.deleted_at is null`;
    if (!cat) return html(renderNotFoundPage(), 404);
    const rows = await sql`select kind, title, url, note, body, done from items
      where category_id = ${cat.id} and deleted_at is null order by sort_key collate "C", id`;
    return html(renderSharePage(cat, rows as ShareItem[]), 200);
  });

  return routes;
}
