import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { installChromeFake } from '../../test/chromeFake';
import { partitionFor, setAccount, setCurrentUserId, type Account } from '../account/account';
import { CURSOR_KEY } from '../sync/engine';
import { deleteDb, openDb, type AtelierDB } from './db';
import { getMeta, liveWorkspaces } from './queries';
import { awaitingFirstPull, ensureSeed } from './seed';
import { resolveTargetCategory } from './target';

const SERVER = 'https://a.example';
const account: Account = { serverUrl: SERVER, userId: 'u1', email: 'u1@x.io', displayName: 'Ada', token: 't', partition: partitionFor(SERVER, 'u1') };
const t = '2026-11-24T00:00:00.000Z';
const row = { createdAt: t, updatedAt: t, deletedAt: null, updatedBy: 'u1' };
const serverWs = { ...row, id: '00000000-0000-4000-8000-000000000001', name: 'Home', emoji: null, ownerId: 'u1', sortKey: 'a0' };
const serverCat = { ...row, id: '00000000-0000-4000-8000-000000000002', workspaceId: serverWs.id, name: 'Inbox', emoji: null, sortKey: 'a0', tabGroup: null, shareToken: null };

let db: AtelierDB;
let pull: { workspaces: unknown[]; categories: unknown[] } | 'offline';

beforeEach(async () => {
  installChromeFake();
  setCurrentUserId('u1');
  await setAccount(account);
  db = openDb(account.partition);
  pull = { workspaces: [], categories: [] };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (pull === 'offline') throw new TypeError('Failed to fetch');
    if (new URL(url).pathname !== '/api/sync/pull') return new Response('{}', { status: 404 });
    return new Response(JSON.stringify({ cursor: 7, items: [], reminders: [], members: [], removedWorkspaceIds: [], ...pull }), { status: 200 });
  }));
});
afterEach(async () => {
  vi.unstubAllGlobals();
  db.close();
  await deleteDb(account.partition);
  await deleteDb('local');
  setCurrentUserId(null);
});

describe('seeding a signed-in partition', () => {
  test('waits for the first pull: the server has a workspace, so no starter one is added', async () => {
    pull = { workspaces: [serverWs], categories: [serverCat] };
    expect(await awaitingFirstPull(db)).toBe(true);
    await ensureSeed(db);
    expect((await liveWorkspaces(db)).map((w) => w.name)).toEqual(['Home']);
    expect(await db.outbox.count()).toBe(0);
    expect(await awaitingFirstPull(db)).toBe(false);
  });

  test('seeds after a first pull that found nothing', async () => {
    await ensureSeed(db);
    expect(await getMeta(db, CURSOR_KEY)).toBe(7);
    expect((await liveWorkspaces(db)).map((w) => w.name)).toEqual(['My workspace']);
  });

  test('offline before the first pull still seeds, so a save has somewhere to go', async () => {
    pull = 'offline';
    await ensureSeed(db);
    expect((await liveWorkspaces(db)).map((w) => w.name)).toEqual(['My workspace']);
  });

  test('worker saves target the pulled category, not a new starter one', async () => {
    pull = { workspaces: [serverWs], categories: [serverCat] };
    expect((await resolveTargetCategory(db)).id).toBe(serverCat.id);
    expect(await db.workspaces.count()).toBe(1);
  });

  test('the local partition seeds without any network', async () => {
    const local = openDb('local');
    expect(await awaitingFirstPull(local)).toBe(false);
    await ensureSeed(local);
    expect(fetch).not.toHaveBeenCalled();
    expect(await local.workspaces.count()).toBe(1);
    local.close();
  });
});
