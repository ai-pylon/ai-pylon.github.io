import { byId, CATALOG, esc, gmeta, missingCaps, noteOpen, page, pathOf, S, store, TREE } from "./state.js";
import { onTreeContext } from "./tree-menu.js";

// ------------------------------------------------- left-sidebar tree ----
// Built locally from /v1/apps (no extra calls): groups from the app_id path,
// apps as rows (readiness dot + page link), each app expandable to its LLM
// tools. Clicking any row navigates the VIS explorer; the explorer's current
// node is highlighted + revealed here (two views of one place).

function treeData(){
  var root = { kids: {}, apps: [] };
  S.apps.forEach(function(a){
    var segs = pathOf(a).split('/'), leaf = segs.pop(), node = root, path = '';
    segs.forEach(function(sg){ path = path ? path + '/' + sg : sg; node.kids[sg] = node.kids[sg] || { kids: {}, apps: [], path: path }; node = node.kids[sg]; });
    node.apps.push({ seg: leaf, a: a });
  });
  return root;
}
function toolsOf(a){ return (a.ops||[]).filter(function(o){ return o.tool; }); }
function treeMatch(a){
  if (!TREE.q) return true;
  var q = TREE.q.toLowerCase();
  if ((a.app_id + ' ' + (a.title||'')).toLowerCase().indexOf(q) >= 0) return true;
  return toolsOf(a).some(function(o){ return ((o.tool_schema && o.tool_schema.name) || o.name).toLowerCase().indexOf(q) >= 0; });
}
function treeToolMatch(a, o){
  if (!TREE.q) return true;
  var q = TREE.q.toLowerCase();
  if ((a.app_id + ' ' + (a.title||'')).toLowerCase().indexOf(q) >= 0) return true;
  return ((o.tool_schema && o.tool_schema.name) || o.name).toLowerCase().indexOf(q) >= 0;
}
function countIn(node){
  var n = node.apps.filter(function(it){ return treeMatch(it.a); }).length;
  Object.keys(node.kids).forEach(function(k){ n += countIn(node.kids[k]); });
  return n;
}
function isOpen(key, dflt){ return TREE.q ? true : (key in TREE.open ? TREE.open[key] : dflt); }
function setOpen(key, v){ TREE.open[key] = v; store('treeOpen', TREE.open); }
function row(cls, depth, html, key){
  var r = document.createElement('div'); r.className = 'at-row ' + cls; r.style.paddingLeft = (6 + depth * 12) + 'px';
  if (key) r.setAttribute('data-key', key);
  r.innerHTML = html; return r;
}
// ------------------------------------------------ URL routes (framework) --
// The tree's ROOT (?tree=<group path | app id>) and FILTER (?tq=<text>) live in
// the URL through AppUIRouter — the same router the VIS explorer uses for the
// content node (?vis=<uri>) — so a scoped tree is deep-linkable, survives a
// refresh, and back/forward restore it (AppUIRouter's onRoute on popstate).
var _router = null;
function treeRouter(){
  if (!_router && window.AppUIRouter && AppUIRouter.create) {
    AppUIRouter.alias('home', 'root', 'tree');
    AppUIRouter.alias('home', 'tq', 'tq');
    _router = AppUIRouter.create('home', onTreeRoute);   // page-lifetime (the tree outlives a dashboard re-render)
  }
  return _router;
}
function routedRoot(){
  var r = treeRouter(), v = r ? (r.get('root') || '') : '';
  return String(v).replace(/^\/+|\/+$/g, '');
}
function onTreeRoute(){
  var r = treeRouter(); if (!r) return;
  var root = routedRoot(), q = r.get('tq') || '';
  if (root === TREE.root && q === TREE.q) return;
  TREE.root = root; TREE.q = q;
  var s = TREE.host && TREE.host.querySelector('.at-search'); if (s && s.value !== q) s.value = q;
  renderTreeBody();
}
// Scope the tree to `path` ('' = everything) and show that node in the content area.
// One history entry: if the explorer already pushed its ?vis= change, the root is
// folded into that entry (replace); otherwise the root change is its own entry.
function setTreeRoot(path){
  path = String(path || '').replace(/^\/+|\/+$/g, '');
  TREE.root = path;
  renderTreeBody();
  var r = treeRouter();
  var before = location.href;
  var done = function(){ if (r) r.set('root', path, { replace: location.href !== before, silent: true }); };
  if (page.explorer) Promise.resolve(page.explorer.open(path ? CATALOG + '/' + path : CATALOG)).then(done, done);
  else done();
}
function setTreeFilter(q){
  TREE.q = q;
  var r = treeRouter(); if (r) r.set('tq', q, { replace: true, silent: true });
  renderTreeBody();
}

