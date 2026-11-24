import { createApp } from './app';
import { ConfigError, loadConfig } from './config';
import { connect, migrate } from './db';
import type { MailTransport } from './mail';

let config;
try {
  config = loadConfig(process.env);
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(`Configuration error: ${err.message}`);
    process.exit(1);
  }
  throw err;
}

const sql = connect(config.databaseUrl);
await migrate(sql);

// SMTP transport arrives with the sign-in task; until then mail stays off.
const mail: MailTransport | null = null;

const { app } = createApp({ sql, config, mail });
const server = Bun.serve({ port: config.port, fetch: app.fetch });
console.log(`Atelier server listening on ${server.url}`);
