import { LOCAL_USER } from '../data/db';
import { sha256Hex } from './sha256';

export type Account = { serverUrl: string; userId: string; email: string; displayName: string; token: string; partition: string };

/** `chrome.storage.local` key of the signed-in account. */
export const ACCOUNT_KEY = 'account';
const KEY = ACCOUNT_KEY;
export const LOCAL_PARTITION = 'local';

export async function getAccount(): Promise<Account | null> {
  return ((await chrome.storage.local.get(KEY))[KEY] as Account | undefined) ?? null;
}

export async function setAccount(account: Account): Promise<void> {
  await chrome.storage.local.set({ [KEY]: account });
}

export async function clearAccount(): Promise<void> {
  await chrome.storage.local.remove(KEY);
}

export function partitionFor(serverUrl: string, userId: string): string {
  return `acct-${sha256Hex(`${serverUrl}|${userId}`).slice(0, 16)}`;
}

// The signed-in user id, kept in memory so the repo can stamp rows synchronously.
// Pages and the worker set it when they open the active partition.
let activeUserId: string = LOCAL_USER;
export const currentUserId = (): string => activeUserId;
export const setCurrentUserId = (id: string | null | undefined): void => { activeUserId = id ?? LOCAL_USER; };
