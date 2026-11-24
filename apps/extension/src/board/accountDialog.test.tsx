import { afterEach, beforeEach, describe, expect, onTestFinished, test, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { installChromeFake, type ChromeFake } from '../../test/chromeFake';
import { getAccount, partitionFor, setAccount, setCurrentUserId, type Account } from '../account/account';
import { forgetDb, getActiveDb } from '../account/activeDb';
import { MAGIC_POLL } from '../account/signIn';
import { DbProvider } from '../data/DbContext';
import { deleteDb, openDb, type AtelierDB } from '../data/db';
import { createCategory, createItem, createWorkspace } from '../data/repo';
import { AccountEntry } from './AccountDialog';
import { OPEN_ACCOUNT_EVENT } from './SyncStatus';

const SERVER = 'https://a.example';
const user = { id: 'u1', email: 'u1@x.io', displayName: 'Ada' };
const PARTITION = partitionFor(SERVER, 'u1');

type Handler = (body: any) => { status?: number; json?: unknown } | Promise<{ status?: number; json?: unknown }>;
let routes: Record<string, Handler>;
let fetchMock: ReturnType<typeof vi.fn>;
let chromeFake: ChromeFake;
let db: AtelierDB;

function stubFetch() {
  fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    if (u.origin !== SERVER) throw new TypeError('Failed to fetch');
    const handler = routes[`${init.method ?? 'GET'} ${u.pathname}`];
    if (!handler) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
    const { status = 200, json } = await handler(init.body ? JSON.parse(String(init.body)) : undefined);
    return new Response(json === undefined ? null : JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
}

const config = (magicLink = true, google = true) => ({ json: { name: 'Atelier', auth: { password: true, magicLink, google } } });

beforeEach(async () => {
  chromeFake = installChromeFake();
  setCurrentUserId(null);
  routes = { 'GET /api/config': () => config() };
  stubFetch();
  await deleteDb('local');
  db = openDb('local');
});
afterEach(async () => {
  vi.unstubAllGlobals();
  MAGIC_POLL.intervalMs = 2000;
  db.close();
  forgetDb('local');
  forgetDb(PARTITION);
  await deleteDb('local');
  await deleteDb(PARTITION);
  setCurrentUserId(null);
});

const renderEntry = () => render(<DbProvider db={db}><AccountEntry /></DbProvider>);

async function connect(address = 'a.example/') {
  renderEntry();
  fireEvent.click(await screen.findByRole('button', { name: 'Connect a server' }));
  fireEvent.change(await screen.findByLabelText('Server address'), { target: { value: address } });
  fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
}

describe('AccountDialog', () => {
  test('connect normalises url and shows auth options from config', async () => {
    await connect('  a.example/ ');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(chromeFake.permissions.contains).toHaveBeenCalledWith({ origins: [`${SERVER}/*`] });
    expect(fetchMock.mock.calls[0]![0]).toBe(`${SERVER}/api/config`);
    expect(screen.getByRole('button', { name: 'Email me a link' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeInTheDocument();
    // One primary button per view.
    expect(document.querySelectorAll('.im-btn-primary')).toHaveLength(1);
  });

  test('config without magic link or google hides those options', async () => {
    routes['GET /api/config'] = () => config(false, false);
    await connect();
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Email me a link' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Continue with Google' })).toBeNull();
  });

  test("an unreachable server shows Can't reach that server", async () => {
    await connect('b.example');
    expect(await screen.findByText("Can't reach that server")).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Connect a server' })).toBeInTheDocument();
  });

  test('declined host permission is explained', async () => {
    chromeFake.permissions.contains.mockResolvedValue(false);
    chromeFake.permissions.request.mockResolvedValue(false);
    await connect();
    expect(await screen.findByText('Atelier needs your permission to reach that server.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('password sign-in from the dialog stores the account', async () => {
    routes['POST /api/auth/login'] = (body) =>
      body.email === 'u1@x.io' && body.password === 'pw' ? { json: { token: 't1', user } } : { status: 401, json: { error: 'Wrong email or password' } };
    await connect();
    await screen.findByRole('heading', { name: 'Sign in' });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'u1@x.io' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Wrong email or password')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(async () => expect((await getAccount())?.partition).toBe(PARTITION));
    expect(await getAccount()).toMatchObject({ serverUrl: SERVER, userId: 'u1', token: 't1', email: 'u1@x.io' });
    expect(await screen.findByRole('button', { name: 'Ada' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('create account adds a name field and signs up', async () => {
    const signup = vi.fn((body: unknown) => ({ json: { token: 't1', user } }));
    routes['POST /api/auth/signup'] = signup;
    await connect();
    await screen.findByRole('heading', { name: 'Sign in' });
    expect(screen.queryByLabelText('Name')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('heading', { name: 'Create account' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ada' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'u1@x.io' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw-long-enough' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(async () => expect((await getAccount())?.userId).toBe('u1'));
    expect(signup).toHaveBeenCalledWith({ email: 'u1@x.io', password: 'pw-long-enough', displayName: 'Ada' });
  });

  test('magic link polls until signed in', async () => {
    MAGIC_POLL.intervalMs = 5;
    let polls = 0;
    routes['POST /api/auth/magic/start'] = (body) => ({ json: { requestId: `r-${body.email}`, pollSecret: 's' } });
    routes['POST /api/auth/magic/poll'] = (body) => {
      expect(body).toEqual({ requestId: 'r-u1@x.io', pollSecret: 's' });
      return ++polls < 3 ? { status: 202, json: { status: 'pending' } } : { json: { token: 't1', user } };
    };
    await connect();
    await screen.findByRole('heading', { name: 'Sign in' });
    fireEvent.click(screen.getByRole('button', { name: 'Email me a link' }));
    expect(await screen.findByText('Enter your email first')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'u1@x.io' } });
    fireEvent.click(screen.getByRole('button', { name: 'Email me a link' }));
    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
    await waitFor(async () => expect((await getAccount())?.userId).toBe('u1'));
    expect(polls).toBe(3);
  });

  test('magic link can be cancelled', async () => {
    MAGIC_POLL.intervalMs = 5;
    routes['POST /api/auth/magic/start'] = () => ({ json: { requestId: 'r', pollSecret: 's' } });
    const poll = vi.fn(() => ({ status: 202, json: { status: 'pending' } }));
    routes['POST /api/auth/magic/poll'] = poll;
    await connect();
    await screen.findByRole('heading', { name: 'Sign in' });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'u1@x.io' } });
    fireEvent.click(screen.getByRole('button', { name: 'Email me a link' }));
    await screen.findByRole('heading', { name: 'Check your email' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in' })).not.toBeDisabled());
    const count = poll.mock.calls.length;
    await new Promise((r) => setTimeout(r, 30));
    expect(poll.mock.calls.length).toBe(count);
    expect(await getAccount()).toBeNull();
  });

  test('google sign-in from the dialog', async () => {
    routes['POST /api/auth/google/exchange'] = (body) => (body.code === 'c1' ? { json: { token: 't1', user } } : { status: 400, json: { error: 'bad' } });
    chromeFake.identity.launchWebAuthFlow.mockImplementation(async ({ url }: { url: string }) => {
      const u = new URL(url);
      expect(u.pathname).toBe('/auth/google/start');
      expect(u.searchParams.get('redirect_uri')).toBe(chromeFake.identity.getRedirectURL('google'));
      return `${chromeFake.identity.getRedirectURL('google')}?code=c1&state=${u.searchParams.get('state')}`;
    });
    await connect();
    await screen.findByRole('heading', { name: 'Sign in' });
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
    await waitFor(async () => expect((await getAccount())?.userId).toBe('u1'));
  });

  test('google with a mismatched state does not sign in', async () => {
    const exchange = vi.fn(() => ({ json: { token: 't1', user } }));
    routes['POST /api/auth/google/exchange'] = exchange;
    chromeFake.identity.launchWebAuthFlow.mockResolvedValue('https://x.chromiumapp.org/google?code=c1&state=other');
    await connect();
    await screen.findByRole('heading', { name: 'Sign in' });
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
    expect(await screen.findByText("Google sign-in didn't finish. Try again.")).toBeInTheDocument();
    expect(exchange).not.toHaveBeenCalled();
    expect(await getAccount()).toBeNull();
  });
});

describe('signed in', () => {
  const account: Account = { serverUrl: SERVER, userId: 'u1', email: 'u1@x.io', displayName: 'Ada', token: 't1', partition: PARTITION };

  async function signedInWithEdits() {
    await setAccount(account);
    setCurrentUserId('u1');
    db.close();
    db = await getActiveDb(); // the instance a page would hold
    const ws = await createWorkspace(db, { name: 'W' });
    const cat = await createCategory(db, { workspaceId: ws.id, name: 'C' });
    await createItem(db, { categoryId: cat.id, kind: 'note', title: 'kept' } as never);
  }

  test('shows server and email, and opens on the open-account event', async () => {
    await setAccount(account);
    renderEntry();
    await screen.findByRole('button', { name: 'Ada' });
    act(() => void window.dispatchEvent(new CustomEvent(OPEN_ACCOUNT_EVENT)));
    // Opened to sign in again: straight to the server's sign-in form, email filled in.
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveValue('u1@x.io');
  });

  test('account view lists server and email', async () => {
    await setAccount(account);
    renderEntry();
    fireEvent.click(await screen.findByRole('button', { name: 'Ada' }));
    expect(await screen.findByRole('heading', { name: 'Account' })).toBeInTheDocument();
    expect(screen.getByText(SERVER)).toBeInTheDocument();
    expect(screen.getByText('u1@x.io')).toBeInTheDocument();
  });

  test('sign-out with unflushed outbox warns and keeps data', async () => {
    await signedInWithEdits();
    routes['POST /api/sync/push'] = () => ({ status: 503, json: { error: 'down' } });
    const logout = vi.fn(() => ({ status: 204 }));
    routes['POST /api/auth/logout'] = logout;
    const createObjectURL = vi.fn(() => 'blob:x');
    const saved = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    onTestFinished(() => { URL.createObjectURL = saved.create; URL.revokeObjectURL = saved.revoke; click.mockRestore(); });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderEntry();
    fireEvent.click(await screen.findByRole('button', { name: 'Ada' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByText("Some changes haven't synced yet.")).toBeInTheDocument();
    errors.mockRestore();
    expect(await getAccount()).toEqual(account);
    expect(await db.items.count()).toBe(1);
    expect(logout).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Export data' }));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
    expect(await getAccount()).toEqual(account);

    fireEvent.click(screen.getByRole('button', { name: 'Sign out anyway' }));
    // The dialog closes once sign-out has finished.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await getAccount()).toBeNull();
    expect(logout).toHaveBeenCalled();
    const gone = openDb(PARTITION);
    expect(await gone.items.count()).toBe(0);
    gone.close();
  });

  test('sign-out deletes account partition when everything synced', async () => {
    await signedInWithEdits();
    routes['POST /api/sync/push'] = (body) => ({ json: { results: body.changes.map((c: any) => ({ table: c.table, id: c.row.id, status: 'applied' })) } });
    routes['GET /api/sync/pull'] = () => ({ json: { cursor: 3, workspaces: [], categories: [], items: [], reminders: [], members: [], removedWorkspaceIds: [] } });
    routes['POST /api/auth/logout'] = () => ({ status: 204 });
    renderEntry();
    fireEvent.click(await screen.findByRole('button', { name: 'Ada' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('button', { name: 'Connect a server' })).toBeInTheDocument();
    expect(await getAccount()).toBeNull();
    expect(screen.queryByText("Some changes haven't synced yet.")).toBeNull();
    const gone = openDb(PARTITION);
    expect(await gone.items.count()).toBe(0);
    gone.close();
  });
});
