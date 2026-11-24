import { sortByKey, type Category, type Item, type Reminder, type Workspace } from '@atelier/core';
import { deleteDb, enqueue, openDb, type AtelierDB } from '../data/db';
import { appendKey, clock } from '../data/repo';
import { getMeta, liveWorkspaces } from '../data/queries';
import { ensureSeed } from '../data/seed';
import { ApiClient, ApiError, type AuthResult } from '../sync/api';
import { syncOnce, type SyncApi } from '../sync/engine';
import { clearAccount, getAccount, LOCAL_PARTITION, partitionFor, setAccount, type Account } from './account';
import { forgetDb } from './activeDb';

export const FROM_DEVICE_NAME = 'From this device';
/** Account-partition meta: id of the "From this device" workspace, so a re-run merge reuses it. */
const FROM_DEVICE_KEY = 'fromDeviceWorkspaceId';

/** Seed names, as created by `ensureSeed`. */
const SEED = { workspace: 'My workspace', categories: ['Saved', 'Notes'] };

export class AccountSwitchError extends Error {
  constructor() {
    super('That is a different account. Sign out first to switch accounts.');
    this.name = 'AccountSwitchError';
  }
}

export class GoogleSignInError extends Error {
  constructor() {
    super("Google sign-in didn't finish. Try again.");
    this.name = 'GoogleSignInError';
  }
}

export class MagicLinkExpiredError extends Error {
  constructor() {
    super('That link expired. Try again.');
    this.name = 'MagicLinkExpiredError';
  }
}

const live = <R extends { deletedAt: string | null }>(r: R) => r.deletedAt === null;
const untouched = (r: { createdAt: string; updatedAt: string }) => r.updatedAt === r.createdAt;

/** True when the partition holds anything beyond an untouched first-run seed. */
export async function hasUserContent(db: AtelierDB): Promise<boolean> {
  return db.transaction('r', [db.workspaces, db.categories, db.items], async () => {
    if ((await db.items.filter(live).count()) > 0) return true;
    const workspaces = await db.workspaces.filter(live).toArray();
    if (workspaces.length === 0) return false;
    const ws = workspaces[0]!;
    if (workspaces.length > 1 || ws.name !== SEED.workspace || ws.emoji !== null || !untouched(ws)) return true;
    const cats = sortByKey(await db.categories.filter(live).toArray());
    return (
      cats.length !== SEED.categories.length ||
      cats.some((c, i) => c.workspaceId !== ws.id || c.name !== SEED.categories[i] || c.emoji !== null || !untouched(c))
    );
  });
}

interface LocalRows {
  categories: Category[];
  items: Item[];
  reminders: Reminder[];
}

/** Live rows whose parents are live too; categories in board order (workspace order, then their own). */
async function readLocal(local: AtelierDB): Promise<LocalRows> {
  return local.transaction('r', [local.workspaces, local.categories, local.items, local.reminders], async () => {
    const workspaces = await liveWorkspaces(local);
    const allCats = await local.categories.filter(live).toArray();
    const categories = workspaces.flatMap((w) => sortByKey(allCats.filter((c) => c.workspaceId === w.id)));
    const catIds = new Set(categories.map((c) => c.id));
    const items = (await local.items.filter(live).toArray()).filter((i) => catIds.has(i.categoryId));
    const itemIds = new Set(items.map((i) => i.id));
    const reminders = (await local.reminders.filter(live).toArray()).filter((r) => itemIds.has(r.itemId));
    return { categories, items, reminders };
  });
}

/**
 * Copy local rows into the account partition: all categories move (ids kept) into one
 * "From this device" workspace; items and reminders keep their ids, reminders now belong to the user.
 * Everything is queued for upload. Re-running reuses the same workspace and overwrites by id, so
 * nothing duplicates.
 */
async function mergeInto(target: AtelierDB, rows: LocalRows, userId: string): Promise<void> {
  const t = clock.now();
  await target.transaction('rw', [target.workspaces, target.categories, target.items, target.reminders, target.outbox, target.meta], async () => {
    const knownId = await getMeta<string>(target, FROM_DEVICE_KEY);
    const known = knownId ? await target.workspaces.get(knownId) : undefined;
    let ws: Workspace;
    if (known && known.deletedAt === null) ws = known;
    else {
      ws = {
        id: crypto.randomUUID(), createdAt: t, updatedAt: t, deletedAt: null, updatedBy: userId,
        name: FROM_DEVICE_NAME, emoji: null, ownerId: userId,
        sortKey: appendKey((await liveWorkspaces(target)).at(-1)?.sortKey ?? null),
      };
      await target.workspaces.put(ws);
      await enqueue(target, 'workspaces', ws, t);
      await target.meta.put({ key: FROM_DEVICE_KEY, value: ws.id });
    }
    if (!(await target.meta.get('selectedWorkspaceId'))) await target.meta.put({ key: 'selectedWorkspaceId', value: ws.id });

    const movedIds = new Set(rows.categories.map((c) => c.id));
    let last = sortByKey(
      (await target.categories.where('workspaceId').equals(ws.id).filter(live).toArray()).filter((c) => !movedIds.has(c.id)),
    ).at(-1)?.sortKey ?? null;
    for (const c of rows.categories) {
      last = appendKey(last);
      const moved: Category = { ...c, workspaceId: ws.id, sortKey: last, updatedAt: t, updatedBy: userId };
      await target.categories.put(moved);
      await enqueue(target, 'categories', moved, t);
    }
    for (const i of rows.items) {
      await target.items.put(i);
      await enqueue(target, 'items', i, t);
    }
    for (const r of rows.reminders) {
      const mine: Reminder = { ...r, userId, updatedBy: userId };
      await target.reminders.put(mine);
      await enqueue(target, 'reminders', mine, t);
    }
  });
}

