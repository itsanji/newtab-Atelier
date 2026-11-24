import { beforeEach, describe, expect, test } from 'vitest';
import { installChromeFake, type ChromeFake } from '../../test/chromeFake';
import { openDb, type AtelierDB } from '../data/db';
import { getMeta, liveCategories, liveItems, liveWorkspaces, setMeta } from '../data/queries';
import { ensureSeed } from '../data/seed';
import { resolveTargetCategory } from '../data/target';
import { createMenus, onMenuClicked } from './contextMenus';
import { onCommand } from './commands';

let fake: ChromeFake;
let db: AtelierDB;
beforeEach(async () => {
  fake = installChromeFake();
  db = openDb('test-' + crypto.randomUUID());
  await ensureSeed(db);
});
const cats = async () => liveCategories(db, (await liveWorkspaces(db))[0]!.id);

describe('resolveTargetCategory', () => {
  test('falls back to the first category, honours lastCategoryId, seeds when empty', async () => {
    const [first, second] = await cats();
    expect((await resolveTargetCategory(db)).id).toBe(first!.id);
    await setMeta(db, 'lastCategoryId', second!.id);
    expect((await resolveTargetCategory(db)).id).toBe(second!.id);
    const empty = openDb('test-' + crypto.randomUUID());
    expect((await resolveTargetCategory(empty)).name).toBe('Saved');
  });
});

describe('context menus', () => {
  test('creates both entries after removing old ones', async () => {
    await createMenus();
    expect(fake.contextMenus.removeAll).toHaveBeenCalled();
    const created = fake.contextMenus.create.mock.calls.map((c: any[]) => c[0]);
    expect(created).toEqual([
      expect.objectContaining({ id: 'save-page', title: 'Save page to Atelier', contexts: ['page'] }),
      expect.objectContaining({ id: 'save-link', title: 'Save link to Atelier', contexts: ['link'] }),
    ]);
  });

  test('save-link creates a link item in the last category', async () => {
    const [, notes] = await cats();
    await setMeta(db, 'lastCategoryId', notes!.id);
    await onMenuClicked(db, { menuItemId: 'save-link', linkUrl: 'https://l.com/p', selectionText: '  Great read ' });
    const [item] = await liveItems(db, notes!.id);
    expect(item).toMatchObject({ kind: 'link', title: 'Great read', url: 'https://l.com/p' });
    expect(item!.faviconUrl).toContain('_favicon');
    expect(fake.notifications.create).toHaveBeenCalledWith(
      expect.any(String), expect.objectContaining({ message: 'Saved to Notes', title: 'Atelier' }),
    );
  });

  test('save-link falls back to the url as title', async () => {
    const [first] = await cats();
    await onMenuClicked(db, { menuItemId: 'save-link', linkUrl: 'https://l.com/p' });
    expect((await liveItems(db, first!.id))[0]!.title).toBe('https://l.com/p');
  });

  test('save-page saves the tab; unsavable pages notify instead', async () => {
    const [first] = await cats();
    await onMenuClicked(db, { menuItemId: 'save-page' }, { id: 1, index: 0, url: 'https://p.com/', title: 'P' } as any);
    expect((await liveItems(db, first!.id))[0]).toMatchObject({ title: 'P', url: 'https://p.com/' });
    await onMenuClicked(db, { menuItemId: 'save-page' }, { id: 2, index: 1, url: 'chrome://newtab/' } as any);
    expect(await liveItems(db, first!.id)).toHaveLength(1);
    expect(fake.notifications.create).toHaveBeenLastCalledWith(
      expect.any(String), expect.objectContaining({ message: "This page can't be saved" }),
    );
  });
});

describe('commands', () => {
  test('save-current-tab saves the active tab and notifies', async () => {
    await fake.tabs.create({ url: 'https://c.com/', title: 'C' });
    const [first] = await cats();
    await onCommand(db, 'save-current-tab');
    expect((await liveItems(db, first!.id))[0]).toMatchObject({ title: 'C', url: 'https://c.com/' });
    expect(fake.notifications.create).toHaveBeenCalledWith(
      expect.any(String), expect.objectContaining({ message: 'Saved to Saved' }),
    );
    expect(await getMeta(db, 'lastCategoryId')).toBeUndefined();
  });

  test('ignores other commands', async () => {
    await onCommand(db, 'other');
    expect(fake.notifications.create).not.toHaveBeenCalled();
  });
});
