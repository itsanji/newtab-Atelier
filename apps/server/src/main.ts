import { createApp } from './app';
import { ConfigError, loadConfig } from './config';
import { connect, migrate } from './db';
import { smtpTransport, type MailTransport } from './mail';

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

const mail: MailTransport | null = config.smtp ? smtpTransport(config.smtp.url, config.smtp.from) : null;

const { app, websocket } = createApp({ sql, config, mail });
const server = Bun.serve({ port: config.port, fetch: app.fetch, websocket });
console.log(`Atelier server listening on ${server.url}`);
