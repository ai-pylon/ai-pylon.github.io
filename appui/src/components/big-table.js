/* AppUIBigTable: a grid over a REMOTE row source of any size.
 *
 * Unlike AppUIDataTable / AppUIVirtualScroll (which virtualise rows that are
 * already in memory), this never holds the data set. It keeps a small cache of
 * row blocks and asks the host for the window on screen, so it works the same
 * over a thousand rows or a few hundred million.
 *
 * Usage:
 *   const grid = AppUIBigTable.create({
 *     container: el,                       // sized by the page (it fills it)
 *     fetch: (offset, limit) => api('rows', {view, offset, limit})
 *                                 .then(r => r.rows),   // -> array of row arrays
 *     onSort: (column, direction) => {},   // direction: 'asc' | 'desc' | null
 *     onRange: (first, last, total) => {}, // visible rows changed
 *     onFilter: (column, text) => {},      // a column filter changed (text '' = cleared)
 *     filterRow: true,                     // per-column filter inputs under the header
 *     menuItems: ctx => [],                // extra right-click items (ctx below)
 *     onFilterDialog: column => {},        // "Filter this column…" opens the host's dialog
 *     onRowClick: (row, index, event) => {},   // a click on a loaded row (row = its value array)
 *     rowHeight: 24, blockSize: 200, maxBlocks: 80,
 *   });
 *   grid.setFilters({col: 'text'})   // show the host's current column filters
 *
 * Filtering is delegated to the host like sorting (the data is remote): the
 * filter inputs and the right-click "Filter" items only report (column, text).
 * Filter text grammar (the host turns it into its query): `abc` contains,
 * `=v` `!=v` `>v` `>=v` `<v` `<=v`, `null`, `!null`.
 * Right-click (AppUIContextMenu, bundle contextMenu): on a cell — copy value / row /
 * column name, filter to this value, exclude it, sort; on a header — sort, filter,
 * clear filter. ctx = {kind: 'cell'|'header', column, type, value, row, index}.
 *   grid.setView({columns: [{name, type}], total, sort: {column, direction},
 *                 pinned: 2});          // keep the first 2 columns in view (frozen)
 *   grid.setTotal(n);            // more rows arrived (streaming source): keeps position
 *   grid.scrollToRow(1234567);   grid.refresh();   grid.destroy();
 *
 * Width: only the columns in view (plus pinned ones) are rendered, and the DOM
 * is updated at most once per animation frame, so a table with hundreds of
 * columns scrolls as cheaply as a narrow one.
 * Scrolling: the scrollbar maps proportionally onto the row count (browsers cap
 * element height, so pixel-exact scrolling stops working beyond ~1M rows);
 * wheel and keyboard move by rows, so navigation stays precise at any size.
 * Sorting is delegated to the host (onSort) — it must be done where the data is.
 */
