# Atelier — tab board extension: design

Date: 2026-11-24 · Status: draft for approval

## Intent

A free, open-source, self-hostable browser extension with the same feature set
and behaviour as tabExtend (the "tabExtend – Easy Tab Manager" Chrome
extension): the new tab page becomes a Kanban-style board where you save,
organise and reopen tabs, keep notes and to-dos beside them, sync across
devices through a server you run yourself, and share with others.

It has its own identity. "Atelier" is the working name (placeholder). It must
not reuse tabExtend's name, logo, copy or visual design.

## Goals

- Feature parity with tabExtend's user-facing features (list below), in one
  release, with nothing paywalled.
- Local-first: the board opens instantly from local data and works fully
  without any server; connecting to a server adds sync and sharing.
- Easy self-hosting: one `docker compose up` brings up the server; sensible
  defaults with no third-party services required.
- The look of the approved mockup, in the user's **Impression** design system
  (canvas: https://claude.ai/artifact/Kuftmujisu9Aybc39ejJ3q — screens
  "New tab board" light + dark, "Toolbar popup").

## Non-goals

- Paid plans, billing, usage limits, telemetry.
- A hosted service run by us; Chrome Web Store / Edge Add-ons listings (later).
- Mobile apps, Safari/Firefox builds.
- AI features, read-later parsing, full-text page archiving.
- Importers from other tab managers (JSON export/import of our own data only).
- Duplicate-link warnings, saved sessions, sort options.

## Anti-goals (failure even if it "works")

- Losing or duplicating a user's saved items during sync, offline edits,
  conflicts or account switches.
- A slow new tab: the board must paint from local data without waiting on the
  network (target < 200 ms to first content on a warm start).
- Requiring a server or account for basic use.
- A self-host setup that needs a pile of external services to start.
- Anything that looks or reads like tabExtend's branding.
- Leaking private boards: a public link exposes exactly one category,
  read-only, and nothing else.

## Feature set (complete scope of this release)

1. **New tab board** replaces the new tab page (`chrome_url_overrides.newtab`).
2. **Workspaces** (sidebar list) → **categories** (columns) → **items**.
   Create, rename, reorder, delete at every level.
3. **Item kinds:** link (url, title, favicon, optional note), note (paragraphs,
   bold/italic, links, checklists), to-do (text, done, optional reminder).
4. **Open tabs panel** in the sidebar: live list of the current window's tabs.
   Drag a tab onto a category to save it. "Save all and close" saves the
   window's tabs into a new category and closes them.
5. **Tab groups:** saving a tab group keeps its title and colour; the category
   shows a "Tab group · N" badge. "Open all" restores the links, recreating the
   tab group when the category came from one.
6. **Drag and drop** for items (within/between categories and workspaces) and
   for categories (reorder columns).
7. **Toolbar popup:** save current tab to a chosen category (optional note),
   close-after-saving option, "save all tabs in this window", open the board.
8. **Context menu:** "Save page to Atelier", "Save link to Atelier" (to the
   last-used category).
9. **Keyboard shortcut** (`commands`) to save the current tab.
10. **Reminders** on to-dos: system notification at the time; clicking it opens
    the board at that item.
11. **Search** across titles, URLs, notes and to-dos in all workspaces.
12. **Themes:** Giverny (light), Nocturne (dark), follow system. Custom emoji
    per category and workspace.
13. **Connect to a server** (settings: server URL) and **sign in**:
    email + password always; magic link when the server has SMTP configured;
    Google when the server has a Google OAuth client configured.
14. **Sync** across devices, near real-time.
15. **Shared workspaces:** invite by email; roles owner / editor / viewer;
    edits show live. With SMTP the invitee gets an email; without it the
    invite appears when that email signs in on that server.
16. **Public share link** for a single category: a read-only web page served
    by the server; owner can revoke it.
17. **Export / import** all data as JSON (also the way to move between
    servers).

## Approaches considered

- **A. Local only, add a server later.** Fastest; no sync or sharing at launch.
- **B. Local-first extension + a backend.** Full parity now. **Chosen by the
  user**, then refined to self-hosted open source (below).
- **C. Sync via the user's Google Drive app folder.** No server, but no shared
  workspaces or public links; a dead end for parity.

