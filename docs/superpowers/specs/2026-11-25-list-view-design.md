# List view — design

**Why:** scan everything in a workspace at once, read long titles, and work in a narrow window. The column board scrolls sideways and spends a lot of space; the list view packs the same content densely and only scrolls down.

## What the user sees

- A **Columns ⇄ List** switch next to the search box. The choice is remembered on this device (not synced).
- In List view the workspace's categories are compact blocks, each **at most ~420px wide**, packed into **newspaper columns** (CSS columns): they fill the first column top to bottom, then continue in the next, so there are no gaps. On a wide screen that is several columns; on a narrow window, one. **Only vertical scrolling.**
- Rows are tight: one line per item — icon, title (one line, ellipsis, full title on hover), address on the right.
- Folders stay folders (icons, click the name to expand), just smaller. Notes, to-dos, the Add menu, menus, drag and drop, sharing tags and "Open all" behave as on the board. The New category tile becomes a small block at the end.

## Approaches considered

- **Stacked full-width sections** — too much empty space on wide screens (user: "so many unnecessary spaces").
- **Two panes (categories left, list right)** — shows one category at a time; fails "scan everything at once".
- **Wrapped categories, rows (flex-wrap)** — keeps order left to right but leaves holes under short categories.
- **Wrapped categories, newspaper columns** — chosen (option B in the mockups): no holes, most content per screen; order reads down each column.

## How (builder's calls)

- Same components as the board (CategoryColumn, ItemRow, FolderBlock, …); List view is a modifier class on the board plus compact CSS. No data, sync or server change.
- View mode lives in `localStorage` (`atelier.boardView`: `columns` | `list`), read synchronously so the first paint is right; other open tabs follow via the `storage` event.
- Category reordering keeps using the sortable index (works with any layout).

## Non-goals

- No per-workspace view setting, no sync of the choice.
- No change to the Columns view.

## Revision (same day, after using it)

- **Same look as Columns:** list view keeps the board's padding, spacing, row sizes and icons; only the layout differs.
- **Category size S / M / L** (260 / 300 / 380 px), a header switch remembered per device, applied to both views; M is the old fixed 300px.
- **As many columns as fit:** newspaper columns balance heights and leave lanes unused (4 categories on a wide screen used 2 lanes). Replaced by masonry: lanes = how many fixed-width categories fit; each category, in order, goes into the currently shortest lane (absolute positions, re-placed on resize or when a category's height changes, so nothing remounts and drag and drop keeps working).
