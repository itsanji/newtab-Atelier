import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderSharePage } from '../../server/src/share/page';
import { magicConfirmPage } from '../../server/src/auth/pages';

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist-e2e');
const executablePath = process.env.ATELIER_CHROMIUM ?? '/usr/bin/chromium';

// Long unbroken strings: nothing to wrap them at, so only truncation or `overflow-wrap: anywhere` keeps them in.
const LONG_TITLE = `Hono - Web framework built on Web Standards ${'T'.repeat(160)}`;
const LONG_URL = `https://example.com/${'a'.repeat(300)}`;
const LONG_CATEGORY = 'C'.repeat(150);
const LONG_WORKSPACE = 'W'.repeat(140);
const LONG_TODO = 'D'.repeat(260);
const LONG_NOTE = 'N'.repeat(320);
const WIDTHS = [1500, 1024, 800, 400];

let context: BrowserContext;
let userDataDir: string;
let extensionId: string;

test.beforeAll(async () => {
  userDataDir = mkdtempSync(path.join(tmpdir(), 'atelier-e2e-'));
  context = await chromium.launchPersistentContext(userDataDir, {
    executablePath,
    headless: false,
    args: ['--headless=new', `--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  extensionId = new URL(worker.url()).host;
});

test.afterAll(async () => {
  await context?.close();
  rmSync(userDataDir, { recursive: true, force: true });
});

/**
 * Fails with the offending measurements when anything makes the page scroll sideways. The board is the one
 * thing that scrolls sideways, inside itself; its columns stay 300px and fit its height.
 */
async function expectNoHorizontalOverflow(page: Page, label: string) {
  const m = await page.evaluate(() => {
    const doc = document.documentElement;
    const board = document.querySelector('.atl-board');
    return {
      doc: { scroll: doc.scrollWidth, client: doc.clientWidth },
      board: board ? { scroll: board.scrollWidth, client: board.clientWidth } : null,
      columns: Array.from(document.querySelectorAll('.atl-column')).map((c) => c.getBoundingClientRect().width),
      // Each column head stays on one row: its visible children share one vertical centre and stay inside it.
      heads: Array.from(document.querySelectorAll('.atl-column-head')).map((h) => {
        const r = h.getBoundingClientRect();
        const kids = Array.from(h.children).map((k) => k.getBoundingClientRect()).filter((k) => k.width > 0);
        return {
          name: h.closest('.atl-column')?.getAttribute('aria-label') ?? '',
          offRow: kids.length ? Math.max(...kids.map((k) => k.top + k.height / 2)) - Math.min(...kids.map((k) => k.top + k.height / 2)) : 0,
          overflow: Math.max(0, ...kids.map((k) => k.right - r.right)),
        };
      }),
    };
  });
  expect(m.doc.scroll, `${label}: page scrolls sideways`).toBeLessThanOrEqual(m.doc.client);
  for (const w of m.columns) expect(w, `${label}: column wider than 300px`).toBeLessThanOrEqual(301);
  for (const h of m.heads) {
    expect(h.offRow, `${label}: head of "${h.name}" wrapped onto a second row`).toBeLessThanOrEqual(2);
    expect(h.overflow, `${label}: head of "${h.name}" spills out of its column`).toBeLessThanOrEqual(1);
  }
}

/** The column whose right edge is furthest right (the one most likely to push a popover off-screen). */
async function rightmostColumn(page: Page) {
  const index = await page.evaluate(() => {
    const cols = Array.from(document.querySelectorAll('.atl-column'));
    let best = 0;
    cols.forEach((c, i) => { if (c.getBoundingClientRect().right > cols[best]!.getBoundingClientRect().right) best = i; });
    return best;
  });
  return page.locator('.atl-column').nth(index);
}

test('long content never makes the page scroll sideways', async () => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.goto(`chrome-extension://${extensionId}/src/newtab/index.html`);
  const saved = page.getByRole('region', { name: 'Saved', exact: true });
  await expect(saved).toBeVisible();

  // Worst-case column head: "Saved" with both the tab-group tag and the public tag. Written straight into
  // IndexedDB (no server here), then reloaded so the board reads it.
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('atelier-local');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction('categories', 'readwrite');
      const store = tx.objectStore('categories');
      const all = store.getAll();
      all.onsuccess = () => {
        const cat = (all.result as Array<{ name: string }>).find((c) => c.name === 'Saved')!;
        store.put({ ...cat, shareToken: 'layout-test', tabGroup: { title: 'Research', color: 'blue' } });
      };
      tx.oncomplete = () => { open.result.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }));
  await page.reload();
  await expect(saved.getByText('Public', { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page, 'tagged column head at 1500px');
  // "Public" is never cut short, and the title keeps real room next to the tags.
  const fit = await saved.evaluate((col) => {
    const pub = Array.from(col.querySelectorAll('.atl-column-head > .im-tag')).find((t) => t.textContent === 'Public')!;
    return { pubCut: pub.scrollWidth > pub.clientWidth, title: col.querySelector('.atl-column-title')!.getBoundingClientRect().width };
  });
  expect(fit.pubCut, '"Public" tag is truncated').toBe(false);
  expect(fit.title, 'column title squeezed').toBeGreaterThanOrEqual(48);

  // Workspace name
  await page.locator('.atl-sidebar').hover({ position: { x: 20, y: 300 } });
  await page.getByRole('button', { name: 'Workspace options' }).first().click();
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  await page.getByLabel('Name', { exact: true }).fill(LONG_WORKSPACE);
  await page.getByRole('button', { name: 'Save workspace' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(LONG_WORKSPACE);

  // A link with a long title and url, a to-do and a note, all in "Saved"
  await saved.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Link' }).click();
  await saved.getByLabel('Web address').fill(LONG_URL);
  await saved.getByLabel('Title').fill(LONG_TITLE);
  await saved.getByRole('button', { name: 'Add link' }).click();
  await expect(saved.getByTitle(LONG_TITLE)).toBeVisible();

  await saved.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: 'To-do' }).click();
  await saved.getByLabel('To-do text').fill(LONG_TODO);
  await saved.getByLabel('To-do text').press('Enter');
  await expect(saved.getByText(LONG_TODO)).toBeVisible();

  await saved.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Note' }).click();
  await expect(saved.getByRole('textbox', { name: 'New note' })).toBeFocused();
  await page.keyboard.insertText(LONG_NOTE);
  await expect(saved.getByText(LONG_NOTE)).toBeVisible();

  // A long category name, then enough columns to fill more than one row
  await saved.locator('.atl-title-btn').click();
  await saved.getByLabel('Category name').fill(LONG_CATEGORY);
  await saved.getByLabel('Category name').press('Enter');
  const long = page.getByRole('region', { name: LONG_CATEGORY });
  await expect(long).toBeVisible();
  for (const name of ['Reading', 'Projects', 'Recipes', 'Travel']) {
    await page.getByRole('button', { name: /New category/ }).click();
    await page.getByLabel('Category name').fill(name);
    await page.getByLabel('Category name').press('Enter');
    await expect(page.getByRole('region', { name })).toBeVisible();
  }

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await expectNoHorizontalOverflow(page, `${width}px`);

    // The last column's options menu and its emoji picker stay on screen.
    const last = await rightmostColumn(page);
    await last.scrollIntoViewIfNeeded();
    await last.getByRole('button', { name: 'Category options' }).click();
    await expect(page.getByRole('menu')).toBeVisible();
    await expectNoHorizontalOverflow(page, `${width}px, column menu open`);
    await page.keyboard.press('Escape');

    await last.getByRole('button', { name: /emoji/ }).click();
    await expect(page.getByRole('dialog', { name: 'Choose emoji' })).toBeVisible();
    await expectNoHorizontalOverflow(page, `${width}px, emoji picker open`);
    await page.keyboard.press('Escape');

    // Item and to-do menus in the long column (the reminder picker too).
    await long.scrollIntoViewIfNeeded();
    await long.locator('.atl-todo').hover();
    await long.getByRole('button', { name: 'Set reminder' }).click();
    await expect(page.getByRole('dialog', { name: 'Reminder' })).toBeVisible();
    await expectNoHorizontalOverflow(page, `${width}px, reminder picker open`);
    await page.keyboard.press('Escape');
  }

  // Many columns: the board scrolls sideways inside itself, only with Shift+wheel, and the page stays put.
  await page.setViewportSize({ width: 1024, height: 700 });
  const board = page.locator('.atl-board');
  const sizes = await board.evaluate((b) => ({ scroll: b.scrollWidth, client: b.clientWidth }));
  expect(sizes.scroll, 'board holds more columns than fit').toBeGreaterThan(sizes.client);
  const spots = await page.evaluate(() => {
    const [a, b] = Array.from(document.querySelectorAll('.atl-column')).map((c) => c.getBoundingClientRect());
    return { gap: { x: (a!.right + b!.left) / 2, y: a!.top + 10 }, column: { x: a!.left + a!.width / 2, y: a!.top + 120 } };
  });
  // A plain wheel never moves the board sideways, over a gap or over a column.
  for (const spot of [spots.gap, spots.column]) {
    await page.mouse.move(spot.x, spot.y);
    await page.mouse.wheel(0, 400);
  }
  await page.waitForTimeout(300);
  expect(await board.evaluate((b) => b.scrollLeft), 'a plain wheel scrolled sideways').toBe(0);
  // Shift+wheel does, even over a column: the browser does this itself.
  await page.mouse.move(spots.column.x, spots.column.y);
  await page.keyboard.down('Shift');
  await page.mouse.wheel(0, 400);
  await page.keyboard.up('Shift');
  await expect.poll(() => board.evaluate((b) => b.scrollLeft)).toBeGreaterThan(0);
  // Wide windows fit the page to the window: columns scroll their own items instead of growing the page.
  const tall = await page.evaluate(() => ({
    page: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    tallest: Math.max(...Array.from(document.querySelectorAll('.atl-column')).map((c) => c.getBoundingClientRect().bottom)),
    view: window.innerHeight,
  }));
  expect(tall.page, 'page scrolls up and down').toBeLessThanOrEqual(0);
  expect(tall.tallest, 'a column runs past the window').toBeLessThanOrEqual(tall.view);

  // Search results with the long title
  await page.setViewportSize({ width: 400, height: 900 });
  await page.getByRole('searchbox', { name: 'Search' }).fill('Hono');
  await expect(page.getByRole('region', { name: 'Search results' }).getByTitle(LONG_TITLE)).toBeVisible();
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await expectNoHorizontalOverflow(page, `${width}px, search results`);
  }
  await page.close();
});

test('list view: same look as the board, as many fixed-width lanes as fit, only scrolls down', async () => {
  // Runs after the long-content test, so the long titles, the long category and the extra columns are there.
  const page = await context.newPage();
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.goto(`chrome-extension://${extensionId}/src/newtab/index.html`);
  await expect(page.locator('.atl-column').first()).toBeVisible();
  // Items load after the columns: wait for a link before measuring one.
  await expect(page.locator('.atl-fav').first()).toBeVisible();
  const look = () => page.evaluate(() => {
    const col = document.querySelector('.atl-column')!;
    const cs = getComputedStyle(col);
    return { padding: cs.padding, row: document.querySelector('.atl-item')!.getBoundingClientRect().height, icon: document.querySelector('.atl-fav')!.getBoundingClientRect().width };
  });
  const board = await look();
  await page.getByRole('button', { name: 'Show as list' }).click();
  await expect(page.locator('.atl-board')).toHaveClass(/atl-board-list/);
  expect(await look(), 'list view looks like the board').toEqual(board);

  const measure = () => page.evaluate(() => {
    const doc = document.documentElement;
    const el = document.querySelector('.atl-board')!;
    const box = el.getBoundingClientRect();
    const tiles = Array.from(el.children).map((c) => c.getBoundingClientRect());
    const overlap = tiles.some((a, i) => tiles.some((b, j) => i < j && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1));
    return {
      page: doc.scrollWidth - doc.clientWidth,
      board: el.scrollWidth - el.clientWidth,
      widths: [...new Set(tiles.map((r) => Math.round(r.width)))],
      lanes: new Set(tiles.map((r) => Math.round(r.left))).size,
      fit: Math.max(1, Math.floor((box.width + 24) / (Math.min(300, box.width) + 24))),
      count: tiles.length,
      inside: tiles.every((r) => r.right <= box.right + 1 && r.left >= box.left - 1),
      overlap,
    };
  });
  for (const width of [1500, 1024, 800, 400]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(async () => (await measure()).lanes).toBe(Math.min((await measure()).fit, (await measure()).count));
    const m = await measure();
    expect(m.page, `${width}px: page scrolls sideways`).toBeLessThanOrEqual(0);
    expect(m.board, `${width}px: list scrolls sideways`).toBeLessThanOrEqual(0);
    expect(m.inside, `${width}px: a category spills out`).toBe(true);
    expect(m.overlap, `${width}px: categories overlap`).toBe(false);
    if (width > 400) expect(m.widths, `${width}px: every category is 300px`).toEqual([300]);
  }

  // Reordering re-places the categories (a reorder changes no sizes, so only the order can trigger it).
  const titles = () => page.locator('.atl-column-title').allTextContents();
  const before = await titles();
  const grip = page.locator('.atl-column').last().getByRole('button', { name: 'Drag to reorder category' });
  await grip.focus();
  await page.keyboard.press('Space');
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(120);
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(120);
  }
  await page.keyboard.press('Space');
  await expect.poll(titles).not.toEqual(before);
  await expect.poll(async () => (await measure()).overlap, { message: 'categories overlap after a reorder' }).toBe(false);

  // Category size: every category takes the chosen width, in the list and on the board.
  await page.setViewportSize({ width: 1500, height: 900 });
  const sizes = page.getByRole('group', { name: 'Category size' });
  for (const [name, px] of [['Large', 380], ['Small', 260], ['Medium', 300]] as const) {
    await sizes.getByRole('button', { name }).click();
    await expect.poll(async () => (await measure()).widths).toEqual([px]);
    expect((await measure()).overlap).toBe(false);
  }
  // Custom: the gear opens a slider from S (260px) to the board's width.
  await sizes.getByRole('button', { name: 'Custom' }).click();
  const slider = page.getByRole('slider', { name: 'Category width' });
  await slider.focus();
  await page.keyboard.press('End');
  const full = await page.locator('.atl-board').evaluate((b) => b.clientWidth);
  await expect.poll(async () => (await measure()).widths).toEqual([full]);
  expect((await measure()).lanes, 'one category fills the board').toBe(1);
  await page.keyboard.press('Home');
  await expect.poll(async () => (await measure()).widths).toEqual([260]);
  // On a narrow window the slider stays on screen and the page still doesn't scroll sideways.
  await page.setViewportSize({ width: 400, height: 900 });
  // The masonry re-places after the resize (a ResizeObserver callback): wait for it before measuring.
  await expect.poll(async () => (await measure()).page, { message: 'page scrolls sideways at 400px' }).toBeLessThanOrEqual(0);
  const pop = await page.locator('.atl-size-pop').boundingBox();
  expect(pop!.x, 'slider starts off screen').toBeGreaterThanOrEqual(0);
  expect(pop!.x + pop!.width, 'slider runs off screen').toBeLessThanOrEqual(400);
  await page.keyboard.press('Escape');
  await expect(slider).toHaveCount(0);
  await page.setViewportSize({ width: 1500, height: 900 });
  await sizes.getByRole('button', { name: 'Medium' }).click();

  await page.getByRole('button', { name: 'Show as columns' }).click();
  await sizes.getByRole('button', { name: 'Large' }).click();
  expect(await page.locator('.atl-column').first().evaluate((c) => c.getBoundingClientRect().width)).toBe(380);
  await sizes.getByRole('button', { name: 'Medium' }).click();
  await page.close();
});

