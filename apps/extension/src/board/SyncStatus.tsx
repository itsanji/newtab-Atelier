import { useEffect, useState } from 'react';
import { useAccount } from '../account/useAccount';
import { getSyncStatus, STATUS_KEY, type SyncStatus as Status } from '../sync/status';

/** Board code listens for this to open the account dialog. */
export const OPEN_ACCOUNT_EVENT = 'atelier:open-account';

export function useSyncStatus(partition: string | undefined): Status | null {
  const [status, setStatus] = useState<Status | null>(null);
  useEffect(() => {
    let live = true;
    void getSyncStatus().then((s) => live && setStatus(s)).catch(() => undefined);
    const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area === 'session' && STATUS_KEY in changes) setStatus((changes[STATUS_KEY]!.newValue as Status | undefined) ?? null);
    };
    chrome.storage.onChanged.addListener(onChanged as never);
    return () => {
      live = false;
      chrome.storage.onChanged.removeListener(onChanged as never);
    };
  }, []);
  return status && status.partition === partition ? status : null;
}

const retry = () => void Promise.resolve(chrome.runtime.sendMessage({ type: 'sync-now' })).catch(() => undefined);

/** Pure view, so each state can be rendered directly. */
export function SyncStatusLine({ state, onSignIn, onRetry }: { state: Status['state']; onSignIn(): void; onRetry(): void }) {
  return (
    <div className="atl-sync" role="status">
      {state === 'idle' && 'Synced'}
      {state === 'syncing' && 'Syncing…'}
      {state === 'offline' && 'Offline'}
      {state === 'paused' && (
        <button type="button" className="atl-textlink" onClick={onSignIn}>Sync paused — sign in again</button>
      )}
      {state === 'error' && (
        <>
          Sync failed
          <button type="button" className="atl-textlink" onClick={onRetry}>Retry</button>
        </>
      )}
    </div>
  );
}

/** Sidebar footer line; only shown with an account. */
export function SyncStatus() {
  const account = useAccount();
  const status = useSyncStatus(account?.partition);
  if (!account) return null;
  return (
    <SyncStatusLine
      state={status?.state ?? 'idle'}
      onSignIn={() => window.dispatchEvent(new CustomEvent(OPEN_ACCOUNT_EVENT))}
      onRetry={retry}
    />
  );
}
