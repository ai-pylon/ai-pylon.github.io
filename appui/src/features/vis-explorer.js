/* AppUIVisExplorer — a navigable browser over the VIS layer (knowledge/vis).
 *
 * VIS exposes any hierarchy (the tool catalog, the MOM, a doc set…) as
 * vis://<provider>/<path> nodes with open / expand / search operators. This
 * component turns that into a UI any page can mount: provider switch,
 * breadcrumbs, a node header, children as cards (a group-of-groups root renders
 * as SECTIONS via one expand depth=2 call), a search mode, and a leaf detail
 * view. Everything is data-driven — a new app/tool/provider appears without
 * any page change.
 *
 *   const vx = AppUIVisExplorer.create({
 *     container: host,
 *     uri: 'vis://tool_catalog',          // start node (default: first provider root)
 *     providers: true,                    // show the provider switch
 *     route: 'home',                      // deep-link the current node via AppUIRouter
 *                                         //   (?appui.home.node=<uri>; back/forward work)
 *     routeAlias: 'vis',                  // optional short query name (?vis=<uri>)
 *     layout: 'grid' | 'list',
 *     decorate(node, ctx) {               // optional per-node presentation hook
 *       return {icon, hue, title, subtitle, badges:[html], actions:[{label, href|run, title, primary, cls}],
 *               // a node's own `links` [{label, href, title}] (from the provider) are
 *               // appended to the header actions automatically, opening in a new tab
 *               hidden, onClick};         // onClick(e) returning true = handled
 *     },
 *     renderLeaf(node, el, vx) {},        // optional: append extra UI to a leaf's detail
 *     renderMissing(uri, reply, el, vx) {}, // optional: the provider has no such node — render
 *                                         //   the page's own view into el and return true
 *                                         //   (it then becomes the current, routed node)
 *     onNavigate(node, vx) {},            // after a node (or search) renders
 *   });
 *   vx.open(uri); vx.search(q); vx.rerender(); vx.setLayout('list'); vx.current(); vx.destroy();
 */
