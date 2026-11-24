import { useEffect, useState } from 'react';
import { LOCAL_USER } from '../data/db';
import { sha256Hex } from './sha256';

export type Account = { serverUrl: string; userId: string; email: string; displayName: string; token: string; partition: string };

const KEY = 'account';
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

/** The active account: undefined while loading, null when signed out. Live on storage changes. */
export function useAccount(): Account | null | undefined {
  const [account, setLocal] = useState<Account | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void getAccount().then((a) => live && setLocal(a));
    const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area === 'local' && KEY in changes) setLocal((changes[KEY]!.newValue as Account | undefined) ?? null);
    };
    chrome.storage.onChanged.addListener(onChanged as never);
    return () => { live = false; chrome.storage.onChanged.removeListener(onChanged as never); };
  }, []);
  return account;
}
