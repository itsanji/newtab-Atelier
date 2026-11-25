import { getAccount } from '../account/account';
import { ApiClient } from '../sync/api';
import { CURSOR_KEY, syncOnce } from '../sync/engine';
import type { AtelierDB } from './db';
import { getMeta } from './queries';
import { createCategory, createWorkspace, tx } from './repo';

const ACCOUNT_DB_PREFIX = 'atelier-acct-';
/** How long a first open waits for the first pull before seeding anyway (a hung server must not blank the popup). */
export const FIRST_PULL = { waitMs: 3000 };

/**
 * True while a signed-in partition is empty and has never completed a pull: seeding now could add a
 * starter workspace next to the account's real ones. Local partitions never wait.
 */
export async function awaitingFirstPull(db: AtelierDB): Promise<boolean> {
  if (!db.name.startsWith(ACCOUNT_DB_PREFIX)) return false;
  if ((await db.workspaces.count()) > 0) return false;
  return (await getMeta(db, CURSOR_KEY)) === undefined;
}

/**
 * One sync round for `db` if it is the active account's partition, waiting at most `FIRST_PULL.waitMs`
 * (the round carries on in the background). Never throws.
 */
async function firstPull(db: AtelierDB): Promise<void> {
  try {
    const account = await getAccount();
    if (!account || `atelier-${account.partition}` !== db.name) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      syncOnce(db, account, new ApiClient(account.serverUrl, account.token)),
      new Promise<void>((resolve) => { timer = setTimeout(resolve, FIRST_PULL.waitMs); }),
    ]).finally(() => clearTimeout(timer));
  } catch (e) {
    console.error(e);
  }
}

/**
 * Make sure a workspace exists (popup, worker saves, sign-out). A signed-in partition that has never
 * pulled first runs one sync, so the starter workspace is only created when the server has none.
 * If that sync can't complete (offline), it seeds anyway: a save must land somewhere, and a stray
 * starter workspace is better than a lost save.
 */
export async function ensureSeed(db: AtelierDB): Promise<void> {
  if (await awaitingFirstPull(db)) await firstPull(db);
  await seedNow(db);
}

/** First run only: when no workspace exists at all, create a starter one (atomically). */
function seedNow(db: AtelierDB): Promise<void> {
  return tx(db, async () => {
    if ((await db.workspaces.count()) > 0) return;
    const ws = await createWorkspace(db, { name: 'My workspace' });
    await createCategory(db, { workspaceId: ws.id, name: 'Saved' });
    await createCategory(db, { workspaceId: ws.id, name: 'Notes' });
  });
}