const AppUIBigTable = (() => {
  const MAX_PX = 8000000;
  let styled = false;
  function style() {
    if (styled) return; styled = true;
    const s = document.createElement('style');
    s.textContent = [
      '.aubt{display:flex;flex-direction:column;min-height:0;height:100%;border:1px solid var(--border,#3f4147);font:12px/1 var(--font-mono,ui-monospace,Consolas,monospace);color:var(--text,inherit);background:var(--bg,transparent)}',
      '.aubt-head{overflow:hidden;flex:none;background:var(--bg-elevated,rgba(127,127,127,.12));border-bottom:1px solid var(--border,#3f4147)}',
      '.aubt-hrow,.aubt-row{display:flex;white-space:nowrap}',
      '.aubt-hc{position:relative;flex:none;box-sizing:border-box;padding:6px 8px;font-weight:600;cursor:pointer;overflow:hidden;text-overflow:ellipsis;border-right:1px solid var(--border,#3f4147);user-select:none}',
      '.aubt-hc small{font-weight:400;opacity:.6;margin-left:6px}',
      '.aubt-rs{position:absolute;right:0;top:0;bottom:0;width:6px;cursor:col-resize}',
      '.aubt-view{position:relative;flex:1;min-height:0;overflow:auto;outline:none}',
      '.aubt-rows{position:sticky;top:0;height:0}',
      '.aubt-row{box-sizing:border-box;border-bottom:1px solid var(--border-subtle,rgba(127,127,127,.18))}',
      '.aubt-row:hover{background:rgba(127,127,127,.12)}',
      '.aubt-clickable .aubt-row{cursor:pointer}',
      '.aubt-c{flex:none;box-sizing:border-box;padding:0 8px;overflow:hidden;text-overflow:ellipsis;border-right:1px solid var(--border-subtle,rgba(127,127,127,.18))}',
      '.aubt-n{text-align:right}.aubt-null{opacity:.4}.aubt-neg{color:#c62828}.aubt-idx{color:var(--text-muted,GrayText);text-align:right}',
      '.aubt-pin{position:sticky;z-index:1;background:var(--bg-elevated,Canvas)}',
      '.aubt-pin-last{border-right:2px solid var(--border,#3f4147)}',
      '.aubt-empty{padding:16px;opacity:.6;font-family:inherit}',
      '.aubt-frow{display:flex;white-space:nowrap;border-top:1px solid var(--border-subtle,rgba(127,127,127,.18))}',
      '.aubt-fc{flex:none;box-sizing:border-box;padding:2px 3px;border-right:1px solid var(--border,#3f4147)}',
      '.aubt-fc input{width:100%;box-sizing:border-box;font:11px var(--font-mono,ui-monospace,Consolas,monospace);padding:2px 4px;border:1px solid var(--border-subtle,rgba(127,127,127,.3));background:var(--bg,transparent);color:inherit;border-radius:2px}',
      '.aubt-fc input.on{border-color:var(--accent,#4c8bf5);background:rgba(76,139,245,.08)}',
      '.aubt-hc.aubt-filtered{color:var(--accent,#4c8bf5)}'
    ].join('\n');
    document.head.appendChild(s);
  }
  const NUMERIC = /INT|DECIMAL|DOUBLE|FLOAT|REAL|NUMERIC|HUGEINT/i;

  function create(opts = {}) {
    const container = typeof opts.container === 'string' ? document.querySelector(opts.container) : opts.container;
    if (!container) throw new Error('AppUIBigTable: container required');
    style();
    const rowH = opts.rowHeight || 24, block = opts.blockSize || 200, maxBlocks = opts.maxBlocks || 80;
    const root = document.createElement('div'); root.className = 'aubt' + (opts.onRowClick ? ' aubt-clickable' : '');
    const head = document.createElement('div'); head.className = 'aubt-head';
    const hrow = document.createElement('div'); hrow.className = 'aubt-hrow'; head.appendChild(hrow);
    const frow = document.createElement('div'); frow.className = 'aubt-frow';
    if (opts.filterRow) head.appendChild(frow);
    let filters = {};                 // column -> filter text (as reported by the host)
    const view = document.createElement('div'); view.className = 'aubt-view'; view.tabIndex = 0;
    const rowsEl = document.createElement('div'); rowsEl.className = 'aubt-rows';
    // The scrolled cells are kept OUT of the accessibility tree: every cell text
    // change is an accessibility event, and on Windows with any UI-automation
    // client running (they force Chrome's accessibility on) each one costs ~2 ms
    // of NotifyWinEvent on the BROWSER's main thread — a wide table's scroll froze
    // the whole browser for seconds. The view carries a summary label instead
    // (rows × columns, updated by setView / setTotal); the header stays exposed.
    rowsEl.setAttribute('aria-hidden', 'true');
    const spacer = document.createElement('div'); spacer.setAttribute('aria-hidden', 'true');
    view.appendChild(rowsEl); view.appendChild(spacer);
    root.appendChild(head); root.appendChild(view);
    container.replaceChildren(root);

    let columns = [], widths = [], total = 0, sort = null, pinned = 0;
    let first = 0, gen = 0, destroyed = false, selfScroll = false, timer = 0, lastFirst = 0;
    const cache = new Map();      // block index -> rows (insertion order = LRU)
    const pending = new Set();
    const pool = [];              // row elements

    let query='',filterCleanup,filterVersion=0;
    const columnState=AppUITableColumns.create({stateKey:opts.stateKey,onChange:projectColumns});
    const controls=AppUITableControls.create({container:root,opts:{...opts,find:!!opts.onSearch,columnMenuItems:col=>opts.menuItems?.({kind:'header',column:col.name,type:col.type||''})||[]},
      allColumns:columnState.all,getColumns:()=>columnState.visible.slice(),getFilters:()=>({...filters}),
      setSearch,clearFilters:clearColumnFilters,
      setVisible:columnState.setVisible,moveColumn:columnState.move,resetColumns:columnState.reset,
      showFilter:showColumnFilter,sortColumn:(id,asc)=>opts.onSort?.(id,asc?'asc':'desc'),clearSort:()=>opts.onSort?.(sort?.column||null,null),isCurrent:()=>!destroyed});
    root.insertBefore(root.lastElementChild,head);
    function setSearch(text){query=String(text||'');controls.update({query,count:total,filtered:Object.keys(filters).length>0});opts.onSearch?.(query);}
    function clearColumnFilters(){const previous=Object.keys(filters);filters={};renderHead();controls.update({query,count:total,filtered:false});if(opts.onFilters)opts.onFilters({});else for(const id of previous)opts.onFilter?.(id,'');}
    function projectColumns(){
      columns=columnState.visible;
      widths=columns.map(c=>Number(c.width)||Math.max(70,Math.min(360,(String(c.name).length+String(c.type||'').length+3)*7+24)));
      pinned=Math.min(pinned,Math.max(0,columns.length-1));
      pool.forEach(r=>{r.replaceChildren();r._sig='';});renderHead();layout();paint(true);
      opts.onColumnsChange?.(columnState.getColumns());
    }
    async function showColumnFilter(col){
      const ticket=++filterVersion;filterCleanup?.();
      let stats={};try{stats=await opts.columnStats?.(col.name)||{};}catch{}
      if(destroyed||ticket!==filterVersion)return;
      const values=(stats.top||[]).map(item=>String(item.value??'')).filter(Boolean);
      const popup=window.AppUITableFilter.create({container:root,column:col,values,rawValues:[stats.min,stats.max].filter(v=>v!=null),value:filters[col.id],onApply:value=>setFilter(col.id,typeof value==='string'&&value?{type:'contains',value}:value),onClose:()=>{if(filterCleanup===popup.destroy)filterCleanup=null;}});
      filterCleanup=popup.destroy;
    }

    const idxW = () => Math.max(56, String(total).length * 8 + 18);
    const totalW = () => idxW() + widths.reduce((a, b) => a + b, 0);
    // Pin the row-number column and the first `pinned` data columns (k = 0 is the row number).
    function pin(cell, k) {
      if (k > pinned) return;
      let left = 0;
      if (k > 0) { left = idxW(); for (let i = 0; i < k - 1; i++) left += widths[i]; }
      cell.classList.add('aubt-pin'); cell.style.left = left + 'px';
      if (k === pinned && pinned > 0) cell.classList.add('aubt-pin-last');
    }
    const visible = () => Math.max(1, Math.ceil(view.clientHeight / rowH));
    const maxFirst = () => Math.max(0, total - Math.max(1, Math.floor(view.clientHeight / rowH)));
    const scrollH = () => Math.min(total * rowH, MAX_PX);

    function layout() {
      spacer.style.cssText = 'height:' + scrollH() + 'px;width:' + totalW() + 'px';
      hrow.style.width = totalW() + 'px'; frow.style.width = totalW() + 'px';
    }
    let headerScope;
    function renderHead() {
      headerScope?.destroy();headerScope=AppUILifecycle.createScope();
      hrow.replaceChildren();
      const ix = document.createElement('div'); ix.className = 'aubt-hc aubt-idx'; ix.textContent = '#';
      ix.style.width = idxW() + 'px'; ix.style.cursor = 'default'; pin(ix, 0); hrow.appendChild(ix);
      columns.forEach((c, i) => {
        const h = document.createElement('div'); h.className = 'aubt-hc';h.dataset.columnId=c.name;h.tabIndex=0; h.style.width = widths[i] + 'px';
        const mark = sort && sort.column === c.name ? (sort.direction === 'desc' ? ' ▼' : ' ▲') : '';
        h.textContent = c.name + mark; h.title = c.name + (c.type ? ' — ' + c.type : '') + (c.hint ? '\nformat: ' + c.hint : '') +
          (c.description ? '\n' + c.description : '');
        if (c.type) { const t = document.createElement('small'); t.textContent = c.type.toLowerCase(); h.appendChild(t); }
        h.addEventListener('click', () => {
          const dir = !sort || sort.column !== c.name ? 'asc' : sort.direction === 'asc' ? 'desc' : null;
          if (opts.onSort) opts.onSort(c.name, dir);
        });
        AppUITableControls.bindHeader({cell:h,column:c,scope:headerScope,onMenu:controls.showMenu,onMove:columnState.move,reorderable:opts.reorderable!==false,isCurrent:()=>!destroyed});
        const grip = document.createElement('div'); grip.className = 'aubt-rs';
        grip.addEventListener('click', e => e.stopPropagation());
        grip.addEventListener('pointerdown', e => {
          e.preventDefault(); e.stopPropagation();h.draggable=false; grip.setPointerCapture(e.pointerId);
          const x0 = e.clientX, w0 = widths[i];
          const move = ev => { widths[i] = Math.max(40, w0 + ev.clientX - x0);c.width=widths[i]; h.style.width = widths[i] + 'px'; layout(); paint(true); };
          const up = () => { grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); renderHead(); };
          grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up);
        });
        if (filters[c.name]) { h.classList.add('aubt-filtered'); h.title += '\nfilter: ' + AppUITableFilter.format(filters[c.name]); }
        pin(h, i + 1); h.appendChild(grip); hrow.appendChild(h);
      });
      renderFilters();
    }
    // one filter input per column, under the header (scrolls with it)
    function renderFilters() {
      if (!opts.filterRow) return;
      frow.replaceChildren();
      const ix = document.createElement('div'); ix.className = 'aubt-fc aubt-idx'; ix.style.width = idxW() + 'px';
      ix.title = 'Column filters: abc (contains)  =v  !=v  >v  >=v  <v  <=v  null  !null — Enter applies'; ix.textContent = '⏷';
      ix.style.textAlign = 'center'; pin(ix, 0); frow.appendChild(ix);
      columns.forEach((c, i) => {
        const cell = document.createElement('div'); cell.className = 'aubt-fc'; cell.style.width = widths[i] + 'px';
        const input = document.createElement('input');
        input.type = 'text'; input.spellcheck = false; input.value = filters[c.name] || '';
        input.placeholder = NUMERIC.test(c.type || '') ? '=, >, <…' : 'filter';
        input.setAttribute('aria-label', 'Filter ' + c.name);
        input.classList.toggle('on', !!filters[c.name]);
        const apply = () => {
          const v = input.value.trim();
          if ((filters[c.name] || '') === v) return;
          setFilter(c.name, v);
        };
        input.addEventListener('keydown', e => {
          if (e.key === 'Enter') { e.preventDefault(); apply(); }
          else if (e.key === 'Escape' && input.value) { e.preventDefault(); input.value = ''; apply(); }
        });
        input.addEventListener('change', apply);
        input.addEventListener('contextmenu', e => e.stopPropagation());
        pin(cell, i + 1); cell.appendChild(input); frow.appendChild(cell);
      });
    }
    function setFilter(column, text) {
      text = text&&typeof text==='object'?text:String(text||'').trim();
      if (text) filters[column] = text; else delete filters[column];
      renderHead();
      if (opts.onFilter) opts.onFilter(column, text);
    }
    // ── right-click menu ───────────────────────────────────────────────────
    function quoteFilter(v) {        // a value as filter text: =v (NULL -> null)
      if (v === null || v === undefined) return 'null';
      return '=' + String(v);
    }
    function copy(text) {
      try { navigator.clipboard.writeText(String(text)); } catch (e) { /* clipboard is optional */ }
    }
    function menu(e, ctx) {
      const items = [];
      const col = ctx.column;
      if (ctx.kind === 'cell') {
        const shown = ctx.value === null ? 'NULL' : String(ctx.value);
        const short = shown.length > 40 ? shown.slice(0, 40) + '…' : shown;
        items.push({label: 'Copy value', action: () => copy(ctx.value === null ? '' : ctx.value)});
        if (ctx.row) items.push({label: 'Copy row', action: () => copy(ctx.row.map(x => x === null ? '' : String(x)).join('\t'))});
        items.push({label: 'Copy column name', action: () => copy(col)});
        items.push({separator: true});
        items.push({label: 'Filter: ' + col + ' = ' + short, action: () => setFilter(col, quoteFilter(ctx.value))});
        items.push({label: 'Exclude: ' + col + ' ≠ ' + short, action: () => setFilter(col, ctx.value === null ? '!null' : '!=' + String(ctx.value))});
        if (NUMERIC.test(ctx.type || '') && ctx.value !== null) {
          items.push({label: 'Filter: ' + col + ' > ' + short, action: () => setFilter(col, '>' + ctx.value)});
          items.push({label: 'Filter: ' + col + ' < ' + short, action: () => setFilter(col, '<' + ctx.value)});
        }
      } else {
        items.push({label: 'Copy column name', action: () => copy(col)});
        items.push({label: 'Filter this column…', action: () => {
          if (opts.onFilterDialog) { opts.onFilterDialog(col); return; }
          const v = window.prompt('Filter ' + col + ':\n  abc  contains     =v  !=v  >v  >=v  <v  <=v     null  !null', filters[col] || '');
          if (v !== null) setFilter(col, v);
        }});
      }
      if (filters[col]) items.push({label: 'Clear filter on ' + col, action: () => setFilter(col, '')});
      if (Object.keys(filters).length > 1) items.push({label: 'Clear all column filters', action: () => {
        const cols = Object.keys(filters); filters = {}; renderHead(); cols.forEach(cn => opts.onFilter && opts.onFilter(cn, ''));
      }});
      if (opts.onSort) {
        items.push({separator: true});
        items.push({label: 'Sort ascending', action: () => opts.onSort(col, 'asc')});
        items.push({label: 'Sort descending', action: () => opts.onSort(col, 'desc')});
        if (sort && sort.column === col) items.push({label: 'Clear sort', action: () => opts.onSort(col, null)});
      }
      if (opts.menuItems) {
        const extra = opts.menuItems(ctx) || [];
        if (extra.length) items.push({separator: true}, ...extra);
      }
      const show = () => window.AppUIContextMenu.show(e, items);
      if (window.AppUIContextMenu) show();
      else if (window.AppUIAssets && AppUIAssets.load) AppUIAssets.load('contextMenu').then(show).catch(() => {});
    }
    rowsEl.addEventListener('click', e => {
      if (!opts.onRowClick) return;
      const rowEl_ = e.target.closest('.aubt-row');
      const i = rowEl_ ? pool.indexOf(rowEl_) : -1;
      if (i < 0) return;
      const index = first + i, b = cache.get(Math.floor(index / block)), data = b ? b[index % block] : null;
      if (data) opts.onRowClick(data, index, e);
    });
    rowsEl.addEventListener('contextmenu', e => {
      const cellEl = e.target.closest('.aubt-c'), rowEl_ = e.target.closest('.aubt-row');
      if (!cellEl || !rowEl_ || !rowEl_._cells) return;
      const i = pool.indexOf(rowEl_); if (i < 0) return;
      const entry = rowEl_._cells.find(x => x[0] === cellEl);
      if (!entry || entry[1] < 0) return;            // the row-number column has no menu
      e.preventDefault();
      const index = first + i, b = cache.get(Math.floor(index / block)), data = b ? b[index % block] : null;
      const c = columns[entry[1]];
      menu(e, {kind: 'cell', column: c.name, type: c.type || '', value: data ? data[c.sourceIndex] : undefined,
               row: data || null, index});
    });
    function rowEl(i) {
      while (pool.length <= i) {
        const r = document.createElement('div'); r.className = 'aubt-row';
        r.style.height = rowH + 'px'; r.style.lineHeight = (rowH - 1) + 'px';
        rowsEl.appendChild(r); pool.push(r);
      }
      return pool[i];
    }
    // ── column window ──────────────────────────────────────────────────────
    // Only the columns in the horizontal viewport (plus the pinned ones) get
    // cells. A trace table can have hundreds of columns; rendering them all
    // made every scroll step repaint thousands of cells.
    let layoutVer = 0, colSig = '';
    function colWindow() {
      const lo = view.scrollLeft - idxW() - 300, hi = view.scrollLeft - idxW() + view.clientWidth + 300;
      let x = 0, c0 = -1, c1 = -1;
      for (let i = 0; i < widths.length; i++) {
        const end = x + widths[i];
        if (i >= pinned && end > lo && x < hi) { if (c0 < 0) c0 = i; c1 = i; }
        x = end;
      }
      return {c0, c1};
    }
    function buildRow(r, win) {
      r.replaceChildren();
      const cells = [];
      function add(k) {            // k = 0 row number, k >= 1 data column k-1
        const c = document.createElement('div');
        c.className = 'aubt-c' + (k === 0 ? ' aubt-idx' : NUMERIC.test(columns[k - 1].type || '') ? ' aubt-n' : '');
        c.style.width = (k === 0 ? idxW() : widths[k - 1]) + 'px';
        pin(c, k); r.appendChild(c); cells.push([c, k - 1]);
      }
      add(0);
      for (let i = 0; i < pinned; i++) add(i + 1);
      if (win.c0 >= 0) {
        let gap = 0;
        for (let i = pinned; i < win.c0; i++) gap += widths[i];
        if (gap) { const sp = document.createElement('div'); sp.style.cssText = 'flex:none;width:' + gap + 'px'; r.appendChild(sp); }
        for (let i = win.c0; i <= win.c1; i++) add(i + 1);
      }
      r._cells = cells; r._sig = colSig;
    }
    // set a cell's text IN PLACE (its one text node's value) and only when it
    // changed: replacing the node (textContent) is a remove + insert for the
    // renderer and the accessibility layer on every scroll step
    function setText(c, t) {
      const n = c.firstChild;
      if (n && n.nodeType === 3 && !n.nextSibling) { if (n.nodeValue !== t) n.nodeValue = t; }
      else c.textContent = t;
    }
    function fillRow(r, index, data, win) {
      if (r._sig !== colSig) buildRow(r, win);
      const cells = r._cells;
      setText(cells[0][0], String(index + 1));
      for (let j = 1; j < cells.length; j++) {
        const c = cells[j][0], v = data ? data[columns[cells[j][1]].sourceIndex] : undefined;
        if (v === null) { setText(c, 'NULL'); c.classList.add('aubt-null'); c.classList.remove('aubt-neg'); }
        else {
          c.classList.remove('aubt-null');
          const f = v === undefined ? {text: '·'} : shown(v, columns[cells[j][1]]);
          setText(c, f.text); c.classList.toggle('aubt-neg', !!f.red);
        }
      }
    }
    function label() {
      view.setAttribute('aria-label', 'Table: ' + total.toLocaleString('en-US') + ' rows × ' + columns.length +
        ' columns (cells are not listed for assistive technology; use the filter, SQL or Export)');
    }
    // a column's display hint (a spreadsheet number format): percent, fixed decimals,
    // thousands separators, a negative section ("0.00;[Red]-0.00", "#,##0;(#,##0)")
    // with its colour, and date / time codes (yyyy-mm-dd hh:mm:ss ...) applied to an
    // Excel serial number; anything else is shown as stored. -> {text, red}
    function shown(v, col) {
      const h = col && col.hint;
      if (!h || typeof v !== 'number') return {text: String(v)};
      const secs = String(h).split(';');
      const neg = v < 0 && secs.length > 1 && secs[1].trim() !== '';
      let sec = neg ? secs[1] : secs[0];
      const red = /\[red\]/i.test(sec);
      sec = sec.replace(/\[[^\]]*\]/g, '').replace(/\\(.)/g, '$1').replace(/"([^"]*)"/g, '$1').trim();
      if (/[ymdhs]/i.test(sec.replace(/AM\/PM|A\/P/gi, '')) && !/[0#]/.test(sec)) {
        const t = dateText(v, sec);
        return {text: t == null ? String(v) : t, red};
      }
      let wrap = false, sign = '';
      if (neg) {
        if (/^\(.*\)$/.test(sec)) { wrap = true; sec = sec.slice(1, -1).trim(); }
        if (sec[0] === '-') { sign = '-'; sec = sec.slice(1).trim(); }
      }
      const m = /^(#,##)?0(?:\.(0+))?(%)?$/.exec(sec);
      if (!m) return {text: String(v), red: red && v < 0};
      const dec = m[2] ? m[2].length : 0, base = neg ? Math.abs(v) : v, x = m[3] ? base * 100 : base;
      const s = m[1] ? x.toLocaleString('en-US', {minimumFractionDigits: dec, maximumFractionDigits: dec}) : x.toFixed(dec);
      const body = s + (m[3] ? '%' : '');
      return {text: wrap ? '(' + sign + body + ')' : sign + body, red};
    }
    // an Excel date serial (days since 1899-12-30, 1900 system) in a date/time code
    function dateText(v, code) {
      if (!(v > -1 && v < 2958466)) return null;
      const d = new Date(Math.round((v - 25569) * 86400000));
      if (isNaN(d)) return null;
      const p2 = n => String(n).padStart(2, '0');
      const ampm = /AM\/PM/i.test(code);
      const hr = d.getUTCHours(), h12 = hr % 12 || 12;
      const toks = code.match(/yyyy|yy|mmmm|mmm|mm|m|dddd|ddd|dd|d|hh|h|ss|s|AM\/PM|[^ymdhsA]+|./gi) || [];
      const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
        'October', 'November', 'December'];
      const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      let out = '', lastWasHour = false;
      toks.forEach((tk, i) => {
        const lo = tk.toLowerCase();
        const nextIsSec = () => toks.slice(i + 1).some(x => /^s+$/i.test(x)) && !toks.slice(i + 1).some(x => /^[dhy]/i.test(x));
        if (lo === 'yyyy') out += d.getUTCFullYear();
        else if (lo === 'yy') out += p2(d.getUTCFullYear() % 100);
        else if (lo === 'mmmm') out += months[d.getUTCMonth()];
        else if (lo === 'mmm') out += months[d.getUTCMonth()].slice(0, 3);
        else if (lo === 'mm' || lo === 'm') {             // minutes after an hour / before seconds
          const minute = lastWasHour || nextIsSec();
          const val = minute ? d.getUTCMinutes() : d.getUTCMonth() + 1;
          out += lo === 'mm' ? p2(val) : val;
        } else if (lo === 'dddd') out += days[d.getUTCDay()];
        else if (lo === 'ddd') out += days[d.getUTCDay()].slice(0, 3);
        else if (lo === 'dd') out += p2(d.getUTCDate());
        else if (lo === 'd') out += d.getUTCDate();
        else if (lo === 'hh') out += p2(ampm ? h12 : hr);
        else if (lo === 'h') out += ampm ? h12 : hr;
        else if (lo === 'ss') out += p2(d.getUTCSeconds());
        else if (lo === 's') out += d.getUTCSeconds();
        else if (lo === 'am/pm') out += hr < 12 ? 'AM' : 'PM';
        else out += tk;
        if (/^h+$/.test(lo)) lastWasHour = true; else if (/[a-z]/.test(lo)) lastWasHour = false;
      });
      return out;
    }
    // paint() only SCHEDULES: however many scroll / wheel / data events arrive,
    // the DOM is updated once per animation frame.
    let frame = 0, lastRange = '';
    function paint(relayout) {
      if (relayout) layoutVer++;
      if (frame || destroyed) return;
      frame = requestAnimationFrame(() => { frame = 0; paintNow(); });
    }
    function paintNow() {
      if (destroyed) return;
      const n = Math.min(visible() + 1, Math.max(0, total - first));
      const win = colWindow();
      colSig = layoutVer + ':' + win.c0 + ':' + win.c1 + ':' + pinned + ':' + columns.length;
      rowsEl.style.width = totalW() + 'px';
      for (let i = 0; i < n; i++) {
        const index = first + i, b = cache.get(Math.floor(index / block));
        const r = rowEl(i); r.style.display = '';
        fillRow(r, index, b ? b[index % block] : null, win);
      }
      for (let i = n; i < pool.length; i++) pool[i].style.display = 'none';
      const range = first + ':' + n + ':' + total;
      if (opts.onRange && range !== lastRange) { lastRange = range; opts.onRange(first, Math.min(total, first + n) - 1, total); }
      clearTimeout(timer); timer = setTimeout(load, 40);
    }
    function load() {
      if (destroyed || !opts.fetch || !total) return;
      // the blocks on screen (plus half a block either side), then ONE block ahead in
      // the direction the user is scrolling, so steady scrolling rarely waits
      const dir = first > lastFirst ? 1 : first < lastFirst ? -1 : 0;
      lastFirst = first;
      const from = Math.floor(Math.max(0, first - block / 2) / block);
      const to = Math.floor(Math.min(total - 1, first + visible() + block / 2) / block);
      const want = [];
      for (let b = from; b <= to; b++) want.push(b);
      const ahead = dir > 0 ? to + 1 : dir < 0 ? from - 1 : -1;
      if (ahead >= 0 && ahead * block < total && want.length < maxBlocks - 1) want.push(ahead);
      for (const b of want) {
        if (cache.has(b)) { const v = cache.get(b); cache.delete(b); cache.set(b, v); continue; }
        if (pending.has(b)) continue;
        pending.add(b);
        const mine = gen;
        Promise.resolve(opts.fetch(b * block, block)).then(rows => {
          if (mine !== gen || destroyed) return;
          pending.delete(b); cache.set(b, rows || []);
          while (cache.size > maxBlocks) cache.delete(cache.keys().next().value);
          const lo = Math.floor(first / block), hi = Math.floor((first + visible()) / block);
          if (b >= lo && b <= hi) paint();
        }).catch(err => { if (mine === gen) { pending.delete(b); if (opts.onError) opts.onError(err); } });
      }
    }
    function syncScrollbar() {
      const range = scrollH() - view.clientHeight, top = maxFirst() ? Math.round(first / maxFirst() * range) : 0;
      if (Math.abs(view.scrollTop - top) > 1) { selfScroll = true; view.scrollTop = Math.max(0, top); }
    }
    function goto(index, fromScrollbar) {
      const next = Math.max(0, Math.min(maxFirst(), Math.round(index)));
      const moved = next !== first; first = next;
      if (!fromScrollbar) syncScrollbar();
      if (moved || !fromScrollbar) paint();
    }
    view.addEventListener('scroll', () => {
      head.scrollLeft = view.scrollLeft;        // the filter row lives in the header, so it follows
      paint();                                    // the column window may have moved
      if (selfScroll) { selfScroll = false; return; }
      const range = scrollH() - view.clientHeight;
      goto(range > 0 ? view.scrollTop / range * maxFirst() : 0, true);
    });
    view.addEventListener('wheel', e => {
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;   // horizontal: native
      e.preventDefault();
      const px = e.deltaMode === 1 ? e.deltaY * rowH : e.deltaMode === 2 ? e.deltaY * view.clientHeight : e.deltaY;
      goto(first + (px > 0 ? Math.max(1, Math.round(px / rowH)) : Math.min(-1, Math.round(px / rowH))));
    }, {passive: false});
    view.addEventListener('keydown', e => {
      const page = Math.max(1, visible() - 2);
      const step = {ArrowDown: 1, ArrowUp: -1, PageDown: page, PageUp: -page}[e.key];
      if (step) { e.preventDefault(); goto(first + step); }
      else if (e.key === 'Home' && e.ctrlKey) { e.preventDefault(); goto(0); }
      else if (e.key === 'End' && e.ctrlKey) { e.preventDefault(); goto(total); }
    });
    // Re-layout on the NEXT frame and only when the viewport really changed:
    // resizing our own children inside the observer callback makes the browser
    // report "ResizeObserver loop completed with undelivered notifications".
    let seenW = -1, seenH = -1, raf = 0;
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => {
      if (view.clientWidth === seenW && view.clientHeight === seenH) return;
      seenW = view.clientWidth; seenH = view.clientHeight;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => { if (!destroyed) { layout(); goto(first); } });
    }) : null;
    if (ro) ro.observe(view);

    function setView(v = {}) {
      gen++; cache.clear(); pending.clear();
      filterVersion++;filterCleanup?.();
      total=Math.max(0,v.total||0);sort=v.sort||null;first=0;
      if(v.filters)filters={...v.filters};
      columnState.update((v.columns||[]).map((c,i)=>({...c,id:c.name,label:c.name,sourceIndex:i,filterType:NUMERIC.test(c.type||'')?'number':undefined,filterable:!!opts.onFilter})),{reset:!v.keepWidths,stateKey:v.stateKey||opts.stateKey});
      columns=columnState.visible;
      pinned=Math.max(0,Math.min(v.pinned||0,columns.length-1));
      widths=columns.map(c=>Number(c.width)||Math.max(70,Math.min(360,(String(c.name).length+String(c.type||'').length+3)*7+24)));
      controls.update({query,count:total,filtered:Object.keys(filters).length>0});
      renderHead(); layout(); label(); view.scrollTop = 0; view.scrollLeft = 0;
      pool.forEach(r => { r.replaceChildren(); r._sig = ''; }); lastRange = '';
      if (!columns.length) { rowsEl.style.width = ''; pool.forEach(r => { r.style.display = 'none'; }); return; }
      paint(true);
    }
    // The row source grew (data still streaming in): keep the position, extend
    // the scroll range, and forget the short tail block so it is fetched again.
    function setTotal(n) {
      n = Math.max(0, n || 0);
      if (n === total) return;
      const idx0 = idxW();
      for (const [b, rows] of cache) if (rows.length < block) cache.delete(b);
      total = n;controls.update({query,count:total,filtered:Object.keys(filters).length>0}); layout(); label();
      if (idxW() !== idx0) { renderHead(); paint(true); } else paint();
      syncScrollbar();
    }
    return {
      setView, setTotal,setFilter,clearFilters:clearColumnFilters,setSearch,getSearch:()=>query,
      getColumns:columnState.getColumns,setColumnVisible:columnState.setVisible,moveColumn:columnState.move,resetColumns:columnState.reset,showColumns:controls.showColumns,showFilter:id=>{const col=columnState.all.find(c=>c.id===id);if(col)return showColumnFilter(col);},
      setFilters(map) { filters = Object.assign({}, map || {});controls.update({query,count:total,filtered:Object.keys(filters).length>0}); renderHead(); },
      getFilters: () => Object.assign({}, filters),
      refresh() { gen++; cache.clear(); pending.clear(); paint(); },
      scrollToRow(i) { goto(i); view.focus(); },
      getRange: () => ({first, total}),
      destroy() { destroyed = true;headerScope?.destroy();filterVersion++;filterCleanup?.();controls.destroy(); clearTimeout(timer); cancelAnimationFrame(raf); cancelAnimationFrame(frame); if (ro) ro.disconnect(); root.remove(); },
    };
  }
  return {create};
})();
window.AppUIBigTable = AppUIBigTable;
