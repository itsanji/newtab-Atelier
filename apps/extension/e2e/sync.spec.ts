import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Two devices (separate Chromium profiles with the built extension) against a real server on a
// fresh database in the test Postgres (`bun run db:test:up`). Needs an `ATELIER_E2E=1` build, which
// grants http://127.0.0.1/* so connecting doesn't ask for permission.

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const dist = path.resolve(here, '../dist-e2e');
const executablePath = process.env.ATELIER_CHROMIUM ?? '/usr/bin/chromium';
const bun = process.env.ATELIER_BUN ?? 'bun';
const ADMIN_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:54329/postgres';
const TEST_URL = 'http://atelier.test/';
const PASSWORD = 'correct horse battery';
const A = { name: 'Ada', email: 'ada@example.test' };
const C = { name: 'Cleo', email: 'cleo@example.test' };

test.describe.configure({ mode: 'serial' });

interface Device {
  context: BrowserContext;
  dir: string;
  extensionId: string;
  board: Page;
}

const dbName = `atelier_e2e_${process.pid}_${Date.now()}`;
let server: ChildProcess | undefined;
let serverLog = '';
let serverUrl: string;
const devices: Device[] = [];
let a: Device;
let b: Device;

/** Runs SQL against the admin database with Bun's client (the test runner is Node). */
function admin(statement: string) {
  const script = `import { SQL } from 'bun'; const s = new SQL(process.env.ADMIN_URL); await s.unsafe(process.env.STMT); await s.close();`;
  const r = spawnSync(bun, ['-e', script], { env: { ...process.env, ADMIN_URL, STMT: statement }, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${statement} failed (is the test Postgres up? bun run db:test:up): ${r.stderr || r.error}`);
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}

async function startServer() {
  admin(`create database ${dbName}`);
  const port = await freePort();
  serverUrl = `http://127.0.0.1:${port}`;
  const db = new URL(ADMIN_URL);
  db.pathname = `/${dbName}`;
  server = spawn(bun, ['apps/server/src/main.ts'], {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      PUBLIC_URL: serverUrl,
      DATABASE_URL: db.toString(),
      SESSION_SECRET: 'e2e-secret-e2e-secret-e2e-secret-e2e!',
      PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout!.on('data', (d) => (serverLog += d));
  server.stderr!.on('data', (d) => (serverLog += d));
  const exited = new Promise<never>((_, reject) => server!.once('exit', (code) => reject(new Error(`server exited (${code}):\n${serverLog}`))));
  exited.catch(() => undefined); // the normal exit in afterAll is not an error
  const ready = (async () => {
    for (let i = 0; i < 200; i++) {
      try {
        if ((await fetch(`${serverUrl}/health`)).ok) return;
      } catch {
        /* not listening yet */
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`server did not start:\n${serverLog}`);
  })();
  await Promise.race([ready, exited]);
}

async function launchDevice(): Promise<Device> {
  const dir = mkdtempSync(path.join(tmpdir(), 'atelier-e2e-sync-'));
  const context = await chromium.launchPersistentContext(dir, {
    executablePath,
    headless: false,
    args: ['--headless=new', `--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });
  await context.route('http://atelier.test/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><head><title>Example Domain</title></head><body><h1>Example Domain</h1></body></html>',
    }),
  );
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const extensionId = new URL(worker.url()).host;
  const board = await context.newPage();
  await board.goto(`chrome-extension://${extensionId}/src/newtab/index.html`);
  await expect(board.getByRole('region', { name: 'Saved' })).toBeVisible();
  const device = { context, dir, extensionId, board };
  devices.push(device);
  return device;
}

async function signUpViaApi(user: { name: string; email: string }) {
  const res = await fetch(`${serverUrl}/api/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: user.email, password: PASSWORD, displayName: user.name }),
  });
  expect(res.status).toBe(201);
}

/** Connect to the test server from the sidebar and sign in (or create the account). */
async function connect(board: Page, user: { name: string; email: string }, mode: 'signin' | 'signup') {
  await board.getByRole('button', { name: 'Connect a server' }).click();
  const connectDialog = board.getByRole('dialog', { name: 'Connect a server' });
  await connectDialog.getByLabel('Server address').fill(serverUrl);
  await connectDialog.getByRole('button', { name: 'Connect' }).click();
  let dialog = board.getByRole('dialog', { name: 'Sign in' });
  await expect(dialog).toBeVisible();
  if (mode === 'signup') {
    await dialog.getByRole('button', { name: 'Create account' }).click();
    dialog = board.getByRole('dialog', { name: 'Create account' });
    await dialog.getByLabel('Name').fill(user.name);
  }
  await dialog.getByLabel('Email').fill(user.email);
  await dialog.getByLabel('Password').fill(PASSWORD);
  await dialog.getByRole('button', { name: mode === 'signup' ? 'Create account' : 'Sign in' }).click();
  await expect(dialog).toBeHidden();
  await expect(board.getByRole('button', { name: user.name })).toBeVisible();
}

const savedItem = (board: Page, title: string) =>
  board.getByRole('region', { name: 'Saved' }).locator('[data-item-id]', { hasText: title });

test.beforeAll(async () => {
  await startServer();
  [a, b] = await Promise.all([launchDevice(), launchDevice()]);
});

test.afterAll(async () => {
  await Promise.all(devices.map((d) => d.context.close().catch(() => undefined)));
  for (const d of devices) rmSync(d.dir, { recursive: true, force: true });
  if (server && server.exitCode === null) {
    const gone = new Promise((r) => server!.once('exit', r));
    server.kill('SIGTERM');
    await gone;
  }
  try {
    admin(`drop database if exists ${dbName} with (force)`);
  } catch (e) {
    console.warn(String(e));
  }
});

test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus) await info.attach('server log', { body: serverLog, contentType: 'text/plain' });
});

test('device A creates an account and saves a tab', async () => {
  await connect(a.board, A, 'signup');
  await expect(a.board.getByRole('status').filter({ hasText: 'Synced' })).toBeVisible();

  // A workspace name both devices and the invited viewer can find.
  await a.board.getByRole('navigation', { name: 'Workspaces' }).getByRole('button', { name: 'Workspace options' }).click();
  await a.board.getByRole('menuitem', { name: 'Edit' }).click();
  const edit = a.board.getByRole('dialog', { name: 'Edit workspace' });
  await edit.getByLabel('Name').fill('Studio');
  await edit.getByRole('button', { name: 'Save workspace' }).click();
  await expect(a.board.getByRole('heading', { level: 1, name: 'Studio' })).toBeVisible();

  // Save a tab from the popup, as in the smoke test.
  const target = await a.context.newPage();
  await target.goto(TEST_URL);
  const tabId = await a.board.evaluate(async (url) => (await chrome.tabs.query({})).find((t) => t.url === url)?.id, TEST_URL);
  expect(tabId).toBeDefined();
  const popup = await a.context.newPage();
  await popup.goto(`chrome-extension://${a.extensionId}/src/popup/index.html?tabId=${tabId}`);
  await popup.getByRole('radio', { name: 'Saved' }).click();
  // Saving closes the saved tab and then the popup itself.
  const closed = popup.waitForEvent('close');
  await popup.getByRole('button', { name: 'Save tab' }).click();
  await closed;
  await target.close().catch(() => undefined);

  await a.board.bringToFront();
  await expect(savedItem(a.board, 'Example Domain')).toBeVisible();
  await expect(a.board.getByRole('status').filter({ hasText: 'Synced' })).toBeVisible();
});

test('device B signs in to the same account, gets the link, then sees A\'s edits live', async () => {
  await connect(b.board, A, 'signin');
  await expect(b.board.getByRole('heading', { level: 1, name: 'Studio' })).toBeVisible({ timeout: 10_000 });
  await expect(savedItem(b.board, 'Example Domain')).toBeVisible({ timeout: 10_000 });

  // With both boards open, a rename on A reaches B without a reload.
  await a.board.bringToFront();
  await a.board.getByRole('region', { name: 'Notes' }).getByRole('button', { name: 'Category options' }).click();
  await a.board.getByRole('menuitem', { name: 'Rename' }).click();
  await a.board.getByLabel('Category name').fill('Reading');
  await a.board.getByLabel('Category name').press('Enter');
  await expect(a.board.getByRole('region', { name: 'Reading' })).toBeVisible();

  await b.board.bringToFront();
  await expect(b.board.getByRole('region', { name: 'Reading' })).toBeVisible({ timeout: 10_000 });
  await expect(b.board.getByRole('region', { name: 'Notes' })).toHaveCount(0);
});

test('a title edited on B shows up on A', async () => {
  const row = savedItem(b.board, 'Example Domain');
  await row.hover();
  await row.getByRole('button', { name: 'Link options' }).click();
  await b.board.getByRole('menuitem', { name: 'Edit' }).click();
  const dialog = b.board.getByRole('dialog', { name: 'Edit link' });
  await dialog.getByLabel('Title').fill('Example, renamed on B');
  await dialog.getByRole('button', { name: 'Save link' }).click();
  await expect(savedItem(b.board, 'Example, renamed on B')).toBeVisible();

  await a.board.bringToFront();
  await expect(savedItem(a.board, 'Example, renamed on B')).toBeVisible({ timeout: 10_000 });
});

test('A shares the category publicly; the link shows the item', async () => {
  // Capture what the menu copies instead of relying on clipboard access in headless Chromium.
  await a.board.evaluate(() => {
    (window as unknown as { copied?: string }).copied = undefined;
    navigator.clipboard.writeText = async (text: string) => {
      (window as unknown as { copied?: string }).copied = text;
    };
  });
  const saved = a.board.getByRole('region', { name: 'Saved' });
  await saved.getByRole('button', { name: 'Category options' }).click();
  await a.board.getByRole('menuitem', { name: 'Create public link' }).click();
  await expect(saved.getByText('Public', { exact: true })).toBeVisible();
  const url = await a.board.evaluate(() => (window as unknown as { copied?: string }).copied);
  expect(url).toMatch(new RegExp(`^${serverUrl.replace(/\./g, '\\.')}/s/`));

  const page = await a.context.newPage();
  const res = await page.goto(url!);
  expect(res?.status()).toBe(200);
  await expect(page.getByText('Example, renamed on B')).toBeVisible();
  await page.close();
});

test('a viewer invited by A sees the workspace read-only on B', async () => {
  await signUpViaApi(C);

  await a.board.getByRole('button', { name: 'Share' }).click();
  const share = a.board.getByRole('dialog', { name: 'Share Studio' });
  await share.getByLabel('Email').fill(C.email);
  await share.getByLabel('Role').selectOption('viewer');
  await share.getByRole('button', { name: 'Send invite' }).click();
  await expect(share.getByRole('list', { name: 'Members' }).getByText(C.name)).toBeVisible();
  await share.getByRole('button', { name: 'Close' }).click();

  // B signs out of A's account and in as C.
  await b.board.bringToFront();
  await b.board.getByRole('button', { name: A.name }).click();
  await b.board.getByRole('dialog', { name: 'Account' }).getByRole('button', { name: 'Sign out' }).click();
  await expect(b.board.getByRole('button', { name: 'Connect a server' })).toBeVisible();
  await expect(savedItem(b.board, 'Example, renamed on B')).toHaveCount(0);

  await connect(b.board, C, 'signin');
  await b.board.getByRole('navigation', { name: 'Workspaces' }).getByRole('button', { name: /Studio/ }).click();
  await expect(b.board.getByRole('heading', { level: 1, name: 'Studio' })).toBeVisible();
  await expect(b.board.getByText('View only', { exact: true }).first()).toBeVisible();
  const row = savedItem(b.board, 'Example, renamed on B');
  await expect(row).toBeVisible();
  await expect(row.getByRole('button', { name: 'Link options' })).toHaveCount(0);
  await expect(b.board.getByRole('region', { name: 'Saved' }).getByRole('button', { name: 'Category options' })).toHaveCount(0);
});