const AppUIVisExplorer = (() => {
  const API = '/v1/apps/knowledge/vis/';
  const KIND_ICON = {group: '📁', app: '🧩', namespace: '📂', tool: '🔧', node_type: '🗂️', moc: '📦', attribute: '🏷️',
    doc: '📄', section: '§', file: '📄', folder: '📁'};
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  }
  function defaultApi(op, args) {
    return fetch(API + op, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(args || {})})
      .then(r => r.json());
  }
  function providerOf(uri) { const m = /^vis:\/\/([^/]+)/.exec(uri || ''); return m ? m[1] : ''; }

  function create(opts = {}) {
    if (!opts.container) throw new Error('AppUIVisExplorer.create requires a container');
    _AppUIVisExplorerStyles.inject();
    const api = opts.api || defaultApi;
    // Deep links go through AppUI's URL router (namespaced query params), never a
    // hand-rolled hash: ?appui.<route>.node=<uri>, or ?<routeAlias>=<uri>.
    let router = null;
    const scope = window.AppUILifecycle ? AppUILifecycle.createScope() : null;
    const root = document.createElement('div');
    root.className = 'vx' + (opts.layout === 'list' ? ' list' : '');
    opts.container.appendChild(root);
    root.innerHTML = '<div class="vx-top" data-r="prov"></div><div class="vx-crumbs" data-r="crumbs"></div>' +
      '<div data-r="head"></div><div data-r="body"></div>';
    const R = k => root.querySelector('[data-r="' + k + '"]');

    let providers = [];
    let cur = null;          // last opened node (open result)
    let mode = 'node';       // 'node' | 'search'
    let lastQuery = '';
    let seq = 0;             // drops stale responses
    let destroyed = false;
    const sectionCache = new Map();   // uri -> expand(depth 2) result

    const view = _AppUIVisExplorerView.create({
      opts, R, api, sectionCache, open,
      getState: () => ({providers, cur, mode, lastQuery, seq, destroyed}),
      getApi: () => api_, kindIcon: kind => KIND_ICON[kind] || '•', esc, providerOf,
    });
    const {grid, msg, renderProviders, renderCrumbs, renderHead, renderBody} = view;

    function routeSet(uri) {
      if (router && router.get('node') !== uri) router.set('node', uri, {silent: true});
    }
    function routeUri() { return router ? (router.get('node') || '') : ''; }

    async function open(uri, {push = true} = {}) {
      if (destroyed) return;
      const my = ++seq;
      mode = 'node';
      R('body').innerHTML = cur ? R('body').innerHTML : msg('⏳', 'Loading…');
      root.style.opacity = '.6';
      let r;
      // a UI can show far more than the LLM-sized default content budget
      try { r = await api('open', {uri, budget: opts.contentBudget || 20000}); } catch (e) { r = {ok: false, error: String(e)}; }
      if (my !== seq || destroyed) return;
      root.style.opacity = '';
      if (!r || !r.ok) {
        // renderMissing(uri, reply, bodyEl, vx) → true = the page rendered its own view of a
        // node the provider doesn't have (e.g. an app with no LLM tools isn't in the tool
        // catalog). The node still becomes current + routed, so breadcrumbs / a companion
        // tree / back-forward stay in step with the URL.
        if (opts.renderMissing) {
          const base = (/^vis:\/\/[^/]+/.exec(uri) || [''])[0];
          const segs = String(uri).slice(base.length).replace(/^\/+/, '').split('/').filter(Boolean);
          const ancestors = [{uri: base, path: '', title: providerOf(uri), kind: 'group'}].concat(
            segs.slice(0, -1).map((s, i) => ({uri: base + '/' + segs.slice(0, i + 1).join('/'),
              path: segs.slice(0, i + 1).join('/'), title: s, kind: 'group'})));
          const stub = {uri, path: segs.join('/'), kind: 'missing', title: segs[segs.length - 1] || uri,
            ancestors, error: (r && (r.error || r._error)) || ''};
          R('head').innerHTML = '';
          let handled = false;
          try { handled = opts.renderMissing(uri, r, R('body'), api_) === true; } catch (_e) { handled = false; }
          if (handled) {
            cur = stub;
            if (push) routeSet(uri);
            renderProviders(); renderCrumbs(stub);
            if (opts.onNavigate) opts.onNavigate(stub, api_);
            return;
          }
        }
        R('head').innerHTML = '';
        R('body').innerHTML = msg('⚠️', esc((r && (r.error || r._error)) || 'could not open ' + uri));
        return;
      }
      // `open` returns no `path` (children/ancestors do) — derive it so the
      // node, header and decorate() all see the same shape.
      if (r.path == null) r.path = String(r.uri || uri).replace(/^vis:\/\/[^/]+\/?/, '');
      cur = r;
      if (push) routeSet(r.uri);
      renderProviders(); renderCrumbs(r); renderHead(r);
      await renderBody(r, my);
      if (my === seq && opts.onNavigate) opts.onNavigate(r, api_);
    }
    async function search(q, {under} = {}) {
      q = (q || '').trim();
      if (!q) { if (mode === 'search' && cur) return open(cur.uri, {push: false}); return; }
      const my = ++seq;
      mode = 'search'; lastQuery = q;
      const where = under || (cur ? 'vis://' + providerOf(cur.uri) : undefined);
      let r;
      try { r = await api('search', {query: q, under: where, limit: opts.searchLimit || 40}); } catch (e) { r = {ok: false, error: String(e)}; }
      if (my !== seq || destroyed) return;
      renderCrumbs(cur || {});
      R('head').innerHTML = '';
      const body = R('body');
      if (!r || !r.ok) { body.innerHTML = msg('⚠️', esc((r && r.error) || 'search failed')); return; }
      const hits = r.hits || [];
      if (!hits.length) { body.innerHTML = msg('🔭', 'No matches for “' + esc(q) + '” in ' + esc(r.provider || 'this provider') + '.'); }
      else {
        const g = grid(hits, {search: true});
        body.replaceChildren(g.el);
      }
      if (opts.onNavigate) opts.onNavigate({search: q, hits, provider: r.provider}, api_);
    }

    // back/forward: AppUIRouter calls onRoute on popstate → open the routed node
    if (opts.route && window.AppUIRouter) {
      if (opts.routeAlias) AppUIRouter.alias(opts.route, 'node', opts.routeAlias);
      router = AppUIRouter.create(opts.route, () => {
        const u = routeUri() || opts.uri || '';
        if (u && (!cur || u !== cur.uri || mode !== 'node')) open(u, {push: false});
      });
      if (scope) scope.add(() => router.destroy());
    }

    const api_ = {
      open, search,
      rerender() {
        if (!cur) return;
        if (mode === 'search') return search(lastQuery);
        renderProviders(); renderCrumbs(cur); renderHead(cur); return renderBody(cur, seq);
      },
      refresh() { sectionCache.clear(); return cur ? open(cur.uri, {push: false}) : undefined; },
      setLayout(l) { root.classList.toggle('list', l === 'list'); },
      current() { return cur; },
      mode() { return mode; },
      providers() { return providers.slice(); },
      api,
      el: root,
      destroy() {
        destroyed = true;
        if (scope) scope.destroy(); else if (router) router.destroy();
        root.remove();
      },
    };

    (async () => {
      try {
        const pr = await api('providers', {});
        providers = (pr && pr.providers) || [];
      } catch (_e) { providers = []; }
      if (destroyed) return;
      const start = routeUri() || opts.uri || (providers[0] && providers[0].root);
      if (start) open(start, {push: false});
      else R('body').innerHTML = msg('🔌', 'No VIS providers are registered.');
    })();
    return api_;
  }
  // kindIcon: the explorer's per-kind icon, so a companion tree matches it
  return {create, providerOf, kindIcon: kind => KIND_ICON[kind] || '•'};
})();
window.AppUIVisExplorer = AppUIVisExplorer;
