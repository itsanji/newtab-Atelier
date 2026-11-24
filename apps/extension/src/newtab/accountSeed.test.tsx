import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { installChromeFake } from '../../test/chromeFake';
import { partitionFor, setAccount, setCurrentUserId, type Account } from '../account/account';
import { forgetDb, getActiveDb } from '../account/activeDb';
import { deleteDb } from '../data/db';
import { setMeta } from '../data/queries';
import { CURSOR_KEY } from '../sync/engine';
import { App } from './App';

const account: Account = {
  serverUrl: 'https://a.example', userId: 'u1', email: 'u1@x.io', displayName: 'Ada', token: 't', partition: partitionFor('https://a.example', 'u1'),
};

beforeEach(() => {
  installChromeFake();
  setCurrentUserId(null);
});
afterEach(async () => {
  forgetDb(account.partition);
  await deleteDb(account.partition);
  setCurrentUserId(null);
});

describe('signed-in first run', () => {
  test('a fresh account board waits for the first pull, then gets the starter workspace', async () => {
    await setAccount(account);
    render(<App />);
    expect(await screen.findByText('Getting your board from the server…')).toBeInTheDocument();
    const db = await getActiveDb();
    expect(await db.workspaces.count()).toBe(0);
    // The first pull found nothing on the server.
    await act(async () => { await setMeta(db, CURSOR_KEY, 4); });
    expect(await screen.findByRole('heading', { name: 'My workspace', level: 1 })).toBeInTheDocument();
    expect(await db.workspaces.count()).toBe(1);
  });

  test('a pulled workspace is shown without adding the starter one', async () => {
    await setAccount(account);
    render(<App />);
    await screen.findByText('Getting your board from the server…');
    const db = await getActiveDb();
    const t = '2026-11-24T00:00:00.000Z';
    await act(async () => {
      await db.transaction('rw', db.workspaces, db.meta, async () => {
        await db.workspaces.put({ id: crypto.randomUUID(), name: 'Shared', emoji: null, ownerId: 'u2', sortKey: 'a0', createdAt: t, updatedAt: t, deletedAt: null, updatedBy: 'u2' });
        await db.meta.put({ key: CURSOR_KEY, value: 9 });
      });
    });
    expect(await screen.findByRole('heading', { name: 'Shared', level: 1 })).toBeInTheDocument();
    expect((await db.workspaces.toArray()).map((w) => w.name)).toEqual(['Shared']);
  });
});
