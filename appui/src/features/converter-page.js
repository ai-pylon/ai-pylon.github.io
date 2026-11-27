/* AppUIConverterPage: the page body for "turn one input file into output files".
 *
 * Every converter app (cell trace, baseband trace, …) has the same page: name a
 * file, pick output formats, look at what is in it, convert, then open the
 * results. This component is that page, built from AppUIToolbar and
 * AppUIDataTable, so each app only describes its own ops and wording.
 *
 * The app's ops (all take {path} or {src}):
 *   inspect -> anything; shown through `inspectTables(result)`
 *   convert {formats, confirm:true} -> {tables:[{name, rows, columns}],
 *            outputs:{<format>:[paths] | [{path, label, viewer?}]}, out_dir, elapsed_ms, …}
 *
 * Usage:
 *   AppUIConverterPage.create({
 *     container: el,
 *     api: '/v1/apps/analytics/pm_event/',
 *     hint: 'C:\\traces\\trace.gpb',
 *     formats: ['parquet', 'duckdb', 'csv', 'xlsx'], defaults: ['parquet', 'duckdb'],
 *     viewers: {duckdb: '/apps/analytics/duckdb_viewer/'},   // format -> page taking ?path=
 *     folderFormats: ['parquet'],          // formats whose folder (not each file) is opened
 *     inspectSummary: r => '2,546 records',
 *     inspectTables: r => [{title, columns: [{id, label}], rows: [...]}],
 *     convertSummary: r => 'decoded 2,546 records',
 *     convertNotes: r => ['3 records skipped: …'],          // shown as warnings
 *     extraLinks: r => [{label: 'Chart this', href: '…'}],
 *     isolate: true,                       // convert in its own Python process (long CPU-bound decodes)
 *   });
 * The page url may carry ?path= or ?src= to inspect a file at once.
 */
