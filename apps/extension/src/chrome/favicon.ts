import { useSyncExternalStore } from 'react';

/*
 * Chrome's `_favicon` endpoint answers with a grey globe for a page it has no icon for yet, and the page then
 * keeps that globe in its image cache under the same address, even after Chrome learns the real icon (the
 * moment the site is opened in a tab). So every address carries a version: a fresh one per page load, and a
 * new one whenever a tab reports a new icon, which makes the next render ask Chrome again.
 */
let version = Date.now().toString(36);
let watched: unknown = null;
const listeners = new Set<() => void>();

function watchTabs() {
  const event = globalThis.chrome?.tabs?.onUpdated;
  if (!event || event === watched) return;
  watched = event;
  event.addListener((_id, change) => {
    if (change.favIconUrl === undefined) return;
    version = (Date.now() + Math.random()).toString(36).replace('.', '');
    for (const fn of listeners) fn();
  });
}

export function faviconUrl(pageUrl: string, size = 32): string {
  watchTabs();
  return chrome.runtime.getURL('/_favicon/') + '?pageUrl=' + encodeURIComponent(pageUrl) + '&size=' + size + '&v=' + version;
}

/** Re-renders the caller when the favicon version changes; call it in any component that shows favicons. */
export function useFaviconVersion(): string {
  watchTabs();
  return useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    () => version,
  );
}
