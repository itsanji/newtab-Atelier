import { beforeEach, describe, expect, test, vi } from 'vitest';
import { installChromeFake, type ChromeFake } from '../../test/chromeFake';
import { openDb, type AtelierDB } from '../data/db';
import { createCategory, createItem } from '../data/repo';
import { liveCategories, liveItems, liveWorkspaces } from '../data/queries';
import { ensureSeed } from '../data/seed';
import { isSavableTab, listWindowTabs, openAll, saveAll, saveAllAndClose, saveTab, savedLabel } from './tabs';

let fake: ChromeFake;
let db: AtelierDB;
beforeEach(async () => {
  fake = installChromeFake();
  db = openDb('test-' + crypto.randomUUID());
  await ensureSeed(db);
});
const ws = async () => (await liveWorkspaces(db))[0]!;
const remaining = async () => (await fake.tabs.query({})).map((t) => t.url);

describe('isSavableTab', () => {
  test('rejects pinned, newtab, extension, blank and url-less tabs', () => {
    const t = (o: object) => o as chrome.tabs.Tab;
    expect(isSavableTab(t({ url: 'https://a.com', pinned: false }))).toBe(true);
    expect(isSavableTab(t({ url: 'https://a.com', pinned: true }))).toBe(false);
    for (const url of ['chrome://settings/', 'javascript:void(0)', 'chrome://newtab/', 'edge://newtab/', 'about:newtab', 'about:blank', 'chrome-extension://abc/x.html', chrome.runtime.getURL('newtab.html'), undefined]) {
      expect(isSavableTab(t({ url, pinned: false }))).toBe(false);
    }
  });
});

describe('saveAllAndClose', () => {
  test('skips newtab, extension and pinned tabs', async () => {
    await fake.tabs.create({ url: chrome.runtime.getURL('newtab.html') });
    await fake.tabs.create({ url: 'https://pinned.com', pinned: true });
    await fake.tabs.create({ url: 'chrome://newtab/' });
    await fake.tabs.create({ url: 'https://a.com', title: 'A' });
    await fake.tabs.create({ url: 'https://b.com', title: 'B' });
    expect((await listWindowTabs()).map((t) => t.url)).toEqual(['https://a.com', 'https://b.com']);
    const res = await saveAllAndClose(db, (await ws()).id);
    expect(res.saved).toBe(2);
    expect(await remaining()).toEqual([chrome.runtime.getURL('newtab.html'), 'https://pinned.com', 'chrome://newtab/']);
  });

  test('tab group becomes its own category with title and colour', async () => {
    const a = await fake.tabs.create({ url: 'https://a.com', title: 'A' });
    const b = await fake.tabs.create({ url: 'https://b.com', title: 'B' });
    await fake.tabs.create({ url: 'https://c.com', title: 'C' });
    const gid = await fake.tabs.group({ tabIds: [a.id, b.id] });
    await fake.tabGroups.update(gid, { title: 'Research', color: 'blue' });
    const w = await ws();
    const existing = await createCategory(db, { workspaceId: w.id, name: 'Old' });
    const res = await saveAllAndClose(db, w.id, undefined, new Date(2026, 10, 24, 9, 5));
    expect(res.categories.map((c) => c.name)).toEqual(['Research', 'Saved 24 Nov, 09:05']);
    expect(res.categories[0]!.tabGroup).toEqual({ title: 'Research', color: 'blue' });
    expect(res.categories[1]!.tabGroup).toBeNull();
    expect((await liveItems(db, res.categories[0]!.id)).map((i) => i.title)).toEqual(['A', 'B']);
    const names = (await liveCategories(db, w.id)).map((c) => c.name);
    expect(names.slice(0, 2)).toEqual(['Research', 'Saved 24 Nov, 09:05']);
    expect(names.indexOf('Old')).toBeGreaterThan(1);
    expect(existing.name).toBe('Old');
  });

  test('unnamed group is "Tab group"', async () => {
    const a = await fake.tabs.create({ url: 'https://a.com' });
    await fake.tabs.group({ tabIds: [a.id] });
    const res = await saveAllAndClose(db, (await ws()).id);
    expect(res.categories[0]!.name).toBe('Tab group');
  });

  test('ungrouped tabs go to a category named "Saved <d MMM, HH:mm>"', async () => {
    await fake.tabs.create({ url: 'https://a.com', title: 'A' });
    const res = await saveAllAndClose(db, (await ws()).id, undefined, new Date(2026, 10, 24, 11, 30));
    expect(res.categories.map((c) => c.name)).toEqual(['Saved 24 Nov, 11:30']);
    expect(savedLabel(new Date(2026, 0, 5, 0, 7))).toBe('Saved 5 Jan, 00:07');
  });

  test('does nothing when nothing is savable', async () => {
    await fake.tabs.create({ url: 'chrome://newtab/' });
    const before = (await liveCategories(db, (await ws()).id)).length;
    expect(await saveAllAndClose(db, (await ws()).id)).toEqual({ categories: [], saved: 0 });
    expect((await liveCategories(db, (await ws()).id)).length).toBe(before);
    expect(await remaining()).toEqual(['chrome://newtab/']);
  });

  test('writes exactly one outbox entry per new category and per saved tab', async () => {
    const a = await fake.tabs.create({ url: 'https://a.com', title: 'A' });
    const b = await fake.tabs.create({ url: 'https://b.com', title: 'B' });
    await fake.tabs.create({ url: 'https://c.com', title: 'C' });
    await fake.tabs.group({ tabIds: [a.id, b.id] });
    const w = await ws();
    await createCategory(db, { workspaceId: w.id, name: 'Old' });
    const last = (await db.outbox.orderBy('seq').last())!.seq;
    const puts = vi.spyOn(db.outbox, 'put');
    const res = await saveAllAndClose(db, w.id);
    // One outbox write per row: categories are created in place, never created and then moved.
    expect(puts).toHaveBeenCalledTimes(5);
    puts.mockRestore();
    const queued = await db.outbox.where('seq').above(last).toArray();
    const cats = queued.filter((e) => e.table === 'categories');
    expect(cats.map((e) => e.rowId).sort()).toEqual(res.categories.map((c) => c.id).sort());
    expect(queued.filter((e) => e.table === 'items')).toHaveLength(3);
    expect(queued).toHaveLength(5);
  });

  test('keeps tabs open when the save fails', async () => {
    await fake.tabs.create({ url: 'https://a.com' });
    await expect(saveAllAndClose(db, 'missing-workspace')).rejects.toThrow();
    expect(await remaining()).toEqual(['https://a.com']);
  });
});

