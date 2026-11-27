# AppUI table components — which one to use (reuse audit)

_Audit for PLATFORM_IMPROVEMENTS #6: there are two shared table components plus
several app-local tables. This records the reuse boundary so a new table picks
the right one instead of hand-rolling a third strategy._

## The two shared components

### `AppUIPreviewTable` — lightweight read-only previewer
`framework/appui/src/components/preview-table.js` (ships in the always-on
`content` bundle). Input is **`header: string[]` + `rows: any[][]`** (a flat
dump). Renders as an **HTML string** (`tableHtml` → `mountTable` → `wireTable`),
escapes cells via `escCell`, pins the table to the viewport, sorts on header
click (numeric-aware, re-renders only the `<tbody>`), and windows the initial
render at `ROW_CAP = 2000` with a "show all" button.

**Use it for:** cheap, read-only previews of tabular dumps — CSV/TSV, SQLite,
PylonDB, Parquet, xlsx, RAN config. It is the one every file previewer should
call (it was promoted out of the workspace page's per-closure table helpers
exactly so previewers stop re-implementing it).

Not virtualized in the scroll sense — "show all" materializes every row. Fine
for a preview; if you need true windowing on a huge live dataset, use DataTable.

### `AppUIDataTable` — rich interactive grid
`framework/appui/src/components/data-table.js` (+ its `data-table-*` sub-modules;
ships in the opt-in `dataTable` bundle). Input is **object rows + a `columns[]`
descriptor model** (`{id,label,render(row,scope),getValue,sortable,filterable}`),
with `getId` identity and `maxRows` (default 500). Builds **real DOM nodes**,
does **true virtual scroll** (`AppUIVirtualScroll`, row recycling) above 200
rows, has per-column **filter** popups, **expandable detail rows**,
**action/checkbox** cells, live-stream `prepend`, and full `AppUILifecycle` /
`AbortSignal` teardown.

**Use it for:** interactive grids — a live event/log stream, a filterable
selectable list, anything with per-cell controls or that must stay smooth at
tens of thousands of rows.

## Decision: these two stay SEPARATE

### DataTable export

`table.exportCsv({filename:'results'})` and
`table.exportXlsx({filename:'results', sheetName:'Results'})` download the current
filtered/sorted display, including virtual rows, capped by `maxRows`.
`scope:'all'` exports all loaded model rows; it does not fetch server pages.
`download:false` returns `{blob, filename, rows}` without downloading.

Columns can set `export:false`, `exportValue(row)`, `exportLink(row)`,
`exportLabel` and `exportWidth`. Action/checkbox columns are excluded by default.
Values otherwise use `getValue(row)` or `row[id]`; render callbacks never run.
Use exportValue for computed display text. XLSX keeps numbers and booleans typed,
wraps multiline text, freezes the header, adds autofilters and safe HTTP(S)/mailto
hyperlinks. Strings are literal cells, never formulas. CSV escapes formula-like
text and quotes fields. `AppUITableExport.create({columns,items,format,...})`
exposes the same writer independently in the `dataTable` bundle. No network or
third-party script is needed. The workbook uses uncompressed ZIP entries.
They have different input contracts (`string[][]` vs object-rows + column
descriptors), different rendering (innerHTML string vs DOM + virtual scroll),
and different purposes (read-only preview vs interactive grid). Collapsing them
would force the lean previewer to carry the grid's weight (or the grid to lose
its model). PreviewTable is the lightweight sibling, DataTable the heavyweight —
keep both; pick by the table above.

## App-local tables — audit outcome

| Where | What it is | Verdict |
|---|---|---|
| `platform/tool_catalog/page/chain.js` | An **SVG dependency graph + pipeline builder** — no rows/columns at all. | **Not a table.** Nothing to converge. |
| `analytics/parquet_viewer/page/js/table.js` `displayData` | A flat "Table" view: builds `thead`/`tbody` innerHTML over **all** rows, no sort, no cap, **no cell escaping**. | **Convergence candidate (clean):** replace with `AppUIPreviewTable.tableHtml/mountTable/wireTable` to get escaping + sort + the 2000-row cap for free. Deferred: parquet is out of this item's safe edit scope; tracked below. |
| `analytics/parquet_viewer/page/js/file-previews.js` `buildPreviewTablesAsync` | A richer sortable **preview** table, but with its own machinery: sort via a right-click column-context-menu that **re-renders the whole view** (not just the tbody), a fixed **10-row** cap, no `escCell`, plus parquet-domain features (custom/renamed/hidden columns, per-column stats row, folder grouping, sticky quick-nav). | **Partial convergence only.** The inner `<table>` body is a subset of PreviewTable, but the domain shell (column context-menu, stats, grouping, quick-nav) has no hooks in PreviewTable today. Converging would need PreviewTable to grow per-column header decoration + a pluggable cell/column model first. **Documented difference — do not blindly split.** |

