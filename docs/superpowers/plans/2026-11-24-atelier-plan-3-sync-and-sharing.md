# Atelier Plan 3 — Sync, Accounts and Sharing in the Extension

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the plan-1 extension to the plan-2 server: sign in (password, magic link, Google), sync near real-time across devices, shared workspaces with roles, public category links, and safe account switching — while still working fully with no server.

**Architecture:** The local store is partitioned (`openDb(partition)`): `local` for no account, `acct-<hash>` per server account. The active account lives in `chrome.storage.local` under `account`; every page and the service worker open the active partition and reload when it changes. A sync engine (single-flight via `navigator.locks`) pushes the outbox and pulls since a cursor; the worker runs it on an alarm and on messages, open board pages hold the WebSocket and trigger it on `changed`. Account, sharing and server calls go through one typed API client.

**Tech Stack:** as plan 1, plus `chrome.permissions`, `chrome.identity.launchWebAuthFlow`, Web Locks API, WebSocket. No new UI kit.

**Spec:** `docs/superpowers/specs/2026-11-24-atelier-tab-board-design.md` (Feature set 13–16, Sync, Account switching, Reminders in shared workspaces, Writes sync can't apply, Constraints).
**Server API:** `docs/superpowers/plans/2026-11-24-atelier-plan-2-server.md` (Tasks 2–6 Interfaces are the contract; the server code in `apps/server` is the truth if they differ).
**Carried notes:** `docs/superpowers/notes/2026-11-24-notes-for-sync-plans.md`.

## Global Constraints

- **No CI/CD.** Never create pipeline files. Tests run locally.
- Max 3 subagents at a time.
- All plan-1 constraints still hold (Impression look, voice, < 200 ms first paint from local data, no network without a configured server, one primary button per view).
- The board never waits on the network: sync runs after first paint and failures only show a quiet status ("Offline", "Sync paused — sign in again").
- Manifest adds `identity` permission and `optional_host_permissions: ["http://*/*", "https://*/*"]`. The server origin is requested with `chrome.permissions.request` from a user click, skipped when `chrome.permissions.contains` already grants it. An e2e build (`ATELIER_E2E=1 vite build`) additionally declares `host_permissions: ["http://127.0.0.1/*"]`; normal builds never do.
- Nothing a user wrote is silently dropped: `rejected` push results are copied into a "Recovered" category; `restored` items show a "Restored" tag.
- Edits never upload under another identity: the outbox is per partition, and a partition's token is only used for that partition.
- Reminders are private: the extension only creates reminders with `userId` = the signed-in user id (or `local`), and the device that fires one sets `remindedAt` and syncs it.
- `selectedWorkspaceId` and the sync cursor live in the partition's `meta` table and are never uploaded.
- Viewers see shared workspaces read-only: every edit affordance is hidden or disabled with the tooltip "View only".

## Review Focus

1. **Signing in on a device that has local items, then signing out with unsynced edits** — sign-in moves every local row into the account partition under a workspace "From this device" with ids unchanged and nothing duplicated; sign-out with a failing flush warns and offers export before deleting anything. Test: Task 5 `sign-in merges local rows once` and `sign-out with unflushed outbox warns and keeps data`.
2. **A local edit made while a pull brings an older server copy of the same row** — the pending local edit wins (pull skips rows with an outbox entry); after push the server copy matches. Test: Task 3 `pull never overwrites a row with a pending outbox entry`.
3. **Server unreachable, token revoked (401), or server URL typed without scheme / with trailing slash** — offline: outbox kept, status "Offline", retried next alarm; 401: status "Sync paused — sign in again", outbox kept; URL normalised (`https://` added when missing, trailing slash removed). Tests: Task 2 `normaliseServerUrl`, Task 3 `push failure keeps outbox`, `401 pauses sync`.
4. **Outbox where a child row has a lower seq than its edited parent** — push sends tables in order workspaces → categories → items → reminders, so the server never sees a child before its parent in one push. Test: Task 3 `push orders by table then seq`.
5. **Two devices appending to the same category** — sort keys get a random suffix so keys don't collide. Test: Task 3 `appended sort keys are unique across devices`.

---

## File structure

```
apps/extension/
  manifest.config.ts          identity, optional_host_permissions, e2e host_permissions
  src/account/
    account.ts                Account type, getAccount/setAccount/clearAccount, partitionFor, useAccount()
    activeDb.ts               getActiveDb() for the worker; ActiveDbProvider for pages (reopens on change)
    signIn.ts                 finishSignIn(api result) incl. local merge; signOut()
  src/sync/
    api.ts                    ApiClient, normaliseServerUrl, ApiError, UnauthorizedError, OfflineError
    engine.ts                 syncOnce(db, account, api) ; pushOutbox ; applyPull ; recover
    status.ts                 sync status in chrome.storage.session: 'idle'|'syncing'|'offline'|'paused'|'error'
    live.ts                   useLiveSync(): WebSocket per open board page
    schedule.ts               worker wiring: alarm 'sync' every 1 min, onStartup, 'sync-now' message
  src/data/db.ts              version(2): members table
  src/data/repo.ts            sort-key jitter on append; onLocalWrite hook -> 'sync-now'
  src/board/
    AccountDialog.tsx         connect, sign up/in, magic link, Google, signed-in view, sign out
    ShareDialog.tsx           members, invite, roles, remove, leave
    PublicLinkMenu (in CategoryColumn menu)   create / copy / revoke
    SyncStatus.tsx            sidebar footer status line
    useRole.ts                role of current user in a workspace (owner when no account)
  e2e/sync.spec.ts            two devices + server
```

---

### Task 1: Partitions, account store, schema v2

**Interfaces — Produces:**
- `type Account = { serverUrl: string; userId: string; email: string; displayName: string; token: string; partition: string }`; `getAccount(): Promise<Account|null>`, `setAccount(a)`, `clearAccount()` (chrome.storage.local key `account`); `partitionFor(serverUrl, userId): string` = `acct-` + first 16 hex chars of SHA-256(`serverUrl|userId`); `useAccount(): Account | null | undefined` (undefined while loading, live on storage changes).
- `getActiveDb(): Promise<AtelierDB>` (worker; caches per partition, closes the old DB when the account changes); `<ActiveDbProvider>` for newtab and popup: resolves the partition, renders children inside `DbProvider`, remounts children when the partition changes. Replace the direct `openDb()` use in `newtab/App.tsx`, `popup/Popup.tsx` and `background/index.ts`.
- `currentUserId(): string` used by repo for `updatedBy` and new reminders' `userId` (the account's userId, else `LOCAL_USER`); repo's `stamp`/`base` use it.
- Dexie `version(2)` adds `members: 'id, workspaceId'` (rows of plan-2 `Member`); `deleteDb(partition)`.
- Manifest changes per Global Constraints.

