import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { SQL } from 'bun';
import { migrate } from '../src/db';
import { freshDb } from './helpers';

let sql: SQL;
let drop: () => Promise<void>;
beforeAll(async () => ({ sql, drop } = await freshDb()));
afterAll(() => drop());

describe('migrate', () => {
  test('creates all tables', async () => {
    const rows = await sql`select table_name from information_schema.tables where table_schema = 'public'`;
    const names = rows.map((r: { table_name: string }) => r.table_name);
    for (const t of [
      'users', 'sessions', 'workspaces', 'workspace_members', 'categories', 'items', 'reminders',
      'magic_links', 'oauth_codes', 'oauth_states', 'schema_migrations',
    ]) {
      expect(names).toContain(t);
    }
    const seq = await sql`select 1 as ok from pg_class where relkind = 'S' and relname = 'change_seq'`;
    expect(seq.length).toBe(1);
  });

  test('migrate is idempotent', async () => {
    const before = await sql`select name from schema_migrations order by name`;
    await migrate(sql);
    await migrate(sql);
    const after = await sql`select name from schema_migrations order by name`;
    expect(after).toEqual(before);
    expect(after.map((r: { name: string }) => r.name)).toEqual(['001_init.sql']);
  });

  test('concurrent migrations do not clash', async () => {
    const { sql: other, drop: dropOther } = await freshDb({ migrate: false });
    try {
      await Promise.all([migrate(other), migrate(other), migrate(other)]);
      const rows = await other`select name from schema_migrations`;
      expect(rows.length).toBe(1);
    } finally {
      await dropOther();
    }
  });

  test('role check and unique member email are enforced', async () => {
    const [u] = await sql`insert into users (id, email) values (gen_random_uuid(), 'a@b.test') returning id`;
    const [w] = await sql`
      insert into workspaces (id, name, owner_id, sort_key, created_at, updated_at, version)
      values (gen_random_uuid(), 'W', ${u.id}, 'a0', now(), now(), nextval('change_seq')) returning id`;
    const member = (role: string) => sql`
      insert into workspace_members (id, workspace_id, email, role, created_at, updated_at, version)
      values (gen_random_uuid(), ${w.id}, 'm@b.test', ${role}, now(), now(), nextval('change_seq'))`;
    await expect(member('boss')).rejects.toThrow();
    await member('viewer');
    await expect(member('editor')).rejects.toThrow();
  });
});
