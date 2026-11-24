import { useCallback, useEffect, useState } from 'react';

export type ThemePref = 'giverny' | 'nocturne' | 'system';
export type ResolvedTheme = 'giverny' | 'nocturne';

const KEY = 'theme';
export const THEME_CACHE_KEY = 'atelier-theme';
const ORDER: ThemePref[] = ['giverny', 'nocturne', 'system'];
const isPref = (v: unknown): v is ThemePref => v === 'giverny' || v === 'nocturne' || v === 'system';

export async function getTheme(): Promise<ThemePref> {
  const v = (await chrome.storage.local.get(KEY))[KEY];
  return isPref(v) ? v : 'system';
}

export async function setTheme(pref: ThemePref): Promise<void> {
  await chrome.storage.local.set({ [KEY]: pref });
}

export const resolveTheme = (pref: ThemePref, prefersDark: boolean): ResolvedTheme =>
  pref === 'system' ? (prefersDark ? 'nocturne' : 'giverny') : pref;

function applyClass(theme: ResolvedTheme) {
  const root = document.documentElement;
  root.classList.remove(theme === 'giverny' ? 'nocturne' : 'giverny');
  root.classList.add(theme);
}

/** Apply the last resolved theme synchronously, before React renders, to avoid a flash. */
export function applyCachedTheme() {
  try {
    const cached = localStorage.getItem(THEME_CACHE_KEY);
    if (cached === 'giverny' || cached === 'nocturne') applyClass(cached);
  } catch { /* storage unavailable */ }
}

const darkQuery = () => (typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null);

export function useTheme() {
  const [pref, setPref] = useState<ThemePref>('system');
  const [dark, setDark] = useState(() => darkQuery()?.matches ?? false);

  useEffect(() => {
    let live = true;
    void getTheme().then((p) => live && setPref(p));
    const onChanged = (changes: Record<string, unknown>, area: string) => {
      const next = (changes[KEY] as { newValue?: unknown } | undefined)?.newValue;
      if (area === 'local' && isPref(next)) setPref(next);
    };
    chrome.storage.onChanged.addListener(onChanged as never);
    return () => { live = false; chrome.storage.onChanged.removeListener(onChanged as never); };
  }, []);

  useEffect(() => {
    const mql = darkQuery();
    if (!mql) return;
    const onChange = () => setDark(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  const resolved = resolveTheme(pref, dark);
  useEffect(() => {
    applyClass(resolved);
    try { localStorage.setItem(THEME_CACHE_KEY, resolved); } catch { /* ignore */ }
  }, [resolved]);

  const cycle = useCallback(() => setTheme(ORDER[(ORDER.indexOf(pref) + 1) % ORDER.length]!), [pref]);
  return { pref, resolved, cycle };
}
