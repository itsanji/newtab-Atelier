import { useCallback, useEffect, useState } from 'react';

/** How the board lays out a workspace: side-by-side columns, or the masonry list that scrolls down. */
export type BoardView = 'columns' | 'list';
/** Fixed width of every category, in both views: a preset, or `custom` (a width the user picks). */
export type CategorySize = 's' | 'm' | 'l' | 'custom';
export const CATEGORY_WIDTH: Record<Exclude<CategorySize, 'custom'>, number> = { s: 260, m: 300, l: 380 };
/** The narrowest a custom width goes (S); the widest is the board's own width. */
export const MIN_CATEGORY_WIDTH = CATEGORY_WIDTH.s;

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
const SIZES = ['s', 'm', 'l', 'custom'] as const;

export const useBoardView = () => useLocalChoice<BoardView>('atelier.boardView', VIEWS, 'columns');
export const useCategorySize = () => useLocalChoice<CategorySize>('atelier.categorySize', SIZES, 'm');

const WIDTH_KEY = 'atelier.categoryWidth';
const readWidth = (): number => {
  try {
    const n = Number(localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(n) && n >= MIN_CATEGORY_WIDTH ? Math.round(n) : 400;
  } catch {
    return 400;
  }
};

/** The custom category width in px, remembered on this device. */
export function useCustomCategoryWidth(): [number, (px: number) => void] {
  const [width, setWidth] = useState(readWidth);
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === WIDTH_KEY) setWidth(readWidth()); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  const set = useCallback((px: number) => {
    const next = Math.max(MIN_CATEGORY_WIDTH, Math.round(px));
    setWidth(next);
    try { localStorage.setItem(WIDTH_KEY, String(next)); } catch { /* storage blocked */ }
  }, []);
  return [width, set];
}
