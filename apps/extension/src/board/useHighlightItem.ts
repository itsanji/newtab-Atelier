import { useCallback, useEffect, useRef } from 'react';

export const HIGHLIGHT_CLASS = 'atl-highlight';
export const HIGHLIGHT_MS = 2000;

/**
 * Returns `highlight(itemId)`: scrolls the item's row into view and marks it for 2 s.
 * Retries briefly because the row may still be mounting (e.g. after a workspace switch).
 * Pending timers are cleared on unmount.
 */
export function useHighlightItem() {
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const cleanups = useRef(new Set<() => void>());
  useEffect(() => {
    const t = timers.current;
    const c = cleanups.current;
    return () => {
      t.forEach(clearTimeout);
      t.clear();
      c.forEach((fn) => fn());
      c.clear();
    };
  }, []);

  return useCallback((itemId: string) => {
    let tries = 0;
    const later = (fn: () => void, ms: number) => {
      const id = setTimeout(() => { timers.current.delete(id); fn(); }, ms);
      timers.current.add(id);
    };
    const attempt = () => {
      const el = document.querySelector<HTMLElement>(`[data-item-id="${CSS.escape(itemId)}"]`);
      if (!el) {
        if (++tries < 20) later(attempt, 50);
        return;
      }
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView?.({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
      el.classList.add(HIGHLIGHT_CLASS);
      const remove = () => el.classList.remove(HIGHLIGHT_CLASS);
      cleanups.current.add(remove);
      later(() => { remove(); cleanups.current.delete(remove); }, HIGHLIGHT_MS);
    };
    attempt();
  }, []);
}
