// API reference: every tool of a group / app as an HTTP operation (POST /v1/apps/<app>/<op>, JSON body),
// built from the live catalog by the read-only `openapi` op. Filterable table, copy-as-curl, "Try" (opens the
// Try-It view) and an OpenAPI 3 JSON download.
export function mountApiView(root, actions, setStatus, { esc, catalog, onTry, onScope }) {
  root.classList.add('tc-api');
  root.innerHTML = '<div class="tc-api-bar"><label for="a-scope">Group or app</label>' +
    '<input id="a-scope" list="a-scopes" placeholder="e.g. platform or file/vfs" spellcheck="false"><datalist id="a-scopes"></datalist>' +
    '<button type="button" id="a-load" class="tc-primary">Show</button><button type="button" id="a-dl">Download OpenAPI JSON</button>' +
    '<span id="a-count" class="tc-dim"></span></div><div id="a-table" class="tc-api-table"></div>';
  const q = (id) => root.querySelector('#' + id);
  let doc = null, table = null, scope = '';
  catalog('groups', {}).then((r) => {
    const dl = q('a-scopes');
    for (const g of (r.groups || [])) {
      dl.appendChild(Object.assign(document.createElement('option'), { value: g.group }));
      for (const a of (g.apps || [])) dl.appendChild(Object.assign(document.createElement('option'), { value: a }));
    }
  });
  async function load(s) {
    scope = String(s == null ? q('a-scope').value : s).trim();
    q('a-scope').value = scope;
    if (!scope) { q('a-table').innerHTML = '<p class="tc-dim">Choose a group (e.g. <code>platform</code>) or an app (e.g. <code>file/vfs</code>).</p>'; q('a-count').textContent = ''; return; }
    onScope && onScope(scope);
    q('a-table').innerHTML = '<p class="tc-dim">building…</p>';
    const r = await catalog('openapi', { group: scope });
    if (!r.ok) { q('a-table').innerHTML = '<p class="tc-bad">' + esc(r._error || r.error || 'failed') + '</p>'; return; }
    doc = r.openapi;
    const rows = Object.keys(doc.paths).map((p) => {
      const o = doc.paths[p].post, props = o.requestBody.content['application/json'].schema.properties;
      return { path: p, id: o.operationId, safety: o['x-safety'], summary: o.summary,
               params: Object.keys(props).map((k) => k + ':' + (props[k].type || 'string')).join(', '), props };
    });
    q('a-count').textContent = rows.length + ' operation(s)';
    q('a-table').innerHTML = '';
    if (table && table.destroy) table.destroy();
    table = AppUIDataTable.create({ container: q('a-table'), items: rows, stickyHeader: true, maxRows: 1000,
      getId: (x) => x.id, empty: 'No tools in ' + scope,
      columns: [
        { id: 'id', label: 'Tool', sortable: true, filterable: true, width: '300px' },
        { id: 'safety', label: 'Safety', sortable: true, filterable: true, width: '90px' },
        { id: 'path', label: 'Endpoint', width: '300px' },
        { id: 'params', label: 'Parameters' },
        { id: 'summary', label: 'What it does' },
        { id: 'act', label: '', actions: (x) => [
          { label: 'Try', action: () => onTry(x.id) },
          { label: 'curl', title: 'copy a curl command', action: () => copy(curlFor(x)) }] },
      ] });
    setStatus(rows.length + ' operations in ' + scope);
  }
  function curlFor(x) {
    const body = {}; Object.keys(x.props).forEach((k) => { body[k] = '<' + (x.props[k].type || 'string') + '>'; });
    return 'curl -X POST ' + location.origin + x.path + " -H 'Content-Type: application/json' -d '" + JSON.stringify(body) + "'";
  }
  function copy(text) {
    const u = window.AppUI && AppUI.utils && AppUI.utils.core;
    if (u && u.copyText) u.copyText(text, { fallbackOnError: true }).then(() => setStatus('curl copied'));
    else if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => setStatus('curl copied'));
  }
  q('a-load').addEventListener('click', () => load());
  q('a-scope').addEventListener('keydown', (e) => { if (e.key === 'Enter') load(); });
  q('a-dl').addEventListener('click', () => {
    if (!doc) { setStatus('Show a group first'); return; }
    const name = 'openapi-' + (scope.replace(/[^\w.-]+/g, '_') || 'all') + '.json';
    const u = window.AppUI && AppUI.utils && AppUI.utils.core;
    if (u && u.downloadText) u.downloadText(JSON.stringify(doc, null, 2), name, 'application/json');
    else { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
  });
  load('');
  return { load, scope: () => scope };
}
