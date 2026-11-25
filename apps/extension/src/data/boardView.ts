import { useCallback, useEffect, useState } from 'react';

/** How the board lays out a workspace: side-by-side columns, or the packed, vertically scrolling list. */
export type BoardView = 'columns' | 'list';

const KEY = 'atelier.boardView';

function read(): BoardView {
  try {
    return localStorage.getItem(KEY) === 'list' ? 'list' : 'columns';
  } catch {
    return 'columns';
  }
}

/**
 * The board view, remembered on this device (not synced). Read synchronously so the first paint is
 * already right; other open new tabs follow along through the `storage` event.
 */
export function useBoardView(): [BoardView, (view: BoardView) => void] {
  const [view, setView] = useState<BoardView>(read);
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === KEY) setView(read()); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  const set = useCallback((next: BoardView) => {
    setView(next);
    try { localStorage.setItem(KEY, next); } catch { /* storage blocked: this page still switches */ }
  }, []);
  return [view, set];
}
