/* AppUITableWorkbench: a complete "open a tabular file, browse it, query it"
 * page body, shared by the analytics viewers (parquet / csv / xlsx / duckdb).
 *
 * The host app supplies five ops (all take {path} or {src}):
 *   tables -> {tables:[{name, rows, columns:[{name,type}]}]}
 *   open   {table|sql, where?, order_by?} -> {view, rows, columns}
 *   rows   {view, offset, limit} -> {rows:[[…]]}
 *   export {view, save_to, confirm, force?} -> {path, rows}
 *
 * Usage:
 *   AppUITableWorkbench.create({
 *     container: el,
 *     api: '/v1/apps/analytics/csv_viewer/',
 *     hint: 'C:\\data\\trace.csv',          // placeholder for the path box
 *   });
 * The page url may carry ?path=<local path> or ?src=<vfs url> to open at once.
 * Rows are shown through AppUIBigTable, so table size is not a concern here.
 *
 * Two layouts:
 *   create({container, …})        everything inside `container` (table list on the left)
 *   create({mount: {side, top, body}, …})   the pieces go into separate elements —
 *       side = the table list, top = the path / filter / SQL bars, body = grid + status
 *   createApp({id, title, api, hint, sideWidth?, menu?})   a whole AppUI shell page:
 *       the table list in the LEFT SIDEBAR ("Tables" tab, with a filter box), the bars
 *       in content.top, the grid in the body, plus a "Table" menu. Needs the shell bundle.
 * The table list gets a filter box when a source has many tables.
 * Column filters: the grid's filter row and right-click menu (AppUIBigTable) give
 * per-column filters; they become SQL conditions (columnFilterSql) ANDed with the
 * free-text filter box. Pass columnFilters:false to turn them off.
 * Dialogs (AppUIDialog): "Filters…" edits every column condition + the SQL condition
 * in one place; right-click "Properties…" shows a column's statistics for the current
 * view (host op column_stats {view, column} -> rows, nulls, distinct, min, max, avg,
 * sum, stddev, quartiles, text lengths, top values) — hidden if the host lacks the op.
 */