/**
 * Complete a sign-in (password, magic link or Google): merge local content into the account's
 * partition when there is any, empty the local partition, switch the active account and ask the
 * worker to sync. While signed in, only the same account may sign in again (a renewed session).
 */
export async function finishSignIn(api: Pick<ApiClient, 'serverUrl'>, result: AuthResult): Promise<Account> {
  const account: Account = {
    serverUrl: api.serverUrl,
    userId: result.user.id,
    email: result.user.email,
    displayName: result.user.displayName,
    token: result.token,
    partition: partitionFor(api.serverUrl, result.user.id),
  };
  const current = await getAccount();
  if (current && current.partition !== account.partition) throw new AccountSwitchError();

  const local = openDb(LOCAL_PARTITION);
  try {
    if (await hasUserContent(local)) {
      const rows = await readLocal(local);
      const target = openDb(account.partition);
      try {
        await mergeInto(target, rows, account.userId);
      } finally {
        target.close();
      }
    }
  } finally {
    local.close();
  }
  await setAccount(account);
  // Only after the copy has committed: the local partition is emptied.
  forgetDb(LOCAL_PARTITION);
  await deleteDb(LOCAL_PARTITION);
  tellWorker('reminders-changed');
  tellWorker('sync-now');
  return account;
}

/** Best effort: without a listening worker the next alarm catches up. */
function tellWorker(type: 'sync-now' | 'reminders-changed'): void {
  try {
    void Promise.resolve(chrome.runtime.sendMessage({ type })).catch(() => undefined);
  } catch {
    /* no worker */
  }
}

/**
 * Sign out: flush the outbox first; with edits still unsynced, returns 'unsynced' and changes nothing
 * (unless `force`). Otherwise ends the session (failures ignored), forgets the account, deletes its
 * partition and leaves a freshly seeded local board.
 */
export async function signOut(
  account: Account,
  api: SyncApi & Pick<ApiClient, 'logOut'> = new ApiClient(account.serverUrl, account.token),
  opts: { force?: boolean } = {},
): Promise<'unsynced' | 'signed-out'> {
  if (!opts.force) {
    const db = openDb(account.partition);
    try {
      await syncOnce(db, account, api);
      if ((await db.outbox.count()) > 0) return 'unsynced';
    } finally {
      db.close();
    }
  }
  try {
    await api.logOut();
  } catch {
    /* the session dies with the partition anyway */
  }
  await clearAccount();
  forgetDb(account.partition);
  await deleteDb(account.partition);
  const local = openDb(LOCAL_PARTITION);
  try {
    await ensureSeed(local);
  } finally {
    local.close();
  }
  tellWorker('reminders-changed');
  return 'signed-out';
}

export const MAGIC_POLL = { intervalMs: 2000, timeoutMs: 15 * 60_000 };

/**
 * Poll a magic-link request until it signs in. Resolves null when cancelled; throws
 * MagicLinkExpiredError on timeout or when the server says the request is gone.
 */
export async function pollMagic(
  api: Pick<ApiClient, 'magicPoll'>,
  requestId: string,
  pollSecret: string,
  { intervalMs = MAGIC_POLL.intervalMs, timeoutMs = MAGIC_POLL.timeoutMs, signal }: { intervalMs?: number; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<AuthResult | null> {
  const deadline = Date.now() + timeoutMs;
  while (!signal?.aborted) {
    let res: AuthResult | { status: 'pending' };
    try {
      res = await api.magicPoll(requestId, pollSecret);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 404 || e.status === 410)) throw new MagicLinkExpiredError();
      throw e;
    }
    if (signal?.aborted) return null;
    if ('token' in res) return res;
    if (Date.now() >= deadline) throw new MagicLinkExpiredError();
    await wait(Math.min(intervalMs, Math.max(0, deadline - Date.now())), signal);
  }
  return null;
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
  });
}

const randomState = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Run Google sign-in in a browser auth window; the returned state must match the one sent. */
export async function googleSignIn(api: Pick<ApiClient, 'googleStartUrl' | 'googleExchange'>): Promise<AuthResult> {
  const state = randomState();
  const url = api.googleStartUrl(chrome.identity.getRedirectURL('google'), state);
  let responseUrl: string | undefined;
  try {
    responseUrl = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
  } catch {
    throw new GoogleSignInError();
  }
  let params: URLSearchParams;
  try {
    params = new URL(responseUrl ?? '').searchParams;
  } catch {
    throw new GoogleSignInError();
  }
  const code = params.get('code');
  if (!code || params.get('state') !== state) throw new GoogleSignInError();
  return api.googleExchange(code);
}