// The subtree under TREE.root: a group path → that group's node; an app id → a
// node holding just that app (its tools open); unknown → null.
function rootNode(full){
  if (!TREE.root) return full;
  if (byId(TREE.root)) return { kids: {}, apps: [{ seg: TREE.root.split('/').pop(), a: byId(TREE.root) }], path: TREE.root };
  var node = full;
  TREE.root.split('/').forEach(function(sg){ node = node && node.kids[sg]; });
  return node || null;
}
function renderCrumbs(){
  var el = TREE.host && TREE.host.querySelector('.at-crumbs'); if (!el) return;
  if (!TREE.root) { el.hidden = true; el.innerHTML = ''; return; }
  var segs = TREE.root.split('/'), acc = '', h = '<a data-root="" title="Show every app">🏠 All</a>';
  segs.forEach(function(sg, i){
    acc = acc ? acc + '/' + sg : sg;
    var m = i === 0 ? gmeta(sg) : null;
    h += '<span class="sep">▸</span>' + (i === segs.length - 1
      ? '<b title="' + esc(acc) + '">' + esc(m ? m.label : sg) + '</b>'
      : '<a data-root="' + esc(acc) + '" title="Scope the tree to ' + esc(acc) + '">' + esc(m ? m.label : sg) + '</a>');
  });
  el.innerHTML = h; el.hidden = false;
}

