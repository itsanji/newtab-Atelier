import { describe, expect, test } from 'vitest';
import { exportFileSchema } from '../src/exportFormat';

const T = '2026-11-24T10:00:00.000Z';
const base = { createdAt: T, updatedAt: T, deletedAt: null, updatedBy: null };
const ID = {
  ws: '11111111-1111-4111-8111-111111111111',
  cat: '22222222-2222-4222-8222-222222222222',
  item: '33333333-3333-4333-8333-333333333333',
  rem: '44444444-4444-4444-8444-444444444444',
};
const workspace = { ...base, id: ID.ws, name: 'W', emoji: null, ownerId: null, sortKey: 'a0' };
const category = { ...base, id: ID.cat, workspaceId: ID.ws, name: 'C', emoji: null, sortKey: 'a0', tabGroup: null, shareToken: null };
const item = {
  ...base, id: ID.item, categoryId: ID.cat, kind: 'link', sortKey: 'a0', title: 't', url: 'https://x.test',
  faviconUrl: null, note: null, body: null, done: false,
};
const reminder = { ...base, id: ID.rem, itemId: ID.item, userId: 'local', remindAt: T, remindedAt: null };
const file = (over: object = {}) => ({
  format: 'atelier', version: 1, exportedAt: T,
  workspaces: [workspace], categories: [category], items: [item], reminders: [reminder], ...over,
});
const ok = (f: unknown) => exportFileSchema.safeParse(f).success;

test('accepts a minimal valid export', () =>
  expect(ok({ format: 'atelier', version: 1, exportedAt: T, workspaces: [], categories: [], items: [], reminders: [] })).toBe(true));

test('accepts a full valid export', () => expect(ok(file())).toBe(true));

test('rejects wrong format tag', () => expect(ok({ format: 'other', version: 1 })).toBe(false));

test('rejects item with unknown kind', () => expect(ok(file({ items: [{ ...item, kind: 'video' }] }))).toBe(false));

describe('timestamps', () => {
  test('accept offsets', () => expect(ok(file({ workspaces: [{ ...workspace, updatedAt: '2026-11-24T10:00:00+01:00' }] }))).toBe(true));
  test('reject non-dates', () => {
    expect(ok(file({ workspaces: [{ ...workspace, updatedAt: 'yesterday' }] }))).toBe(false);
    expect(ok(file({ categories: [{ ...category, createdAt: '' }] }))).toBe(false);
    expect(ok(file({ items: [{ ...item, deletedAt: 'nope' }] }))).toBe(false);
    expect(ok(file({ exportedAt: '2026-13-45' }))).toBe(false);
  });
});

describe('ids', () => {
  test('reject non-uuid ids and references', () => {
    expect(ok(file({ workspaces: [{ ...workspace, id: 'w1' }] }))).toBe(false);
    expect(ok(file({ categories: [{ ...category, workspaceId: 'w1' }] }))).toBe(false);
    expect(ok(file({ items: [{ ...item, categoryId: 'c1' }] }))).toBe(false);
    expect(ok(file({ reminders: [{ ...reminder, itemId: 'i1' }] }))).toBe(false);
  });
});

describe('sort keys', () => {
  test('reject keys fractional-indexing cannot extend', () => {
    expect(ok(file({ items: [{ ...item, sortKey: '' }] }))).toBe(false);
    expect(ok(file({ categories: [{ ...category, sortKey: 'zz!' }] }))).toBe(false);
    expect(ok(file({ workspaces: [{ ...workspace, sortKey: 'a00' }] }))).toBe(false); // trailing zero
  });
  test('accept generated keys', () => expect(ok(file({ items: [{ ...item, sortKey: 'a1V' }] }))).toBe(true));
});

describe('reminders', () => {
  test('reject an invalid remindAt', () => {
    expect(ok(file({ reminders: [{ ...reminder, remindAt: 'soon' }] }))).toBe(false);
    expect(ok(file({ reminders: [{ ...reminder, remindedAt: 'later' }] }))).toBe(false);
  });
});

describe('link urls', () => {
  test('allow null and http, https, file, ftp', () => {
    for (const url of [null, 'http://a.test/', 'https://a.test/x', 'file:///tmp/a.html', 'ftp://a.test/f']) {
      expect(ok(file({ items: [{ ...item, url }] }))).toBe(true);
    }
  });
  test('reject other protocols and non-urls', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,hi', 'chrome://settings', 'not a url', '']) {
      expect(ok(file({ items: [{ ...item, url }] }))).toBe(false);
    }
  });
});
