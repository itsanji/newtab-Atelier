import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { App } from '../newtab/App';
import { openDb, type AtelierDB } from '../data/db';
import { createCategory, createItem, createWorkspace } from '../data/repo';
import { liveCategories, liveItems, liveWorkspaces } from '../data/queries';
import { ensureSeed } from '../data/seed';
import { announcements, applyDrop } from './dnd';
import { installChromeFake } from '../../test/chromeFake';

let db: AtelierDB;
afterEach(() => vi.restoreAllMocks());
beforeEach(() => {
  installChromeFake();
  db = openDb('test-' + crypto.randomUUID());
});

async function setup() {
  await ensureSeed(db);
  const ws = (await liveWorkspaces(db))[0]!;
  const a = await createCategory(db, { workspaceId: ws.id, name: 'Reading list' });
  const b = await createCategory(db, { workspaceId: ws.id, name: 'Later' });
  const mk = (categoryId: string, title: string) => createItem(db, { categoryId, kind: 'link', title, url: `https://${title}.com` });
  return { ws, a, b, mk };
}
const titles = async (id: string) => (await liveItems(db, id)).map((i) => i.title);

describe('applyDrop', () => {
  test('moves an item between categories and keeps order', async () => {
    const { a, b, mk } = await setup();
    const x = await mk(a.id, 'x');
    await mk(a.id, 'y');
    const p = await mk(b.id, 'p');
    await mk(b.id, 'q');
    expect(await applyDrop(db, { active: { type: 'item', id: x.id }, over: { type: 'item', id: p.id }, placement: 'after' })).toBeNull();
    expect(await titles(a.id)).toEqual(['y']);
    expect(await titles(b.id)).toEqual(['p', 'x', 'q']);
  });

  test('dropping on a column appends; reorders within a column', async () => {
    const { a, b, mk } = await setup();
    const x = await mk(a.id, 'x');
    const y = await mk(a.id, 'y');
    await applyDrop(db, { active: { type: 'item', id: x.id }, over: { type: 'category', id: b.id }, placement: 'after' });
    expect(await titles(b.id)).toEqual(['x']);
    await applyDrop(db, { active: { type: 'item', id: x.id }, over: { type: 'item', id: y.id }, placement: 'before' });
    expect(await titles(a.id)).toEqual(['x', 'y']);
  });

  test('reorders categories', async () => {
    const { ws, a, b } = await setup();
    const before = (await liveCategories(db, ws.id)).map((c) => c.id);
    expect(before.slice(-2)).toEqual([a.id, b.id]);
    await applyDrop(db, { active: { type: 'category', id: b.id }, over: { type: 'category', id: a.id }, placement: 'before' });
    expect((await liveCategories(db, ws.id)).map((c) => c.id).slice(-2)).toEqual([b.id, a.id]);
  });

  test('drop on a workspace appends to its first category, or notifies when empty', async () => {
    const { a, mk } = await setup();
    const x = await mk(a.id, 'x');
    const other = await createWorkspace(db, { name: 'Other' });
    expect(await applyDrop(db, { active: { type: 'item', id: x.id }, over: { type: 'workspace', id: other.id }, placement: 'after' }))
      .toBe('Add a category to that workspace first');
    expect(await titles(a.id)).toEqual(['x']);
    const c = await createCategory(db, { workspaceId: other.id, name: 'First' });
    await applyDrop(db, { active: { type: 'item', id: x.id }, over: { type: 'workspace', id: other.id }, placement: 'after' });
    expect(await titles(c.id)).toEqual(['x']);
  });

  test('ignores unsupported and missing targets', async () => {
    const { ws, a, mk } = await setup();
    const x = await mk(a.id, 'x');
    expect(await applyDrop(db, { active: { type: 'item', id: x.id }, over: null, placement: 'after' })).toBeNull();
    expect(await applyDrop(db, { active: { type: 'category', id: a.id }, over: { type: 'workspace', id: ws.id }, placement: 'after' })).toBeNull();
    expect(await titles(a.id)).toEqual(['x']);
  });
});

