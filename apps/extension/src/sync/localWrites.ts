import { onLocalWrite } from '../data/repo';

/** Ask the worker to sync now (no debounce). Safe when nobody listens. */
export function syncNow(): void {
  void Promise.resolve(chrome.runtime.sendMessage({ type: 'sync-now' })).catch(() => undefined);
}

/** Pages: after local edits settle for `delayMs`, ask the worker to sync. Returns a stop function. */
export function requestSyncOnLocalWrite(delayMs = 1000): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const off = onLocalWrite(() => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      // No worker listening (or no account) is fine: the next alarm syncs anyway.
      syncNow();
    }, delayMs);
  });
  return () => {
    clearTimeout(timer);
    off();
  };
}
