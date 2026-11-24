import { Hono } from 'hono';
import type { SQL } from 'bun';
import type { TableName } from '@atelier/core';
import type { Config } from '../config';
import type { Hub } from '../live/hub';
import { requireUser, type AuthEnv } from '../auth/middleware';
import { applyPush, type PushChange } from './push';
import { pull } from './pull';
import { TABLES } from './rows';

const MAX_CHANGES = 1000;

function parseChanges(body: unknown): PushChange[] | null {
  const changes = (body as { changes?: unknown } | null)?.changes;
  if (!Array.isArray(changes) || changes.length < 1 || changes.length > MAX_CHANGES) return null;
  for (const change of changes) {
    if (!change || typeof change !== 'object') return null;
    if (!TABLES.includes((change as { table?: unknown }).table as TableName)) return null;
  }
  return changes as PushChange[];
}

export function syncRoutes(sql: SQL, config: Config, now: () => Date, hub: Hub): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();
  routes.use('*', requireUser(sql, config.sessionSecret, now));

  routes.post('/push', async (c) => {
    const changes = parseChanges(await c.req.json().catch(() => null));
    if (!changes) return c.json({ error: 'Send 1 to 1000 changes, each with a known table and a row' }, 400);
    const user = c.get('user');
    const outcome = await applyPush(sql, user, changes, now());

    const userIds = new Set<string>(outcome.remindersChanged ? [user.id] : []);
    if (outcome.workspaceIds.size > 0) {
      const rows = await sql`select distinct user_id from workspace_members
        where workspace_id = any(${[...outcome.workspaceIds]}::uuid[]) and deleted_at is null and user_id is not null`;
      for (const r of rows) userIds.add(r.user_id);
    }
    if (userIds.size > 0) hub.notifyUsers([...userIds]);

    return c.json({ results: outcome.results });
  });

  routes.get('/pull', async (c) => {
    const raw = c.req.query('cursor') ?? '0';
    if (!/^\d{1,15}$/.test(raw)) return c.json({ error: 'Cursor must be a whole number of zero or more' }, 400);
    return c.json(await pull(sql, c.get('user').id, Number(raw)));
  });

  return routes;
}
