import { mountChainEditor } from './chain-view.js?v=6';
import { mountDependencyGraph } from './dependency-view.js?v=7';
import { mountTryView } from './try-view.js?v=1';
import { mountApiView } from './api-view.js?v=1';
import { outputFields } from './chain-bindings.js?v=3';
/* Tool Catalog page (platform/tool_catalog) - built on the AppUI conventions:
 *
 *   layout   AppUI.createApp: menubar + menu, LEFT sidebar tabs (Tools = every tool, group > app > tool;
 *            Apps = the app/capability list of the dependency graph), CONTENT = a top bar (view nav +
 *            the active view's actions) and the view bodies, RIGHT = the AI assistant (manifest sidebars_shown),
 *            status bar.
 *   routes   AppUIRouter, short query names: ?view=tools|chain|graph|api  &tool=<id>  &group=<api scope>
 *            &node=<graph focus>. Every view change is a history entry; back/forward restore the view.
 *   calls    AppUI.services.api.operation (the shared op transport) - chain steps and Try-It call tools
 *            through the normal op edge; the catalog's own ops stay read-only.
 *
 * Views are mounted once, on first show, and kept: the chain survives switching views.
 * The left "Tools" list acts on the current view: Tools -> open the tool, Chain -> add a step,
 * API -> show the tool's app, Graph -> focus the tool's app.
 */
const APP = 'platform/tool_catalog', NS = 'tool_catalog';
const VIEWS = [['tools', 'Tools'], ['chain', 'Chain builder'], ['graph', 'Dependency graph'], ['api', 'API reference']];

const esc = (v) => AppUI.utils.text.esc(String(v == null ? '' : v));
async function callOp(appId, op, body) {
  const r = await AppUI.services.api.operation(appId, op, body || {});
  if (r && typeof r === 'object') return Object.assign({ ok: r.ok !== false && !r._error && !(r.error && r.ok !== true) }, r, { result: r });
  return { ok: false, _error: 'bad response', result: { _error: 'bad response' } };
}
const catalog = (op, body) => callOp(APP, op, body);
async function fetchApps() {
  const r = await AppUI.services.api.requestResponse('/v1/apps', undefined, { credentials: 'same-origin', timeout: null }).catch(() => null);
  return (r && r.data && r.data.apps) || [];
}
const SVGNS = 'http://www.w3.org/2000/svg';
function svgEl(name, attrs) { const e = document.createElementNS(SVGNS, name); for (const k in (attrs || {})) e.setAttribute(k, attrs[k]); return e; }
function svgText(x, y, text, cls, maxw) {
  const t = svgEl('text', { x, y, class: cls });
  let s = String(text || ''); if (maxw) { const max = Math.floor(maxw / 6.4); if (s.length > max) s = s.slice(0, max - 1) + '…'; }
  t.textContent = s; return t;
}
// a yes/no dialog as a promise (Cancel, Escape and the backdrop all answer "no")
function confirm(message) {
  return new Promise((resolve) => {
    let done = false; const answer = (v) => { if (!done) { done = true; resolve(v); } };
    const body = document.createElement('div'); body.style.whiteSpace = 'pre-wrap'; body.textContent = message;
    AppUI.components.Dialog.show({ title: 'Confirm', body, onClose: () => answer(false),
      buttons: [{ text: 'Yes', primary: true, action: () => answer(true) }, { text: 'Cancel', action: () => answer(false) }] });
  });
}

