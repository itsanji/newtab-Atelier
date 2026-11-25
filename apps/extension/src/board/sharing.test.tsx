import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { installChromeFake, type ChromeFake } from '../../test/chromeFake';
import { partitionFor, setAccount, setCurrentUserId, type Account } from '../account/account';
import { forgetDb, getActiveDb } from '../account/activeDb';
import { deleteDb, type AtelierDB, type Member } from '../data/db';
import { CURSOR_KEY } from '../sync/engine';
import { RECOVERED_KEY } from '../sync/status';
import { App } from '../newtab/App';
import { updateItem } from '../data/repo';

const SERVER = 'https://a.example';
const account: Account = { serverUrl: SERVER, userId: 'u1', email: 'u1@x.io', displayName: 'Ada', token: 't', partition: partitionFor(SERVER, 'u1') };
const T = '2026-11-24T00:00:00.000Z';
const row = (id: string, by: string) => ({ id, createdAt: T, updatedAt: T, deletedAt: null, updatedBy: by });
const member = (id: string, userId: string | null, role: Member['role'], email: string, displayName: string | null = null): Member =>
  ({ id, workspaceId: 'w1', userId, role, email, displayName, deletedAt: null });

type Handler = (body: any) => { status?: number; json?: unknown };
let routes: Record<string, Handler>;
let calls: string[];
let chromeFake: ChromeFake;
let db: AtelierDB;

async function seed(ownerId: string, members: Member[], opts: { restored?: boolean; shareToken?: string | null } = {}) {
  await setAccount(account);
  db = await getActiveDb();
  await db.transaction('rw', db.workspaces, db.categories, db.items, db.members, db.meta, async () => {
    await db.workspaces.put({ ...row('w1', ownerId), name: 'Team', emoji: null, ownerId, sortKey: 'a0' });
    await db.categories.put({ ...row('c1', ownerId), workspaceId: 'w1', name: 'Reading', emoji: null, sortKey: 'a0', tabGroup: null, shareToken: opts.shareToken ?? null });
    await db.items.put({ ...row('i1', ownerId), categoryId: 'c1', kind: 'link', sortKey: 'a0', title: 'Docs', url: 'https://docs.example/', faviconUrl: null, note: null, body: null, done: false, folderId: null, restored: opts.restored ?? false });
    await db.items.put({ ...row('i2', ownerId), categoryId: 'c1', kind: 'todo', sortKey: 'a1', title: 'Water plants', url: null, faviconUrl: null, note: null, body: null, done: false, folderId: null, restored: false });
    await db.members.bulkPut(members);
    await db.meta.put({ key: CURSOR_KEY, value: 1 });
  });
}

beforeEach(() => {
  chromeFake = installChromeFake();
  setCurrentUserId(null);
  calls = [];
  routes = {};
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    const key = `${init.method ?? 'GET'} ${u.pathname}`;
    calls.push(`${key} ${init.body ?? ''}`.trim());
    const h = routes[key];
    if (!h) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
    const { status = 200, json } = h(init.body ? JSON.parse(String(init.body)) : undefined);
    return new Response(json === undefined ? null : JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } });
  }));
});
afterEach(async () => {
  vi.unstubAllGlobals();
  forgetDb(account.partition);
  await deleteDb(account.partition);
  setCurrentUserId(null);
});

