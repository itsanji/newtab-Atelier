import type { AtelierDB } from '../data/db';
import { createItem } from '../data/repo';
import { resolveTargetCategory } from '../data/target';
import { faviconUrl } from '../chrome/favicon';
import { isSavableTab, saveTab } from '../chrome/tabs';
import { notify } from './notify';

export async function createMenus(): Promise<void> {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({ id: 'save-page', title: 'Save page to Atelier', contexts: ['page'] });
  chrome.contextMenus.create({ id: 'save-link', title: 'Save link to Atelier', contexts: ['link'] });
}

export async function onMenuClicked(
  db: AtelierDB, info: { menuItemId: string | number; linkUrl?: string; selectionText?: string }, tab?: chrome.tabs.Tab,
): Promise<void> {
  if (info.menuItemId === 'save-page') {
    if (!tab || !isSavableTab(tab)) return notify("This page can't be saved");
    const category = await resolveTargetCategory(db);
    await saveTab(db, tab, { categoryId: category.id });
    return notify(`Saved to ${category.name}`);
  }
  if (info.menuItemId === 'save-link' && info.linkUrl) {
    const category = await resolveTargetCategory(db);
    await createItem(db, {
      categoryId: category.id, kind: 'link', title: info.selectionText?.trim() || info.linkUrl,
      url: info.linkUrl, faviconUrl: faviconUrl(info.linkUrl),
    });
    notify(`Saved to ${category.name}`);
  }
}