Backend for B, once self-hosting became a requirement (designer's call):

- **Self-hosted Supabase** — rejected: ~10 containers, heavy for self-hosters.
- **PocketBase** — light (one binary) but pre-1.0, and our sync rules would
  live in its hook system.
- **Own small TypeScript server + Postgres — chosen.** Two containers, sync and
  permission rules in our own code, types shared with the extension. The user
  chose Bun + Hono for it.

## Architecture (decided)

- **Monorepo, TypeScript throughout.** Packages: the extension, the server,
  and a shared core (data model, sort keys, sync protocol types, validation).
- **Extension:** Manifest V3, React, Vite. One build for Chrome, Edge, Brave.
  New tab page (board), popup, background service worker (tab events, context
  menus, commands, alarms, sync scheduling).
- **Local store:** IndexedDB (via Dexie) is the source of truth on each device;
  the UI reads only from it.
- **Server (user's choice):** Bun runtime + Hono, Postgres, WebSocket channel
  for live change notifications (Hono's Bun WebSocket adapter), serves the
  public share pages. Shipped as a Docker image (on the official Bun image)
  plus `docker-compose.yml` (server + Postgres).
- **Tooling:** Bun as package manager and workspace runner for the whole
  monorepo; the extension still builds with Vite (run under Bun). Configured by
  environment variables: public URL, database URL, session secret, optional
  SMTP, optional Google OAuth client.
- **Permissions:** the extension requests the server origin at runtime
  (`optional_host_permissions`) when the user connects; no server origins are
  baked in.
- **Design:** Impression tokens as CSS variables, Cormorant Garamond + Jost,
  its Button/Tag/Card/Field patterns as React components. No other UI kit.
- **License:** MIT (designer's call). **Distribution:** GitHub releases with the
  extension zip (load unpacked) and the server image.

### Data model

All synced rows: `id` (UUID made on the client), `created_at`, `updated_at`
(server-assigned), `deleted_at` (tombstone), `updated_by`.

- `user` — email, password hash, display name.
- `workspace` — name, emoji, owner_id, sort key.
- `workspace_member` — workspace_id, user_id or pending email, role.
- `category` — workspace_id, name, emoji, sort key, tab_group {title, color} or
  null, share_token or null.
- `item` — category_id, kind (link | note | todo), sort key, title, url,
  favicon_url, body (note JSON), done.
- `reminder` — item_id, user_id, remind_at, reminded_at (private to its user).
- Ordering uses fractional sort keys so a move writes one row.

### Sync

- Every edit writes to IndexedDB and queues an outbox entry.
- When connected, the extension pushes the outbox and pulls changes since its
  cursor; a WebSocket message from the server triggers a pull.
- Conflicts: last write wins per row by server-assigned `updated_at`; deletes
  are tombstones so they propagate.
- The server enforces every permission (membership, role) on each write.
- Reminders fire on one device: the device that fires sets `reminded_at`.

### Account switching (designer's call)

- The local store is partitioned: one local (no-account) partition plus one per
  server account. The outbox is per partition, so edits never upload under
  another identity.
- Signing in on a device with local items: they are merged into the account
  (UUIDs kept, so nothing duplicates) into a workspace named "From this
  device"; the local partition is then emptied.
- Signing out: the account's partition is removed from the device after its
  outbox flushes; if it can't flush, the user is warned and can export JSON
  first. The device returns to an empty local board.
- Switching accounts or servers is sign out, then sign in.

### Reminders in shared workspaces (designer's call)

A reminder belongs to whoever set it; other members see no reminder and get no
notification.

### Writes sync can't apply (designer's call)

Nothing a user wrote is silently dropped:

- Edit to an item whose category/workspace was deleted elsewhere: the server
  restores the parent and the item lands there with a "Restored" tag.
- Edit rejected by permissions (role lowered, removed): the item is copied into
  a "Recovered" category in the user's own first workspace, with a notice.

## Constraints

- MV3 service worker lifetime: no long-lived sockets in the worker; the live
  WebSocket lives in open extension pages; the worker syncs on alarms/events.
- Extension permissions: `tabs`, `tabGroups`, `storage`, `unlimitedStorage`,
  `contextMenus`, `alarms`, `notifications`, `identity`; server origin
  requested at runtime.
- The server must run with only Postgres; SMTP and Google are optional.
- Max 3 subagents at a time during the build.

## Left to the builder

Monorepo folder layout, Postgres client / ORM and migration tool,
password hashing and session mechanism, drag-and-drop library, rich-text editor
for notes, search library, test stack, favicon fetching, the share page's
markup (in Impression), self-host documentation layout.