describe('roles', () => {
  test('viewer sees workspace read-only', async () => {
    await seed('u2', [member('m1', 'u2', 'owner', 'o@x.io', 'Olive'), member('m2', 'u1', 'viewer', 'u1@x.io', 'Ada')]);
    render(<App />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Team' })).toBeInTheDocument();
    expect(await screen.findByText('View only', { selector: '.im-tag' })).toBeInTheDocument();
    const col = await screen.findByRole('region', { name: 'Reading' });
    expect(within(col).getByRole('button', { name: 'Add' })).toBeDisabled();
    expect(within(col).getByRole('button', { name: 'Add' })).toHaveAttribute('title', 'View only');
    expect(within(col).queryByRole('button', { name: 'Category options' })).toBeNull();
    expect(within(col).queryByRole('button', { name: 'Link options' })).toBeNull();
    expect(within(col).queryByRole('button', { name: 'To-do options' })).toBeNull();
    expect(within(col).queryByRole('button', { name: /Drag to/ })).toBeNull();
    expect(await within(col).findByRole('checkbox')).toBeDisabled();
    expect(screen.getByRole('button', { name: /New category/ })).toBeDisabled();
  });

  test('an editor can edit', async () => {
    await seed('u2', [member('m1', 'u2', 'owner', 'o@x.io'), member('m2', 'u1', 'editor', 'u1@x.io')]);
    render(<App />);
    const col = await screen.findByRole('region', { name: 'Reading' });
    expect(within(col).getByRole('button', { name: 'Add' })).toBeEnabled();
    expect(screen.queryByText('View only', { selector: '.im-tag' })).toBeNull();
  });
});

describe('sharing', () => {
  test('owner invites member and sees pending tag', async () => {
    const user = userEvent.setup();
    const list = [member('m1', 'u1', 'owner', 'u1@x.io', 'Ada')];
    routes['GET /api/workspaces/w1/members'] = () => ({ json: { members: list } });
    routes['POST /api/workspaces/w1/members'] = (body) => {
      const m = member('m2', null, body.role, body.email);
      list.push(m);
      return { status: 201, json: { member: m } };
    };
    await seed('u1', list.slice());
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Share' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Email'), 'new@x.io');
    await user.selectOptions(within(dialog).getByLabelText('Role'), 'viewer');
    await user.click(within(dialog).getByRole('button', { name: 'Send invite' }));
    expect(await within(dialog).findByText('new@x.io')).toBeInTheDocument();
    expect(within(dialog).getByText('Pending')).toBeInTheDocument();
    expect(calls).toContain('POST /api/workspaces/w1/members {"email":"new@x.io","role":"viewer"}');
    expect(chromeFake.runtime.sendMessage).toHaveBeenCalledWith({ type: 'sync-now' });
    // Owner can change a role and remove.
    routes['PATCH /api/workspaces/w1/members/m2'] = (body) => { list[1] = { ...list[1]!, role: body.role }; return { json: { member: list[1] } }; };
    await user.selectOptions(within(dialog).getByLabelText('Role for new@x.io'), 'editor');
    await waitFor(() => expect(calls).toContain('PATCH /api/workspaces/w1/members/m2 {"role":"editor"}'));
    routes['DELETE /api/workspaces/w1/members/m2'] = () => { list.pop(); return { status: 204 }; };
    await user.click(within(dialog).getByRole('button', { name: 'Remove new@x.io' }));
    await waitFor(() => expect(within(dialog).queryByText('new@x.io')).toBeNull());
  });

  test('non-owner can leave', async () => {
    const user = userEvent.setup();
    const list = [member('m1', 'u2', 'owner', 'o@x.io', 'Olive'), member('m2', 'u1', 'editor', 'u1@x.io', 'Ada')];
    routes['GET /api/workspaces/w1/members'] = () => ({ json: { members: list } });
    routes['DELETE /api/workspaces/w1/members/m2'] = () => ({ status: 204 });
    await seed('u2', list);
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Share' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('button', { name: 'Send invite' })).toBeNull();
    await user.click(await within(dialog).findByRole('button', { name: 'Leave workspace' }));
    await waitFor(() => expect(calls).toContain('DELETE /api/workspaces/w1/members/m2'));
    expect(await screen.findByText('You left Team')).toBeInTheDocument();
    expect(chromeFake.runtime.sendMessage).toHaveBeenCalledWith({ type: 'sync-now' });
  });
});