- [ ] Tests: `partitionFor is stable and differs per user`, `ActiveDbProvider switches partition when account changes`, `getActiveDb returns local without account`, `new reminder uses signed-in user id`, existing suite still green.
- [ ] Commit `feat(extension): account store and partitioned databases`.

### Task 2: API client

**Interfaces — Produces:**
- `normaliseServerUrl(input: string): string` — trims, adds `https://` when no scheme, keeps `http://` when given, removes trailing slashes and any path; throws `InvalidServerUrl` on garbage.
- `class ApiClient(serverUrl, token?: string)` with methods: `config()`, `signUp(email, password, displayName)`, `logIn(email, password)`, `logOut()`, `me()`, `magicStart(email)`, `magicPoll(requestId, pollSecret)`, `googleStartUrl(redirectUri, state)` (string), `googleExchange(code)`, `push(changes)`, `pull(cursor)`, `members(workspaceId)`, `invite(workspaceId, email, role)`, `setRole(workspaceId, memberId, role)`, `removeMember(workspaceId, memberId)`, `share(categoryId)`, `unshare(categoryId)`, `liveUrl()` (`ws(s)://…/api/live`). Types mirror the server routes.
- Errors: `UnauthorizedError` (401), `OfflineError` (fetch threw / timeout 15 s via `AbortSignal.timeout`), `ApiError(status, message)` carrying the server's `error` text.
- `ensureHostPermission(serverUrl): Promise<boolean>` — `contains` then `request({ origins: [origin + '/*'] })`.