test('the popup keeps long category names inside its width', async () => {
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 380, height: 700 });
  await popup.goto(`chrome-extension://${extensionId}/src/newtab/index.html`);
  const tabId = await popup.evaluate(async () => (await chrome.tabs.query({}))[0]?.id);
  await popup.goto(`chrome-extension://${extensionId}/src/popup/index.html?tabId=${tabId}`);
  await expect(popup.getByRole('radio', { name: LONG_CATEGORY })).toBeVisible();
  await expectNoHorizontalOverflow(popup, 'popup');
  await popup.close();
});

test('the public share page wraps long content on a phone', async () => {
  const html = renderSharePage({ name: LONG_CATEGORY, emoji: '📚' }, [
    { kind: 'link', title: LONG_TITLE, url: LONG_URL, note: LONG_NOTE, body: null, done: false },
    { kind: 'todo', title: LONG_TODO, url: null, note: null, body: null, done: false },
    { kind: 'note', title: LONG_NOTE.slice(0, 80), url: null, note: null, body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: LONG_NOTE }] }] }, done: false },
  ]);
  const page = await context.newPage();
  await page.setViewportSize({ width: 360, height: 800 });
  await page.setContent(html);
  await expectNoHorizontalOverflow(page, 'share page at 360px');
  await page.setContent(magicConfirmPage(LONG_URL));
  await expectNoHorizontalOverflow(page, 'sign-in page at 360px');
  await page.close();
});
