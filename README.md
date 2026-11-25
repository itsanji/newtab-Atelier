# Atelier

![The Atelier board: categories side by side, with folders of site icons, reading links, to-dos and a note](docs/images/board.png)

Atelier is a browser extension that turns the new tab page into a board of links, notes and to-dos, grouped by workspace and category. Save tabs from the toolbar popup, the context menu or the open tabs panel, drag items between categories, set reminders and search everything on the board. It works with no server and no account, and keeps everything in local storage.

## Requirements

- [mise](https://mise.jdx.dev), which installs Bun 1.4.4 from `mise.toml`
- A Chromium-based browser (Chrome, Edge or Brave)

## Install

```sh
mise install
bun install
```

## Test

The server tests need a throwaway Postgres in Docker (port 54329 on 127.0.0.1, data kept in memory):

```sh
bun run db:test:up
bun run test
```

`bun run test` runs the extension and core tests (Vitest) and then the server tests (`bun test`).

## Build

```sh
bun run build
```

The unpacked extension is written to `apps/extension/dist`.

## Load unpacked in Chrome, Edge or Brave

1. Open `chrome://extensions` (`edge://extensions` in Edge, `brave://extensions` in Brave).
2. Turn on Developer mode.
3. Choose Load unpacked and select `apps/extension/dist`.
4. Open a new tab to see the board.

Press Alt+Shift+S to save the current tab. You can change the shortcut at `chrome://extensions/shortcuts`.

## Sync and sharing

Atelier works fully without an account. To use it on more than one device, or with other people, run your own Atelier server (one container plus Postgres, started with `docker compose up -d`). Setup, HTTPS, email and Google sign-in are covered in [docs/self-hosting.md](docs/self-hosting.md).

Once the server is running:

1. In the board's sidebar, choose Connect a server and enter its address, for example `atelier.example.com` (`https://` is added when you leave it out). The browser asks for permission to reach that server.
2. Create an account, or sign in with a password, an emailed link or Google (the last two only when the server has them set up).
3. The board then syncs in the background. Changes show up on your other signed-in devices within a few seconds while a board is open, and at least once a minute otherwise. The sidebar footer shows Synced, Offline, or Sync paused when you need to sign in again.

If you already have items on the device, signing in moves them into a workspace called From this device in your account. Signing out removes the account's board from the device; if some changes haven't synced, Atelier warns you first and offers an export.

Sharing:

- **Workspaces.** Use Share in the board header to invite people by email as editors or viewers. Viewers see the workspace read-only. Owners can change roles and remove members; anyone else can leave.
- **Public links.** From a category's options menu, choose Create public link. Anyone with the link sees a read-only page of that category, served by your server. Copy public link and Stop sharing are in the same menu.

Reminders stay private to the person who set them, even in shared workspaces.

## End-to-end tests

```sh
bun run db:test:up
bun run e2e
```

`bun run e2e` builds a test copy of the extension into `apps/extension/dist-e2e` and loads it into a real Chromium with Playwright. It runs two specs:

- `smoke.spec.ts`: the board, saving from the popup, drag and drop and themes, with no server.
- `sync.spec.ts`: starts the server (`apps/server/src/main.ts`) on a free port against a new database in the test Postgres, then drives two browser profiles: device A creates an account and saves a tab, device B signs in and sees it and A's later edits live, B's edits reach A, A creates a public link and opens it, and a viewer invited by A signs in on B and sees the workspace read-only. The server, the browser profiles and the database are removed afterwards.

The test build also grants the extension access to `http://127.0.0.1/*`, so connecting to the local server doesn't need a permission prompt. It goes to its own folder; don't load `dist-e2e` as your everyday extension.

The tests use `/usr/bin/chromium` by default; set `ATELIER_CHROMIUM` to the path of another Chromium binary to override it. Branded Google Chrome no longer loads extensions from the command line, so use Chromium or a Chrome for Testing build. They run the server with `bun` from your `PATH` (override with `ATELIER_BUN`) and reach Postgres at `postgres://postgres:postgres@127.0.0.1:54329/postgres` (override with `TEST_DATABASE_URL`).
