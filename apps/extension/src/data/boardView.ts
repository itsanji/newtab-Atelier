import { useCallback, useEffect, useState } from 'react';

/** How the board lays out a workspace: side-by-side columns, or the masonry list that scrolls down. */
export type BoardView = 'columns' | 'list';
/** Fixed width of every category, in both views. */
export type CategorySize = 's' | 'm' | 'l';
export const CATEGORY_WIDTH: Record<CategorySize, number> = { s: 260, m: 300, l: 380 };

/**
 * A layout choice remembered on this device (not synced). Read synchronously so the first paint is already
 * right; other open new tabs follow along through the `storage` event.
 */
function useLocalChoice<T extends string>(key: string, allowed: readonly T[], fallback: T): [T, (next: T) => void] {
  const read = useCallback((): T => {
    try {
      const v = localStorage.getItem(key);
      return allowed.includes(v as T) ? (v as T) : fallback;
    } catch {
      return fallback;
    }
  }, [key, allowed, fallback]);
  const [value, setValue] = useState<T>(read);
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === key) setValue(read()); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [key, read]);
  const set = useCallback((next: T) => {
    setValue(next);
    try { localStorage.setItem(key, next); } catch { /* storage blocked: this page still switches */ }
  }, [key]);
  return [value, set];
}

const VIEWS = ['columns', 'list'] as const;
const SIZES = ['s', 'm', 'l'] as const;

export const useBoardView = () => useLocalChoice<BoardView>('atelier.boardView', VIEWS, 'columns');
export const useCategorySize = () => useLocalChoice<CategorySize>('atelier.categorySize', SIZES, 'm');
