// preview-table.js — AppUIPreviewTable: the shared sortable/virtualized DATA
// TABLE used by every file previewer that renders rows (CSV/TSV, SQLite,
// PylonDB, Parquet, xlsx, RAN config, …). Promoted from the workspace page's
// per-closure `_tableHtml`/`_mountTable`/`_wireTable` (src/16_preview3.js) into a
// reusable AppUI component (IMPROVEMENTS_NEXT #4 — aggregate shared behavior into
// a reusable component with real consumers; #1 — so a LAZY previewer bundle can
// reuse it with no duplication). Pure DOM/string helpers, no app state.
//
//   AppUIPreviewTable.tableHtml(header, rows, caption, opts?) -> html string
//       header: string[]; rows: any[][]; caption?: string
//       opts.pin (default true): single table pins to the viewport (both
//         scrollbars at the pane edges); pin:false for stacked multi-table.
//   AppUIPreviewTable.mountTable(ctx, html)   — make ctx.box a flex column +
//       set innerHTML (so a pinned table scrolls internally).
//   AppUIPreviewTable.wireTable(box, header, rows) — attach the virtualized
//       "show all" + sortable-header behaviour (re-renders ONLY the <tbody>).
//   AppUIPreviewTable.rowHtml(row, i)         — one <tr> (zebra by index).
//   AppUIPreviewTable.escCell(s)              — the fast HOT-path cell escaper.
(function () {
  'use strict';

  var TABLE_ROW_CAP = 2000;   // initial windowed render; rest behind "show all"

  // Fast HTML escaper for the HOT table-cell path: a single regex replace
  // instead of a DOM-based escaper (which allocates a throwaway <div> per field).
  // Only the 5 text-context entities — fine for <td>/<th> text.
  function escCell(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '"' ? '&quot;' : '&#39;';
    });
  }

  // Build one <tr> string for a row (zebra bg by absolute index).
  function rowHtml(r, i) {
    var bg = (i % 2) ? 'color-mix(in srgb, var(--text-primary,#e3e5e8) 6%, var(--bg-primary,#1e1f22))' : 'var(--bg-primary,#1e1f22)';
    var tds = '';
    for (var c = 0; c < r.length; c++) {
      tds += '<td style="padding:4px 10px;border-bottom:1px solid var(--border,#3f4147);color:var(--text-primary,#e3e5e8);' +
        'white-space:nowrap;vertical-align:top">' + escCell(r[c]) + '</td>';
    }
    return '<tr style="background:' + bg + '">' + tds + '</tr>';
  }

  // A generic sortable table from rows (array of arrays) + header (array).
  // VIRTUALIZED: only the first TABLE_ROW_CAP rows are rendered up front; a
  // "show all" control appends the rest (incremental — no full pane rebuild).
  // SORTABLE: clicking a header re-renders ONLY the <tbody> (not the pane).
  function tableHtml(header, rows, caption, opts) {
    var pin = !(opts && opts.pin === false);   // single table pins to viewport; stacked tables don't
    var th = (header || []).map(function (h, ci) {
      return '<th data-col="' + ci + '" style="position:sticky;top:0;cursor:pointer;background:var(--bg-elevated,#2b2d31);text-align:left;padding:6px 10px;' +
        'border-bottom:1px solid var(--border,#3f4147);color:var(--text-primary,#e3e5e8);font-weight:600;white-space:nowrap" title="click to sort">' + escCell(h) + '</th>';
    }).join('');
    rows = rows || [];
    var shown = Math.min(rows.length, TABLE_ROW_CAP);
    var body = '';
    for (var i = 0; i < shown; i++) body += rowHtml(rows[i], i);
    var more = rows.length - shown;
    var moreBtn = more > 0
      ? '<div class="ws-table-more" style="padding:8px 10px;text-align:center;background:var(--bg-primary,#1e1f22)">' +
        '<button type="button" class="ws-table-showall" style="font:12px ui-monospace,monospace;padding:4px 12px;cursor:pointer;' +
        'background:var(--bg-elevated,#2b2d31);color:var(--text-primary,#e3e5e8);border:1px solid var(--border,#3f4147);border-radius:4px">' +
        'Show all ' + rows.length + ' rows (' + more + ' more)</button></div>'
      : '';
    // PIN mode (single table): a flex-column capped at the pane height so the
    // scroll region fills it and BOTH scrollbars pin to the pane edges (a wide
    // table's h-bar stays at the viewport bottom). SHORT table → shrinks, no bar.
    // NON-PIN (stacked multi-table): natural height; the OUTER container scrolls.
    if (pin) {
      return '<div class="ws-table-wrap" style="flex:1 1 auto;min-height:0;display:flex;flex-direction:column;background:var(--bg-primary,#1e1f22)">' +
        (caption ? ('<div style="flex:0 0 auto;padding:6px 10px;font-size:11px;color:var(--text-muted,#949ba4)">' + escCell(caption) + '</div>') : '') +
        '<div class="ws-table-scroll" style="flex:1 1 auto;min-height:0;overflow:auto">' +
        '<table style="border-collapse:collapse;width:100%;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace">' +
        '<thead><tr>' + th + '</tr></thead><tbody class="ws-table-body">' + body + '</tbody></table></div>' + moreBtn + '</div>';
    }
    return '<div class="ws-table-wrap" style="background:var(--bg-primary,#1e1f22)">' +
      (caption ? ('<div style="padding:6px 10px;font-size:11px;color:var(--text-muted,#949ba4)">' + escCell(caption) + '</div>') : '') +
      '<div class="ws-table-scroll" style="overflow-x:auto">' +
      '<table style="border-collapse:collapse;width:100%;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace">' +
      '<thead><tr>' + th + '</tr></thead><tbody class="ws-table-body">' + body + '</tbody></table></div>' + moreBtn + '</div>';
  }

  // Mount a PINNED single table so its horizontal scrollbar stays at the pane
  // (viewport) bottom, not the content bottom. The preview box becomes a flex
  // column with overflow:hidden; the pinned wrap (flex:1;min-height:0) fills it
  // and scrolls INTERNALLY, so both scrollbars sit at the box edges and only
  // show when the table actually overflows.
  function mountTable(ctx, html) {
    try {
      var b = ctx.box;
      if (b && b.style) { b.style.display = 'flex'; b.style.flexDirection = 'column'; b.style.overflow = 'hidden'; }
    } catch (e) {}
    ctx.box.innerHTML = html;
  }

  // Wire the virtualized/sortable behaviours onto a just-rendered table. Keeps
  // the full `rows` in a closure so show-all + sort re-render the <tbody> ONLY
  // (incremental — never rebuilds the whole preview pane).
  function wireTable(box, header, rows) {
    try {
      var tbody = box.querySelector('.ws-table-body');
      if (!tbody) return;
      var sortCol = -1, sortDir = 1, capped = true;
      function paint() {
        var data = rows;
        if (sortCol >= 0) {
          data = rows.slice().sort(function (a, b) {
            var x = a[sortCol], y = b[sortCol];
            var nx = parseFloat(x), ny = parseFloat(y);
            var bothNum = !isNaN(nx) && !isNaN(ny) && String(x).trim() !== '' && String(y).trim() !== '';
            if (bothNum) return (nx - ny) * sortDir;
            return String(x == null ? '' : x).localeCompare(String(y == null ? '' : y)) * sortDir;
          });
        }
        var lim = capped ? Math.min(data.length, TABLE_ROW_CAP) : data.length;
        var s = '';
        for (var i = 0; i < lim; i++) s += rowHtml(data[i], i);
        tbody.innerHTML = s;
        var mb = box.querySelector('.ws-table-more');
        if (mb) mb.style.display = (capped && data.length > TABLE_ROW_CAP) ? '' : 'none';
      }
      box.addEventListener('click', function (e) {
        var t = e.target;
        if (t && t.classList && t.classList.contains('ws-table-showall')) { capped = false; paint(); return; }
        var thEl = t; while (thEl && thEl.tagName !== 'TH' && thEl !== box) thEl = thEl.parentNode;
        if (thEl && thEl.tagName === 'TH' && thEl.hasAttribute('data-col')) {
          var c = parseInt(thEl.getAttribute('data-col'), 10);
          if (c === sortCol) sortDir = -sortDir; else { sortCol = c; sortDir = 1; }
          paint();
        }
      });
    } catch (e) { /* non-fatal: static table still shows */ }
  }

  if (typeof window !== 'undefined') {
    window.AppUIPreviewTable = {
      ROW_CAP: TABLE_ROW_CAP,
      escCell: escCell,
      rowHtml: rowHtml,
      tableHtml: tableHtml,
      mountTable: mountTable,
      wireTable: wireTable,
    };
  }
})();