function boot() {
  for (const k of ['view', 'tool', 'group', 'node']) AppUIRouter.alias(NS, k, k);
  const S = { view: null, mounted: {}, actions: {}, bodies: {}, app: null, toolTree: null, tools: [] };
  const router = AppUIRouter.create(NS, () => show(router.get('view') || 'tools', { fromRoute: true }));
  const setStatus = (t) => { try { S.app && S.app.setStatus && S.app.setStatus(t); } catch (_e) { /* ignore */ } };
  const bus = window.AppUISelectionBus && AppUISelectionBus.scope ? AppUISelectionBus.scope(APP) : null;
  let chain = null, tryV = null, apiV = null;
  const appsHost = document.createElement('div'); appsHost.className = 'tc-side-host';
  // view bodies + their action bars exist before the shell renders (whatever order it renders regions in)
  for (const [id] of VIEWS) {
    const v = document.createElement('div'); v.className = 'tc-view'; v.hidden = true; v.dataset.view = id; S.bodies[id] = v;
    const a = document.createElement('div'); a.className = 'tc-acts'; a.hidden = true; S.actions[id] = a;
  }

  // ── views ───────────────────────────────────────────────────────────────────
  const mounters = {
    tools: (root, acts) => { tryV = mountTryView(root, acts, setStatus, { esc, catalog, callOp, confirm,
      onAddToChain: (id, args) => { show('chain'); chain.addStep(id, stringify(args)); setStatus('added ' + id + ' to the chain'); },
      onOpenTool: (id, preset) => openTool(id, preset) }); },
    chain: (root, acts) => { chain = mountChainEditor(root, acts, setStatus, { esc, catalog, callOp, svgEl, svgText, confirm }); },
    graph: (root, acts) => mountDependencyGraph(root, acts, setStatus, { fetchApps, esc, svgEl, svgText, listHost: appsHost }),
    api: (root, acts) => { apiV = mountApiView(root, acts, setStatus, { esc, catalog, onTry: (id) => openTool(id),
      onScope: (s) => { router.set('group', s, { replace: true, silent: true }); } }); },
  };
  const stringify = (args) => { const o = {}; for (const [k, v] of Object.entries(args || {})) o[k] = typeof v === 'object' ? JSON.stringify(v) : v; return o; };
  function ensure(view) {
    if (S.mounted[view]) return;
    S.mounted[view] = true;
    mounters[view](S.bodies[view], S.actions[view]);
  }
  function show(view, opts = {}) {
    if (!S.bodies[view]) view = 'tools';
    ensure(view);
    S.view = view;
    for (const [v] of VIEWS) { S.bodies[v].hidden = v !== view; S.actions[v].hidden = v !== view; }
    document.querySelectorAll('.tc-nav button').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
    if (!opts.fromRoute && router.get('view') !== (view === 'tools' ? null : view)) router.set('view', view === 'tools' ? '' : view, { silent: true });
    if (opts.fromRoute) applyRoute(view);
    document.dispatchEvent(new Event('tc-view'));
    // the left sidebar follows the view: the graph pairs with the Apps list, every other view with Tools
    const side = S.app && S.app.sidebars;
    if (side && side.activate) side.activate('left', view === 'graph' ? 'apps' : 'tools');
  }
  function applyRoute(view) {
    const tool = router.get('tool'), group = router.get('group'), node = router.get('node');
    if (view === 'tools' && tryV) tryV.open(tool || null);
    if (view === 'api' && apiV && group && apiV.scope() !== group) apiV.load(group);
    if (view === 'graph' && node && bus) setTimeout(() => bus.set({ kind: 'graph-node', id: node }), 0);
  }
  function openTool(id, preset) {
    show('tools');
    router.set('tool', id, { silent: true });
    tryV.open(id, preset);
    if (S.toolTree) S.toolTree.setActive(id);
  }
  // the left Tools list acts on the current view
  function pickTool(id) {
    const appId = id.slice(0, id.lastIndexOf('.'));
    if (S.view === 'chain') { chain.addStep(id); setStatus('added ' + id); }
    else if (S.view === 'api') { router.set('group', appId, { silent: true }); apiV.load(appId); }
    else if (S.view === 'graph') { router.set('node', appId, { silent: true }); if (bus) bus.set({ kind: 'graph-node', id: appId }); }
    else openTool(id);
  }
  if (bus) bus.subscribe((sel) => {                // the Apps tab / an assistant focus brings the graph forward
    if (sel && sel.kind === 'graph-node' && sel.id) {
      if (router.get('node') !== sel.id) router.set('node', sel.id, { replace: true, silent: true });
      if (S.view !== 'graph') show('graph');
    }
  });

  // ── left sidebar: Tools (every tool) ────────────────────────────────────────
  function renderTools(host) {
    const wrap = document.createElement('div'); wrap.className = 'tc-side-host';
    wrap.innerHTML = '<div class="tc-find"><input id="tc-filter" type="search" placeholder="Filter tools…" spellcheck="false" aria-label="Filter tools"></div>' +
      '<div class="tc-hint" id="tc-hint"></div><div class="tc-tools-tree" id="tc-tree"><div class="tc-dim">Loading tools…</div></div>';
    host.replaceChildren(wrap);
    const treeBox = wrap.querySelector('#tc-tree');
    const hint = () => { wrap.querySelector('#tc-hint').textContent = ({ chain: 'click or drag a tool to add a step', api: 'click a tool to show its app', graph: 'click a tool to focus its app' }[S.view]) || 'click a tool to try it'; };
    hint(); document.addEventListener('tc-view', hint);
    catalog('search', { query: '/./', limit: 5000 }).then((r) => {
      const seen = {}; S.tools = (r.tools || []).filter((t) => t && t.id && !seen[t.id] && (seen[t.id] = 1));
      const tree = {};
      for (const t of S.tools) {
        const appId = t.id.slice(0, t.id.lastIndexOf('.')); const g = t.group || 'other';
        ((tree[g] = tree[g] || {})[appId] = tree[g][appId] || []).push(t);
      }
      const roots = Object.keys(tree).sort().map((g) => ({ name: g, path: 'g:' + g, hasChildren: true,
        badge: String(Object.values(tree[g]).reduce((n, a) => n + a.length, 0)),
        children: Object.keys(tree[g]).sort().map((a) => ({ name: a.slice(g.length + 1) || a, path: 'a:' + a, hasChildren: true, badge: String(tree[g][a].length),
          children: tree[g][a].sort((x, y) => x.id.localeCompare(y.id)).map((t) => ({ name: t.id.slice(a.length + 1), path: t.id, hasChildren: false,
            title: t.id + (t.description ? ' - ' + t.description : ''), data: { toolId: t.id, write: t.safety === 'confirm', desc: String(t.description || '') } })) })) }));
      treeBox.innerHTML = '';
      S.toolTree = AppUI.components.Tree.create({ container: treeBox, draggable: true, storageKey: 'pylon2.catalog.tools.tree',
        matchFn: (node, qlc) => (node.name || '').toLowerCase().includes(qlc) || String((node.data && node.data.toolId) || node.path || '').toLowerCase().includes(qlc)
          || String((node.data && node.data.desc) || '').toLowerCase().includes(qlc),
        onDragStart: (node, e) => { if (node.data && node.data.toolId) e.dataTransfer.setData('text/plain', node.data.toolId); },
        decorateRow: (node, row) => { if (node.data && node.data.write) { const w = document.createElement('span'); w.className = 'wr'; w.textContent = 'write'; row.appendChild(w); } },
        onSelect: (node) => { if (!node.hasChildren && node.data && node.data.toolId) pickTool(node.data.toolId); } });
      S.toolTree.setRoots(roots);
      const t = router.get('tool'); if (t) { S.toolTree.expandTo(t); S.toolTree.setActive(t); }
      let ft = null;
      wrap.querySelector('#tc-filter').addEventListener('input', (e) => { clearTimeout(ft); const v = e.target.value; ft = setTimeout(() => S.toolTree.setFilter(v), 140); });
      setStatus(S.tools.length + ' tools');
    }).catch((e) => { treeBox.innerHTML = '<div class="tc-bad">Failed to load tools: ' + esc(e && e.message || e) + '</div>'; });
    return () => { if (S.toolTree && S.toolTree.destroy) S.toolTree.destroy(); S.toolTree = null; };
  }
  function renderApps(host) { host.replaceChildren(appsHost); ensure('graph'); }

  // ── shell ───────────────────────────────────────────────────────────────────
  S.app = AppUI.createApp({
    id: 'platform-tool_catalog', title: 'Tool Catalog', menubar: { theme: true }, statusBar: {},
    menu: {
      View: VIEWS.map(([id, label]) => ({ id: 'view:' + id, label })),
      Chain: [{ id: 'chain:run', label: 'Run chain' }, { id: 'chain:clear', label: 'Clear chain' }, { id: 'chain:save', label: 'Save chain…' }],
      Open: [{ id: 'open:profiler', label: 'Tool Profiler' }, { id: 'open:runner', label: 'Tool Runner (workflows)' }, { id: 'open:guides', label: 'Tool Guides' }],
    },
    onAction: (_m, id) => {
      const [kind, arg] = String(id).split(':');
      if (kind === 'view') show(arg);
      else if (kind === 'chain') { show('chain'); if (arg === 'run') chain.run(); else if (arg === 'clear') chain.clear(); else chain.save(); }
      else if (kind === 'open') location.href = { profiler: '/apps/platform/tool_profiler/', runner: '/apps/platform/tool_runner/', guides: '/apps/platform/tool_guides/' }[arg];
    },
    leftSidebar: { width: 300, tabs: [
      { id: 'tools', label: 'Tools', active: true, render: renderTools },
      { id: 'apps', label: 'Apps', render: renderApps },
    ] },
    content: {
      top: (host) => {
        const bar = document.createElement('div'); bar.className = 'tc-top';
        const nav = document.createElement('div'); nav.className = 'tc-nav'; nav.setAttribute('role', 'tablist');
        for (const [id, label] of VIEWS) {
          const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.dataset.view = id; b.setAttribute('role', 'tab');
          b.addEventListener('click', () => show(id));
          if (id === S.view) b.classList.add('on');
          nav.appendChild(b);
        }
        bar.appendChild(nav);
        for (const [id] of VIEWS) bar.appendChild(S.actions[id]);
        host.replaceChildren(bar);
      },
      body: (host) => {
        const views = document.createElement('div'); views.className = 'tc-views';
        for (const [id] of VIEWS) views.appendChild(S.bodies[id]);
        host.style.overflow = 'hidden'; host.replaceChildren(views);
        show(router.get('view') || 'tools', { fromRoute: 'init' });
        applyRoute(S.view);
      },
    },
  });

  if (S.view === 'graph' && S.app.sidebars && S.app.sidebars.activate) S.app.sidebars.activate('left', 'apps');

  // ── AI assistant: live hooks for the manifest chat profile ──────────────────
  const unregister = AppUIHostHooks.register('catalog.chain', {
    context: () => {
      const parts = ['Current view: ' + S.view + (tryV && tryV.current() ? ' (open tool: ' + tryV.current() + ')' : '') +
        (apiV && apiV.scope() ? ' · API scope: ' + apiV.scope() : '')];
      const snap = chain && chain.snapshot();
      if (snap && snap.steps.length) {
        parts.push('Current chain (' + snap.steps.length + ' steps' + (snap.selected ? ', selected step ' + snap.selected : '') + '):\n' +
          snap.steps.map((s) => '  step ' + s.n + ': ' + s.tool + ' ' + JSON.stringify(s.params) +
            (s.routes.length ? '\n    routed in: ' + s.routes.join('; ') : '') +
            (s.output_fields ? '\n    output fields (last run): ' + s.output_fields.join(', ') : '') +
            (s.status ? '\n    last run: ' + s.status : '')).join('\n') +
          (snap.issues.length ? '\nRouting problems:\n  ' + snap.issues.join('\n  ') : ''));
      } else parts.push('Current chain: (empty)');
      const sel = bus && bus.get();
      if (sel && sel.id) parts.push('Dependency graph focus: ' + sel.id + (sel.label ? ' (' + sel.label + ')' : ''));
      return parts.join('\n\n');
    },
    onAction: (type, payload) => {
      payload = payload || {};
      if (type === 'chain.set' || type === 'chain.append') {
        const recs = (Array.isArray(payload.steps) ? payload.steps : []).filter((s) => s && s.tool).map((s) => ({ tool: String(s.tool), params: s.params || {} }));
        if (!recs.length) return false;
        show('chain');
        const p = type === 'chain.set' ? chain.hydrate(recs) : chain.append(recs);
        p.then(() => setStatus((type === 'chain.set' ? 'Assistant set a ' : 'Assistant added ') + recs.length + ' step' + (recs.length === 1 ? '' : 's') + (type === 'chain.set' ? ' chain' : '')));
        return true;
      }
      if (type === 'catalog.focus') {
        const id = payload.id || payload.node;
        if (!id) return false;
        show('graph');
        if (bus) setTimeout(() => bus.set({ kind: 'graph-node', id: String(id) }), 0);
        return true;
      }
      if (type === 'tool.open' && (payload.id || payload.tool)) { openTool(String(payload.id || payload.tool), payload.args || null); return true; }
      return false;
    },
    confirmAction: (type) => {
      if (type === 'chain.set' && chain && chain.count()) return 'Replace the current ' + chain.count() + '-step chain?';
      return null;
    },
  });
  let disposeSidebars = null, dock = null;
  AppUIAssets.load('aiSidebar')
    .then(() => AppUIPanelApp.mountDeclaredSidebars({ appId: APP }))
    .then((d) => {
      disposeSidebars = d;
      const right = document.getElementById('app-right');
      if (right && window.AppUIChatPanel && AppUIChatPanel.rememberDock) dock = AppUIChatPanel.rememberDock(right, 'pages/platform_tool_catalog');
    }).catch(() => { /* the page works without the assistant */ });
  window.addEventListener('pagehide', () => {
    try { dock && dock.stop(); } catch (_e) { /* ignore */ }
    try { disposeSidebars && disposeSidebars(); } catch (_e) { /* ignore */ }
    try { unregister(); } catch (_e) { /* ignore */ }
  });
  // automation / live-verify handle (read-mostly; the same surface the assistant drives)
  window.__toolCatalog = { show, openTool, chain: () => chain, view: () => S.view, outputFields };
}

boot();
