import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { LastWorkspaceError } from '../data/repo';

const NotifyCtx = createContext<(message: string) => void>(() => {});

/** Renders children plus a polite live region that announces short notices. */
export function NoticeProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState('');
  return (
    <NotifyCtx.Provider value={setMessage}>
      {children}
      <div role="status" aria-live="polite" className="atl-notice" hidden={!message} onClick={() => setMessage('')}>
        {message}
      </div>
    </NotifyCtx.Provider>
  );
}

// Dexie re-wraps errors thrown inside a transaction by name, so `instanceof NotFoundError` is unreliable.
const isNotFound = (e: unknown) => e instanceof Error && (e.name === 'NotFoundError' || (e as { inner?: Error }).inner?.name === 'NotFoundError');

export const useNotify = () => useContext(NotifyCtx);

/**
 * Returns `run(promise)`: awaits a repository call, turns failures into a notice
 * (and console.error for unexpected ones), and resolves to whether it succeeded.
 */
export function useRun() {
  const notify = useNotify();
  return useCallback(
    async (action: Promise<unknown>): Promise<boolean> => {
      try {
        await action;
        return true;
      } catch (e) {
        if (isNotFound(e)) notify('That item was removed in another tab');
        else if (e instanceof LastWorkspaceError) notify(e.message);
        else {
          console.error(e);
          notify('Something went wrong. Try again.');
        }
        return false;
      }
    },
    [notify],
  );
}
