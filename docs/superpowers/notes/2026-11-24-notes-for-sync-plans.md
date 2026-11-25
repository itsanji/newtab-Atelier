# Notes for the server and sync plans (from plan 1 reviews)

Carried forward from the plan 1 build so plans 2 and 3 don't rediscover them.

## Outbox

- The outbox is coalesced per row: key `<table>:<rowId>`, latest snapshot wins, `seq` strictly increasing (assigned inside the write transaction).
- Because a rewritten row gets a new, higher `seq`, a parent edited after its child was created is queued **after** the child. The uploader must not assume parents precede children in `seq` order (upload in one batch, or let the server accept children whose parent arrives in the same push).

## Sort keys

- Keys come from `fractional-indexing` and are deterministic, so two devices appending to the same category produce equal keys. `keyFor` tolerates equal neighbours (places after `before`), but sync should add jitter or rebalance on conflict.

## Import

- Re-parented orphans get `updatedAt = now` on import. A genuinely newer edit made elsewhere before that moment would lose last-write-wins against it.
- Reminder merge is keyed by reminder id; after a clear-and-reset on another device, an import can leave two live reminders for one item.

## URLs

- Only `http`, `https`, `file` and `ftp` URLs are accepted (tab saves, save-link, import schema, open all). Keep the same allow-list at every server write boundary.
- `faviconUrl` is stored as `null`; the UI derives it from `url` via Chrome's `_favicon` endpoint (install-specific, never sync it).

## UI state

- `selectedWorkspaceId` lives in shared `meta`, so switching workspace in one board tab switches all open board tabs. With accounts, keep it per device, not synced.