describe('saveAll', () => {
  test('close: false saves every tab and leaves them open', async () => {
    await fake.tabs.create({ url: 'https://a.com', title: 'A' });
    await fake.tabs.create({ url: 'https://b.com', title: 'B' });
    const res = await saveAll(db, (await ws()).id, { close: false, now: new Date(2026, 10, 24, 9, 5) });
    expect(res.saved).toBe(2);
    expect((await liveItems(db, res.categories[0]!.id)).map((i) => i.title)).toEqual(['A', 'B']);
    expect(fake.tabs.remove).not.toHaveBeenCalled();
    expect(await remaining()).toEqual(['https://a.com', 'https://b.com']);
  });

  test('close: true saves and closes', async () => {
    await fake.tabs.create({ url: 'https://a.com', title: 'A' });
    const res = await saveAll(db, (await ws()).id, { close: true });
    expect(res.saved).toBe(1);
    expect(await remaining()).toEqual([]);
  });
});

describe('saveTab', () => {
  test('creates a link item with favicon at start or end', async () => {
    const w = await ws();
    const c = await createCategory(db, { workspaceId: w.id, name: 'X' });
    await createItem(db, { categoryId: c.id, kind: 'link', title: 'old', url: 'https://old.com' });
    const item = await saveTab(db, { url: 'https://a.com', title: 'A' } as chrome.tabs.Tab, { categoryId: c.id, position: 'start' });
    expect(item.kind).toBe('link');
    expect(item.faviconUrl).toBeNull();
    expect((await liveItems(db, c.id)).map((i) => i.title)).toEqual(['A', 'old']);
  });
});

describe('openAll', () => {
  test('opens links in order, skipping notes, and recreates the tab group', async () => {
    const w = await ws();
    const c = await createCategory(db, { workspaceId: w.id, name: 'G', tabGroup: { title: 'Research', color: 'blue' } });
    await createItem(db, { categoryId: c.id, kind: 'link', title: 'A', url: 'https://a.com' });
    await createItem(db, { categoryId: c.id, kind: 'note', title: 'n' });
    await createItem(db, { categoryId: c.id, kind: 'link', title: 'B', url: 'https://b.com' });
    await openAll(db, c.id);
    const tabs = await fake.tabs.query({});
    expect(tabs.map((t) => [t.url, t.active])).toEqual([['https://a.com', true], ['https://b.com', false]]);
    expect(fake.tabs.group).toHaveBeenCalledTimes(1);
    const gid = tabs[0]!.groupId;
    expect(tabs[1]!.groupId).toBe(gid);
    expect(fake.tabGroups.update).toHaveBeenCalledWith(gid, { title: 'Research', color: 'blue' });
  });

  test('skips links that are not http, https, file or ftp', async () => {
    const c = await createCategory(db, { workspaceId: (await ws()).id, name: 'P' });
    await createItem(db, { categoryId: c.id, kind: 'link', title: 'J', url: 'javascript:alert(1)' });
    await createItem(db, { categoryId: c.id, kind: 'link', title: 'A', url: 'https://a.com' });
    await openAll(db, c.id);
    expect(await remaining()).toEqual(['https://a.com']);
  });

  test('one failing tab does not stop the rest or the regrouping', async () => {
    const c = await createCategory(db, { workspaceId: (await ws()).id, name: 'G', tabGroup: { title: 'R', color: 'red' } });
    await createItem(db, { categoryId: c.id, kind: 'link', title: 'A', url: 'https://a.com' });
    await createItem(db, { categoryId: c.id, kind: 'link', title: 'B', url: 'https://b.com' });
    await createItem(db, { categoryId: c.id, kind: 'link', title: 'C', url: 'https://c.com' });
    fake.tabs.create.mockImplementationOnce(async () => { throw new Error('nope'); });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    await openAll(db, c.id);
    errors.mockRestore();
    const tabs = await fake.tabs.query({});
    expect(tabs.map((t) => t.url)).toEqual(['https://b.com', 'https://c.com']);
    expect(fake.tabs.group).toHaveBeenCalledWith({ tabIds: tabs.map((t) => t.id) });
    expect(fake.tabGroups.update).toHaveBeenCalledTimes(1);
  });

  test('does not group a plain category', async () => {
    const c = await createCategory(db, { workspaceId: (await ws()).id, name: 'P' });
    await createItem(db, { categoryId: c.id, kind: 'link', title: 'A', url: 'https://a.com' });
    await openAll(db, c.id);
    expect(fake.tabs.group).not.toHaveBeenCalled();
    expect(await remaining()).toEqual(['https://a.com']);
  });
});
