import { Hono } from 'hono';
import type { SQL } from 'bun';
import type { Config } from './config';
import type { MailTransport } from './mail';
import { createHub, type Hub } from './live/hub';
import { authRoutes } from './auth/routes';

export interface Deps {
  sql: SQL;
  config: Config;
  /** Null when SMTP is not configured. */
  mail: MailTransport | null;
  now?: () => Date;
}

export function createApp(deps: Deps): { app: Hono; websocket: unknown; hub: Hub } {
  const { config } = deps;
  const hub = createHub();
  const app = new Hono();
  const now = deps.now ?? (() => new Date());

  app.get('/health', (c) => c.text('ok'));

  app.get('/api/config', (c) =>
    c.json({
      name: 'Atelier',
      auth: { password: true, magicLink: config.smtp !== null, google: config.google !== null },
    }),
  );

  app.route('/api/auth', authRoutes(deps.sql, config, now));

  app.notFound((c) => (c.req.path.startsWith('/api/') ? c.json({ error: 'Not found' }, 404) : c.text('Not found', 404)));
  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: 'Something went wrong' }, 500);
  });

  return { app, websocket: undefined, hub };
}