- [ ] Tests (fetch stubbed): `normaliseServerUrl` cases (`example.com` → `https://example.com`, `http://10.0.0.2:8787/` → `http://10.0.0.2:8787`, `https://x.y/path/` → `https://x.y`, `"  "` throws), `sends bearer token`, `maps 401 to UnauthorizedError`, `maps network failure to OfflineError`, `surfaces server error message`.
- [ ] Commit `feat(extension): server API client`.

### Task 3: Sync engine

**Interfaces — Produces:**
- `syncOnce(db, account, api, now?): Promise<SyncResult>` — runs inside `navigator.locks.request('atelier-sync:' + partition, …)` (single flight), then `pushOutbox` then `pull` (repeat push once if new outbox entries arrived meanwhile). Sets status via `status.ts`.
- `pushOutbox`: read outbox, order by table rank (workspaces 0, categories 1, items 2, reminders 3) then `seq`; send in chunks of 500; for each result delete the outbox entry **only if its `seq` is unchanged** since read. `applied`: done. `restored`: set local item `restored = true` (and un-tombstone local parents) without enqueueing. `rejected`: call `recover(db, row)`.
- `recover(db, rows)`: copies rejected items into a category named "Recovered" in the user's first owned workspace (create the category if missing, at the end), with new ids, enqueued; rejected workspaces/categories/reminders are dropped locally and their outbox entries removed; returns the count; the board shows a notice "N items couldn't sync and were saved to Recovered".
- `applyPull(db, res)`: in one transaction, `put` each row unless an outbox entry exists for it; `members` replaced per workspace; for `removedWorkspaceIds` delete (hard) the workspace, its categories, items, reminders and members locally; save `cursor` in `meta` key `syncCursor`. Never enqueues.
- Repo: appends (`keyBetween(last, null)` sites for workspaces, categories, items) add jitter — `appendKey(last)` = `keyBetween(last, null)` followed by 3 random chars from `0-9A-Za-z` whose last char is not `0`, validated with `keyBetween(result, null)` (fall back to the plain key if invalid).
- `onLocalWrite(fn)` in repo: called after every committed mutation transaction (not by sync); the pages wire it to `chrome.runtime.sendMessage({ type: 'sync-now' })` debounced 1 s.

- [ ] Tests (fake api): `push orders by table then seq`, `push success clears only unchanged outbox entries`, `push failure keeps outbox` (OfflineError → status offline), `401 pauses sync`, `restored result tags item`, `rejected items are copied to Recovered`, `pull applies rows and cursor`, `pull never overwrites a row with a pending outbox entry`, `removed workspace is deleted locally`, `syncOnce is single-flight`, `appended sort keys are unique across devices`.
- [ ] Commit `feat(extension): sync engine`.

### Task 4: Sync scheduling and live updates

- Worker (`schedule.ts`, wired in `background/index.ts` synchronously at top level): alarm `sync` (`periodInMinutes: 1`) created on install/startup; on alarm, `runtime.onStartup`, and message `{type:'sync-now'}` → `syncOnce` for the active account (no-op without account); after a sync that changed reminders, call `syncAlarms`.
- `useLiveSync()` used by the board App when an account exists: opens `api.liveUrl()`, sends `{type:'auth', token}`, on `{type:'changed'}` sends `sync-now`; reconnects with backoff 1 s → 30 s max; close code 4401 sets status paused; closes on unmount/account change. Also sends `sync-now` on mount and on `online` event.
- `SyncStatus.tsx` in the sidebar footer (only with an account): "Synced", "Syncing…", "Offline", "Sync paused — sign in again" (button opens the account dialog), "Sync failed" with retry.
- [ ] Tests: `alarm triggers syncOnce for active account only`, `sync-now message triggers sync`, `useLiveSync reconnects with backoff and syncs on changed` (fake WebSocket), `SyncStatus renders each state`.
- [ ] Commit `feat(extension): background sync and live updates`.

### Task 5: Account UI, sign-in merge, sign-out

