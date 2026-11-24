import { isLinkUrl, type Category, type Item } from '@atelier/core';
import type { AtelierDB } from '../data/db';
import { liveItems } from '../data/queries';
import { createCategory, createItem, tx } from '../data/repo';

const OWN_PAGES = ['chrome://newtab/', 'edge://newtab/', 'about:newtab', 'about:blank', 'chrome-extension://'];

/** True for tabs worth keeping: not pinned, not a new tab page, not an extension page. */
export function isSavableTab(tab: chrome.tabs.Tab): boolean {
  const url = tab.url;
  if (!url || tab.pinned) return false;
  if (OWN_PAGES.some((p) => url.startsWith(p))) return false;
  return !url.startsWith(chrome.runtime.getURL(''));
}

/** Savable tabs in the current window (or the given one), in tab order. */
export async function listWindowTabs(windowId?: number): Promise<chrome.tabs.Tab[]> {
  const tabs = await chrome.tabs.query(windowId === undefined ? { currentWindow: true } : { windowId });
  return tabs.filter(isSavableTab).sort((a, b) => a.index - b.index);
}

/**
 * Saves a tab as a link item in one transaction. With `beforeId`/`afterId` it lands between those
 * neighbours; otherwise at `position` (default end). The favicon is derived from the url when shown.
 */
export function saveTab(
  db: AtelierDB, tab: chrome.tabs.Tab,
  target: { categoryId: string; position?: 'start' | 'end'; beforeId?: string | null; afterId?: string | null },
): Promise<Item> {
  const url = tab.url ?? '';
  return createItem(db, {
    categoryId: target.categoryId, kind: 'link', title: tab.title || url, url,
    faviconUrl: null, position: target.position, beforeId: target.beforeId, afterId: target.afterId,
  });
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const two = (n: number) => String(n).padStart(2, '0');

/** "Saved 24 Nov, 09:05" in local time, independent of the browser locale. */
export function savedLabel(now: Date): string {
  return `Saved ${now.getDate()} ${MONTHS[now.getMonth()]}, ${two(now.getHours())}:${two(now.getMinutes())}`;
}

/**
 * Saves every savable tab in the window: each tab group becomes its own category, loose tabs go to
 * "Saved <d MMM, HH:mm>"; the new categories come first, in tab order. With `close`, the tabs are
 * closed once the save has committed.
 */
export async function saveAll(
  db: AtelierDB, workspaceId: string, opts: { windowId?: number; now?: Date; close: boolean },
): Promise<{ categories: Category[]; saved: number }> {
  const { windowId, now = new Date(), close } = opts;
  const tabs = await listWindowTabs(windowId);
  if (tabs.length === 0) return { categories: [], saved: 0 };

  const none = chrome.tabGroups.TAB_GROUP_ID_NONE;
  const grouped = new Map<number, chrome.tabs.Tab[]>();
  const loose: chrome.tabs.Tab[] = [];
  for (const t of tabs) {
    if (t.groupId === none || t.groupId === undefined) loose.push(t);
    else grouped.set(t.groupId, [...(grouped.get(t.groupId) ?? []), t]);
  }
  const plan: { name: string; tabGroup: Category['tabGroup']; tabs: chrome.tabs.Tab[] }[] = [];
  for (const [id, members] of grouped) {
    const g = await chrome.tabGroups.get(id);
    plan.push({ name: g.title || 'Tab group', tabGroup: { title: g.title ?? '', color: g.color }, tabs: members });
  }
  if (loose.length) plan.push({ name: savedLabel(now), tabGroup: null, tabs: loose });

  // Created last-to-first at the start, so each category is written once and they end up in plan order.
  const categories = await tx(db, async () => {
    const made: Category[] = [];
    for (const p of [...plan].reverse()) {
      const c = await createCategory(db, { workspaceId, name: p.name, tabGroup: p.tabGroup }, { position: 'start' });
      made.unshift(c);
      for (const t of p.tabs) await saveTab(db, t, { categoryId: c.id });
    }
    return made;
  });

  // Close only after the save committed.
  if (close) await chrome.tabs.remove(tabs.map((t) => t.id!));
  return { categories, saved: tabs.length };
}

export function saveAllAndClose(
  db: AtelierDB, workspaceId: string, windowId?: number, now: Date = new Date(),
): Promise<{ categories: Category[]; saved: number }> {
  return saveAll(db, workspaceId, { windowId, now, close: true });
}

export async function openAll(db: AtelierDB, categoryId: string): Promise<void> {
  const category = await db.categories.get(categoryId);
  if (!category || category.deletedAt !== null) return;
  const links = (await liveItems(db, categoryId)).filter((i) => i.url && isLinkUrl(i.url));
  const opened: number[] = [];
  // One tab that fails to open must not stop the rest, nor the regrouping.
  for (const item of links) {
    try {
      const tab = await chrome.tabs.create({ url: item.url!, active: opened.length === 0 });
      if (tab.id !== undefined) opened.push(tab.id);
    } catch (e) {
      console.error(e);
    }
  }
  if (category.tabGroup && opened.length) {
    const groupId = (await chrome.tabs.group({ tabIds: opened as [number, ...number[]] })) as unknown as number;
    await chrome.tabGroups.update(groupId, { title: category.tabGroup.title, color: category.tabGroup.color });
  }
}