describe('drop on the New category tile', () => {
  const now = new Date(2026, 10, 24, 9, 5);
  test('an item starts a category first in the workspace, in one transaction', async () => {
    const { ws, a, mk } = await setup();
    const x = await mk(a.id, 'x');
    const last = (await db.outbox.orderBy('seq').last())!.seq;
    const puts = vi.spyOn(db.outbox, 'put');
    expect(await applyDrop(db, { active: { type: 'item', id: x.id }, over: { type: 'newcat', id: ws.id }, placement: 'after' }, now)).toBeNull();
    const first = (await liveCategories(db, ws.id))[0]!;
    expect(first.name).toBe('Saved 24 Nov, 09:05');
    expect(await titles(first.id)).toEqual(['x']);
    expect(await titles(a.id)).toEqual([]);
    expect(puts).toHaveBeenCalledTimes(2);
    const queued = await db.outbox.where('seq').above(last).toArray();
    expect(queued.map((e) => e.rowId).sort()).toEqual([first.id, x.id].sort());
  });

  test('a tab starts a category holding the saved tab', async () => {
    const { ws } = await setup();
    const puts = vi.spyOn(db.outbox, 'put');
    await applyDrop(db, {
      active: { type: 'tab', id: 'tab:1', tab: { url: 'https://t.com', title: 'T' } }, over: { type: 'newcat', id: ws.id }, placement: 'after',
    }, now);
    const first = (await liveCategories(db, ws.id))[0]!;
    expect(first.name).toBe('Saved 24 Nov, 09:05');
    const [item] = await liveItems(db, first.id);
    expect(item).toMatchObject({ title: 'T', url: 'https://t.com', faviconUrl: null });
    expect(puts).toHaveBeenCalledTimes(2);
  });

  test('a failed save leaves no new category', async () => {
    const { ws } = await setup();
    const before = (await liveCategories(db, ws.id)).length;
    await expect(applyDrop(db, { active: { type: 'item', id: 'missing' }, over: { type: 'newcat', id: ws.id }, placement: 'after' }, now)).rejects.toThrow();
    expect((await liveCategories(db, ws.id)).length).toBe(before);
  });

  test('a category dropped there does nothing', async () => {
    const { ws, a } = await setup();
    const before = (await liveCategories(db, ws.id)).map((c) => c.id);
    expect(await applyDrop(db, { active: { type: 'category', id: a.id }, over: { type: 'newcat', id: ws.id }, placement: 'after' }, now)).toBeNull();
    expect((await liveCategories(db, ws.id)).map((c) => c.id)).toEqual(before);
  });
});

describe('tab dropped on an item', () => {
  test('is saved between the neighbours with exactly one outbox write', async () => {
    const { a, mk } = await setup();
    await mk(a.id, 'x');
    const y = await mk(a.id, 'y');
    const puts = vi.spyOn(db.outbox, 'put');
    await applyDrop(db, { active: { type: 'tab', id: 'tab:1', tab: { url: 'https://t.com', title: 't' } }, over: { type: 'item', id: y.id }, placement: 'before' });
    expect(await titles(a.id)).toEqual(['x', 't', 'y']);
    expect(puts).toHaveBeenCalledTimes(1);
  });
});

describe('drag handles', () => {
  test('rows and columns expose keyboard drag handles', async () => {
    await setup().then(({ a, mk }) => mk(a.id, 'x'));
    render(<App db={db} />);
    const col = await screen.findByRole('region', { name: 'Reading list' });
    expect(await within(col).findByRole('button', { name: 'Drag to move' })).toBeInTheDocument();
    expect(within(col).getByRole('button', { name: 'Drag to reorder category' })).toBeInTheDocument();
  });
});

describe('no-op drops', () => {
  // Highest seq: any write, even one that replaces a row's pending entry, raises it.
  const outbox = async () => (await db.outbox.orderBy('seq').last())?.seq ?? 0;
  test('same-position item drops do not write', async () => {
    const { a, mk } = await setup();
    const x = await mk(a.id, 'x');
    const y = await mk(a.id, 'y');
    const z = await mk(a.id, 'z');
    const n = await outbox();
    // before its own next sibling
    await applyDrop(db, { active: { type: 'item', id: x.id }, over: { type: 'item', id: y.id }, placement: 'before' });
    // after its own previous sibling
    await applyDrop(db, { active: { type: 'item', id: z.id }, over: { type: 'item', id: y.id }, placement: 'after' });
    // last item onto its own column (append)
    await applyDrop(db, { active: { type: 'item', id: z.id }, over: { type: 'category', id: a.id }, placement: 'after' });
    expect(await outbox()).toBe(n);
    expect(await titles(a.id)).toEqual(['x', 'y', 'z']);
  });
  test('same-position category drop does not write', async () => {
    const { a, b } = await setup();
    const n = await outbox();
    await applyDrop(db, { active: { type: 'category', id: a.id }, over: { type: 'category', id: b.id }, placement: 'before' });
    await applyDrop(db, { active: { type: 'category', id: b.id }, over: { type: 'category', id: a.id }, placement: 'after' });
    expect(await outbox()).toBe(n);
  });
});

describe('announcements', () => {
  const act = { id: 'x', data: { current: { type: 'item', title: 'Example' } } };
  const over = { id: 'p', data: { current: { type: 'item', title: 'Other link', categoryName: 'Reading list' } } };
  test('name the category, not the over item', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = announcements as any;
    expect(a.onDragStart({ active: act })).toBe('Picked up Example.');
    expect(a.onDragEnd({ active: act, over })).toBe('Moved Example to Reading list.');
    expect(a.onDragOver({ active: act, over })).toBe('Example is over Reading list.');
  });
});
