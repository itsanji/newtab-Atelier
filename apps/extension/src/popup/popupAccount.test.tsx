import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { installChromeFake } from '../../test/chromeFake';
import { partitionFor, setAccount, setCurrentUserId, type Account } from '../account/account';
import { forgetDb } from '../account/activeDb';
import { deleteDb, openDb } from '../data/db';
import { Popup } from './Popup';

const SERVER = 'https://a.example';
const account: Account = { serverUrl: SERVER, userId: 'u1', email: 'u1@x.io', displayName: 'Ada', token: 't', partition: partitionFor(SERVER, 'u1') };
const t = '2026-11-24T00:00:00.000Z';
const row = { createdAt: t, updatedAt: t, deletedAt: null, updatedBy: 'u1' };
const ws = { ...row, id: '00000000-0000-4000-8000-000000000001', name: 'Home', emoji: null, ownerId: 'u1', sortKey: 'a0' };
const cat = { ...row, id: '00000000-0000-4000-8000-000000000002', workspaceId: ws.id, name: 'Inbox', emoji: null, sortKey: 'a0', tabGroup: null, shareToken: null };

beforeEach(async () => {
  const fake = installChromeFake();
  await fake.tabs.create({ url: 'https://a.com/x', title: 'A page' });
  window.close = vi.fn();
  await setAccount(account);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    cursor: 3, workspaces: [ws], categories: [cat], items: [], reminders: [], members: [], removedWorkspaceIds: [],
  }), { status: 200 })));
});
afterEach(async () => {
  vi.unstubAllGlobals();
  forgetDb(account.partition);
  await deleteDb(account.partition);
  setCurrentUserId(null);
});

describe('popup on a freshly signed-in device', () => {
  test('pulls first and saves into the account workspace instead of adding a starter one', async () => {
    render(<Popup />);
    expect(await screen.findByText('Save to · Home')).toBeInTheDocument();
    const db = openDb(account.partition);
    expect((await db.workspaces.toArray()).map((w) => w.name)).toEqual(['Home']);
    db.close();
  });
});
