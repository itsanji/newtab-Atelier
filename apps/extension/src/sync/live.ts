import { useEffect } from 'react';
import type { Account } from '../account/account';
import { ApiClient } from './api';
import { setSyncStatus } from './status';

export const BACKOFF_START_MS = 1000;
export const BACKOFF_MAX_MS = 30_000;
export const UNAUTHORIZED_CLOSE = 4401;

const syncNow = () => void Promise.resolve(chrome.runtime.sendMessage({ type: 'sync-now' })).catch(() => undefined);

/**
 * Hold the live WebSocket for a signed-in board page: `changed` triggers a sync. Reconnects with
 * backoff (1 s doubling to 30 s); a 4401 close marks sync paused and stops. Closed on unmount.
 */
export function useLiveSync(account: Account | null | undefined): void {
  const token = account?.token;
  const serverUrl = account?.serverUrl;
  const partition = account?.partition;
  useEffect(() => {
    if (!token || !serverUrl || !partition) return;
    let url: string;
    try {
      url = new ApiClient(serverUrl, token).liveUrl();
    } catch {
      return;
    }
    let stopped = false;
    let socket: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = BACKOFF_START_MS;

    const connect = () => {
      clearTimeout(timer);
      if (stopped) return;
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch {
        retry();
        return;
      }
      socket = ws;
      ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token }));
      ws.onmessage = (ev) => {
        let msg: { type?: string } | null = null;
        try {
          msg = JSON.parse(String(ev.data)) as { type?: string };
        } catch {
          return;
        }
        if (msg?.type === 'ready') delay = BACKOFF_START_MS;
        else if (msg?.type === 'changed') syncNow();
      };
      ws.onclose = (ev) => {
        if (socket === ws) socket = null;
        if (stopped) return;
        if (ev.code === UNAUTHORIZED_CLOSE) {
          void setSyncStatus(partition, 'paused').catch(() => undefined);
          return;
        }
        retry();
      };
      ws.onerror = () => undefined;
    };
    const retry = () => {
      clearTimeout(timer);
      timer = setTimeout(connect, delay);
      delay = Math.min(delay * 2, BACKOFF_MAX_MS);
    };
    const onOnline = () => {
      syncNow();
      if (!socket) {
        delay = BACKOFF_START_MS;
        connect();
      }
    };

    syncNow();
    connect();
    window.addEventListener('online', onOnline);
    return () => {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener('online', onOnline);
      const ws = socket;
      socket = null;
      if (ws) {
        ws.onclose = ws.onmessage = ws.onopen = ws.onerror = null;
        ws.close();
      }
    };
  }, [token, serverUrl, partition]);
}