- Sidebar gets an "Account" entry (icon button + label: "Connect a server" without account, else display name/email) opening `AccountDialog`.
- Dialog steps: (1) server URL field + "Connect" (normalise, `ensureHostPermission`, `config()`; show "Can't reach that server" on failure). (2) Sign-in view: email + password with "Sign in" (primary) and "Create account" toggle (adds name field); "Email me a link" when `magicLink` (shows "Check your email" and polls every 2 s up to 15 min, cancel button); "Continue with Google" when `google` (`launchWebAuthFlow` with `chrome.identity.getRedirectURL('google')`, random state checked on return, then `googleExchange`). (3) Signed-in view: server, email, "Sign out".
- `finishSignIn(api, result)`: builds `Account`, opens its partition; if the `local` partition has any live workspace rows with user content (more than the untouched seed — i.e. any item, or any category/workspace changed after creation), copies every local workspace/category/item/reminder into the account partition: a new workspace "From this device" receives all local categories (ids kept, `workspaceId` re-pointed), items/reminders kept as-is with reminder `userId` = account user, all enqueued; then empties the `local` partition (`deleteDb('local')`). Then `setAccount` (pages switch), triggers `sync-now`. A fresh account partition with no workspaces after the first pull gets the plan-1 seed.
- `signOut()`: run `syncOnce`; if the outbox is still non-empty, the dialog shows "Some changes haven't synced yet." with "Export data" (plan-1 export) and "Sign out anyway"; on proceed: `api.logOut()` (ignore failures), `clearAccount()`, `deleteDb(partition)`; the local partition is re-seeded empty.
- [ ] Tests: `connect normalises url and shows auth options from config`, `password sign-in stores account and switches partition`, `sign-in merges local rows once` (ids kept, no duplicates, one "From this device" workspace, local partition emptied), `untouched seed is not merged`, `magic link polls until signed in`, `google flow checks state`, `sign-out with unflushed outbox warns and keeps data`, `sign-out deletes account partition`.
- [ ] Commit `feat(extension): accounts, sign-in merge and sign-out`.

### Task 6: Sharing UI, roles, restored and recovered

- `useRole(workspaceId)`: `'owner'` without account; else from `members` table (current user's live row), defaulting to `'owner'` for a workspace whose `ownerId` is the user or that has no members yet (not pushed).
- Viewer mode: board header, category menus, add buttons, drag handles, item edit/delete and drop targets disabled for viewer workspaces; tooltip "View only"; a "View only" tag in the board header.
- Workspace "Share" button in the board header (account only): `ShareDialog` lists members (name/email, role, "Pending" tag for invites without user), owner can invite (email + role select editor/viewer, "Send invite"), change role, remove; non-owners see "Leave workspace". Calls the API then `sync-now`.
- Category menu gains "Public link" (account + editor/owner): "Create public link" → copies `url` to clipboard, notice "Link copied"; when shared: "Copy public link" and "Stop sharing". Category shows a small "Public" tag when `shareToken` is set.
- Items with `restored: true` show a "Restored" tag; any edit of the item clears it (repo sets `restored: false`).
- Recovered notice from Task 3 shown via the existing `useNotify`.
- [ ] Tests: `viewer sees workspace read-only`, `owner invites member and sees pending tag`, `non-owner can leave`, `create, copy and stop public link`, `restored tag shows and clears on edit`.
- [ ] Commit `feat(extension): sharing, roles and public links`.

### Task 7: End-to-end sync test and docs

- `e2e/sync.spec.ts`: starts the server via `bun apps/server/src/main.ts` against a fresh database on the test Postgres (`bun run db:test:up` first), `PUBLIC_URL=http://127.0.0.1:<port>`, no SMTP/Google; builds with `ATELIER_E2E=1`. Two persistent Chromium contexts (device A, device B). A: connect, create account, save a link (popup flow from plan-1 smoke), see "Synced". B: connect, sign in, sees the link within 10 s (live). B edits the title → A sees it. A shares the category publicly → fetch the URL in a page and see the link title. A invites user C (created via API) as viewer; C on device B after sign-out/sign-in sees the workspace read-only.
- Root script `"e2e": "bun run build:e2e && playwright …"` runs both specs; README: "Sync and sharing" section + link to `docs/self-hosting.md`.
- [ ] Run `bun run test` and `bun run e2e`; all green. Commit `test(e2e): two-device sync, sharing and public link`.
