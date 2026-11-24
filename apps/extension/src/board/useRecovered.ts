import { useEffect } from 'react';
import { useAccount } from '../account/account';
import { RECOVERED_KEY, recoveredNotice, takeRecovered } from '../sync/status';
import { useNotify } from './Notice';

/** Tell the user once when sync moved rejected items to "Recovered". Needs a NoticeProvider. */
export function useRecoveredNotice(): void {
  const notify = useNotify();
  const partition = useAccount()?.partition;
  useEffect(() => {
    if (!partition) return;
    let live = true;
    const check = () => void takeRecovered(partition).then((n) => { if (live && n > 0) notify(recoveredNotice(n)); }).catch(() => undefined);
    check();
    const onChanged = (changes: Record<string, unknown>, area: string) => {
      if (area === 'session' && RECOVERED_KEY in changes) check();
    };
    chrome.storage.onChanged.addListener(onChanged as never);
    return () => { live = false; chrome.storage.onChanged.removeListener(onChanged as never); };
  }, [partition, notify]);
}
