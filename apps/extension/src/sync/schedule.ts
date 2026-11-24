import { getAccount } from '../account/account';
import { getActiveDb } from '../account/activeDb';
import { syncAlarms } from '../background/reminders';
import { onLocalWrite } from '../data/repo';
import { ApiClient } from './api';
import { syncOnce } from './engine';

export const SYNC_ALARM = 'sync';
export const SYNC_DEBOUNCE_MS = 1500;

const report = (e: unknown) => console.error(e);

/** Sync the active account once. No-op without an account. Never throws. */
export async function syncActive(): Promise<void> {
  try {
    const account = await getAccount();
    if (!account) return;
    const db = await getActiveDb();
    const result = await syncOnce(db, account, new ApiClient(account.serverUrl, account.token));
    if (result.remindersChanged) await syncAlarms(db);
  } catch (e) {
    report(e);
  }
}

const ensureAlarm = () => void Promise.resolve(chrome.alarms.create(SYNC_ALARM, { periodInMinutes: 1 })).catch(report);

/**
 * Worker wiring. Call synchronously at the top level of the service worker: it only registers listeners.
 * Sync runs on the `sync` alarm, on startup, on `{type:'sync-now'}` messages and shortly after the
 * worker's own local writes (e.g. a fired reminder).
 * Returns a function that stops the local-write subscription (tests).
 */
export function registerSync(debounceMs = SYNC_DEBOUNCE_MS): () => void {
  chrome.runtime.onInstalled.addListener(() => {
    ensureAlarm();
    void syncActive();
  });
  chrome.runtime.onStartup.addListener(() => {
    ensureAlarm();
    void syncActive();
  });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === SYNC_ALARM) void syncActive();
  });
  chrome.runtime.onMessage.addListener((message) => {
    if ((message as { type?: string } | null)?.type === 'sync-now') void syncActive();
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const off = onLocalWrite(() => {
    clearTimeout(timer);
    timer = setTimeout(() => void syncActive(), debounceMs);
  });
  return () => {
    clearTimeout(timer);
    off();
  };
}
