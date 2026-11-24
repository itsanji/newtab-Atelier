import { SQL } from 'bun';
import type { Hono } from 'hono';
import { createApp } from '../src/app';
import type { Config } from '../src/config';
import { connect, migrate } from '../src/db';
import type { Hub } from '../src/live/hub';
import { memoryTransport, type MailTransport } from '../src/mail';

const ADMIN_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:54329/postgres';

/** A brand-new migrated database, dropped by `drop()`. */
export async function freshDb(opts: { migrate?: boolean } = {}): Promise<{ sql: SQL; url: string; drop(): Promise<void> }> {
  const name = `atelier_test_${crypto.randomUUID().replace(/-/g, '')}`;
  const admin = new SQL(ADMIN_URL);
  await admin.unsafe(`create database ${name}`);
  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  const sql = connect(url.toString());
  if (opts.migrate !== false) await migrate(sql);
  return {
    sql,
    url: url.toString(),
    async drop() {
      await sql.close();
      await admin.unsafe(`drop database if exists ${name} with (force)`);
      await admin.close();
    },
  };
}

export const testConfig = (overrides: Partial<Config> = {}): Config => ({
  publicUrl: 'http://localhost:8787',
  databaseUrl: 'postgres://unused',
  sessionSecret: 'test-secret-test-secret-test-secret!',
  port: 0,
  smtp: null,
  google: null,
  ...overrides,
});

export interface TestApp {
  app: Hono;
  sql: SQL;
  mail: ReturnType<typeof memoryTransport>;
  hub: Hub;
  close(): Promise<void>;
}

export async function makeApp(
  overrides: { config?: Partial<Config>; now?: () => Date; mail?: MailTransport | null; hub?: Hub } = {},
): Promise<TestApp> {
  const db = await freshDb();
  const mail = memoryTransport();
  const { app, hub } = createApp({
    sql: db.sql,
    config: testConfig({ databaseUrl: db.url, ...overrides.config }),
    mail: overrides.mail === undefined ? mail : overrides.mail,
    ...(overrides.now ? { now: overrides.now } : {}),
    ...(overrides.hub ? { hub: overrides.hub } : {}),
  });
  return { app, sql: db.sql, mail, hub, close: db.drop };
}

/** Signs up through the API and returns the bearer token and user. */
export async function signUp(
  app: Hono,
  email: string,
  password = 'correct horse battery',
): Promise<{ token: string; user: { id: string; email: string; displayName: string } }> {
  const res = await app.request('/api/auth/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (res.status !== 201) throw new Error(`signUp failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as { token: string; user: { id: string; email: string; displayName: string } };
}

export const bearer = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` });
