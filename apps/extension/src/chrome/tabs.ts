import type { Category, Item } from '@atelier/core';
import type { AtelierDB } from '../data/db';
import { liveCategories, liveItems } from '../data/queries';
import { createCategory, createItem, moveCategory, tx } from '../data/repo';
import { faviconUrl } from './favicon';

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

export function saveTab(
  db: AtelierDB, tab: chrome.tabs.Tab, target: { categoryId: string; position?: 'start' | 'end' },
): Promise<Item> {
  const url = tab.url ?? '';
  return createItem(db, {
    categoryId: target.categoryId, kind: 'link', title: tab.title || url, url,
    faviconUrl: faviconUrl(url), position: target.position,
  });
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const two = (n: number) => String(n).padStart(2, '0');

/** "Saved 24 Nov, 09:05" in local time, independent of the browser locale. */
export function savedLabel(now: Date): string {
  return `Saved ${now.getDate()} ${MONTHS[now.getMonth()]}, ${two(now.getHours())}:${two(now.getMinutes())}`;
}

export async function saveAllAndClose(
  db: AtelierDB, workspaceId: string, windowId?: number, now: Date = new Date(),
): Promise<{ categories: Category[]; saved: number }> {
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

  const categories = await tx(db, async () => {
    const first = (await liveCategories(db, workspaceId))[0];
    const made: Category[] = [];
    for (const p of plan) {
      const c = await createCategory(db, { workspaceId, name: p.name, tabGroup: p.tabGroup });
      made.push(first ? await moveCategory(db, c.id, made.at(-1)?.id ?? null, first.id) : c);
      for (const t of p.tabs) await saveTab(db, t, { categoryId: c.id });
    }
    return made;
  });

  // Close only after the save committed.
  await chrome.tabs.remove(tabs.map((t) => t.id!));
  return { categories, saved: tabs.length };
}

export async function openAll(db: AtelierDB, categoryId: string): Promise<void> {
  const category = await db.categories.get(categoryId);
  if (!category || category.deletedAt !== null) return;
  const links = (await liveItems(db, categoryId)).filter((i) => i.url);
  const opened: number[] = [];
  for (const [n, item] of links.entries()) {
    const tab = await chrome.tabs.create({ url: item.url!, active: n === 0 });
    if (tab.id !== undefined) opened.push(tab.id);
  }
  if (category.tabGroup && opened.length) {
    const groupId = (await chrome.tabs.group({ tabIds: opened as [number, ...number[]] })) as unknown as number;
    await chrome.tabGroups.update(groupId, { title: category.tabGroup.title, color: category.tabGroup.color });
  }
}
