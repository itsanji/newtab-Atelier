import { Hono } from 'hono';
import { upgradeWebSocket } from 'hono/bun';
import type { SQL } from 'bun';
import type { Hub } from './hub';
import { userForToken } from '../auth/sessions';

const AUTH_TIMEOUT_MS = 10_000;
const PING_MS = 30_000;
const UNAUTHORIZED = 4401;

/** `GET /api/live`: the first message must be `{"type":"auth","token":"..."}`; then the socket receives `changed` nudges. */
export function liveRoutes(sql: SQL, secret: string, now: () => Date, hub: Hub): Hono {
  const routes = new Hono();
  routes.get(
    '/',
    upgradeWebSocket(() => {
      let authed = false;
      let busy = false;
      let unsubscribe: (() => void) | null = null;
      let ping: ReturnType<typeof setInterval> | null = null;
      let timeout: ReturnType<typeof setTimeout> | null = null;
      const cleanup = () => {
        unsubscribe?.();
        unsubscribe = null;
        if (ping) clearInterval(ping);
        if (timeout) clearTimeout(timeout);
        ping = timeout = null;
      };
      return {
        onOpen(_event, ws) {
          timeout = setTimeout(() => ws.close(UNAUTHORIZED, 'Not signed in'), AUTH_TIMEOUT_MS);
        },
        async onMessage(event, ws) {
          if (authed || busy) return;
          busy = true;
          let token: unknown;
          try {
            const msg = JSON.parse(String(event.data));
            if (msg?.type === 'auth') token = msg.token;
          } catch {
            // falls through to the rejection below
          }
          const user = typeof token === 'string' ? await userForToken(sql, secret, token, now()) : null;
          if (!user) {
            ws.close(UNAUTHORIZED, 'Not signed in');
            return;
          }
          if (ws.readyState !== 1) return;
          authed = true;
          if (timeout) clearTimeout(timeout);
          timeout = null;
          unsubscribe = hub.subscribe(user.id, ws);
          ping = setInterval(() => ws.send(JSON.stringify({ type: 'ping' })), PING_MS);
          ws.send(JSON.stringify({ type: 'ready' }));
        },
        onClose: cleanup,
        onError: cleanup,
      };
    }),
  );
  return routes;
}
