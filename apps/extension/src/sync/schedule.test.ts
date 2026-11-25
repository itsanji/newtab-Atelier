import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { installChromeFake, type ChromeFake } from '../../test/chromeFake';
import { clearAccount, partitionFor, setAccount, setCurrentUserId, type Account } from '../account/account';
import { createWorkspace } from '../data/repo';
import { getActiveDb } from '../account/activeDb';

vi.mock('./engine', () => ({ syncOnce: vi.fn(async () => ({ ok: true, state: 'idle', remindersChanged: false })) }));
import { syncOnce } from './engine';
import { registerSync, SYNC_ALARM } from './schedule';

const acct: Account = { serverUrl: 'https://a.example', userId: 'u1', email: 'a@x.io', displayName: 'A', token: 't', partition: partitionFor('https://a.example', 'u1') };
const settle = () => new Promise((r) => setTimeout(r, 30));
let fake: ChromeFake;
let stop: () => void;
beforeEach(() => {
  fake = installChromeFake();
  setCurrentUserId(null);
  vi.mocked(syncOnce).mockClear();
  stop = registerSync(20);
});
afterEach(() => { stop(); setCurrentUserId(null); });

describe('worker sync scheduling', () => {
  test('alarm triggers syncOnce for active account only', async () => {
    fake.alarms.onAlarm.dispatch({ name: SYNC_ALARM });
    await settle();
    expect(syncOnce).not.toHaveBeenCalled(); // signed out
    await setAccount(acct);
    fake.alarms.onAlarm.dispatch({ name: 'reminder:x' });
    await settle();
    expect(syncOnce).not.toHaveBeenCalled(); // other alarm
    fake.alarms.onAlarm.dispatch({ name: SYNC_ALARM });
    await settle();
    expect(syncOnce).toHaveBeenCalledTimes(1);
    expect(vi.mocked(syncOnce).mock.calls[0]![1]).toMatchObject({ partition: acct.partition });
    await clearAccount();
  });

  test('sync-now message triggers sync', async () => {
    await setAccount(acct);
    fake.runtime.onMessage.dispatch({ type: 'sync-now' }, {}, () => {});
    fake.runtime.onMessage.dispatch({ type: 'other' }, {}, () => {});
    await settle();
    expect(syncOnce).toHaveBeenCalledTimes(1);
  });

  test('startup and install create the one-minute alarm and sync', async () => {
    await setAccount(acct);
    fake.runtime.onStartup.dispatch();
    fake.runtime.onInstalled.dispatch({});
    await settle();
    expect(fake.alarms.create).toHaveBeenCalledWith(SYNC_ALARM, { periodInMinutes: 1 });
    expect(syncOnce).toHaveBeenCalled();
  });

  test("the worker's own local writes schedule one debounced sync", async () => {
    await setAccount(acct);
    const db = await getActiveDb();
    await createWorkspace(db, { name: 'A' });
    await createWorkspace(db, { name: 'B' });
    expect(syncOnce).not.toHaveBeenCalled();
    await settle();
    expect(syncOnce).toHaveBeenCalledTimes(1);
  });

  test("skips the run when the account changes between reading it and opening the database", async () => {
    await setAccount(acct);
    const get = fake.storage.local.get;
    const original = get.getMockImplementation()!;
    // Sign-out lands right after syncActive reads the account.
    get.mockImplementationOnce(async (keys) => {
      const r = await original(keys);
      await clearAccount();
      return r;
    });
    fake.runtime.onMessage.dispatch({ type: 'sync-now' }, {}, () => {});
    await settle();
    expect(syncOnce).not.toHaveBeenCalled();
  });

  test('a sync that changed reminders re-syncs alarms', async () => {
    await setAccount(acct);
    vi.mocked(syncOnce).mockResolvedValueOnce({ ok: true, state: 'idle', remindersChanged: true } as never);
    fake.runtime.onMessage.dispatch({ type: 'sync-now' }, {}, () => {});
    await settle();
    expect(fake.alarms.getAll).toHaveBeenCalled();
  });
});
