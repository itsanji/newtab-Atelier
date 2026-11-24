# Atelier Plan 1 — Local Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Manifest V3 extension that turns the new tab into the Atelier board and delivers every local feature of the spec (features 1–12 and 17) with no server.

**Architecture:** Bun-workspace monorepo. `packages/core` holds the shared data model, sort keys and export schema (reused by the server in Plan 2). `apps/extension` is React + Vite (CRXJS plugin); IndexedDB via Dexie is the single source of truth, UI reads through `useLiveQuery`, and every mutation goes through one repository module that also appends to an outbox (consumed by sync in Plan 3).

**Tech Stack:** Bun 1.4.4 (via mise), TypeScript, React 19, Vite + `@crxjs/vite-plugin`, Dexie + `dexie-react-hooks`, `fractional-indexing`, `zod`, `@dnd-kit/core` + `@dnd-kit/sortable`, TipTap (`@tiptap/react`, StarterKit, Link, TaskList, TaskItem), MiniSearch, `@fontsource/cormorant-garamond` + `@fontsource/jost`, Vitest + Testing Library + `fake-indexeddb`, Playwright. Pin each to its latest stable at install time; `bun.lock` records exact versions.

**Spec:** `docs/superpowers/specs/2026-11-24-atelier-tab-board-design.md`
**Mockup:** https://claude.ai/artifact/Kuftmujisu9Aybc39ejJ3q (artboards Main, Night, Popup)

## Global Constraints