### Why parquet is not converged here
`parquet_viewer` is a working app whose preview layers real domain features
on top of a basic table; swapping its inner renderer is a non-trivial rewrite in
a different app's domain and belongs in a parquet-scoped change, not a
component-library reuse audit. The clean win (the flat `displayData` path) and
the partial win (the preview-table body) are recorded so a future parquet pass
has the recipe; the component boundary itself is now explicit.

_New table? Use `AppUIPreviewTable` for a read-only dump, `AppUIDataTable` for an
interactive grid. Don't hand-roll a third — extend one of these (AGENTS.md:
reuse or EXTEND AppUI)._

## Render strategy of `AppUIPreviewTable` — measured decision (#24)

`tableHtml`/`wireTable` build the first `ROW_CAP = 2000` rows as ONE `innerHTML`
string. #24 asked whether a `documentFragment` + chunked append (or virtual
scroll) beats that for the large-table case. Measured in Chromium (Playwright,
median of 5 runs — `dev/framework/bench_preview_table_render.py`):

| shape (2000 rows) | one-shot innerHTML | fragment (200-row chunks) | detached innerHTML |
|---|---|---|---|
| WIDE (40 cols) | ~1680–1850 ms | **~1480–1575 ms** | ~1600–1730 ms |
| LONG-CELL (8 cols, 220-char cells) | **~640–1016 ms** | ~705–1115 ms | ~685–1028 ms |

**Decision: keep the one-shot `innerHTML`.** The fragment path is only ~12–15%
faster for the wide case and slightly SLOWER for long cells — no decisive,
shape-independent win, and both are dominated by the DOM parse/layout of 2000
wide rows (~1.5 s either way). A second render strategy in the lean previewer
isn't worth that.

The real lever for a genuinely huge/wide table is to **not materialize 2000 rows
at all** — i.e. true virtual scroll, which `AppUIDataTable` already has
(`AppUIVirtualScroll`, row recycling). So the recommendation for a previewer that
must stay smooth on very large data is to mount `AppUIDataTable` (virtualized)
rather than grow a windowing strategy into `AppUIPreviewTable`. The previewer's
`ROW_CAP` + "show all" remains the right lightweight default for a preview.

## AppUIBigTable + AppUITableWorkbench (bundle `bigTable`) — rows that are NOT in the browser

`AppUIDataTable` / `AppUIVirtualScroll` virtualise rows that are already loaded.
When the data set itself is too big to load (millions of rows in a parquet /
duckdb / csv file), use `AppUIBigTable`: it holds only a small LRU cache of row
blocks and asks the host for the window on screen via `fetch(offset, limit)`.
The scrollbar maps proportionally onto the row count (element height is capped
by browsers), wheel and keyboard move by rows, and sorting is delegated to the
host through `onSort` because it has to happen where the data lives.

`AppUITableWorkbench` is the complete page body built on it (path box, table
list, filter expression, SQL box, go-to-row, export) for any app that exposes
the ops `tables` / `open` / `rows` / `export`. The four analytics viewers
(`parquet_viewer`, `csv_viewer`, `xlsx_viewer`, `duckdb_viewer`) are each a
dozen lines around it; the engine is `analytics/duckdb_viewer`.
`setView({pinned: n})` keeps the row number and the first n columns in view while
scrolling sideways (a spreadsheet's frozen columns).
Columns are windowed too (only those in view get cells) and painting is
coalesced to one per animation frame — a 154-column table repaints ~230 cells
per frame instead of ~4000.
Measured 2026-11-15 on a 30M-row parquet file: any window in 80–180 ms.
