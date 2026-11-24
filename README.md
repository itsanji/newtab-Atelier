# Atelier

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

```sh
bun run test
```

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

## End-to-end tests

```sh
bun run build
bun run e2e
```

The end-to-end tests load the built extension into a real Chromium. They use `/usr/bin/chromium` by default; set `ATELIER_CHROMIUM` to the path of another Chromium binary to override it. Branded Google Chrome no longer loads extensions from the command line, so use Chromium or a Chrome for Testing build.
