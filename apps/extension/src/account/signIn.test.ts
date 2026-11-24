import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { installChromeFake, type ChromeFake } from '../../test/chromeFake';
import { getAccount, partitionFor, setAccount, setCurrentUserId, type Account } from './account';
import { forgetDb, getActiveDb } from './activeDb';
import { AccountSwitchError, finishSignIn, FROM_DEVICE_NAME, googleSignIn, GoogleSignInError, hasUserContent, pollMagic, signOut } from './signIn';
import { deleteDb, openDb } from '../data/db';
import { ensureSeed } from '../data/seed';
import { createCategory, createItem, createWorkspace, setReminder, updateCategory } from '../data/repo';
import { liveCategories, liveWorkspaces } from '../data/queries';
import { OfflineError, type AuthResult } from '../sync/api';

const SERVER = 'https://a.example';
const auth = (id = 'u1'): AuthResult => ({ token: `tok-${id}`, user: { id, email: `${id}@x.io`, displayName: `User ${id}` } });
const api = { serverUrl: SERVER };

let chromeFake: ChromeFake;
beforeEach(async () => {
  chromeFake = installChromeFake();
  setCurrentUserId(null);
  await deleteDb('local');
});
afterEach(async () => {
  setCurrentUserId(null);
  for (const p of ['local', partitionFor(SERVER, 'u1'), partitionFor(SERVER, 'u2')]) forgetDb(p);
  await deleteDb(partitionFor(SERVER, 'u1'));
  await deleteDb(partitionFor(SERVER, 'u2'));
  await deleteDb('local');
});

async function localWithContent() {
  const local = openDb('local');
  await ensureSeed(local);
  const [ws] = await liveWorkspaces(local);
  const [saved, notes] = await liveCategories(local, ws!.id);
  const ws2 = await createWorkspace(local, { name: 'Side' });
  const cat2 = await createCategory(local, { workspaceId: ws2.id, name: 'Reading' });
  const link = await createItem(local, { categoryId: saved!.id, kind: 'link', title: 'A', url: 'https://a.io' } as never);
  const note = await createItem(local, { categoryId: cat2.id, kind: 'note', title: 'N' } as never);
  const reminder = await setReminder(local, link.id, '2030-01-01T00:00:00.000Z');
  local.close();
  return { cats: [saved!, notes!, cat2], items: [link, note], reminder };
}

describe('hasUserContent', () => {
  test('untouched seed has none; an item or a changed category has some', async () => {
    const local = openDb('local');
    expect(await hasUserContent(local)).toBe(false);
    await ensureSeed(local);
    expect(await hasUserContent(local)).toBe(false);
    const [ws] = await liveWorkspaces(local);
    const [saved] = await liveCategories(local, ws!.id);
    await updateCategory(local, saved!.id, { name: 'Links' });
    expect(await hasUserContent(local)).toBe(true);
    local.close();
  });
  test('an extra empty category counts', async () => {
    const local = openDb('local');
    await ensureSeed(local);
    const [ws] = await liveWorkspaces(local);
    await createCategory(local, { workspaceId: ws!.id, name: 'Later' });
    expect(await hasUserContent(local)).toBe(true);
    local.close();
  });
});

