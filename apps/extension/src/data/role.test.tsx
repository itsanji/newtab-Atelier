import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { installChromeFake } from '../../test/chromeFake';
import { partitionFor, setAccount, type Account } from '../account/account';
import { Popup } from '../popup/Popup';
import { openDb, type AtelierDB } from './db';
import { setMeta } from './queries';
import { resolveTargetCategory, LAST_CATEGORY_KEY } from './target';
import { roleFrom } from './role';

const account: Account = { serverUrl: 'https://a.example', userId: 'u1', email: 'u1@x.io', displayName: 'Ada', token: 't', partition: partitionFor('https://a.example', 'u1') };
const t = '2026-11-24T00:00:00.000Z';
const base = (id: string) => ({ id, createdAt: t, updatedAt: t, deletedAt: null, updatedBy: 'u2' });
let db: AtelierDB;

/** Workspace `ro` (viewer, first) and `rw` (own), one category each. */
async function seed() {
  await db.workspaces.bulkPut([
    { ...base('ro'), name: 'Shared', emoji: null, ownerId: 'u2', sortKey: 'a0' },
    { ...base('rw'), name: 'Mine', emoji: null, ownerId: 'u1', sortKey: 'a1' },
  ]);
  await db.categories.bulkPut([
    { ...base('c-ro'), workspaceId: 'ro', name: 'Theirs', emoji: null, sortKey: 'a0', tabGroup: null, shareToken: null },
    { ...base('c-rw'), workspaceId: 'rw', name: 'Ours', emoji: null, sortKey: 'a0', tabGroup: null, shareToken: null },
  ]);
  await db.members.put({ id: 'm1', workspaceId: 'ro', userId: 'u1', role: 'viewer', email: 'u1@x.io' });
}

beforeEach(async () => {
  const fake = installChromeFake();
  await fake.tabs.create({ url: 'https://a.com/x', title: 'A page' });
  await setAccount(account);
  db = openDb('test-' + crypto.randomUUID());
  await seed();
});

describe('roleFrom', () => {
  test('member row wins; foreign owner without row is viewer; no user owns all', () => {
    expect(roleFrom('u2', [{ id: 'm', workspaceId: 'w', userId: 'u1', role: 'editor' }], 'u1')).toBe('editor');
    expect(roleFrom('u2', [], 'u1')).toBe('viewer');
    expect(roleFrom(null, [], 'u1')).toBe('owner');
    expect(roleFrom('u2', [], null)).toBe('owner');
  });
});

describe('save targets skip viewer workspaces', () => {
  test('resolveTargetCategory picks the first editable category', async () => {
    expect((await resolveTargetCategory(db)).id).toBe('c-rw');
  });
  test('a last-used category in a viewer workspace is ignored', async () => {
    await setMeta(db, LAST_CATEGORY_KEY, 'c-ro');
    expect((await resolveTargetCategory(db)).id).toBe('c-rw');
    await setMeta(db, LAST_CATEGORY_KEY, 'c-rw');
    expect((await resolveTargetCategory(db)).id).toBe('c-rw');
  });
  test('popup does not offer a selected viewer workspace', async () => {
    await setMeta(db, 'selectedWorkspaceId', 'ro');
    render(<Popup db={db} />);
    expect(await screen.findByText('Save to · Mine')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Ours' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Theirs' })).toBeNull();
    expect(screen.getByRole('radio', { name: '+ New' })).toBeInTheDocument();
  });
  test('popup with only viewer workspaces cannot save', async () => {
    await db.members.put({ id: 'm2', workspaceId: 'rw', userId: 'u1', role: 'viewer', email: 'u1@x.io' });
    await db.workspaces.update('rw', { ownerId: 'u2' });
    render(<Popup db={db} />);
    expect(await screen.findByRole('button', { name: 'Save tab' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Save all/ })).toBeNull();
    expect(screen.queryByRole('radio', { name: '+ New' })).toBeNull();
  });
});
