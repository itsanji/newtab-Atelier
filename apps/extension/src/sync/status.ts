/** Sync status for the active partition, shared between the worker and pages via `chrome.storage.session`. */
export type SyncState = 'idle' | 'syncing' | 'offline' | 'paused' | 'error';

export interface SyncStatus {
  partition: string;
  state: SyncState;
  at: string;
  message?: string;
}

export const STATUS_KEY = 'syncStatus';
export const RECOVERED_KEY = 'syncRecovered';

// `chrome.storage.session` is missing outside the extension (and in some tests): status is then not shared.
const area = (): chrome.storage.StorageArea | undefined =>
  (globalThis as { chrome?: typeof chrome }).chrome?.storage?.session;

export async function setSyncStatus(partition: string, state: SyncState, message?: string): Promise<void> {
  const status: SyncStatus = { partition, state, at: new Date().toISOString(), ...(message ? { message } : {}) };
  await area()?.set({ [STATUS_KEY]: status });
}

export async function getSyncStatus(): Promise<SyncStatus | null> {
  const s = area();
  if (!s) return null;
  return ((await s.get(STATUS_KEY))[STATUS_KEY] as SyncStatus | undefined) ?? null;
}

/** Add to the count of items moved to "Recovered" that the board hasn't told the user about yet. */
export async function addRecovered(partition: string, count: number): Promise<void> {
  const s = area();
  if (!s || count <= 0) return;
  const cur = (await s.get(RECOVERED_KEY))[RECOVERED_KEY] as { partition: string; count: number } | undefined;
  const prev = cur?.partition === partition ? cur.count : 0;
  await s.set({ [RECOVERED_KEY]: { partition, count: prev + count } });
}

/** Read and reset the pending "Recovered" count for a partition. */
export async function takeRecovered(partition: string): Promise<number> {
  const s = area();
  if (!s) return 0;
  const cur = (await s.get(RECOVERED_KEY))[RECOVERED_KEY] as { partition: string; count: number } | undefined;
  if (!cur || cur.partition !== partition) return 0;
  await s.remove(RECOVERED_KEY);
  return cur.count;
}

export const recoveredNotice = (count: number): string =>
  `${count} ${count === 1 ? "item couldn't" : "items couldn't"} sync and ${count === 1 ? 'was' : 'were'} saved to Recovered`;
