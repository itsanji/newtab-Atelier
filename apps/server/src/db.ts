import { SQL } from 'bun';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(import.meta.dir, '..', 'migrations');
const MIGRATION_LOCK = 424242;

export function connect(url: string): SQL {
  return new SQL(url);
}

/** Applies pending `migrations/*.sql` in filename order. Safe to run concurrently and repeatedly. */
export async function migrate(sql: SQL, dir: string = MIGRATIONS_DIR): Promise<void> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(${MIGRATION_LOCK})`;
    await tx`create table if not exists schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )`;
    const done = new Set((await tx`select name from schema_migrations`).map((r: { name: string }) => r.name));
    for (const name of files) {
      if (done.has(name)) continue;
      await tx.unsafe(await Bun.file(join(dir, name)).text());
      await tx`insert into schema_migrations (name) values (${name})`;
    }
  });
}
