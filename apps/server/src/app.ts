import { Hono } from 'hono';
import type { SQL } from 'bun';
import type { Config } from './config';
import type { MailTransport } from './mail';
import { createHub, type Hub } from './live/hub';
import { authRoutes } from './auth/routes';
import { syncRoutes } from './sync/routes';
import { memberRoutes } from './members/routes';
import { liveRoutes } from './live/routes';
import { shareApiRoutes, sharePublicRoutes } from './share/routes';
import { magicRoutes } from './auth/magic';
import { googleRoutes } from './auth/google';
import { websocket } from 'hono/bun';

export interface Deps {
  sql: SQL;
  config: Config;
  /** Null when SMTP is not configured. */
  mail: MailTransport | null;
  now?: () => Date;
  /** Live-change notifier; defaults to the app's own hub. */
  hub?: Hub;
}

export function createApp(deps: Deps): { app: Hono; websocket: typeof websocket; hub: Hub } {
  const { config } = deps;
  const hub = deps.hub ?? createHub();
  const app = new Hono();
  const now = deps.now ?? (() => new Date());

  app.get('/health', (c) => c.text('ok'));

  app.get('/api/config', (c) =>
    c.json({
      name: 'Atelier',
      signup: config.allowSignup,
      auth: { password: true, magicLink: config.smtp !== null, google: config.google !== null },
    }),
  );

  const magic = magicRoutes(deps.sql, config, now, deps.mail);
  const google = googleRoutes(deps.sql, config, now);
  app.route('/api/auth/magic', magic.api);
  app.route('/api/auth/google', google.api);
  app.route('/auth/magic', magic.pages);
  app.route('/auth/google', google.pages);
  app.route('/api/auth', authRoutes(deps.sql, config, now));
  app.route('/api/sync', syncRoutes(deps.sql, config, now, hub));
  app.route('/api/workspaces', memberRoutes(deps.sql, config, now, hub, deps.mail));
  app.route('/api/categories', shareApiRoutes(deps.sql, config, now, hub));
  app.route('/', sharePublicRoutes(deps.sql));
  app.route('/api/live', liveRoutes(deps.sql, config.sessionSecret, now, hub));

  app.notFound((c) => (c.req.path.startsWith('/api/') ? c.json({ error: 'Not found' }, 404) : c.text('Not found', 404)));
  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: 'Something went wrong' }, 500);
  });

  return { app, websocket, hub };
}
