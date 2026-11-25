import { useEffect } from 'react';
import { useAccount } from '../account/useAccount';
import { RECOVERED_KEY, recoveredNotice, takeRecovered, takeUnsyncable, UNSYNCABLE_NOTICE_KEY, unsyncableNotice } from '../sync/status';
import { useNotify } from './Notice';

/**
 * Tell the user once when sync moved rejected items to "Recovered", or found a row too large to sync.
 * Needs a NoticeProvider.
 */
export function useRecoveredNotice(): void {
  const notify = useNotify();
  const partition = useAccount()?.partition;
  useEffect(() => {
    if (!partition) return;
    let live = true;
    const check = () => void takeRecovered(partition).then((n) => { if (live && n > 0) notify(recoveredNotice(n)); }).catch(() => undefined);
    const checkTooLarge = () =>
      void takeUnsyncable(partition).then((t) => { if (live && t.length) notify(unsyncableNotice(t)); }).catch(() => undefined);
    check();
    checkTooLarge();
    const onChanged = (changes: Record<string, unknown>, area: string) => {
      if (area !== 'session') return;
      if (RECOVERED_KEY in changes) check();
      if (UNSYNCABLE_NOTICE_KEY in changes) checkTooLarge();
    };
    chrome.storage.onChanged.addListener(onChanged as never);
    return () => { live = false; chrome.storage.onChanged.removeListener(onChanged as never); };
  }, [partition, notify]);
}