describe('public link', () => {
  test('create, copy and stop public link', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    routes['POST /api/categories/c1/share'] = () => ({ json: { shareToken: 'tok', url: `${SERVER}/s/tok` } });
    routes['DELETE /api/categories/c1/share'] = () => ({ status: 204 });
    await seed('u1', [member('m1', 'u1', 'owner', 'u1@x.io')]);
    render(<App />);
    const col = await screen.findByRole('region', { name: 'Reading' });
    await user.click(within(col).getByRole('button', { name: 'Category options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Create public link' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${SERVER}/s/tok`));
    expect(await screen.findByText('Link copied')).toBeInTheDocument();
    expect(await within(col).findByText('Public')).toBeInTheDocument();

    await user.click(within(col).getByRole('button', { name: 'Category options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Copy public link' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));

    await user.click(within(col).getByRole('button', { name: 'Category options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Stop sharing' }));
    await waitFor(() => expect(within(col).queryByText('Public')).toBeNull());
    expect(calls).toContain('DELETE /api/categories/c1/share');
  });

  test('no public link without an account', async () => {
    const user = userEvent.setup();
    db = (await import('../data/db')).openDb('test-' + crypto.randomUUID());
    render(<App db={db} />);
    const col = await screen.findByRole('region', { name: 'Saved' });
    await user.click(within(col).getByRole('button', { name: 'Category options' }));
    expect(screen.queryByRole('menuitem', { name: /public link/i })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Share' })).toBeNull();
  });
});

describe('restored and recovered', () => {
  test('restored tag shows and clears on edit', async () => {
    await seed('u1', [member('m1', 'u1', 'owner', 'u1@x.io')], { restored: true });
    render(<App />);
    expect(await screen.findByText('Restored')).toBeInTheDocument();
    await act(async () => { await updateItem(db, 'i1', { title: 'Docs v2' }); });
    await waitFor(() => expect(screen.queryByText('Restored')).toBeNull());
    expect((await db.items.get('i1'))?.restored).toBe(false);
  });

  test('recovered items raise a notice once', async () => {
    await seed('u1', [member('m1', 'u1', 'owner', 'u1@x.io')]);
    await chrome.storage.session.set({ [RECOVERED_KEY]: { partition: account.partition, count: 2 } });
    render(<App />);
    expect(await screen.findByText("2 items couldn't sync and were saved to Recovered")).toBeInTheDocument();
    expect((await chrome.storage.session.get(RECOVERED_KEY))[RECOVERED_KEY]).toBeUndefined();
  });
});

describe('sidebar and workspace switching', () => {
  const second = async (ownerId: string) => {
    await db.workspaces.put({ ...row('w2', ownerId), name: 'Mine', emoji: null, ownerId, sortKey: 'a1' });
    await db.members.bulkPut([{ ...member('m9', 'u1', 'owner', 'u1@x.io'), workspaceId: 'w2' }]);
  };

  test('viewer workspace has no rename or delete in the sidebar; editors cannot delete', async () => {
    const user = userEvent.setup();
    await seed('u2', [member('m1', 'u2', 'owner', 'o@x.io'), member('m2', 'u1', 'viewer', 'u1@x.io')]);
    await second('u1');
    render(<App />);
    const nav = await screen.findByRole('navigation', { name: 'Workspaces' });
    await within(nav).findByText('Mine');
    // Only "Mine" (owner) has an options menu.
    await waitFor(() => expect(within(nav).getAllByRole('button', { name: 'Workspace options' })).toHaveLength(1));
    // Make Team an editor workspace: Edit but no Delete.
    await act(async () => { await db.members.put(member('m2', 'u1', 'editor', 'u1@x.io')); });
    await waitFor(() => expect(within(nav).getAllByRole('button', { name: 'Workspace options' })).toHaveLength(2));
    await user.click(within(nav).getAllByRole('button', { name: 'Workspace options' })[0]!);
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).toBeNull();
  });

  test('share dialog shows the members of the workspace it is opened for', async () => {
    const user = userEvent.setup();
    routes['GET /api/workspaces/w1/members'] = () => ({ json: { members: [member('m1', 'u1', 'owner', 'u1@x.io', 'Ada'), member('m3', 'u3', 'editor', 'first@x.io')] } });
    routes['GET /api/workspaces/w2/members'] = () => ({ status: 503, json: { error: 'down' } });
    await seed('u1', [member('m1', 'u1', 'owner', 'u1@x.io', 'Ada')]);
    await second('u1');
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Share' }));
    expect(await screen.findByText('first@x.io')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await user.click(within(screen.getByRole('navigation', { name: 'Workspaces' })).getByRole('button', { name: /Mine/ }));
    await user.click(await screen.findByRole('button', { name: 'Share' }));
    await screen.findByRole('dialog');
    expect(screen.queryByText('first@x.io')).toBeNull();
  });
});
