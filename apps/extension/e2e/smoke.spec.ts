import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const executablePath = process.env.ATELIER_CHROMIUM ?? '/usr/bin/chromium';
const TEST_URL = 'http://atelier.test/';

let context: BrowserContext;
let userDataDir: string;
let extensionId: string;

test.beforeAll(async () => {
  userDataDir = mkdtempSync(path.join(tmpdir(), 'atelier-e2e-'));
  context = await chromium.launchPersistentContext(userDataDir, {
    executablePath,
    headless: false,
    args: [
      '--headless=new',
      `--disable-extensions-except=${dist}`,
      `--load-extension=${dist}`,
    ],
  });
  await context.route('http://atelier.test/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><head><title>Example Domain</title></head><body><h1>Example Domain</h1></body></html>',
    }),
  );
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  extensionId = new URL(worker.url()).host;
});

test.afterAll(async () => {
  await context?.close();
  rmSync(userDataDir, { recursive: true, force: true });
});

const newtabUrl = () => `chrome-extension://${extensionId}/src/newtab/index.html`;

async function openNewTab(): Promise<Page> {
  const page = await context.newPage();
  await page.goto(newtabUrl());
  return page;
}

test('new tab shows the seeded workspace and categories', async () => {
  const page = await openNewTab();
  await expect(page.getByText('My workspace').first()).toBeVisible({ timeout: 1000 });
  await expect(page.getByRole('region', { name: 'Saved' })).toBeVisible({ timeout: 1000 });
  await expect(page.getByRole('region', { name: 'Notes' })).toBeVisible({ timeout: 1000 });
  await page.close();
});

test('saving a tab from the popup puts it on the board, and it can be dragged to another category', async () => {
  const board = await openNewTab();
  await expect(board.getByRole('region', { name: 'Saved' })).toBeVisible();

  const target = await context.newPage();
  await target.goto(TEST_URL);
  const tabId = await board.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({});
    return tabs.find((t) => t.url === url)?.id;
  }, TEST_URL);
  expect(tabId).toBeDefined();

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/src/popup/index.html?tabId=${tabId}`);
  await popup.getByRole('radio', { name: 'Saved' }).click();
  await popup.getByRole('button', { name: 'Save tab' }).click();

  await board.bringToFront();
  const saved = board.getByRole('region', { name: 'Saved' });
  const notes = board.getByRole('region', { name: 'Notes' });
  const row = saved.locator('[data-item-id]', { hasText: 'Example Domain' });
  await expect(row).toBeVisible();

  // Drag the link row onto the Notes column with real pointer moves.
  const from = (await row.boundingBox())!;
  const to = (await notes.boundingBox())!;
  const sx = from.x + from.width / 2;
  const sy = from.y + from.height / 2;
  const tx = to.x + to.width / 2;
  const ty = to.y + Math.min(to.height / 2, 120);
  await board.mouse.move(sx, sy);
  await board.mouse.down();
  await board.mouse.move(sx + 12, sy + 12, { steps: 4 });
  await board.mouse.move(tx, ty, { steps: 20 });
  await board.mouse.up();

  await expect(notes.locator('[data-item-id]', { hasText: 'Example Domain' })).toBeVisible();
  await expect(saved.locator('[data-item-id]', { hasText: 'Example Domain' })).toHaveCount(0);

  await board.reload();
  await expect(
    board.getByRole('region', { name: 'Notes' }).locator('[data-item-id]', { hasText: 'Example Domain' }),
  ).toBeVisible();
  await board.close();
  await popup.close().catch(() => undefined);
  await target.close().catch(() => undefined);
});

test('theme button switches to nocturne', async () => {
  const page = await openNewTab();
  const html = page.locator('html');
  for (let i = 0; i < 3 && !(await html.evaluate((el) => el.classList.contains('nocturne'))); i++) {
    await page.getByRole('button', { name: /^Theme:/ }).click();
  }
  await expect(html).toHaveClass(/nocturne/);
  await page.close();
});