const AppUITableWorkbench = (() => {
  let styled = false;
  function style() {
    if (styled) return; styled = true;
    const s = document.createElement('style');
    s.textContent = [
      '.autw{display:flex;flex-direction:column;height:100%;min-height:0;gap:6px;padding:8px;box-sizing:border-box}',
      '.autw-viewer{padding:4px 6px;gap:4px}.autw-viewer .autw-bar select{max-width:280px;font-size:12px}',
      '.autw-viewer a.autw-full{margin-left:auto;font-size:12px;color:var(--accent,#5865f2);text-decoration:none;white-space:nowrap}',
      '.autw-bar{display:flex;gap:6px;align-items:center;flex:none;flex-wrap:wrap}',
      '.autw-bar[hidden],.autw select[hidden]{display:none}',          // the flex rule would override `hidden`
      '.autw-bar input[type=text],.autw textarea{font:12px ui-monospace,Consolas,monospace;padding:4px 6px;box-sizing:border-box}',
      '.autw-grow{flex:1;min-width:160px}',
      '.autw-main{display:flex;flex:1;min-height:0;gap:6px}',
      '.autw-side{flex:none;width:230px;overflow:auto;border:1px solid var(--border,#3f4147);font-size:12px;display:flex;flex-direction:column}',
      '.autw-side.autw-in-shell{width:auto;border:0;height:100%;min-height:0}',
      '.autw-list{flex:1;min-height:0;overflow:auto}',
      '.autw-find{flex:none;margin:6px;padding:4px 6px;font:12px inherit;box-sizing:border-box;width:calc(100% - 12px)}',
      '.autw-find[hidden]{display:none}',
      '.autw-top{display:flex;flex-direction:column;gap:6px;padding:8px 8px 0}',
      '.autw-body{display:flex;flex-direction:column;height:100%;min-height:0;gap:6px;padding:0 8px 8px;box-sizing:border-box}',
      '.autw-t{padding:5px 8px;cursor:pointer;border-bottom:1px solid var(--border-subtle,rgba(127,127,127,.18))}',
      '.autw-t:hover,.autw-t.on{background:rgba(127,127,127,.18)}',
      '.autw-t small{display:block;opacity:.6}',
      '.autw-t.autw-bad{color:var(--danger,#e5534b);cursor:help}',
      '.autw-right{display:flex;flex-direction:column;flex:1;min-width:0;min-height:0;gap:6px}',
      '.autw-grid{flex:1;min-height:120px}',
      '.autw-status{flex:none;font-size:12px;opacity:.8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.autw-err{color:var(--danger,#e5534b);opacity:1;white-space:pre-wrap}',
      '.autw-load{flex:none;display:none;font-size:12px}',
      '.autw-load.on{display:block}',
      '.autw-track{height:6px;border-radius:3px;background:rgba(127,127,127,.25);overflow:hidden;margin-bottom:3px}',
      '.autw-fill{height:100%;width:0;background:var(--accent,#4c8bf5);transition:width .4s linear}',
      '.autw-fill.busy{width:30%!important;animation:autw-slide 1.1s ease-in-out infinite alternate}',
      '@keyframes autw-slide{from{margin-left:0}to{margin-left:70%}}',
      '.autw-dlg{display:flex;flex-direction:column;gap:8px;font-size:12px;min-width:min(640px,86vw)}',
      '.autw-fl{display:flex;flex-direction:column;gap:6px;max-height:46vh;overflow:auto}',
      '.autw-fr{display:grid;grid-template-columns:minmax(140px,1.3fr) 130px minmax(120px,1.5fr) auto;gap:6px;align-items:center}',
      '.autw-fr select,.autw-fr input,.autw-dlg textarea{font:12px ui-monospace,Consolas,monospace;padding:3px 5px;box-sizing:border-box;width:100%}',
      '.autw-dlg .autw-hint{opacity:.7}',
      '.autw-props{display:grid;grid-template-columns:max-content 1fr;gap:3px 14px;font:12px ui-monospace,Consolas,monospace}',
      '.autw-props dt{opacity:.7;font-family:inherit}.autw-props dd{margin:0;word-break:break-all}',
      '.autw-topv{width:100%;border-collapse:collapse;font:12px ui-monospace,Consolas,monospace}',
      '.autw-topv td{padding:2px 6px;border-bottom:1px solid var(--border-subtle,rgba(127,127,127,.18));vertical-align:middle}',
      '.autw-topv td.n{text-align:right;white-space:nowrap}',
      '.autw-barc{width:120px}.autw-barc div{height:8px;background:var(--accent,#4c8bf5);border-radius:2px;min-width:1px}',
      '.autw-sum th{text-align:left;padding:2px 6px;position:sticky;top:0;background:var(--panel,#1e1f22)}',
      '.autw-sum td button{background:none;border:0;padding:0;color:var(--accent,#4c8bf5);cursor:pointer;font:inherit;text-align:left}'
    ].join('\n');
    document.head.appendChild(s);
  }
  function el(tag, attrs, kids) {
    const n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(k => {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'on') Object.keys(attrs.on).forEach(e => n.addEventListener(e, attrs.on[e]));
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(c => n.appendChild(c));
    return n;
  }
  const fmt = n => Number(n).toLocaleString('en-US');
  const NUMERIC = /INT|DECIMAL|DOUBLE|FLOAT|REAL|NUMERIC|HUGEINT/i;
  const qid = name => '"' + String(name).replace(/"/g, '""') + '"';
  const qstr = v => "'" + String(v).replace(/'/g, "''") + "'";
  // One column filter (the AppUIBigTable grammar) -> a DuckDB SQL condition.
  //   abc  contains (case-insensitive)   =v !=v >v >=v <v <=v   null   !null
  function columnFilterSql(column, type, text) {
    if(text?.type==='range'){
      const numeric=window._AppUIDataTableModel?.numeric||((v)=>v==null||v===''?null:Number(v));
      const min=numeric(text.min),max=numeric(text.max);
      if(text.min!=null&&text.min!==''&&!Number.isFinite(min)||text.max!=null&&text.max!==''&&!Number.isFinite(max)||min!==null&&max!==null&&min>max)return 'FALSE';
      const c=NUMERIC.test(type||'')?qid(column):'TRY_CAST('+qid(column)+' AS DOUBLE)',parts=[];
      if(min!==null)parts.push(c+' >= '+min);if(max!==null)parts.push(c+' <= '+max);
      return parts.length?'('+parts.join(' AND ')+')':'';
    }
    if(text?.type==='contains')return 'contains(lower(CAST('+qid(column)+' AS VARCHAR)),lower('+qstr(text.value)+'))';
    const t = String(text || '').trim();
    if (!t) return '';
    const c = qid(column), low = t.toLowerCase();
    if (low === 'null' || low === '=null') return c + ' IS NULL';
    if (low === '!null' || low === '!=null' || low === 'not null') return c + ' IS NOT NULL';
    const m = /^(<=|>=|!=|<>|=|<|>)\s*(.*)$/.exec(t);
    if (!m) return 'CAST(' + c + ' AS VARCHAR) ILIKE ' + qstr('%' + t + '%');
    const op = m[1] === '<>' ? '!=' : m[1];
    let v = m[2];
    if (/^".*"$|^'.*'$/.test(v)) v = v.slice(1, -1);                       // optional quotes
    const lit = NUMERIC.test(type || '') && /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(v) ? v : qstr(v);
    if (op === '!=') return '(' + c + ' IS NULL OR ' + c + ' != ' + lit + ')';   // "not v" keeps NULLs
    return c + ' ' + op + ' ' + lit;
  }

  function create(opts = {}) {
    const container = typeof opts.container === 'string' ? document.querySelector(opts.container) : opts.container;
    if (!container && !opts.mount) throw new Error('AppUITableWorkbench: container (or mount) required');
    style();
    const key = 'autw.path.' + opts.api;
    const lastTableKey = () => 'autw.table.' + opts.api + '.' + (source ? (source.src || source.path || '') : '');
    let source = null, tables = [], current = null, view = null, sort = null, seq = 0;
    let colFilters = {}, colTypes = {}, lastViewKey = '';          // per-column filters (grid filter row / right-click)
    let searchText='',searchColumns=[],findTimer;
    let extra = {};                                                // source options (e.g. workbook read options)
    function whereSql() {
      const parts = [];
      const free = whereIn.value.trim();
      if (free) parts.push('(' + free + ')');
      if(searchText&&searchColumns.length)parts.push('('+searchColumns.map(name=>'contains(lower(CAST('+qid(name)+' AS VARCHAR)),lower('+qstr(searchText)+'))').join(' OR ')+')');
      Object.keys(colFilters).forEach(name => { const s = columnFilterSql(name, colTypes[name], colFilters[name]); if (s) parts.push(s); });
      return parts.join(' AND ') || undefined;
    }

    function api(op, args) {
      return fetch(opts.api + op, {method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(Object.assign({}, source, extra, args || {}))})
        .then(r => r.json()).then(r => { if (!r || r.ok === false) throw new Error((r && (r._error || r.error)) || 'request failed'); return r; });
    }
    // RELEASE ON CLOSE: the engine keeps an opened source's DuckDB connection for fast re-use, which holds the
    // FILE locked (it could not be moved / deleted). When this page goes away (tab closed, navigated, the
    // Workspace preview replaced) tell the engine owner (opts.closeApi, default opts.cacheApi = the
    // duckdb_viewer engine) to close it now; an idle TTL on the server releases it otherwise.
    const closeBase = opts.closeApi !== undefined ? opts.closeApi : opts.cacheApi;
    let _released = '';
    function releaseSource() {
      const p = source && (source.path || source.src);
      if (!closeBase || !p || _released === p) return;
      _released = p;
      const body = JSON.stringify({path: p});
      try {
        if (navigator.sendBeacon && navigator.sendBeacon(closeBase + 'close', new Blob([body], {type: 'application/json'}))) return;
      } catch (_e) { /* fall back to a keepalive fetch */ }
      try { fetch(closeBase + 'close', {method: 'POST', headers: {'Content-Type': 'application/json'}, body, keepalive: true}); } catch (_e) {}
    }
    window.addEventListener('pagehide', releaseSource);
    const pathIn = el('input', {type: 'text', class: 'autw-grow', placeholder: opts.hint || 'path of a file to open', spellcheck: 'false'});
    const whereIn = el('input', {type: 'text', class: 'autw-grow', placeholder: "filter, e.g.  cell = 7 AND rsrp > -90   (SQL expression)", spellcheck: 'false'});
    const sqlIn = el('textarea', {rows: '3', class: 'autw-grow', spellcheck: 'false',
      placeholder: 'SQL (DuckDB): SELECT … FROM <table> …      Ctrl+Enter runs'});
    const gotoIn = el('input', {type: 'text', placeholder: 'go to row', style: 'width:90px'});
    const status = el('div', {class: 'autw-status'});
    // view:'viewer' — the FOCUSED view a previewer shows (inline in the Workspace,
    // in a tab): the same grid / filters / view state, but a slim bar (table pick,
    // filter, open-full link) instead of the path, SQL and export bars. The full
    // page (createApp) is this plus those tools.
    const viewer = opts.view === 'viewer';
    let wantTable = '';                     // showTable() before the table list arrived
    const tablePick = el('select', {title: 'Table'});
    const side = el('div', {class: 'autw-side'});
    // the table list + a filter box (shown once there are enough tables to need it)
    const findIn = el('input', {type: 'search', class: 'autw-find', placeholder: 'filter tables', 'aria-label': 'Filter tables', hidden: ''});
    const list = el('div', {class: 'autw-list', role: 'listbox', 'aria-label': 'Tables'});
    side.append(findIn, list);
    findIn.addEventListener('input', () => renderTables());
    const gridEl = el('div', {class: 'autw-grid'});
    const fill = el('div', {class: 'autw-fill'}), loadText = el('div', {});
    const loadBox = el('div', {class: 'autw-load', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100'},
      [el('div', {class: 'autw-track'}, [fill]), loadText]);
    let busyTimer = 0, pollTimer = 0, wasLoading = false;
    function say(text, bad) { clearInterval(busyTimer); busyTimer = 0; status.textContent = text; status.classList.toggle('autw-err', !!bad); if (!wasLoading) bar(null); }
    // A wait with no measurable progress (opening, sorting, a query): moving bar + elapsed time.
    function busy(label) {
      const t0 = Date.now();
      say(label + '…'); bar({busy: true, text: label + '…'});
      busyTimer = setInterval(() => {
        const sec = Math.round((Date.now() - t0) / 1000);
        status.textContent = label + '… ' + sec + ' s'; loadText.textContent = status.textContent;
      }, 1000);
    }
    function bar(state) {
      loadBox.classList.toggle('on', !!state);
      if (!state) return;
      fill.classList.toggle('busy', !!state.busy);
      if (!state.busy) { fill.style.width = Math.max(1, Math.min(100, state.percent)) + '%'; loadBox.setAttribute('aria-valuenow', String(Math.round(state.percent))); }
      loadText.textContent = state.text;
    }
    // The source is still being read (a big workbook): show how far it is, keep the
    // loaded rows browsable, and extend the grid as more arrive.
    function loadingState(l) {
      clearTimeout(pollTimer);
      if (!l) {
        if (wasLoading) { wasLoading = false; bar(null); finished(); }
        return;
      }
      wasLoading = true;
      bar({percent: l.percent, text: 'loading' + (l.sheets > 1 ? ' sheet ' + l.sheet_index + ' of ' + l.sheets : '') +
        (l.sheet ? ' “' + l.sheet + '”' : '') + ' — ' + l.percent.toFixed(0) + '% · ' + fmt(l.rows) +
        ' rows so far. You can already browse, filter and query what is loaded.'});
      pollTimer = setTimeout(poll, 1500);
    }
    function poll() {
      const src = source;
      api('tables', {}).then(r => {
        if (src !== source) return;
        tables = r.tables || []; renderTables();
        if (!current && tables.length) {
          // reopen the table last shown for this source (a reload used to land on
          // tables[0], so the page — and its assistant's context — showed a table
          // the user wasn't looking at)
          let last = '';
          try { last = localStorage.getItem(lastTableKey()) || ''; } catch (_e) { last = ''; }
          pick(tables.find(t => t.name === last && !t.error) || tables[0]); show();
        }
        else if (current && current.table && !whereIn.value.trim() && !sort) {
          const t = tables.find(x => x.name === current.table);
          if (t && t.rows != null) grid.setTotal(t.rows);
        }
        loadingState(r.loading);
      }).catch(e => { if (src === source) { wasLoading = false; bar(null); say(String(e.message || e), true); } });
    }
    // Reading finished: the typed, final tables replace the provisional ones.
    function finished() {
      const at = grid.getRange().first, src = source;
      api('tables', {}).then(r => {
        if (src !== source) return;
        tables = r.tables || [];
        const keep = current && current.table && tables.find(x => x.name === current.table);
        if (current && current.table) { if (keep) { if (!whereIn.value.trim()) pick(keep); } else if (tables.length) pick(tables[0]); }
        renderTables();
        if (current) show(() => { if (at) grid.scrollToRow(at); });
      }).catch(e => say(String(e.message || e), true));
    }

    const grid = AppUIBigTable.create({
      container: gridEl,
      fetch: (offset, limit) => { const v = view; return api('rows', {view: v, offset, limit}).then(r => r.rows); },
      onSort: (column, direction) => { sort = direction ? {column, direction} : null; show(); },
      onRange: (a, b, total) => { rangeText = total ? 'rows ' + fmt(a + 1) + '–' + fmt(b + 1) + ' of ' + fmt(total) : 'no rows'; paintStatus(); },
      filterRow: false,
      onSearch:text=>{searchText=text;clearTimeout(findTimer);findTimer=setTimeout(show,250);},
      onFilters:map=>{colFilters=map;show();},
      columnStats:column=>api('column_stats',{view,column,top:20}),
      onFilterDialog: opts.columnFilters === false ? undefined : column => filterDialog(column),
      onFilter: opts.columnFilters === false ? undefined : (column, text) => {
        if (text) colFilters[column] = text; else delete colFilters[column];
        show();
      },
      menuItems: ctx => {
        const extra = [];
        if (opts.stats !== false) extra.push({label: 'Properties of ' + ctx.column + '…', action: () => propsDialog(ctx.column)},
                                             {label: 'Summary of all columns…', action: () => summaryDialog()});
        if (opts.columnFilters !== false) extra.push({label: 'Filters…', action: () => filterDialog(ctx.column)});
        return extra.concat(opts.menuItems ? (opts.menuItems(ctx) || []) : []);
      },
      onError: e => say(String(e.message || e), true),
    });
    let rangeText = '', infoText = '';
    // while a wait is being shown (busy), the grid's range updates must not replace it
    function paintStatus() { if (busyTimer) return; say([rangeText, infoText].filter(Boolean).join('   ·   ')); }

    function renderTables() {
      if (viewer) {
        tablePick.replaceChildren(...tables.filter(t => !t.error).map(t => el('option', {value: t.name,
          text: t.name + (t.rows == null ? '' : ' · ' + fmt(t.rows) + ' rows')})));
        tablePick.hidden = tables.length < 2;
        if (current && current.table) tablePick.value = current.table;
      }
      list.replaceChildren();
      findIn.hidden = tables.length < 12;
      const q = findIn.hidden ? '' : findIn.value.trim().toLowerCase();
      const shown = q ? tables.filter(t => String(t.name).toLowerCase().indexOf(q) >= 0) : tables;
      shown.forEach(t => {
        if (t.error) {                         // e.g. a view over a parquet file that is gone
          list.appendChild(el('div', {class: 'autw-t autw-bad', title: t.error,
            on: {click: () => say(t.error, true)}},
            [document.createTextNode(t.name), el('small', {text: 'unavailable — ' + (t.missing_file ? 'its Parquet file is missing' : 'cannot be read')})]));
          return;
        }
        const item = el('div', {class: 'autw-t' + (current && current.table === t.name ? ' on' : ''), title: t.source || t.name,
          on: {click: () => { pick(t); renderTables(); show(); }}},
          [document.createTextNode(t.name), el('small', {text: (t.rows == null ? '' : fmt(t.rows) + ' rows · ') + t.columns.length + ' cols'})]);
        const note = sheetNote(t);
        if (note) item.appendChild(el('small', {text: note}));
        list.appendChild(item);
      });
      if (!shown.length) list.appendChild(el('div', {class: 'autw-t', text: tables.length ? 'no table matches' : 'no tables'}));
      if (opts.onTables) { try { opts.onTables(tables, current); } catch (e) { /* host hook */ } }
    }
    // A spreadsheet sheet carries structure of its own: frozen columns stay
    // pinned, and rows its filter hides are excluded by default (the filter box
    // shows the condition, so it can simply be cleared to see them).
    function pick(t) {
      current = {table: t.name}; sort = null; colFilters = {};
      try { localStorage.setItem(lastTableKey(), t.name); } catch (_e) { /* storage full / blocked */ }
      colTypes = {}; (t.columns || []).forEach(c => { colTypes[c.name] = c.type; });
      whereIn.value = (t.sheet && t.sheet.default_where) || '';
    }
    function sheetNote(t) {
      const m = t.sheet; if (!m) return '';
      const parts = [];
      if (m.hidden_sheet) parts.push('hidden sheet');
      if (m.merged_filled) parts.push('merged cells filled');
      else if (m.merged_ranges) parts.push(fmt(m.merged_ranges) + ' merged area' + (m.merged_ranges === 1 ? '' : 's'));
      if (m.hidden_rows) parts.push(fmt(m.hidden_rows) + ' hidden by the sheet filter');
      if (m.frozen_cols) parts.push(m.frozen_cols + ' frozen col' + (m.frozen_cols === 1 ? '' : 's'));
      if (m.header_row > 1) parts.push('header on row ' + m.header_row);
      if (m.preamble && m.preamble.length && m.preamble[0].length) parts.push('“' + String(m.preamble[0][0]).slice(0, 60) + '”');
      return parts.join(' · ');
    }
    // ── column layout per table: shown / order / renamed + calculated columns ──
    // (kept in localStorage per api + table; named presets can be saved and loaded)
    const layoutKey = name => 'autw.layout.' + opts.api + '.' + name;
    function getLayout(name) {
      try { return JSON.parse(localStorage.getItem(layoutKey(name)) || 'null'); } catch (e) { return null; }
    }
    function setLayout(name, lay) {
      try { if (lay) localStorage.setItem(layoutKey(name), JSON.stringify(lay)); else localStorage.removeItem(layoutKey(name)); }
      catch (e) { /* storage is optional */ }
    }
    const qid = s => '"' + String(s).replace(/"/g, '""') + '"';
    // the SELECT a layout means (null = the plain table)
    function layoutSql(tname, lay) {
      if (!lay) return null;
      const items = (lay.cols || []).filter(c => c.show !== false).map(c => {
        const expr = c.expr ? '(' + c.expr + ')' : qid(c.name);
        const as = c.as && c.as !== c.name ? c.as : (c.expr ? c.name : null);
        return expr + (as ? ' AS ' + qid(as) : '');
      });
      if (!items.length) return null;
      return 'SELECT ' + items.join(', ') + ' FROM ' + qid(tname);
    }
    function show(after) {
      if (!current) return;
      const mine = ++seq, started = Date.now(), viewKey = current.table ? 't:' + current.table : 'q:' + current.sql;
      const lsql = current.table ? layoutSql(current.table, getLayout(current.table)) : null;
      const base = lsql ? {sql: lsql} : current;
      const args = Object.assign({}, base, {where: whereSql(),
        order_by: sort ? [[sort.column, sort.direction === 'desc']] : undefined});
      busy(current.sql ? 'running the query' : (args.where || args.order_by) ? 'preparing the rows' : 'opening');
      api('open', args).then(r => {
        if (mine !== seq) return;
        say('');
        view = r.view;
        infoText = (r.materialized ? 'result prepared in ' : 'opened in ') + (Date.now() - started) + ' ms';
        if (r.sorting) infoText += ' · the first rows are ready, the rest is being sorted in the background';
        if (lsql) infoText += ' · column layout applied (Table ▸ Columns…)';
        const nf = Object.keys(colFilters).length;
        if (nf) infoText += '   ·   ' + nf + ' column filter' + (nf === 1 ? '' : 's') + ': ' +
          Object.keys(colFilters).map(n => n + ' ' + AppUITableFilter.format(colFilters[n])).join(', ');
        (r.columns || []).forEach(c => { if (c && c.name) colTypes[c.name] = c.type; });
        const tmeta = current.table && tables.find(x => x.name === current.table);
        const hints = (tmeta && tmeta.sheet && tmeta.sheet.formats) || {};     // spreadsheet number formats
        const descs = {};                                                       // a model's column descriptions
        ((tmeta && tmeta.columns) || []).forEach(c => { if (c.description) descs[c.name] = c.description; });
        searchColumns=(r.columns||[]).map(c=>c.name);
        const cols = (r.columns || []).map(c => (hints[c.name] || descs[c.name])
          ? Object.assign({}, c, hints[c.name] ? {hint: hints[c.name]} : {}, descs[c.name] ? {description: descs[c.name]} : {}) : c);
        grid.setView({columns: cols, total: r.rows, sort, pinned: r.pinned_columns || 0, filters: colFilters, stateKey:opts.api+':'+(source?.path||source?.src||'')+':'+viewKey,keepWidths: viewKey === lastViewKey});
        // embedded (e.g. in the Workspace preview): tell the host what is shown,
        // so its chat can analyse exactly this view (view id = this filter/sort/SQL)
        try {
          window.AppUIEmbed?.post({src: source && (source.src || source.path), table: current.table || null,
            sql: current.sql || (lsql || null), where: args.where || null,
            order_by: args.order_by || null, view: r.view, rows: r.rows,
            columns: (r.columns || []).map(c => c.name).slice(0, 200),
            accepts: ['sql', 'where']});      // the host may fill these (AppUIEmbed.onCommand below)
        } catch (_e) {}
        lastViewKey = viewKey;
        if (!r.rows) { rangeText = 'no rows'; paintStatus(); }
        if (typeof after === 'function') after();
      }).catch(e => { if (mine === seq) say(String(e.message || e), true); });
    }
    function openSource(value) {
      value = String(value || '').trim();
      if (!value) return;
      const prev = source && (source.path || source.src);
      if (prev && prev !== value) releaseSource();          // the file this page had open is no longer needed
      source = /^vfs:\/\//.test(value) ? {src: value} : {path: value};
      _released = '';
      pathIn.value = value; current = null; view = null; sort = null; tables = []; renderTables();
      grid.setView({columns: [], total: 0});
      clearTimeout(pollTimer); wasLoading = false;
      busy('opening');
      try { localStorage.setItem(key, value); } catch (e) { /* storage is optional */ }
      api('tables', {}).then(r => {
        tables = r.tables || [];
        wasLoading = !!r.loading;
        let lastT = '';
        try { lastT = localStorage.getItem(lastTableKey()) || ''; } catch (_e) { lastT = ''; }
        const first = (wantTable && tables.find(t => !t.error && t.name === wantTable))
          || (lastT && tables.find(t => !t.error && t.name === lastT)) || tables.find(t => !t.error);
        wantTable = '';
        say(r.warning || (tables.length + ' table' + (tables.length === 1 ? '' : 's')), !!r.warning);
        if (pendingSql) {                    // a ?sql= deep link: run it instead of showing the first table
          sqlIn.value = pendingSql; pendingSql = ''; sqlBar.hidden = false; renderTables(); runSql();
        } else if (first) { pick(first); if (!r.warning) show(); else show(() => { infoText = '⚠ ' + r.warning + '   ·   ' + infoText; paintStatus(); }); }
        renderTables();
        if (r.loading) loadingState(r.loading);
      }).catch(e => say(String(e.message || e), true));
    }
    // ── the Filters dialog: every column condition + the free SQL condition ──
    const OPS = [['contains', 'contains', ''], ['=', '=', '='], ['!=', '≠', '!='], ['>', '>', '>'], ['>=', '≥', '>='],
                 ['<', '<', '<'], ['<=', '≤', '<='], ['null', 'is null', null], ['!null', 'is not null', null]];
    function parseFilter(text) {             // grammar text -> [op, value]
      const t = String(text || '').trim(), low = t.toLowerCase();
      if (low === 'null' || low === '=null') return ['null', ''];
      if (low === '!null' || low === '!=null' || low === 'not null') return ['!null', ''];
      const m = /^(<=|>=|!=|<>|=|<|>)\s*(.*)$/.exec(t);
      return m ? [m[1] === '<>' ? '!=' : m[1], m[2]] : ['contains', t];
    }
    function filterText(op, value) {
      const o = OPS.find(x => x[0] === op);
      if (!o) return '';
      if (o[2] === null) return op;                       // null / !null take no value
      return String(value || '').trim() === '' ? '' : o[2] + String(value).trim();
    }
    function columnNames() {
      const t = current && current.table && tables.find(x => x.name === current.table);
      const names = Object.keys(colTypes);
      return names.length ? names : (t ? t.columns.map(c => c.name) : []);
    }
    function filterDialog(focusColumn) {
      if (!window.AppUIDialog) return;
      if (!current) { say('open a table first', true); return; }
      const cols = columnNames();
      const list = el('div', {class: 'autw-fl'});
      function addRow(column, text) {
        if(text&&typeof text==='object'){
          const edit=el('button',{text:'Edit '+column+' filter'}),del=el('button',{text:'Remove condition'}),row=el('div',{class:'autw-fr'},[el('span',{text:column}),el('span',{text:text.type==='range'?(text.min??'unbounded')+' to '+(text.max??'unbounded'):'contains '+text.value}),edit,del]);
          row._get=()=>[column,text];del.addEventListener('click',()=>row.remove());edit.addEventListener('click',()=>{AppUIDialog.close(dlg);grid.showFilter(column);});list.append(row);return edit;
        }
        const [op, value] = parseFilter(text);
        const colSel = el('select', {'aria-label': 'Column'});
        cols.forEach(n => { const o = el('option', {value: n, text: n + (colTypes[n] ? '  (' + String(colTypes[n]).toLowerCase() + ')' : '')}); colSel.appendChild(o); });
        colSel.value = column || cols[0] || '';
        const opSel = el('select', {'aria-label': 'Condition'});
        OPS.forEach(o => opSel.appendChild(el('option', {value: o[0], text: o[1]})));
        opSel.value = op;
        const val = el('input', {type: 'text', 'aria-label': 'Value', spellcheck: 'false', placeholder: 'value'});
        val.value = value;
        const sync = () => { val.disabled = opSel.value === 'null' || opSel.value === '!null'; };
        opSel.addEventListener('change', sync); sync();
        const del = el('button', {text: '✕', title: 'Remove this condition', 'aria-label': 'Remove condition'});
        const row = el('div', {class: 'autw-fr'}, [colSel, opSel, val, del]);
        row._get = () => [colSel.value, filterText(opSel.value, val.value)];
        del.addEventListener('click', () => row.remove());
        list.appendChild(row);
        return val;
      }
      Object.keys(colFilters).forEach(n => addRow(n, colFilters[n]));
      let focusEl = null;
      if (focusColumn && !colFilters[focusColumn]) focusEl = addRow(focusColumn, '');
      if (!list.children.length) focusEl = addRow(cols[0], '');
      const add = el('button', {text: '+ Add condition', on: {click: () => addRow(cols[0], '').focus()}});
      const sqlBox = el('textarea', {rows: '2', spellcheck: 'false', 'aria-label': 'SQL condition',
        placeholder: 'optional SQL condition, e.g.  rsrp > -90 AND cell IN (1, 2)'});
      sqlBox.value = whereIn.value;
      const body = el('div', {class: 'autw-dlg'}, [
        el('div', {class: 'autw-hint', text: 'All conditions must hold (AND). Columns of ' + (current.table || 'the query result') + '.'}),
        list, el('div', {}, [add]),
        el('label', {text: 'SQL condition'}), sqlBox]);
      const dlg = AppUIDialog.show({title: 'Filters', body, width: 'min(720px,92vw)', closable: true, buttons: [
        {text: 'Clear all', action: ov => { colFilters = {}; whereIn.value = ''; AppUIDialog.close(ov); show(); }},
        {text: 'Cancel', action: ov => AppUIDialog.close(ov)},
        {text: 'Apply', primary: true, action: ov => {
          const next = {};
          Array.prototype.forEach.call(list.children, r => { const [c, t] = r._get(); if (c && t) next[c] = t; });
          colFilters = next; whereIn.value = sqlBox.value.trim();
          AppUIDialog.close(ov); show();
        }}]});
      setTimeout(() => { try { (focusEl || sqlBox).focus(); } catch (e) { /* optional */ } }, 0);
      return dlg;
    }

    // ── the Properties dialog: statistics of one column over the current view ──
    function propsDialog(column) {
      if (!window.AppUIDialog || !view) return;
      const body = el('div', {class: 'autw-dlg'}, [el('div', {class: 'autw-hint', text: 'computing statistics…'})]);
      const ov = AppUIDialog.show({title: 'Column ' + column, body, width: 'min(620px,92vw)', closable: true,
        buttons: [{text: 'Close', primary: true, action: o => AppUIDialog.close(o)}]});
      const nf = Object.keys(colFilters).length + (whereIn.value.trim() ? 1 : 0);
      api('column_stats', {view, column, top: 15}).then(s => {
        const rows = [['type', s.type], ['rows', fmt(s.rows)], ['non-null', fmt(s.non_null)],
          ['nulls', fmt(s.nulls) + (s.rows ? '  (' + (100 * s.nulls / s.rows).toFixed(1) + '%)' : '')],
          ['distinct', (s.distinct_estimated ? '≈ ' : '') + fmt(s.distinct)]];
        if ('min' in s) rows.push(['min', s.min], ['max', s.max]);
        if ('avg' in s) rows.push(['avg', s.avg], ['sum', s.sum], ['stddev', s.stddev]);
        if ('median' in s) rows.push(['p25 · median · p75', [s.p25, s.median, s.p75].map(x => x == null ? '–' : x).join(' · ')]);
        if ('min_length' in s) rows.push(['length min · avg · max', [s.min_length, s.avg_length, s.max_length].map(x => x == null ? '–' : x).join(' · ')],
                                           ['empty strings', fmt(s.empty)]);
        const dl = el('dl', {class: 'autw-props'});
        rows.forEach(([k, v]) => { dl.appendChild(el('dt', {text: k})); dl.appendChild(el('dd', {text: v == null ? 'NULL' : String(v)})); });
        const top = el('table', {class: 'autw-topv'});
        const most = (s.top[0] && s.top[0].count) || 1;
        s.top.forEach(t => {
          const bar = el('div'); bar.style.width = Math.max(1, Math.round(100 * t.count / most)) + '%';
          const f = el('button', {text: 'Filter', title: 'Show only rows where ' + column + ' is this value'});
          f.addEventListener('click', () => {
            colFilters[column] = t.value === null ? 'null' : '=' + String(t.value);
            AppUIDialog.close(ov); show();
          });
          top.appendChild(el('tr', {}, [el('td', {text: t.value === null ? 'NULL' : String(t.value)}),
            el('td', {class: 'n', text: fmt(t.count)}),
            el('td', {class: 'n', text: s.rows ? (100 * t.count / s.rows).toFixed(1) + '%' : ''}),
            el('td', {class: 'autw-barc'}, [bar]), el('td', {}, [f])]));
        });
        body.replaceChildren(
          el('div', {class: 'autw-hint', text: 'over the rows of the current view' + (nf ? ' (' + nf + ' filter' + (nf === 1 ? '' : 's') + ' applied)' : '') +
                                                 ' · computed in ' + s.elapsed_ms + ' ms'}),
          dl, el('div', {text: 'Most frequent values' + (s.distinct > s.top.length ? ' (top ' + s.top.length + ' of ' + fmt(s.distinct) + ')' : ''),
                         style: 'font-weight:600;margin-top:4px'}), top);
      }).catch(e => body.replaceChildren(el('div', {class: 'autw-err', text: String(e.message || e)})));
      return ov;
    }

    function columnsDialog() {
      if (!window.AppUIDialog) return;
      if (!current || !current.table) { say('open a table first (column layouts are per table)', true); return; }
      const tname = current.table, t = tables.find(x => x.name === tname);
      const base = (t ? t.columns : []).map(c => ({name: c.name, as: c.name, show: true}));
      const lay = getLayout(tname);
      let rows = lay && lay.cols ? lay.cols.map(c => Object.assign({}, c)) : base;
      base.forEach(b => { if (!rows.some(r => !r.expr && r.name === b.name)) rows.push(Object.assign({}, b, {show: false})); });
      const list = el('div', {class: 'autw-fl', style: 'max-height:50vh;overflow:auto'});
      function paintRows() {
        list.replaceChildren();
        rows.forEach((c, i) => {
          const cb = el('input', {type: 'checkbox', title: 'show'}); cb.checked = c.show !== false;
          cb.addEventListener('change', () => { c.show = cb.checked; });
          const as = el('input', {type: 'text', spellcheck: 'false', 'aria-label': 'Column name'}); as.value = c.as || c.name;
          as.addEventListener('input', () => { c.as = as.value.trim() || c.name; if (c.expr) c.name = c.as; });
          const src = el('span', {text: c.expr ? '= ' + c.expr : c.name, style: 'opacity:.6;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:260px'});
          const up = el('button', {text: '▲', title: 'Move up'}), dn = el('button', {text: '▼', title: 'Move down'});
          up.addEventListener('click', () => { if (i > 0) { rows.splice(i - 1, 0, rows.splice(i, 1)[0]); paintRows(); } });
          dn.addEventListener('click', () => { if (i < rows.length - 1) { rows.splice(i + 1, 0, rows.splice(i, 1)[0]); paintRows(); } });
          const parts = [cb, as, src, up, dn];
          if (c.expr) {
            const del = el('button', {text: '✕', title: 'Remove this calculated column'});
            del.addEventListener('click', () => { rows.splice(i, 1); paintRows(); });
            parts.push(del);
          }
          list.appendChild(el('div', {class: 'autw-fr'}, parts));
        });
      }
      paintRows();
      const calcName = el('input', {type: 'text', placeholder: 'new column name', spellcheck: 'false'});
      const calcExpr = el('input', {type: 'text', placeholder: 'SQL expression, e.g.  dl_bytes * 8 / 1e6', spellcheck: 'false', class: 'autw-grow'});
      const addBtn = el('button', {text: '+ Add calculated column', on: {click: () => {
        const n = calcName.value.trim(), x = calcExpr.value.trim();
        if (!n || !x) return;
        rows.push({name: n, as: n, expr: x, show: true}); calcName.value = ''; calcExpr.value = ''; paintRows();
      }}});
      const presetsKey = 'autw.layouts.' + opts.api;
      let presets = {};
      try { presets = JSON.parse(localStorage.getItem(presetsKey) || '{}'); } catch (e) { presets = {}; }
      const presetSel = el('select', {'aria-label': 'Saved layouts'});
      // layouts can also live NEXT TO the data (<file>.layouts.json, host ops layouts /
      // save_layouts) so they travel with it; this browser's ones stay in localStorage
      let withData = {};
      function paintPresets() {
        presetSel.replaceChildren(el('option', {value: '', text: 'saved layouts…'}));
        Object.keys(presets).sort().forEach(n => presetSel.appendChild(el('option', {value: 'b:' + n, text: n})));
        Object.keys(withData).sort().forEach(n => presetSel.appendChild(el('option', {value: 'd:' + n, text: n + '  (with the data)'})));
      }
      paintPresets();
      const dataOk = opts.layouts !== false && source && source.path;
      if (dataOk) api('layouts').then(r => { withData = r.presets || {}; paintPresets(); }).catch(() => {});
      presetSel.addEventListener('change', () => {
        const v = presetSel.value, pz = v.startsWith('d:') ? withData[v.slice(2)] : presets[v.slice(2)];
        if (!pz) return;
        const have = new Set(base.map(b => b.name));      // a preset from another table: keep what applies
        rows = pz.filter(c => c.expr || have.has(c.name)).map(c => Object.assign({}, c));
        base.forEach(b => { if (!rows.some(r => !r.expr && r.name === b.name)) rows.push(Object.assign({}, b, {show: false})); });
        paintRows();
      });
      const savePreset = el('button', {text: 'Save as…', on: {click: () => {
        const n = window.prompt('Name of this column layout:'); if (!n) return;
        presets[n] = rows.map(c => Object.assign({}, c));
        try { localStorage.setItem(presetsKey, JSON.stringify(presets)); } catch (e) { /* optional */ }
        paintPresets();
      }}});
      const saveData = el('button', {text: 'Save with the data…', title: 'Keep this layout in a .layouts.json next to the file, so it travels with the data',
        on: {click: () => {
          const n = window.prompt('Name of this column layout (saved next to the data):'); if (!n) return;
          api('layouts').then(r => {
            const all = Object.assign({}, r.presets || {}); all[n] = rows.map(c => Object.assign({}, c));
            return api('save_layouts', {presets: all, confirm: true}).then(w => { withData = all; paintPresets(); say('saved to ' + w.file); });
          }).catch(e => say(String(e.message || e), true));
        }}});
      const body = el('div', {class: 'autw-dlg'}, [
        el('div', {class: 'autw-hint', text: 'Tick the columns to show, drag order with ▲▼, rename, or add a calculated column (a DuckDB SQL expression over this table). Kept for “' + tname + '”.'}),
        list, el('div', {class: 'autw-bar'}, [calcName, calcExpr, addBtn]),
        el('div', {class: 'autw-bar'}, dataOk ? [presetSel, savePreset, saveData] : [presetSel, savePreset])]);
      AppUIDialog.show({title: 'Columns of ' + tname, body, width: 'min(820px,94vw)', closable: true, buttons: [
        {text: 'Reset', action: ov => { setLayout(tname, null); AppUIDialog.close(ov); colFilters = {}; sort = null; show(); }},
        {text: 'Cancel', action: ov => AppUIDialog.close(ov)},
        {text: 'Apply', primary: true, action: ov => {
          const same = rows.length === base.length && rows.every((c, i) => !c.expr && c.show !== false &&
            c.name === base[i].name && (c.as || c.name) === c.name);
          setLayout(tname, same ? null : {cols: rows});
          AppUIDialog.close(ov); colFilters = {}; sort = null; show();
        }}]});
    }

    // ── auto-refresh: follow a source that is being rewritten (a converter, a logger) ──
    // A converter that rewrites the source publishes on the EventBus 'files' channel
    // (framework.events: tabular_out.write_duckdb, op_isolate after an isolated
    // convert): then the check runs AT ONCE, and polling slows to a 30 s safety net.
    // Without the bus (or an event for this source) the 5 s poll keeps working.
    let refreshTimer = 0, lastSig = null, bus = null, refreshOn = false;
    const norm = p => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    function touches(d) {
      const src = source && norm(source.path || source.src);
      if (!src || !d) return false;
      return [d.path, d.dir, d.out_dir].some(x => {
        const p = norm(x);
        return p && (p === src || src.startsWith(p + '/') || p.startsWith(src + '/'));
      });
    }
    function checkRefresh() {
      if (!source || document.hidden) return Promise.resolve();
      return api('tables', {counts: false}).then(r => {
        if (lastSig !== null && r.sig && r.sig !== lastSig) {
          const at = grid.getRange().first;
          tables = r.tables || []; renderTables();
          show(() => { if (at) grid.scrollToRow(at); infoText = 'refreshed ' + new Date().toLocaleTimeString() + ' · ' + infoText; paintStatus(); });
        }
        lastSig = r.sig || lastSig;
      }).catch(() => {});
    }
    function schedule() {
      clearTimeout(refreshTimer);
      if (!refreshOn) return;
      const live = bus && bus.state === 'connected';
      refreshTimer = setTimeout(() => checkRefresh().then(schedule), live ? 30000 : Math.max(2000, opts.refreshMs || 5000));
    }
    function onFiles(d) { if (refreshOn && touches(d)) checkRefresh(); }
    function setAutoRefresh(on) {
      clearTimeout(refreshTimer); refreshTimer = 0; lastSig = null; refreshOn = !!on;
      if (!on) { if (bus) { bus.close(); bus = null; } return false; }
      checkRefresh().then(schedule);                       // takes the current signature
      if (!bus && opts.eventBus !== false) {
        const start = () => {
          if (!refreshOn || bus || !window.AppUIEventBus) return;
          bus = new window.AppUIEventBus(['files'], {debounce: 400});
          ['changed', 'saved', 'written'].forEach(ev => bus.on('files', ev, d => (Array.isArray(d) ? d : [d]).forEach(onFiles)));
        };
        if (window.AppUIEventBus) start();
        else if (window.AppUIAssets) AppUIAssets.load('runtimeServices').then(start).catch(() => {});
      }
      return true;
    }

    // ── every column at a glance (one scan: host op column_summary) ──
    function summaryDialog() {
      if (!window.AppUIDialog || !view) return;
      const body = el('div', {class: 'autw-dlg'}, [el('div', {class: 'autw-hint', text: 'summarising every column…'})]);
      const ov = AppUIDialog.show({title: 'Columns of this view', body, width: 'min(980px,94vw)', closable: true,
        buttons: [{text: 'Close', primary: true, action: o => AppUIDialog.close(o)}]});
      // a big view answers from a ~10 % sample first, then the exact summary replaces it
      const render = s => {
        const tbl = el('table', {class: 'autw-topv autw-sum'});
        tbl.appendChild(el('tr', {}, ['column', 'type', 'non-null', 'nulls %', 'distinct ≈', 'min', 'max', 'avg']
          .map(h => el('th', {text: h}))));
        const cut = v => { const t = v == null ? '' : String(v); return t.length > 40 ? t.slice(0, 40) + '…' : t; };
        s.columns.forEach(c => {
          const name = el('button', {text: c.column, title: 'Properties of ' + c.column});
          name.addEventListener('click', () => { AppUIDialog.close(ov); propsDialog(c.column); });
          tbl.appendChild(el('tr', {}, [el('td', {}, [name]), el('td', {text: String(c.type || '').toLowerCase()}),
            el('td', {class: 'n', text: fmt(c.non_null)}),
            el('td', {class: 'n', text: s.rows ? (100 * c.nulls / s.rows).toFixed(1) : ''}),
            el('td', {class: 'n', text: fmt(c.distinct)}), el('td', {text: cut(c.min)}), el('td', {text: cut(c.max)}),
            el('td', {class: 'n', text: c.avg == null ? '' : String(c.avg)})]));
        });
        body.replaceChildren(el('div', {class: 'autw-hint', text: fmt(s.rows) + ' rows · ' + s.columns.length +
          ' columns · ' + (s.sampled ? 'from a ' + (s.sample_percent || 10) + ' % sample (counts scaled, min/max of the sample) — exact summary on the way…'
            : s.cached ? 'cached' : 'computed in ' + s.elapsed_ms + ' ms') + ' · click a column for its full properties'}),
          el('div', {style: 'max-height:62vh;overflow:auto'}, [tbl]));
      };
      const fail = e => body.replaceChildren(el('div', {class: 'autw-err', text: String(e.message || e)}));
      api('column_summary', {view, sample: true}).then(s => {
        render(s);
        if (s.sampled) api('column_summary', {view}).then(x => { if (body.isConnected) render(x); }).catch(fail);
      }).catch(fail);
      return ov;
    }

    function runSql() {
      const sql = sqlIn.value.trim();
      if (!sql || !source) return;
      current = {sql}; whereIn.value = ''; sort = null; colFilters = {}; renderTables(); show();
    }
    function exportView() {
      if (!view) return;
      const to = window.prompt('Save the rows shown (all of them, not just the visible window) to:\n' +
        'The extension picks the format: .parquet  .csv  .xlsx  .duckdb');
      if (!to) return;
      busy('exporting');
      const go = force => api('export', {view, save_to: to, confirm: true, force})
        .then(r => { say(''); infoText = 'exported ' + fmt(r.rows) + ' rows to ' + r.path; paintStatus(); })
        .catch(e => {
          if (!force && /exists/.test(String(e.message)) && window.confirm(to + ' exists. Overwrite?')) return go(true);
          say(String(e.message || e), true);
        });
      go(false);
    }
    pathIn.addEventListener('keydown', e => { if (e.key === 'Enter') openSource(pathIn.value); });
    whereIn.addEventListener('keydown', e => { if (e.key === 'Enter') show(); });
    sqlIn.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); runSql(); } });
    gotoIn.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      const n = parseInt(gotoIn.value.replace(/[^0-9]/g, ''), 10);
      if (n > 0) grid.scrollToRow(n - 1);
    });

    // Browse…: the AppUI file dialog (loaded on first use) over the host's file layer
    function browse(onPick, current) {
      const start = String(current || '').replace(/\\/g, '/').replace(/\/[^/]*$/, '') || '';
      const go = () => AppUIFileDialog.open({title: 'Open', startPath: start, allowFolders: true, onSelect: onPick});
      if (window.AppUIFileDialog) go();
      else if (window.AppUIAssets) AppUIAssets.load('fileDialog').then(go).catch(e => say(String(e.message || e), true));
    }
    const pathBar = el('div', {class: 'autw-bar'}, [pathIn, el('button', {text: 'Open', on: {click: () => openSource(pathIn.value)}}),
      el('button', {text: 'Browse…', title: 'Pick a file or folder', on: {click: () => browse(p => openSource(p), pathIn.value)}})]);
    const filtersBtn = el('button', {text: 'Filters…', title: 'Edit every column filter and the SQL condition', on: {click: () => filterDialog()}});
    const filterBar = el('div', {class: 'autw-bar'}, [whereIn, el('button', {text: 'Filter', on: {click: show}}),
      ...(opts.columnFilters === false ? [] : [filtersBtn]), gotoIn,
      el('button', {text: 'Export…', on: {click: exportView}})]);
    const sqlBar = el('div', {class: 'autw-bar'}, [sqlIn, el('button', {text: 'Run SQL', on: {click: runSql}})]);
    tablePick.addEventListener('change', () => {
      const t = tables.find(x => x.name === tablePick.value);
      if (t) { pick(t); renderTables(); show(); }
    });
    const m = opts.mount;
    // the host (e.g. the Workspace chat) fills the SQL / filter box; it runs only
    // when asked (run:true) — otherwise the user reviews and presses Run / Filter
    function applyCommand(cmd) {
      if (typeof cmd.table === 'string') {
        const t = tables.find(x => x.name === cmd.table);
        if (!t) { say('no table ' + cmd.table, true); return false; }
        pick(t); renderTables(); show(); return true;
      }
      if (typeof cmd.sql === 'string') {
        sqlIn.value = cmd.sql; sqlBar.hidden = false;
        try { sqlIn.focus(); } catch (_e) {}
        if (cmd.run) runSql();
        else say('SQL filled in by the chat — review it and press Run SQL (Ctrl+Enter)');
        return true;
      }
      if (typeof cmd.where === 'string') {
        whereIn.value = cmd.where;
        if (cmd.run) show(); else say('filter filled in by the chat — press Filter to apply it');
        return true;
      }
      return false;
    }
    if (window.AppUIEmbed) AppUIEmbed.onCommand(cmd => { applyCommand(cmd); });
    // A chat MOUNTED ON THIS PAGE (sidebar gallery "AI Chat" / the app's
    // chat_profile with host_hooks:"page") sees what is shown and drives it with
    // page.sql / page.filter / page.table actions — the same path as above; any
    // other page.* action falls through to the shared page agent (DOM).
    const appId = String(opts.api || '').replace(/^\/v1\/apps\//, '').replace(/\/+$/, '');
    if (window.AppUIHostHooks && AppUIHostHooks.register) {
      AppUIHostHooks.register('page', {
        context() {
          const src = source && (source.src || source.path);
          const t = current && current.table && tables.find(x => x.name === current.table);
          const cols = t ? (t.columns || []).map(c => c.name + ' ' + String(c.type || '').toLowerCase()) : [];
          return [
            'TABLE VIEWER PAGE (' + (opts.title || appId) + ')',
            'source: ' + (src || '(none open)'),
            'tables: ' + tables.filter(x => !x.error).map(x => x.name + (x.rows == null ? '' : ' (' + x.rows + ' rows)')).join(', '),
            current ? (current.table ? 'shown table: ' + current.table : 'shown: the result of the SQL below') : 'shown: nothing yet',
            cols.length ? 'columns (' + cols.length + '): ' + cols.slice(0, 120).join(', ') + (cols.length > 120 ? ' …' : '') : '',
            sqlIn.value.trim() ? 'SQL box: ' + sqlIn.value.trim().slice(0, 600) : '',
            whereIn.value.trim() ? 'filter box: ' + whereIn.value.trim().slice(0, 300) : '',
            'To CHANGE THIS PAGE (only when the user asks to fill / set / run / show something), end your reply with an action block:',
            '```action\n{"type": "page.sql", "sql": "SELECT …", "run": false}\n```',
            '  page.filter {"where": "<SQL condition>", "run": true|false} · page.table {"name": "<table>"} — run:true only when asked to run/apply.',
            'For ANSWERS about the data, call the tools (' + appId + '.query / .column_stats / .tables with path or src = the source above) — never guess.',
          ].filter(Boolean).join('\n');
        },
        onAction(type, payload) {
          const p = payload || {};
          if (type === 'page.sql') return applyCommand({sql: String(p.sql || ''), run: !!p.run});
          if (type === 'page.filter') return applyCommand({where: String(p.where || ''), run: !!p.run});
          if (type === 'page.table') return applyCommand({table: String(p.name || p.table || '')});
          return false;     // not ours → the page agent
        },
      });
    }
    if (viewer) {
      sqlBar.hidden = true;                 // a focused view: SQL on demand
      const sqlToggle = el('button', {text: 'SQL', title: 'Show / hide the SQL box',
        on: {click: () => { sqlBar.hidden = !sqlBar.hidden; if (!sqlBar.hidden) sqlIn.focus(); }}});
      const full = opts.fullUrl ? el('a', {class: 'autw-full', text: '↗ open full', target: '_blank', rel: 'noopener',
        href: typeof opts.fullUrl === 'function' ? opts.fullUrl() : opts.fullUrl}) : null;
      container.replaceChildren(el('div', {class: 'autw autw-viewer'}, [
        el('div', {class: 'autw-bar'}, [tablePick, whereIn, el('button', {text: 'Filter', on: {click: show}}),
          ...(opts.columnFilters === false ? [] : [filtersBtn]), sqlToggle, full]),
        sqlBar, loadBox, gridEl, status]));
    } else if (m) {           // split layout: the host places the pieces (e.g. shell sidebar / content top / body)
      side.classList.add('autw-in-shell');
      if (m.side) m.side.replaceChildren(side);
      if (m.top) m.top.replaceChildren(el('div', {class: 'autw-top'}, [pathBar, filterBar, sqlBar]));
      if (m.body) m.body.replaceChildren(el('div', {class: 'autw-body'}, [loadBox, gridEl, status]));
    } else {
      container.replaceChildren(el('div', {class: 'autw'}, [
        pathBar,
        el('div', {class: 'autw-main'}, [side, el('div', {class: 'autw-right'}, [filterBar, sqlBar, loadBox, gridEl, status])])
      ]));
    }

    const q = new URLSearchParams(location.search);
    let start = q.get('path') || q.get('src') || '';
    // ?sql=<query> (with ?path=): open the source and run that query - a deep link from another
    // page to exactly the rows it means (e.g. node_health: the trace rows around a crash)
    let pendingSql = start ? (q.get('sql') || '') : '';
    if (opts.autoOpen === false) { /* the host opens the source (e.g. charts' data pane) */ }
    else if (!start) { try { start = localStorage.getItem(key) || ''; } catch (e) { start = ''; } pathIn.value = start; }
    else openSource(start);
    return {
      // the open source / view, for a page's AI assistant context (chat_profile host hook)
      state: () => {
        const t = current && current.table ? tables.find(x => x.name === current.table) : null;
        return {path: pathIn.value.trim(), table: current && current.table || null, sql: current && current.sql || null,
                where: whereIn.value.trim() || null, tables: tables.map(x => x.name),
                // the shown table's columns, so an assistant uses the real names
                columns: t ? (t.columns || []).map(c => ({name: c.name, type: c.type})) : []};
      },
      // put a SELECT in the SQL bar and run it (the assistant's "show me" action; read-only by the engine)
      runQuery(sql) { sqlIn.value = String(sql || ''); sqlBar.hidden = false; runSql(); },
      open: openSource, sideElement: side,
      // show a table of the open source — now, or once its table list arrives
      showTable(name) {
        const t = tables.find(x => !x.error && x.name === name);
        if (t) { if (!(current && current.table === name)) { pick(t); renderTables(); show(); } }
        else wantTable = String(name || '');
      },
      source: () => source && (source.src || source.path),
      focusPath() { pathIn.focus(); pathIn.select(); },
      focusSql() { sqlIn.focus(); },
      focusFilter() { whereIn.focus(); },
      filterDialog: column => filterDialog(column),
      propsDialog: column => propsDialog(column),
      exportView,
      // extra arguments on every call for this source (e.g. a workbook's read options);
      // the source is opened again with them
      columnsDialog,
      setAutoRefresh,
      setSourceOptions(o) { extra = Object.assign({}, o || {}); if (pathIn.value.trim()) openSource(pathIn.value); },
      sourceOptions: () => Object.assign({}, extra),
      destroy() { releaseSource(); window.removeEventListener('pagehide', releaseSource); clearTimeout(findTimer); clearInterval(busyTimer); clearTimeout(pollTimer); grid.destroy(); if (container) container.replaceChildren(); },
    };
  }

  // A whole AppUI shell page around the workbench: tables in the left sidebar, the
  // path / filter / SQL bars in content.top, the grid in the body, a "Table" menu.
  // The sidebar tab is rendered lazily by the shell (and may not be the shown one),
  // so the table list element exists up front and the tab just attaches it.
  function createApp(opts = {}) {
    if (!window.AppUI || !AppUI.createApp) throw new Error('AppUITableWorkbench.createApp needs the AppUI shell');
    const side = document.createElement('div'), top = document.createElement('div'), body = document.createElement('div');
    side.style.cssText = 'height:100%;min-height:0;display:flex;flex-direction:column';
    body.style.cssText = 'height:100%;min-height:0';
    let wb = null, refreshing = false;
    const menu = Object.assign({'Table': [
      {id: 'autw.open', label: 'Open file…'}, {id: 'autw.filter', label: 'Filters…'},
      {id: 'autw.sql', label: 'SQL query…'}, {id: 'autw.columns', label: 'Columns…'},
      {id: 'autw.refresh', label: 'Auto-refresh'}, {separator: true}, {id: 'autw.export', label: 'Export rows…'}]
      .concat(opts.cacheApi ? [{separator: true}, {id: 'autw.cache', label: 'Cache…'}] : [])}, opts.menu || {});
    const post = (op, args) => fetch(opts.cacheApi + op, {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(args || {})}).then(r => r.json());
    const mb = n => n >= 1073741824 ? (n / 1073741824).toFixed(2) + ' GB' : (n / 1048576).toFixed(1) + ' MB';
    // the engine's scratch cache (imported csv / xlsx copies, filtered results): size, cap, free it
    function cacheDialog() {
      if (!window.AppUIDialog) return;
      const body = document.createElement('div');
      body.style.cssText = 'font-size:13px;line-height:1.6';
      body.textContent = 'reading…';
      const ov = AppUIDialog.show({title: 'Cache', body, width: 'min(520px,92vw)', closable: true, buttons: [
        {text: 'Free cache', action: o => {
          if (!window.confirm('Close the open files and delete the imported copies and result tables?')) return;
          post('clear_cache', {confirm: true}).then(r => { body.textContent = r.ok ? 'freed ' + mb(r.freed_bytes || 0) : (r._error || 'failed'); });
        }},
        {text: 'Close', primary: true, action: o => AppUIDialog.close(o)}]});
      post('status', {}).then(s => {
        if (!s.ok) { body.textContent = s._error || 'status unavailable'; return; }
        body.replaceChildren();
        [['in use', mb(s.scratch_bytes || 0) + ' for ' + (s.scratch_sources || 0) + ' source(s)'],
         ['limit', mb(s.scratch_cap_bytes || 0) + ' — least recently used sources are dropped first'],
         ['open now', (s.open || []).map(o => o.path).join('\n') || 'nothing'],
         ['folder', s.scratch_dir || '']].forEach(([k, v]) => {
          const row = document.createElement('div');
          const b = document.createElement('b'); b.textContent = k + ': ';
          const t = document.createElement('span'); t.textContent = v; t.style.whiteSpace = 'pre-wrap';
          row.append(b, t); body.appendChild(row);
        });
      }).catch(e => { body.textContent = String(e.message || e); });
      return ov;
    }
    const app = AppUI.createApp({
      id: opts.id, title: opts.title, menubar: {theme: true}, menu,
      onAction(group, id, params) {
        if (id === 'autw.open') wb && wb.focusPath();
        else if (id === 'autw.filter') wb && wb.filterDialog();
        else if (id === 'autw.sql') wb && wb.focusSql();
        else if (id === 'autw.export') wb && wb.exportView();
        else if (id === 'autw.cache') cacheDialog();
        else if (id === 'autw.columns') wb && wb.columnsDialog();
        else if (id === 'autw.refresh' && wb) {
          refreshing = wb.setAutoRefresh(!refreshing);
          try { AppUI.setStatus(refreshing ? 'auto-refresh on: the table reloads when the file changes' : 'auto-refresh off'); } catch (e) { /* optional */ }
        }
        else if (opts.onAction) opts.onAction(group, id, params);
      },
      leftSidebar: {width: opts.sideWidth || 280, tabs: [
        {id: 'tables', label: 'Tables', active: true, render: host => { host.style.minHeight = '0'; host.replaceChildren(side); }}]},
      content: {top: host => host.replaceChildren(top), body: host => { host.style.overflow = 'hidden'; host.replaceChildren(body); }},
      statusBar: {},
    });
    wb = create(Object.assign({}, opts, {mount: {side, top, body}, container: null}));
    return Object.assign({app}, wb);
  }
  // The focused VIEWER page (a previewer's url): the shell without menus or
  // sidebars around create({view:'viewer'}) — source from ?src=, an "open full"
  // link to the app's full page (opts.fullPage, default index.htm) with the
  // same source. The full page (createApp) includes the same view plus tools.
  function createViewer(opts = {}) {
    if (!window.AppUI || !AppUI.createApp) throw new Error('AppUITableWorkbench.createViewer needs the AppUI shell');
    const body = document.createElement('div');
    body.style.cssText = 'height:100%;min-height:0';
    const fq = new URLSearchParams(location.search); fq.delete('embed');
    const app = AppUI.createApp({id: opts.id, title: opts.title, statusBar: {},
      content: {body: host => { host.style.overflow = 'hidden'; host.replaceChildren(body); }}});
    const wb = create(Object.assign({}, opts, {view: 'viewer', container: body, mount: null,
      fullUrl: opts.fullUrl || ((opts.fullPage || 'index.htm') + '?' + fq.toString())}));
    return Object.assign({app}, wb);
  }
  return {create, createApp, createViewer, columnFilterSql};
})();
window.AppUITableWorkbench = AppUITableWorkbench;