function treeNode(node, depth){
  var frag = document.createDocumentFragment();
  Object.keys(node.kids).sort().forEach(function(name){
    var ch = node.kids[name], n = countIn(ch); if (!n) return;
    var key = 'g:' + ch.path, open = isOpen(key, depth === 0), m = (depth === 0 && !TREE.root) ? gmeta(name) : null;
    var r = row('grp', depth, '<span class="at-tw' + (open ? ' open' : '') + '">▸</span>' + (m ? '<span>' + m.icon + '</span>' : '') +
      '<span class="nm">' + esc(m ? m.label : name) + '</span><span class="at-cnt">' + n + '</span>', key);
    var kids = document.createElement('div'); kids.className = 'at-kids-wrap';
    if (!open) kids.style.display = 'none'; else kids.appendChild(treeNode(ch, depth + 1));
    r.onclick = function(e){
      var nowOpen = kids.style.display === 'none';
      // caret: just fold/unfold. Label: unfold (never fold away the place you
      // are going) and navigate the explorer to the group.
      var onCaret = !!e.target.closest('.at-tw');
      if (onCaret || nowOpen) {
        kids.style.display = nowOpen ? '' : 'none';
        if (nowOpen && !kids.childNodes.length) kids.appendChild(treeNode(ch, depth + 1));
        r.querySelector('.at-tw').classList.toggle('open', nowOpen); setOpen(key, nowOpen);
      }
      if (!onCaret && page.explorer) page.explorer.open(CATALOG + '/' + ch.path);
    };
    frag.appendChild(r); frag.appendChild(kids);
  });
  node.apps.slice().sort(function(x, y){ return x.seg.localeCompare(y.seg); }).forEach(function(it){
    var a = it.a; if (!treeMatch(a)) return;
    var tools = toolsOf(a), key = 'a:' + a.app_id, open = isOpen(key, TREE.root === a.app_id) && tools.length;
    var ready = !missingCaps(a).length;
    var r = row('app', depth, '<span class="at-tw' + (tools.length ? '' : ' none') + (open ? ' open' : '') + '">▸</span>' +
      '<span class="dot ' + (ready ? 'ready' : 'bad') + '" title="' + (ready ? 'ready' : 'missing: ' + esc(missingCaps(a).join(', '))) + '"></span>' +
      '<span class="nm" title="' + esc(a.title + ' — ' + a.app_id) + '">' + esc(it.seg) + '</span>' +
      (tools.length ? '<span class="at-cnt">' + tools.length + '</span>' : '') +
      (a.url ? '<a class="pg" href="' + esc(a.url) + '" target="_blank" rel="noopener" title="Open the app page in a new tab">↗</a>' : ''), 'n:' + a.app_id);
    var kids = document.createElement('div');
    if (!open) kids.style.display = 'none'; else kids.appendChild(treeTools(a, depth + 1));
    r.onclick = function(e){
      if (e.target.closest('a.pg')) { noteOpen(a); return; }
      if (e.target.closest('.at-tw') && tools.length) {
        var nowOpen = kids.style.display === 'none';
        kids.style.display = nowOpen ? '' : 'none';
        if (nowOpen && !kids.childNodes.length) kids.appendChild(treeTools(a, depth + 1));
        r.querySelector('.at-tw').classList.toggle('open', nowOpen); setOpen(key, nowOpen);
        return;
      }
      if (page.explorer) page.explorer.open(CATALOG + '/' + a.app_id);
    };
    frag.appendChild(r); frag.appendChild(kids);
  });
  return frag;
}
// Multi-level tools: a dotted op name nests (knowledge/workspace's
// workspace.rag.code.build_index → rag ▸ code ▸ build_index), the same rule as the
// catalog's VIS tree (platform/tool_catalog impl/vis.py op_segments): a leading segment
// that repeats the app's own name is dropped. A namespace row's VIS path is
// '<app_id>:<ns.path>'.
function opSegs(a, o){
  var segs = String(o.name || '').split('.').filter(Boolean);
  var base = a.app_id.split('/').pop();
  if (segs.length > 1 && (segs[0] === base || segs[0] === base.replace(/-/g, '_'))) segs.shift();
  return segs.length ? segs : [o.name];
}
function treeTools(a, depth, prefix){
  prefix = prefix || [];
  var frag = document.createDocumentFragment(), n = prefix.length, subs = {}, leaves = [];
  toolsOf(a).forEach(function(o){
    if (!treeToolMatch(a, o)) return;
    var segs = opSegs(a, o);
    if (segs.length <= n || segs.slice(0, n).join('.') !== prefix.join('.')) return;
    if (segs.length === n + 1) leaves.push(o);
    else (subs[segs[n]] = subs[segs[n]] || []).push(o);
  });
  Object.keys(subs).sort().forEach(function(seg){
    var p = prefix.concat([seg]), nsPath = a.app_id + ':' + p.join('.'), key = 'ns:' + nsPath;
    var open = isOpen(key, false);
    var r = row('grp ns', depth, '<span class="at-tw' + (open ? ' open' : '') + '">▸</span><span>📂</span>' +
      '<span class="nm">' + esc(seg) + '</span><span class="at-cnt">' + subs[seg].length + '</span>', 'n:' + nsPath);
    r.title = a.app_id + ' · ' + p.join('.') + ' (' + subs[seg].length + ' tools)';
    var kids = document.createElement('div'); kids.className = 'at-kids-wrap';
    if (!open) kids.style.display = 'none'; else kids.appendChild(treeTools(a, depth + 1, p));
    r.onclick = function(e){
      var nowOpen = kids.style.display === 'none', onCaret = !!e.target.closest('.at-tw');
      if (onCaret || nowOpen) {
        kids.style.display = nowOpen ? '' : 'none';
        if (nowOpen && !kids.childNodes.length) kids.appendChild(treeTools(a, depth + 1, p));
        r.querySelector('.at-tw').classList.toggle('open', nowOpen); setOpen(key, nowOpen);
      }
      if (!onCaret && page.explorer) page.explorer.open(CATALOG + '/' + nsPath);
    };
    frag.appendChild(r); frag.appendChild(kids);
  });
  leaves.forEach(function(o){
    var label = n ? opSegs(a, o)[n] : o.name;
    var r = row('tool', depth, '<span class="at-tw none">▸</span><span class="nm">' + esc(label) + '</span>' +
      (o.safety === 'confirm' ? '<span class="w" title="writes">✏️</span>' : ''), 'n:' + a.app_id + '.' + o.name);
    r.title = o.name + ' — ' + ((o.tool_schema && o.tool_schema.description) || o.description || '');
    r.onclick = function(){ if (page.explorer) page.explorer.open(CATALOG + '/' + a.app_id + '.' + o.name); };
    frag.appendChild(r);
  });
  return frag;
}
function renderTree(){
  if (!TREE.host) return;
  var wrap = TREE.host.querySelector('.at-wrap'), body;
  if (!wrap) {
    TREE.root = routedRoot();                        // deep link: ?tree=<path>&tq=<filter>
    var rq = treeRouter() && treeRouter().get('tq'); if (rq) TREE.q = rq;
    TREE.host.innerHTML = '';
    wrap = document.createElement('div'); wrap.className = 'at-wrap';
    var search = document.createElement('input'); search.className = 'at-search';
    search.placeholder = 'Filter apps & tools…'; search.value = TREE.q;
    TREE.host.appendChild(wrap);
    var owner = window.AppUILifecycle.createViewScope({host: wrap});
    var filterLater = window.AppUILifecycle.debounce(function () { setTreeFilter(search.value.trim()); }, 100);
    owner.add(filterLater.destroy);
    owner.listen(search, 'input', filterLater);
    owner.listen(search, 'keydown', function(e){ if (e.key === 'Escape') { filterLater.cancel(); search.value = ''; setTreeFilter(''); } });
    body = document.createElement('div'); body.className = 'at-body';
    owner.listen(body, 'contextmenu', onTreeContext);
    var crumbs = document.createElement('div'); crumbs.className = 'at-crumbs'; crumbs.hidden = true;
    owner.listen(wrap, 'click', function(e){
      var a = e.target.closest('[data-root]'); if (a && wrap.contains(a)) setTreeRoot(a.getAttribute('data-root'));
    });
    wrap.appendChild(search); wrap.appendChild(crumbs); wrap.appendChild(body);
  }
  renderTreeBody();
}
function renderTreeBody(){
  var body = TREE.host && TREE.host.querySelector('.at-body'); if (!body) return;
  renderCrumbs();
  if (!S.apps.length) { body.innerHTML = '<div class="at-empty">' + (S.loaded ? 'No apps.' : 'Loading…') + '</div>'; return; }
  var start = rootNode(treeData());
  if (!start) {
    body.innerHTML = '<div class="at-empty">No app or group “' + esc(TREE.root) + '”. <a data-root="">Show all</a></div>';
    return;
  }
  body.replaceChildren(treeNode(start, 0));
  if (!body.childNodes.length) body.innerHTML = '<div class="at-empty">No match.</div>';
  syncTree(false);
}
// Highlight the explorer's current node; open its ancestors so it's visible.
function syncTree(reveal){
  if (!TREE.host) return;
  var cur = page.explorer && page.explorer.mode() === 'node' && page.explorer.current();
  var path = cur && page.vis.providerOf(cur.uri) === 'tool_catalog' ? (cur.path || '') : '';
  TREE.sel = path;
  TREE.host.querySelectorAll('.at-row.sel').forEach(function(x){ x.classList.remove('sel'); });
  if (!path) return;
  // a tool '<app>.<op>' or a namespace '<app>:<ns>' — both live inside an app (tool ids keep the APP ID even
  // when the app is browsed at a category path); an app node itself arrives at its BROWSE path
  // ('ericsson/docs/cpi' for ericsson/cpi), so map a browse path back to its app
  var isNs = path.indexOf(':') > 0;
  var head = isNs ? path.split(':')[0] : path.split('.')[0], isTool = isNs || path.indexOf('.') > 0, changed = false;
  var aHit = byId(head) || S.apps.filter(function(x){ return pathOf(x) === head; })[0] || null;
  var appId = aHit ? aHit.app_id : head;
  if (reveal) {
    var segs = (aHit ? pathOf(aHit) : head).split('/'), acc = '';
    for (var i = 0; i < segs.length - (aHit ? 1 : 0); i++) {
      acc = acc ? acc + '/' + segs[i] : segs[i];
      if (!isOpen('g:' + acc, i === 0)) { setOpen('g:' + acc, true); changed = true; }
    }
    if (isTool && !isOpen('a:' + appId, false)) { setOpen('a:' + appId, true); changed = true; }
    // open the namespaces on the way down to the node
    var a0 = byId(appId), segs0 = null;
    if (isNs) segs0 = path.split(':')[1].split('.').filter(Boolean).concat(['']);
    else if (isTool && a0) segs0 = opSegs(a0, { name: path.slice(appId.length + 1) });
    for (var k = 1; segs0 && k < segs0.length; k++) {
      var nsKey = 'ns:' + appId + ':' + segs0.slice(0, k).join('.');
      if (!isOpen(nsKey, false)) { setOpen(nsKey, true); changed = true; }
    }
    if (changed) {
      renderTreeBody();   // re-selects; scroll after the rebuild so it's in view
      var s2 = TREE.host.querySelector('.at-row.sel'); if (s2) s2.scrollIntoView({ block: 'nearest' });
      return;
    }
  }
  var key = aHit ? 'n:' + (isTool ? path : appId) : 'g:' + path;
  var el = TREE.host.querySelector('.at-row[data-key="' + key.replace(/"/g, '') + '"]');
  if (el) { el.classList.add('sel'); if (reveal) el.scrollIntoView({ block: 'nearest' }); }
}

export { setTreeRoot, setTreeFilter, treeRouter, opSegs, treeData, toolsOf, treeMatch, treeToolMatch, countIn, isOpen, setOpen, row, treeNode, treeTools, renderTree, renderTreeBody, syncTree };