- Name in UI: "Atelier" (placeholder). No tabExtend name, logo, copy or styling anywhere.
- Look: Impression design system. Colours/type/spacing/radii/shadows exactly as `apps/extension/src/ui/theme/tokens.css` (Task 2 copies the values from the canvas file `project/ds/impression/tokens.css`). Cormorant Garamond (display, never below 22px) + Jost (UI). One primary (lily) button per view. One dab row per view. Thin 1.5px stroke icons, never emoji as icons, never filled.
- Voice: sentence case, no exclamation marks, verb-first button labels.
- Works with no server and no account; nothing in this plan makes a network request (fonts are bundled, favicons via Chrome's `_favicon` endpoint).
- New tab first content from local data, never waiting on network; target < 200 ms warm.
- Manifest permissions: `tabs`, `tabGroups`, `storage`, `unlimitedStorage`, `contextMenus`, `alarms`, `notifications`, `favicon`. (`identity` and `optional_host_permissions` arrive in Plan 3.)
- All synced rows carry `id` (UUID v4 from `crypto.randomUUID()`), `createdAt`, `updatedAt`, `deletedAt: string | null`, `updatedBy: string | null` (ISO-8601 strings). Deletes are tombstones; queries exclude `deletedAt !== null`.
- Every repository mutation appends one outbox entry per changed row.
- Ordering uses `fractional-indexing` keys; a move writes one row.
- Max 3 subagents at a time.

## Review Focus

1. **"Save all and close" in a window that contains the board itself, empty new tabs, or pinned tabs** — the board tab and other `chrome://newtab/` / extension pages are neither saved nor closed; pinned tabs are neither saved nor closed. Test: Task 7 `saveAllAndClose skips newtab, extension and pinned tabs`.
2. **Very long titles and URLs** — rows truncate with ellipsis on one line and expose the full title via `title` attribute; nothing overflows its column. Test: Task 4 `ItemRow truncates long titles and keeps full title as tooltip`.
3. **Importing a malformed, foreign or partially valid JSON file** — rejected with a readable message and zero rows written (single Dexie transaction). Test: Task 12 `import rejects invalid file and writes nothing`.
4. **Reminder whose time passed while the browser was closed** — fires once on next startup. Test: Task 9 `missed reminder fires on startup exactly once`.
5. **Deleting the last workspace** — not allowed; the action is disabled with an explanation, so the board is never empty of workspaces. Test: Task 3 `deleteWorkspace refuses the last live workspace`.

---

## File structure

```
mise.toml                      bun = "1.4.4"
package.json                   private, workspaces ["packages/*","apps/*"], scripts: test, build, e2e
tsconfig.base.json             strict, ES2022, moduleResolution bundler
vitest.config.ts               projects: packages/core, apps/extension
.gitignore                     node_modules, dist, .output, playwright-report
LICENSE                        MIT
packages/core/
  src/model.ts                 row types
  src/sortKey.ts               keyBetween, sortByKey
  src/exportFormat.ts          zod schema + types for the export file
  src/index.ts                 re-exports
  test/*.test.ts
apps/extension/
  manifest.config.ts           defineManifest (CRXJS)
  vite.config.ts
  src/newtab/{index.html,main.tsx,App.tsx}
  src/popup/{index.html,main.tsx,Popup.tsx}
  src/background/{index.ts,contextMenus.ts,commands.ts,reminders.ts}
  src/data/{db.ts,repo.ts,seed.ts,queries.ts,search.ts,exportImport.ts,settings.ts}
  src/chrome/{tabs.ts,favicon.ts}
  src/ui/theme/{tokens.css,base.css,fonts.ts}
  src/ui/components/{Button,Tag,Field,Dabs,IconButton,Icon,Menu,Dialog}.tsx
  src/board/{Sidebar,WorkspaceList,OpenTabsPanel,BoardHeader,Board,CategoryColumn,ItemRow,NoteItem,TodoItem,AddItemMenu,EmojiPicker,SearchResults,ReminderPicker,dnd}.tsx|ts
  test/{setup.ts,chromeFake.ts}
  e2e/{playwright.config.ts,smoke.spec.ts}
```

---

### Task 1: Monorepo and core model

**Files:**
- Create: `mise.toml`, `package.json`, `tsconfig.base.json`, `vitest.config.ts`, `.gitignore`, `LICENSE`, `README.md` (one paragraph + dev commands)
- Create: `packages/core/{package.json,tsconfig.json,src/model.ts,src/sortKey.ts,src/exportFormat.ts,src/index.ts}`
- Test: `packages/core/test/sortKey.test.ts`, `packages/core/test/exportFormat.test.ts`

**Interfaces:**
- Produces (`@atelier/core`):
  - `type Iso = string`
  - `interface RowBase { id: string; createdAt: Iso; updatedAt: Iso; deletedAt: Iso | null; updatedBy: string | null }`
  - `interface Workspace extends RowBase { name: string; emoji: string | null; ownerId: string | null; sortKey: string }`
  - `type TabGroupColor = 'grey'|'blue'|'red'|'yellow'|'green'|'pink'|'purple'|'cyan'|'orange'`
  - `interface Category extends RowBase { workspaceId: string; name: string; emoji: string | null; sortKey: string; tabGroup: { title: string; color: TabGroupColor } | null; shareToken: string | null }`
  - `type ItemKind = 'link'|'note'|'todo'`
  - `interface Item extends RowBase { categoryId: string; kind: ItemKind; sortKey: string; title: string; url: string | null; faviconUrl: string | null; note: string | null; body: unknown | null; done: boolean }` (`note` = the short optional note on a link; `body` = TipTap JSON for note items)
  - `interface Reminder extends RowBase { itemId: string; userId: string; remindAt: Iso; remindedAt: Iso | null }`
  - `type TableName = 'workspaces'|'categories'|'items'|'reminders'`
  - `keyBetween(before: string | null, after: string | null): string`
  - `sortByKey<T extends { sortKey: string }>(rows: T[]): T[]` (stable, ascending by key, ties by `id`)
  - `exportFileSchema` (zod) and `type ExportFile = { format: 'atelier'; version: 1; exportedAt: Iso; workspaces: Workspace[]; categories: Category[]; items: Item[]; reminders: Reminder[] }`

- [ ] **Step 1:** `mise use bun@1.4.4` in repo root; create root `package.json` with workspaces and scripts `"test": "vitest run"`, `"build": "bun run --filter '*' build"`, `"e2e": "bun run --filter @atelier/extension e2e"`; `bun install`.
- [ ] **Step 2: Write failing tests**

```ts
// sortKey.test.ts
test('keyBetween(null, null) returns a key', () => expect(typeof keyBetween(null, null)).toBe('string'));
test('keyBetween orders between neighbours', () => {
  const a = keyBetween(null, null), c = keyBetween(a, null), b = keyBetween(a, c);
  expect([c, a, b].sort()).toEqual([a, b, c]);
});
test('sortByKey breaks ties by id', () => {
  expect(sortByKey([{ id: 'b', sortKey: 'a0' }, { id: 'a', sortKey: 'a0' }]).map(r => r.id)).toEqual(['a', 'b']);
});
// exportFormat.test.ts
test('accepts a minimal valid export', () => expect(exportFileSchema.safeParse({ format: 'atelier', version: 1, exportedAt: '2026-11-24T10:00:00.000Z', workspaces: [], categories: [], items: [], reminders: [] }).success).toBe(true));
test('rejects wrong format tag', () => expect(exportFileSchema.safeParse({ format: 'other', version: 1 }).success).toBe(false));
test('rejects item with unknown kind', ...);  // kind: 'video' → false
```

- [ ] **Step 3:** Run `bun run test` — expect FAIL (modules missing).
- [ ] **Step 4:** Implement `model.ts`, `sortKey.ts` (wrap `generateKeyBetween` from `fractional-indexing`), `exportFormat.ts` (zod schemas mirroring the interfaces exactly), `index.ts`.
- [ ] **Step 5:** Run `bun run test` — expect PASS.
- [ ] **Step 6:** Commit `feat(core): data model, sort keys, export schema`.

---

### Task 2: Extension shell, Impression theme and base components

**Files:**
- Create: `apps/extension/{package.json,tsconfig.json,vite.config.ts,manifest.config.ts}`
- Create: `src/newtab/{index.html,main.tsx,App.tsx}`, `src/popup/{index.html,main.tsx,Popup.tsx}`, `src/background/index.ts`
- Create: `src/ui/theme/{tokens.css,base.css,fonts.ts}`, `src/ui/components/{Button,Tag,Field,Dabs,IconButton,Icon,Menu,Dialog}.tsx`
- Create: `test/setup.ts` (Testing Library jest-dom, `fake-indexeddb/auto`), `test/chromeFake.ts`
- Test: `src/ui/components/components.test.tsx`

**Interfaces:**
- Produces:
  - `Button(props: ButtonHTMLAttributes & { variant?: 'primary'|'quiet'|'ghost'|'danger' })` → `<button class="im-btn im-btn-<variant>">` (quiet = no modifier class)
  - `Tag({ tone?: 'neutral'|'lily'|'sage'|'rose'|'ochre', children })`
  - `Field(props: InputHTMLAttributes & { label: string; hint?: string; error?: string; hideLabel?: boolean })` — label always in DOM; `hideLabel` makes it visually hidden
  - `Dabs({ colors?: ('lily'|'sage'|'rose'|'ochre')[] })` aria-hidden
  - `IconButton({ label: string; icon: IconName; onClick })` — `aria-label={label}`
  - `Icon({ name: IconName; size?: number })`, `type IconName = 'plus'|'more'|'moon'|'sun'|'search'|'grip'|'close'|'bell'|'share'|'external'|'trash'|'edit'|'check'`
  - `Menu({ trigger, items: { label: string; onSelect(): void; danger?: boolean; disabled?: boolean; hint?: string }[] })`, `Dialog({ open, title, onClose, children })`
  - `installChromeFake(): ChromeFake` in `test/chromeFake.ts` — in-memory `chrome.tabs`, `tabGroups`, `windows`, `storage.local`, `alarms`, `notifications`, `contextMenus`, `commands`, `runtime` with event emitters (`onCreated/onRemoved/onUpdated/onAlarm/onClicked`) and spies; later tasks extend it.
- Manifest: name "Atelier", MV3, `chrome_url_overrides.newtab = src/newtab/index.html`, `action.default_popup = src/popup/index.html`, `background.service_worker = src/background/index.ts` (type module), permissions per Global Constraints, `commands: { "save-current-tab": { suggested_key: { default: "Alt+Shift+S" }, description: "Save the current tab" } }`.
- CSS: `tokens.css` defines Giverny vars on `:root, .giverny` and Nocturne on `.nocturne` (values from canvas file). `base.css` holds the `im-*` component classes from the Impression bundle.css. Fonts via `@fontsource` imports in `fonts.ts` (Cormorant Garamond 400/500/600 + italic 400; Jost 400/500).

- [ ] **Step 1: Write failing tests**

```tsx
test('Button primary has primary class', () => { render(<Button variant="primary">Save tab</Button>); expect(screen.getByRole('button', { name: 'Save tab' })).toHaveClass('im-btn', 'im-btn-primary'); });
test('Field links label to input', () => { render(<Field label="Search" />); expect(screen.getByLabelText('Search')).toBeInTheDocument(); });
test('Field hideLabel keeps accessible name', () => { render(<Field label="Search" hideLabel />); expect(screen.getByRole('textbox', { name: 'Search' })).toBeInTheDocument(); });
test('IconButton has aria-label', () => { render(<IconButton label="Switch theme" icon="moon" onClick={() => {}} />); expect(screen.getByRole('button', { name: 'Switch theme' })).toBeInTheDocument(); });
test('Tag ochre uses ochre class', ...);
test('Dabs is hidden from assistive tech', ...); // container has aria-hidden="true"
```

- [ ] **Step 2:** `bun run test` — FAIL.
- [ ] **Step 3:** Implement components, theme, manifest, minimal `App.tsx` ("Atelier" title + Dabs) and `Popup.tsx` placeholder.
- [ ] **Step 4:** `bun run test` — PASS. `bun run --filter @atelier/extension build` — produces `apps/extension/dist/manifest.json` with the newtab override.
- [ ] **Step 5:** Commit `feat(extension): MV3 shell, Impression theme, base components`.

---

### Task 3: Local data layer (Dexie, repository, outbox, seed)

**Files:**
- Create: `src/data/{db.ts,repo.ts,seed.ts,queries.ts}`
- Test: `src/data/repo.test.ts`

**Interfaces:**
- Consumes: Task 1 model + `keyBetween`.
- Produces:
  - `class AtelierDB extends Dexie` with tables `workspaces`, `categories`, `items`, `reminders` (primary key `id`; indexes: categories `workspaceId`, items `categoryId`, reminders `itemId`, all `updatedAt`), `outbox` (`++seq`, `{ seq; table: TableName; rowId: string; row: object; queuedAt: Iso }`), `meta` (`key` → `{ key; value }`).
  - `openDb(partition = 'local'): AtelierDB` — database name `atelier-${partition}` (Plan 3 adds per-account partitions).
  - `const LOCAL_USER = 'local'`
  - Repo (all `async`, all in one Dexie `rw` transaction including the outbox write, all set `updatedAt = now`, `updatedBy = LOCAL_USER`):
    - `createWorkspace(db, { name, emoji? }): Promise<Workspace>` (appended last)
    - `updateWorkspace(db, id, patch: Partial<Pick<Workspace,'name'|'emoji'>>)`
    - `moveWorkspace(db, id, beforeId: string | null, afterId: string | null)`
    - `deleteWorkspace(db, id)` — throws `LastWorkspaceError` if it is the only live workspace; tombstones the workspace and its categories and items
    - `createCategory(db, { workspaceId, name, emoji?, tabGroup? }): Promise<Category>` (appended last)
    - `updateCategory(db, id, patch: Partial<Pick<Category,'name'|'emoji'|'tabGroup'>>)`
    - `moveCategory(db, id, beforeId, afterId)`
    - `deleteCategory(db, id)` — tombstones it and its items
    - `createItem(db, input: { categoryId; kind; title; url?; faviconUrl?; note?; body?; position?: 'start'|'end' }): Promise<Item>` (default `end`)
    - `updateItem(db, id, patch: Partial<Pick<Item,'title'|'url'|'note'|'body'|'done'>>)`
    - `moveItem(db, id, { categoryId, beforeId: string|null, afterId: string|null })`
    - `deleteItem(db, id)`
  - `ensureSeed(db): Promise<void>` — first run only (no workspaces at all): workspace "My workspace" with categories "Saved" and "Notes".
  - Queries (`queries.ts`, plain async functions used inside `useLiveQuery`): `liveWorkspaces(db)`, `liveCategories(db, workspaceId)`, `liveItems(db, categoryId)` — exclude tombstones, return `sortByKey` order. `getMeta(db, key)`, `setMeta(db, key, value)`.

- [ ] **Step 1: Write failing tests** (fresh `openDb('test-'+crypto.randomUUID())` per test)

```ts
test('createItem appends at end and writes one outbox entry', ...); // two items → second sortKey > first; outbox has 2 'items' rows
test('moveItem between two items writes only the moved row', ...); // outbox grows by exactly 1, order is a,c,b
test('moveItem to another category changes categoryId', ...);
test('deleteCategory tombstones its items and liveItems hides them', ...);
test('deleteWorkspace refuses the last live workspace', async () => { await expect(deleteWorkspace(db, onlyId)).rejects.toBeInstanceOf(LastWorkspaceError); });
test('ensureSeed creates My workspace with Saved and Notes once', ...); // call twice → still 1 workspace
test('updateItem bumps updatedAt and keeps createdAt', ...);
```

- [ ] **Step 2:** `bun run test src/data` — FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(extension): local data layer with outbox`.

---

### Task 4: Board UI — workspaces, categories, link items

Matches mockup artboard Main: sidebar (brand + Dabs, Workspaces nav, Open tabs slot), header (eyebrow "Workspace · N saved", title, search slot, Share slot hidden until Plan 3, theme slot), horizontal columns, dashed "New category" drop tile.

**Files:**
- Create: `src/board/{Board,Sidebar,WorkspaceList,BoardHeader,CategoryColumn,ItemRow,AddItemMenu}.tsx`, `src/chrome/favicon.ts`
- Modify: `src/newtab/App.tsx` (open db, `ensureSeed`, selected workspace in `meta` key `selectedWorkspaceId`)
- Test: `src/board/board.test.tsx`

**Interfaces:**
- Consumes: Task 3 repo/queries; Task 2 components.
- Produces:
  - `faviconUrl(pageUrl: string, size = 32): string` → `chrome.runtime.getURL('/_favicon/') + '?pageUrl=' + encodeURIComponent(pageUrl) + '&size=' + size`
  - `<CategoryColumn category={Category} />` renders header (emoji, name — inline rename on click, `Tag` with count, or `Tag tone="lily"` "Tab group · N" when `tabGroup`), items, "+ Add" (AddItemMenu: Link / Note / To-do), "Open all" link (wired in Task 7).
  - `<ItemRow item={Item} />` for links: favicon image (fallback letter tile tinted by `hash(id) % 4` over lily/sage/rose/ochre soft+ink pairs), title, domain; whole row is `<a href={url}>`; context menu: Edit, Delete.
  - Workspace actions: create, rename, emoji (Task 11 supplies picker; here a text slot), delete (Menu item disabled with hint "Keep at least one workspace" when last).

- [ ] **Step 1: Write failing tests**

```tsx
test('shows seeded workspace and its categories', ...); // "My workspace", columns "Saved", "Notes"
test('add category via New category tile', ...); // click "New category", type "Reading list", Enter → column appears
test('add link via Add menu', ...); // url "https://example.com/a" title "Example" → row with domain "example.com"
test('rename category inline', ...);
test('selecting a workspace persists across reload', ...); // remount App → same workspace selected
test('ItemRow truncates long titles and keeps full title as tooltip', ...); // 300-char title → element has title attr = full title and computed style text-overflow ellipsis
test('delete workspace is disabled when only one exists', ...);
```

- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(extension): board with workspaces, categories and links`.

---

### Task 5: Notes and to-dos

**Files:**
- Create: `src/board/{NoteItem,TodoItem}.tsx`
- Modify: `src/board/CategoryColumn.tsx` (render by `item.kind`), `AddItemMenu.tsx`
- Test: `src/board/notes.test.tsx`

**Interfaces:**
- `<NoteItem item />` — TipTap editor (StarterKit with bold/italic/paragraph, Link, TaskList, TaskItem); saves `body` (TipTap JSON) via `updateItem` debounced 400 ms and on blur; `title` = first 80 chars of plain text (for search). Rendered on `canvas-sunk` well per mockup.
- `<TodoItem item />` — real `<input type="checkbox">` + label; toggles `done`; done text muted + line-through; inline edit of text; reminder `Tag tone="ochre"` slot (filled in Task 9).

- [ ] **Step 1: Tests**

```tsx
test('adding a to-do and checking it persists done', ...);
test('note text persists after blur and remount', ...);
test('note title is derived from first line', ...);
```

- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(extension): notes and to-dos`.

---

### Task 6: Drag and drop

**Files:**
- Create: `src/board/dnd.ts`, wire `DndContext` in `Board.tsx`
- Modify: `CategoryColumn.tsx`, `ItemRow.tsx`, `WorkspaceList.tsx`
- Test: `src/board/dnd.test.ts`

**Interfaces:**
- `computeItemDrop(target: { categoryId: string; overItemId: string | null; placement: 'before'|'after' }, siblings: Item[]): { categoryId: string; beforeId: string | null; afterId: string | null }` — pure; `siblings` sorted, excludes the dragged item.
- `computeCategoryDrop(overId: string, placement, siblings: Category[]): { beforeId; afterId }`
- Dropping an item on a workspace in the sidebar moves it to the end of that workspace's first category.
- Drag sources typed by `data.type: 'item' | 'category' | 'tab'` (`'tab'` used by Task 7). Keyboard dragging enabled (dnd-kit KeyboardSensor).

- [ ] **Step 1: Tests** — pure function cases: drop on empty column (`null,null`), before first, after last, between two, into another category; category reorder before/after.
- [ ] **Step 2–4:** FAIL → implement (+ wiring) → PASS.
- [ ] **Step 5:** Commit `feat(extension): drag and drop for items and categories`.

---

### Task 7: Tabs — open tabs panel, save all, tab groups, open all

**Files:**
- Create: `src/chrome/tabs.ts`, `src/board/OpenTabsPanel.tsx`
- Modify: `Sidebar.tsx`, `CategoryColumn.tsx` ("Open all"), `Board.tsx` (handle `'tab'` drops), `test/chromeFake.ts`
- Test: `src/chrome/tabs.test.ts`, `src/board/openTabs.test.tsx`

**Interfaces:**
- `isSavableTab(tab: chrome.tabs.Tab): boolean` — false for pinned tabs, `chrome://newtab/`, `edge://newtab/`, any `chrome-extension://`/own-extension URL, `about:blank`, missing url.
- `listWindowTabs(windowId?: number): Promise<chrome.tabs.Tab[]>` — current window, savable only.
- `saveTab(db, tab, target: { categoryId; position?: 'start'|'end' }): Promise<Item>` — link item: title, url, `faviconUrl(url)`.
- `saveAllAndClose(db, workspaceId, windowId?): Promise<{ categories: Category[]; saved: number }>` — savable tabs only; each Chrome tab group becomes its own category (name = group title or "Tab group", `tabGroup = {title,color}`); ungrouped tabs go to one category named `Saved <d MMM, HH:mm>` (local time, e.g. "Saved 24 Nov, 11:30"); new categories placed first in the workspace; then closes exactly the saved tabs.
- `openAll(db, categoryId): Promise<void>` — opens links in order in the current window; if `category.tabGroup`, groups the new tabs and sets title and colour.
- `<OpenTabsPanel />` — eyebrow "Open now", count, hint "Drag a tab onto the board to keep it.", live list (subscribes to `tabs.onCreated/onRemoved/onUpdated/onMoved`, re-lists), each row draggable (`type: 'tab'`), primary button "Save all N and close" (the view's one primary button).

- [ ] **Step 1: Tests**

```ts
test('saveAllAndClose skips newtab, extension and pinned tabs', ...); // 5 tabs: board, pinned, chrome://newtab, 2 normal → saved 2, only those 2 closed
test('tab group becomes its own category with title and colour', ...);
test('ungrouped tabs go to a category named "Saved <d MMM, HH:mm>"', ...); // fake clock 2026-11-24 11:30 → "Saved 24 Nov, 11:30"
test('openAll recreates tab group', ...); // tabs.group + tabGroups.update called with title/color
test('panel updates when a tab is created', ...);
test('dropping a tab on a category saves it there', ...);
```

- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(extension): open tabs panel, save all, tab groups`.

---

### Task 8: Popup, context menu, keyboard shortcut

Matches mockup artboard Popup.

**Files:**
- Modify: `src/popup/Popup.tsx`, `src/background/index.ts`
- Create: `src/background/{contextMenus.ts,commands.ts}`
- Test: `src/popup/popup.test.tsx`, `src/background/background.test.ts`

**Interfaces:**
- Meta key `lastCategoryId` (string). `resolveTargetCategory(db): Promise<Category>` — `lastCategoryId` if live, else first category of first workspace.
- Popup: current tab = `tabId` URL param when present (used by e2e in Task 13), else the active tab of the current window; current tab card (favicon, title, url); eyebrow "Save to · <workspace>"; category chips (radiogroup, last used preselected, "+ New" creates one); `Field label="Note (optional)"`; checkbox "Close the tab after saving" (persisted in `chrome.storage.local` key `closeAfterSave`, default `true`); primary "Save tab"; quiet "Save all N tabs in this window" (calls `saveAllAndClose` into the selected category's workspace); link "Open the board" (`chrome.tabs.create({})`). On save: set `lastCategoryId`, show "Saved" state, close tab if chosen. Unsavable current tab (see `isSavableTab`) disables "Save tab" with hint "This page can't be saved".
- Context menus (created `onInstalled`): ids `save-page` ("Save page to Atelier", contexts `page`), `save-link` ("Save link to Atelier", contexts `link`, uses `linkUrl`, title = `selectionText` or the URL).
- Command `save-current-tab` saves the active tab to `resolveTargetCategory` and shows a notification "Saved to <category>".

- [ ] **Step 1: Tests** — popup saves with note into chosen category and sets `lastCategoryId`; unsavable tab disables Save; context `save-link` creates link item in last category; command saves active tab.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(extension): popup, context menu and shortcut`.

---

### Task 9: Reminders

**Files:**
- Create: `src/background/reminders.ts`, `src/board/ReminderPicker.tsx`
- Modify: `TodoItem.tsx`, `src/background/index.ts`, `src/data/repo.ts` (reminder CRUD), `src/newtab/App.tsx` (focus `?item=<id>`)
- Test: `src/background/reminders.test.ts`, `src/board/reminder.test.tsx`

**Interfaces:**
- Repo: `setReminder(db, itemId, remindAt: Iso): Promise<Reminder>` (one live reminder per item per user; replaces), `clearReminder(db, itemId)`.
- `syncAlarms(db): Promise<void>` — for each live reminder of `LOCAL_USER` with `remindedAt === null`: alarm `reminder:<itemId>` at `remindAt`; clears alarms for others. Called on startup, `onInstalled`, and when the board/popup writes a reminder (message `{ type: 'reminders-changed' }`).
- `fireDue(db, now: Date): Promise<string[]>` — every live, unfired reminder with `remindAt <= now`: notification (title = to-do text, message "Reminder from Atelier", id `reminder:<itemId>`), set `remindedAt`; returns fired item ids. Runs on alarm and on startup.
- Notification click → `chrome.tabs.create({ url: newtab + '?item=<id>' })`; board scrolls to the item and highlights it (lily-soft, 2 s).
- UI: ReminderPicker offers "Later today (18:00)", "Tomorrow 9:00", "Next week (Mon 9:00)", and a `datetime-local` input; set reminder shows `Tag tone="ochre"` with short label ("Tomorrow 9:00", else "24 Nov 9:00"); past-due unfired shows `Tag tone="rose"`.

- [ ] **Step 1: Tests**

```ts
test('syncAlarms creates one alarm per unfired reminder', ...);
test('fireDue notifies and marks remindedAt', ...);
test('missed reminder fires on startup exactly once', ...); // remindAt in past → startup handler fires; second startup fires nothing
test('picking Tomorrow 9:00 stores the right ISO time', ...); // fake clock
```

- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(extension): to-do reminders`.

---

### Task 10: Search

**Files:**
- Create: `src/data/search.ts`, `src/board/SearchResults.tsx`
- Modify: `BoardHeader.tsx` (search Field, `/` focuses it, Esc clears)
- Test: `src/data/search.test.ts`, `src/board/search.test.tsx`

**Interfaces:**
- `buildIndex(rows: { items: Item[]; categories: Category[]; workspaces: Workspace[] }): MiniSearch` — fields `title`, `url`, `note`, `text` (plain text of note body), stored: ids, kind, category, workspace names; prefix + fuzzy 0.2.
- `search(index, query): SearchHit[]` with `SearchHit = { itemId; title; kind; categoryName; workspaceName; workspaceId; categoryId }`.
- Non-empty query replaces the columns with a results list across all workspaces; clicking a hit selects its workspace and highlights the item (same highlight as Task 9).

- [ ] **Step 1: Tests** — finds link by domain fragment; finds note by body word; finds to-do; excludes tombstoned; prefix "atel" matches "Atelier".
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(extension): search`.

---

### Task 11: Themes and emoji

**Files:**
- Create: `src/data/settings.ts`, `src/board/EmojiPicker.tsx`
- Modify: `App.tsx`, `Popup.tsx` (apply theme class), `BoardHeader.tsx` (theme IconButton), `WorkspaceList.tsx`, `CategoryColumn.tsx`
- Test: `src/data/settings.test.ts`, `src/board/emoji.test.tsx`

**Interfaces:**
- `type ThemePref = 'giverny'|'nocturne'|'system'`; `getTheme(): Promise<ThemePref>` / `setTheme(p)` in `chrome.storage.local` key `theme` (default `system`); `resolveTheme(p, prefersDark: boolean): 'giverny'|'nocturne'`; `useTheme()` hook applying the class on `<html>` and following `prefers-color-scheme` when `system`, live across open pages via `chrome.storage.onChanged`.
- Theme button cycles giverny → nocturne → system with `aria-label` "Theme: <name>".
- `<EmojiPicker value onChange />` — popover grid of 64 curated emoji (no library) + "Remove"; used for workspace and category emoji.

- [ ] **Step 1: Tests** — default resolves by system; cycling persists; change in one page applies in another (storage event); picking emoji updates category.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(extension): themes and emoji`.

---

### Task 12: Export and import

**Files:**
- Create: `src/data/exportImport.ts`
- Modify: sidebar footer menu ("Export data", "Import data")
- Test: `src/data/exportImport.test.ts`

**Interfaces:**
- `exportAll(db): Promise<ExportFile>` (includes tombstones? **no** — live rows only); downloaded as `atelier-export-YYYY-MM-DD.json` via blob link.
- `importFile(db, json: unknown): Promise<{ added: number; updated: number; skipped: number }>` — validate with `exportFileSchema`; on failure throw `ImportError` with message "This file isn't an Atelier export" (wrong format) or "This export has damaged entries" (schema errors); merge by `id` in ONE transaction: new id → add; existing → replace only if incoming `updatedAt` is newer; queue outbox for written rows; orphans (category whose workspace is missing, item whose category is missing) go into a workspace "Imported" / category "Imported".

- [ ] **Step 1: Tests**

```ts
test('export then import into empty db round-trips', ...);
test('re-importing the same file adds nothing', ...); // added 0, skipped = all
test('import rejects invalid file and writes nothing', ...); // one bad item among good ones → throws ImportError, all tables unchanged
test('orphan items land in Imported', ...);
```

- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(extension): JSON export and import`.

---

### Task 13: End-to-end smoke test and docs

**Files:**
- Create: `apps/extension/e2e/{playwright.config.ts,smoke.spec.ts}`
- Modify: `README.md` (build, load unpacked in Chrome/Edge/Brave, run tests)

**Interfaces:**
- Playwright `chromium.launchPersistentContext` with `--disable-extensions-except=<dist> --load-extension=<dist>`; extension id from the service worker URL.

- [ ] **Step 1: Write `smoke.spec.ts`**
  - opens a new tab → sees "My workspace" with "Saved" and "Notes" within 1 s;
  - opens `https://example.com` tab, then the popup page `chrome-extension://<id>/src/popup/index.html?tabId=<id>` (popup reads `tabId` param when present, for testability) → "Save tab" → board shows "Example Domain";
  - toggles theme → `<html>` has class `nocturne`.
- [ ] **Step 2:** `bun run build && bun run e2e` — PASS.
- [ ] **Step 3:** Commit `test(extension): e2e smoke and README`.
