import { useEffect, useState } from 'react';
import { ACCOUNT_KEY as KEY, getAccount, type Account } from './account';

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
