import type { AtelierDB } from '../data/db';
import { resolveTargetCategory } from '../data/target';
import { isSavableTab, saveTab } from '../chrome/tabs';
import { notify } from './notify';

export async function onCommand(db: AtelierDB, command: string): Promise<void> {
  if (command !== 'save-current-tab') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !isSavableTab(tab)) return notify("This page can't be saved");
  const category = await resolveTargetCategory(db);
  await saveTab(db, tab, { categoryId: category.id });
  notify(`Saved to ${category.name}`);
}