describe('finishSignIn', () => {
  test('password sign-in stores account and switches partition', async () => {
    const account = await finishSignIn(api, auth('u1'));
    expect(account).toEqual({
      serverUrl: SERVER, userId: 'u1', email: 'u1@x.io', displayName: 'User u1', token: 'tok-u1', partition: partitionFor(SERVER, 'u1'),
    });
    expect(await getAccount()).toEqual(account);
    const db = await getActiveDb();
    expect(db.name).toBe(`atelier-${account.partition}`);
    expect(chromeFake.runtime.sendMessage).toHaveBeenCalledWith({ type: 'sync-now' });
  });

  test('sign-in merges local rows once', async () => {
    const { cats, items, reminder } = await localWithContent();
    const account = await finishSignIn(api, auth('u1'));
    const db = openDb(account.partition);
    const workspaces = await liveWorkspaces(db);
    expect(workspaces.map((w) => w.name)).toEqual([FROM_DEVICE_NAME]);
    const from = workspaces[0]!;
    expect(from.ownerId).toBe('u1');
    // Categories keep their ids and order, re-pointed to the new workspace.
    expect((await liveCategories(db, from.id)).map((c) => c.id)).toEqual(cats.map((c) => c.id));
    // Items and reminders keep their ids; no duplicates.
    expect((await db.items.toArray()).map((i) => i.id).sort()).toEqual(items.map((i) => i.id).sort());
    expect((await db.items.get(items[0]!.id))).toEqual(items[0]);
    const rems = await db.reminders.toArray();
    expect(rems).toHaveLength(1);
    expect(rems[0]).toMatchObject({ id: reminder.id, itemId: items[0]!.id, userId: 'u1' });
    // Everything is queued for upload.
    const queued = (await db.outbox.toArray()).map((e) => e.key).sort();
    expect(queued).toEqual([
      `workspaces:${from.id}`, ...cats.map((c) => `categories:${c.id}`), ...items.map((i) => `items:${i.id}`), `reminders:${reminder.id}`,
    ].sort());
    // The local partition is emptied.
    const local = openDb('local');
    expect(await local.workspaces.count()).toBe(0);
    expect(await local.items.count()).toBe(0);
    local.close();

    // Signing in again (e.g. after a revoked token) merges nothing more.
    await finishSignIn(api, auth('u1'));
    expect((await liveWorkspaces(db)).map((w) => w.name)).toEqual([FROM_DEVICE_NAME]);
    expect(await db.items.count()).toBe(2);
    db.close();
  });

  test('an interrupted merge re-run reuses the same workspace', async () => {
    await localWithContent();
    const account = await finishSignIn(api, auth('u1'));
    // Simulate local rows coming back (merge interrupted before the local partition was emptied).
    await localWithContent();
    await setAccount({ ...account }); // still signed in as the same user
    await finishSignIn(api, auth('u1'));
    const db = openDb(account.partition);
    expect((await liveWorkspaces(db)).filter((w) => w.name === FROM_DEVICE_NAME)).toHaveLength(1);
    db.close();
  });

  test('untouched seed is not merged', async () => {
    const local = openDb('local');
    await ensureSeed(local);
    local.close();
    const account = await finishSignIn(api, auth('u1'));
    const db = openDb(account.partition);
    expect(await db.workspaces.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
    db.close();
    const again = openDb('local');
    expect(await again.workspaces.count()).toBe(0);
    again.close();
  });

  test('forgets the cached local db before deleting it', async () => {
    const local = await getActiveDb();
    expect(local.name).toBe('atelier-local');
    await ensureSeed(local);
    const account = await finishSignIn(api, auth('u1'));
    await signOut(account, { logOut: async () => undefined, push: vi.fn(), pull: vi.fn() } as never, { force: true });
    // The stale instance is closed for good: it can't silently re-create the deleted database.
    await expect(local.workspaces.count()).rejects.toThrow();
    const db = await getActiveDb();
    expect(db.name).toBe('atelier-local');
    expect(db).not.toBe(local);
    expect(await db.workspaces.count()).toBeGreaterThan(0);
  });

  test('refuses to switch to another account while signed in', async () => {
    await finishSignIn(api, auth('u1'));
    await expect(finishSignIn(api, auth('u2'))).rejects.toBeInstanceOf(AccountSwitchError);
    expect((await getAccount())?.userId).toBe('u1');
  });
});

describe('signOut', () => {
  const failingApi = () => ({
    push: vi.fn(async () => { throw new OfflineError(); }),
    pull: vi.fn(async () => { throw new OfflineError(); }),
    logOut: vi.fn(async () => undefined),
  });
  const okApi = () => ({
    push: vi.fn(async (changes: Array<{ table: string; row: { id: string } }>) => ({
      results: changes.map((c) => ({ table: c.table, id: c.row.id, status: 'applied' as const })),
    })),
    pull: vi.fn(async () => ({ cursor: 5, workspaces: [], categories: [], items: [], reminders: [], members: [], removedWorkspaceIds: [] })),
    logOut: vi.fn(async () => { throw new Error('offline'); }),
  });

  test('sign-out with unflushed outbox warns and keeps data', async () => {
    await localWithContent();
    const account = await finishSignIn(api, auth('u1'));
    const fake = failingApi();
    expect(await signOut(account, fake as never)).toBe('unsynced');
    expect(fake.logOut).not.toHaveBeenCalled();
    expect(await getAccount()).toEqual(account);
    const db = openDb(account.partition);
    expect(await db.items.count()).toBe(2);
    expect(await db.outbox.count()).toBeGreaterThan(0);
    db.close();
  });

  test('sign-out deletes account partition', async () => {
    await localWithContent();
    const account = await finishSignIn(api, auth('u1'));
    const cached = await getActiveDb();
    expect(cached.name).toBe(`atelier-${account.partition}`);
    const fake = okApi();
    expect(await signOut(account, fake as never)).toBe('signed-out');
    expect(fake.push).toHaveBeenCalled();
    expect(fake.logOut).toHaveBeenCalled(); // its failure is ignored
    expect(await getAccount()).toBeNull();
    const gone = openDb(account.partition);
    expect(await gone.items.count()).toBe(0);
    expect(await gone.workspaces.count()).toBe(0);
    gone.close();
    // The device returns to a fresh local board.
    const local = await getActiveDb();
    expect(local.name).toBe('atelier-local');
    expect((await liveWorkspaces(local)).map((w) => w.name)).toEqual(['My workspace']);
    expect(await hasUserContent(local)).toBe(false);
    // Signing back in to the same account opens a usable (not the closed, cached) db.
    await setAccount(account);
    const back = await getActiveDb();
    expect(back).not.toBe(cached);
    await expect(cached.items.count()).rejects.toThrow();
    expect(await back.items.count()).toBe(0);
  });

  test('sign-out anyway deletes even with unsynced edits', async () => {
    await localWithContent();
    const account = await finishSignIn(api, auth('u1'));
    expect(await signOut(account, failingApi() as never, { force: true })).toBe('signed-out');
    expect(await getAccount()).toBeNull();
    const gone = openDb(account.partition);
    expect(await gone.items.count()).toBe(0);
    gone.close();
  });
});

describe('pollMagic', () => {
  test('magic link polls until signed in', async () => {
    const poll = vi.fn()
      .mockResolvedValueOnce({ status: 'pending' })
      .mockResolvedValueOnce({ status: 'pending' })
      .mockResolvedValueOnce(auth('u1'));
    const result = await pollMagic({ magicPoll: poll } as never, 'r1', 's1', { intervalMs: 1, timeoutMs: 1000 });
    expect(result).toEqual(auth('u1'));
    expect(poll).toHaveBeenCalledTimes(3);
    expect(poll).toHaveBeenCalledWith('r1', 's1');
  });
  test('stops when cancelled or timed out', async () => {
    const poll = vi.fn(async () => ({ status: 'pending' }));
    const ctrl = new AbortController();
    const p = pollMagic({ magicPoll: poll } as never, 'r', 's', { intervalMs: 1, timeoutMs: 10_000, signal: ctrl.signal });
    ctrl.abort();
    expect(await p).toBeNull();
    await expect(pollMagic({ magicPoll: poll } as never, 'r', 's', { intervalMs: 1, timeoutMs: 5 })).rejects.toThrow('That link expired');
  });
});

describe('googleSignIn', () => {
  const googleApi = () => ({
    googleStartUrl: vi.fn((redirect: string, state: string) => `${SERVER}/auth/google/start?redirect_uri=${encodeURIComponent(redirect)}&state=${state}`),
    googleExchange: vi.fn(async (_code: string) => auth('u1')),
  });

  test('google flow checks state', async () => {
    const a = googleApi();
    chromeFake.identity.launchWebAuthFlow.mockImplementation(async ({ url }: { url: string }) => {
      const state = new URL(url).searchParams.get('state');
      return `https://abc.chromiumapp.org/google?code=c1&state=${state}`;
    });
    expect(await googleSignIn(a as never)).toEqual(auth('u1'));
    expect(a.googleStartUrl).toHaveBeenCalledWith(chromeFake.identity.getRedirectURL('google'), expect.stringMatching(/^[0-9a-f]{32}$/));
    expect(a.googleExchange).toHaveBeenCalledWith('c1');

    const b = googleApi();
    chromeFake.identity.launchWebAuthFlow.mockImplementation(async () => 'https://abc.chromiumapp.org/google?code=c1&state=forged');
    await expect(googleSignIn(b as never)).rejects.toBeInstanceOf(GoogleSignInError);
    expect(b.googleExchange).not.toHaveBeenCalled();
  });

  test('a closed window is a quiet failure', async () => {
    chromeFake.identity.launchWebAuthFlow.mockRejectedValue(new Error('The user did not approve access.'));
    await expect(googleSignIn(googleApi() as never)).rejects.toBeInstanceOf(GoogleSignInError);
  });
});