const AppUIConverterPage = (() => {
  const fmt = n => Number(n).toLocaleString('en-US');
  function el(tag, attrs, kids) {
    const n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(k => {
      if (k === 'text') n.textContent = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(c => c && n.appendChild(c));
    return n;
  }
  function create(opts = {}) {
    const container = typeof opts.container === 'string' ? document.querySelector(opts.container) : opts.container;
    if (!container) throw new Error('AppUIConverterPage: container required');
    const formats = opts.formats || ['parquet'], chosen = new Set(opts.defaults || formats.slice(0, 1));
    const viewers = opts.viewers || {}, folderFormats = opts.folderFormats || [];
    const key = 'appui.converter.path.' + opts.api;
    const top = el('div', {style: 'flex:none'});
    const note = el('div', {style: 'flex:none;padding:8px 12px 0;font-size:12px;white-space:pre-wrap;min-height:16px'});
    const body = el('div', {style: 'flex:1;min-height:0;overflow:auto;padding:0 12px 12px'});
    container.style.cssText += ';display:flex;flex-direction:column;height:100%;min-height:0';
    container.replaceChildren(top, note, body);
    let timer = 0, tablesMade = [];

    function status(text, bad) {
      clearInterval(timer); timer = 0;
      note.textContent = text; note.style.color = bad ? 'var(--danger,#e5534b)' : '';
      try { AppUI.setStatus(String(text).split('\n')[0]); } catch (e) { /* status bar is optional */ }
    }
    function busy(label) {
      const t0 = Date.now(); status(label + '…');
      timer = setInterval(() => { note.textContent = label + '… ' + Math.round((Date.now() - t0) / 1000) + ' s'; }, 1000);
    }
    function api(op, args) {
      return fetch(opts.api + op, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(args)})
        .then(r => r.json());
    }
    // The app id from its api prefix (/v1/apps/<group>/<name>/): convert runs as a
    // platform/work_runner job so the page shows its progress (percent + ETA when the
    // converter reports it, else what it has done so far) instead of a bare timer.
    const appId = (String(opts.api).match(/\/v1\/apps\/([^/]+\/[^/]+)\/?$/) || [])[1];
    const fmtSecs = s => s >= 90 ? Math.round(s / 60) + ' min' : Math.round(s) + ' s';
    function runConvert(args) {
      if (!appId || !window.AppUIApi || !AppUIApi.runJob || opts.background === false) return api('convert', args);
      const label = opts.convertLabel || 'converting', t0 = Date.now();
      return AppUIApi.runJob(appId, 'convert', args, {timeout: opts.jobTimeout || 7200, isolate: !!opts.isolate, onProgress: p => {
        clearInterval(timer); timer = 0;
        const secs = Math.round((Date.now() - t0) / 1000);
        let text = label + '… ' + secs + ' s';
        if (p && p.fraction != null) text = label + '… ' + Math.round(100 * p.fraction) + '%' +
          (p.eta_s != null ? ' · about ' + fmtSecs(p.eta_s) + ' left' : '') + ' · ' + secs + ' s';
        else if (p && p.detail) text = label + '… ' + p.detail + ' · ' + secs + ' s';
        note.textContent = text;
        try { AppUI.setStatus(text); } catch (e) { /* status bar is optional */ }
      }});
    }
    function source() {
      const v = pathInput.value.trim();
      if (!v) return null;
      try { localStorage.setItem(key, v); } catch (e) { /* optional */ }
      return /^vfs:\/\//.test(v) ? {src: v} : {path: v};
    }
    function clear() { tablesMade.forEach(t => t.destroy && t.destroy()); tablesMade = []; body.replaceChildren(); }
    function section(title, columns, rows) {
      body.appendChild(el('h4', {text: title, style: 'margin:14px 0 6px'}));
      const host = el('div', {style: 'max-height:46vh;overflow:auto;border:1px solid var(--border,#3f4147)'});
      body.appendChild(host);
      tablesMade.push(AppUIDataTable.create({container: host, columns, items: rows, maxRows: 2000,
        getId: row => row._id, empty: 'nothing to show', stickyHeader: true}));
    }
    function inspect() {
      const src = source(); if (!src) return;
      busy(opts.inspectLabel || 'reading the file'); clear();
      api('inspect', src).then(r => {
        if (!r.ok) return status(r._error || r.error || 'failed', true);
        status(opts.inspectSummary ? opts.inspectSummary(r) : 'done');
        (opts.inspectTables ? opts.inspectTables(r) : []).forEach(t =>
          section(t.title, t.columns.map(c => Object.assign({sortable: true}, c)), t.rows.map((x, i) => Object.assign({_id: i}, x))));
      }).catch(e => status(String(e.message || e), true));
    }
    function convert() {
      const src = source(); if (!src) return;
      if (!chosen.size) return status('choose at least one output format', true);
      busy(opts.convertLabel || 'converting'); clear();
      runConvert(Object.assign(src, {formats: Array.from(chosen), confirm: true})).then(r => {
        if (!r.ok) return status(r._error || r.error || 'failed', true);
        const notes = opts.convertNotes ? opts.convertNotes(r).filter(Boolean) : [];
        status((opts.convertSummary ? opts.convertSummary(r) : 'converted') + ' in ' + (r.elapsed_ms / 1000).toFixed(1) + ' s\n' +
          r.out_dir + (notes.length ? '\n' + notes.join('\n') : ''), false);
        const sep = r.out_dir.indexOf('\\') >= 0 ? '\\' : '/';
        const outs = [];
        Object.keys(r.outputs || {}).forEach(f => {
          const files = r.outputs[f];
          // an entry may be an object {path, label, folder?, viewer?} (a converter that
          // writes several output sets, e.g. one per part of a bundle)
          if (files.length && typeof files[0] === 'object') {
            files.forEach(o => outs.push({format: f, what: o.label || o.path.split(/[\\/]/).pop(), path: o.path, noViewer: o.viewer === false}));
          } else if (folderFormats.indexOf(f) >= 0) outs.push({format: f, what: files.length + ' files (folder)', path: r.out_dir + sep + f});
          else if (files.length === 1) outs.push({format: f, what: files[0].split(/[\\/]/).pop(), path: files[0]});
          else files.forEach(p => outs.push({format: f, what: p.split(/[\\/]/).pop(), path: p}));
        });
        section('Outputs', [{id: 'format', label: 'Format', sortable: true}, {id: 'what', label: 'File', sortable: true, filterable: true},
          {id: 'open', label: '', export: false, actions: row => viewers[row.format] && !row.noViewer
            ? [{label: 'Open in viewer', action: () => window.open(viewers[row.format] + '?path=' + encodeURIComponent(row.path), '_blank')}] : []}],
          outs.map((o, i) => Object.assign({_id: i}, o)));
        (opts.extraLinks ? opts.extraLinks(r) : []).forEach(l =>
          body.appendChild(el('p', {style: 'margin:8px 0'}, [el('a', {href: l.href, target: '_blank', text: l.label})])));
        section('Tables', [{id: 'name', label: 'Table', sortable: true, filterable: true},
          {id: 'rows', label: 'Rows', sortable: true}, {id: 'columns', label: 'Columns', sortable: true}],
          (r.tables || []).map((t, i) => Object.assign({_id: i}, t)));
      }).catch(e => status(String(e.message || e), true));
    }

    function browse() {
      const cur = String(pathInput.value || '').replace(/\\/g, '/').replace(/\/[^/]*$/, '');
      const go = () => AppUIFileDialog.open({title: 'Choose the input', startPath: cur, allowFolders: true,
        onSelect: p => { pathInput.value = p; inspect(); }});
      if (window.AppUIFileDialog) go();
      else if (window.AppUIAssets) AppUIAssets.load('fileDialog').then(go).catch(e => status(String(e.message || e), true));
    }
    const bar = AppUIToolbar.create({container: top, label: 'Input and output formats', items: [
      {type: 'input', id: 'appui-converter-path', placeholder: opts.hint || 'path of the file to convert'},
      {label: 'Browse…', title: 'Pick the input file or folder', action: () => browse()},
      {separator: true}
    ].concat(formats.map(f => ({type: 'checkbox', label: f, checked: chosen.has(f),
      onChange: on => { if (on) chosen.add(f); else chosen.delete(f); }}))).concat([
      {separator: true},
      {label: 'Inspect', title: 'Show what the file contains, without converting', action: inspect},
      {label: 'Convert', primary: true, title: 'Decode the file and write the chosen formats', action: convert}
    ])});
    const pathInput = bar.element.querySelector('#appui-converter-path');
    pathInput.removeAttribute('id'); pathInput.spellcheck = false;
    pathInput.style.cssText += ';width:min(44vw,620px);font-family:ui-monospace,Consolas,monospace';
    pathInput.addEventListener('keydown', e => { if (e.key === 'Enter') inspect(); });

    const q = new URLSearchParams(location.search), start = q.get('path') || q.get('src');
    if (start) { pathInput.value = start; inspect(); }
    else { try { pathInput.value = localStorage.getItem(key) || ''; } catch (e) { /* optional */ } status(opts.intro || 'Name a file, then Inspect or Convert.'); }
    return {inspect, convert, destroy() { clearInterval(timer); clear(); bar.destroy(); container.replaceChildren(); }};
  }
  return {create, fmt};
})();
window.AppUIConverterPage = AppUIConverterPage;
