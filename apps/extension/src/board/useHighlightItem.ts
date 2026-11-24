import { useCallback } from 'react';

export const HIGHLIGHT_CLASS = 'atl-highlight';
export const HIGHLIGHT_MS = 2000;

/**
 * Returns `highlight(itemId)`: scrolls the item's row into view and marks it for 2 s.
 * Retries briefly because the row may still be mounting (e.g. after a workspace switch).
 */
export function useHighlightItem() {
  return useCallback((itemId: string) => {
    let tries = 0;
    const attempt = () => {
      const el = document.querySelector<HTMLElement>(`[data-item-id="${CSS.escape(itemId)}"]`);
      if (!el) {
        if (++tries < 20) setTimeout(attempt, 50);
        return;
      }
      el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
      el.classList.add(HIGHLIGHT_CLASS);
      setTimeout(() => el.classList.remove(HIGHLIGHT_CLASS), HIGHLIGHT_MS);
    };
    attempt();
  }, []);
}
