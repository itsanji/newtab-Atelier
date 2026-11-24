import { expect, test } from 'vitest';
import { exportFileSchema } from '../src/exportFormat';

const base = { createdAt: '2026-11-24T10:00:00.000Z', updatedAt: '2026-11-24T10:00:00.000Z', deletedAt: null, updatedBy: null };

test('accepts a minimal valid export', () =>
  expect(
    exportFileSchema.safeParse({ format: 'atelier', version: 1, exportedAt: '2026-11-24T10:00:00.000Z', workspaces: [], categories: [], items: [], reminders: [] }).success,
  ).toBe(true));

test('rejects wrong format tag', () => expect(exportFileSchema.safeParse({ format: 'other', version: 1 }).success).toBe(false));

test('rejects item with unknown kind', () =>
  expect(
    exportFileSchema.safeParse({
      format: 'atelier',
      version: 1,
      exportedAt: '2026-11-24T10:00:00.000Z',
      workspaces: [],
      categories: [],
      items: [{ ...base, id: 'i1', categoryId: 'c1', kind: 'video', sortKey: 'a0', title: 't', url: null, faviconUrl: null, note: null, body: null, done: false }],
      reminders: [],
    }).success,
  ).toBe(false));

test('accepts item with known kind', () =>
  expect(
    exportFileSchema.safeParse({
      format: 'atelier',
      version: 1,
      exportedAt: '2026-11-24T10:00:00.000Z',
      workspaces: [],
      categories: [],
      items: [{ ...base, id: 'i1', categoryId: 'c1', kind: 'link', sortKey: 'a0', title: 't', url: 'https://x.test', faviconUrl: null, note: null, body: null, done: false }],
      reminders: [],
    }).success,
  ).toBe(true));
