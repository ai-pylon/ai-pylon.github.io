import { refreshAll } from "./data.js";
import { showDetails } from "./details.js";
import { copy } from "./explorer.js";
import { byId, CATALOG, gmeta, isFav, openApp, page, pathOf, post, S, store, toggleFav, TREE } from "./state.js";
import { renderTreeBody, row, setTreeRoot, toolsOf } from "./tree.js";

// ------------------------------------------- tree right-click menu ------
// One delegated handler; the row's data-key says what it is:
//   g:<group path>   n:<app_id>   n:<app_id>.<op>
var ctxReady = null;
function showMenu(e, items){
  var pt = { x: e.clientX, y: e.clientY };
  if (!ctxReady) ctxReady = AppUIAssets.load('contextMenu');
  ctxReady.then(function(){ AppUIContextMenu.show(pt, items); })
    .catch(function(){ ctxReady = null; window.AppUIToast && AppUIToast.error('Context menu unavailable'); });
}
function toast(kind, msg){ try { window.AppUIToast && AppUIToast[kind](msg); } catch (_e) {} }
function setSubtree(path, open){
  S.apps.forEach(function(a){
    var ap = pathOf(a);
    if (ap !== path && ap.indexOf(path + '/') !== 0) return;
    var segs = ap.split('/'), acc = '';
    for (var i = 0; i < segs.length - 1; i++) { acc = acc ? acc + '/' + segs[i] : segs[i]; if (acc.length >= path.length) TREE.open['g:' + acc] = open; }
    if (!open) TREE.open['a:' + a.app_id] = false;
  });
  store('treeOpen', TREE.open); renderTreeBody();
}
function toggleTools(appId, open){ TREE.open['a:' + appId] = open; store('treeOpen', TREE.open); renderTreeBody(); }
function reloadApp(a){
  var go = function(){
    post('/v1/admin/reload/' + a.app_id, {}).then(function(r){
      if (r && r.ok !== false) { toast('success', 'Reloaded ' + a.title); refreshAll(true); }
      else toast('error', 'Reload failed: ' + ((r && (r._error || r.error)) || 'unknown'));
    }).catch(function(e){ toast('error', 'Reload failed: ' + e); });
  };
  var ask = window.AppUIDialog && AppUIDialog.confirmAsync
    ? AppUIDialog.confirmAsync('Hot-reload ' + a.title + ' (' + a.app_id + ')? Its module code is re-imported; in-flight work in that app may be interrupted.')
    : Promise.resolve(window.confirm('Hot-reload ' + a.app_id + '?'));
  ask.then(function(ok){ if (ok) go(); });
}
function showJson(title, obj){
  var pre = document.createElement('pre');
  pre.style.cssText = 'margin:0;max-height:65vh;overflow:auto;font:12px/1.5 var(--font-mono,ui-monospace,monospace);white-space:pre-wrap';
  pre.textContent = JSON.stringify(obj, null, 2);
  window.AppUIDialog && AppUIDialog.show({ title: title, body: pre, width: '760px', buttons: [{ text: 'Close' }] });
}
function runHealth(a){
  toast('info', 'Running ' + a.title + ' scenarios…');
  post('/v1/apps/platform/appui_guide/apps', { health: true, app_ids: [a.app_id] }).then(function(r){
    var row = (r.apps || []).filter(function(x){ return x.app_id === a.app_id; })[0] || {}, h = row.health;
    if (!h) { toast('warn', a.title + ' declares no scenarios' + (r._error ? ' (' + r._error + ')' : '')); return; }
    if (h.ok) toast('success', a.title + ': ' + h.passed + '/' + h.total + ' scenarios passed');
    else showJson(a.title + ': ' + h.passed + '/' + h.total + ' scenarios passed', h);
  }).catch(function(e){ toast('error', 'Health run failed: ' + e); });
}
function onTreeContext(e){
  var r = e.target.closest('.at-row'); if (!r) return;
  var key = r.getAttribute('data-key') || '';
  e.preventDefault();
  TREE.host.querySelectorAll('.at-row.ctx').forEach(function(x){ x.classList.remove('ctx'); });
  r.classList.add('ctx');
  var items = [];
  if (key.indexOf('g:') === 0) {
    var gp = key.slice(2), m = gp.indexOf('/') < 0 ? gmeta(gp) : null;
    items = [
      { label: '🧭  Explore ' + (m ? m.label : gp), action: function(){ page.explorer && page.explorer.open(CATALOG + '/' + gp); } },
      { label: '📌  Set as tree root', disabled: TREE.root === gp, action: function(){ setTreeRoot(gp); } },
      { label: '🏠  Show all apps', disabled: !TREE.root, action: function(){ setTreeRoot(''); } },
      { separator: true },
      { label: '⊞  Expand all', action: function(){ setSubtree(gp, true); } },
      { label: '⊟  Collapse all', action: function(){ setSubtree(gp, false); } },
      { separator: true },
      { label: '⧉  Copy path', action: function(){ copy(gp); } },
    ];
  } else if (key.indexOf('n:') === 0) {
    var id = key.slice(2), dot = id.indexOf('.'), appId = dot > 0 ? id.slice(0, dot) : id, op = dot > 0 ? id.slice(dot + 1) : '';
    var a = byId(appId); if (!a) return;
    var abs = a.url ? location.origin + a.url : '';
    if (op) {
      var o = (a.ops||[]).filter(function(x){ return x.name === op; })[0] || {};
      var tn = (o.tool_schema && o.tool_schema.name) || (appId + '.' + op);
      var curl = "curl -X POST " + location.origin + "/v1/apps/" + appId + "/" + op + " -H 'Content-Type: application/json' -d '{}'";
      items = [
        { label: (o.safety === 'confirm' ? '🔧  Open tool (writes — view only)' : '▶  Open tool & try it'),
          action: function(){ page.explorer && page.explorer.open(CATALOG + '/' + id); } },
        { label: '↗  Open ' + a.title + ' page (new tab)', disabled: !a.url, action: function(){ openApp(a); } },
        { label: '🧩  Explore ' + a.title, action: function(){ page.explorer && page.explorer.open(CATALOG + '/' + appId); } },
        { separator: true },
        { label: '⧉  Copy tool name', action: function(){ copy(tn); } },
        { label: '⧉  Copy curl command', action: function(){ copy(curl); } },
      ];
    } else {
      var tools = toolsOf(a).length, toolsOpen = !!TREE.open['a:' + appId];
      items = [
        { label: '↗  Open page (new tab)', disabled: !a.url, action: function(){ openApp(a); } },
        { label: '⇥  Open in this tab', disabled: !a.url, action: function(){ openApp(a, true); } },
        { label: '🧭  Explore in launchpad', action: function(){ page.explorer && page.explorer.open(CATALOG + '/' + appId); } },
        { label: '📌  Set as tree root', disabled: TREE.root === appId, action: function(){ setTreeRoot(appId); } },
        { label: '🏠  Show all apps', disabled: !TREE.root, action: function(){ setTreeRoot(''); } },
        { label: (toolsOpen ? '▾  Hide tools' : '▸  Show tools') + ' (' + tools + ')', disabled: !tools,
          action: function(){ toggleTools(appId, !toolsOpen); } },
        { separator: true },
        { label: isFav(appId) ? '★  Unpin from home' : '☆  Pin to home', action: function(){ toggleFav(appId); } },
        { label: 'ⓘ  Capabilities & prompts', action: function(){ showDetails(a); } },
        { separator: true },
        { label: '⧉  Copy app id', action: function(){ copy(appId); } },
        { label: '⧉  Copy page URL', disabled: !abs, action: function(){ copy(abs); } },
        { separator: true },
        { label: '🛠  Developer', submenu: [
          { label: '↻  Hot-reload app', action: function(){ reloadApp(a); } },
          { label: '🧪  Run scenarios (health)', action: function(){ runHealth(a); } },
          { label: '{ }  Describe (JSON)', action: function(){ showJson(a.title + ' — describe', a); } },
        ] },
      ];
    }
  }
  if (items.length) showMenu(e, items);
}
document.addEventListener('pointerdown', function(){
  if (TREE.host) TREE.host.querySelectorAll('.at-row.ctx').forEach(function(x){ x.classList.remove('ctx'); });
}, true);

export { showMenu, toast, setSubtree, toggleTools, reloadApp, showJson, runHealth, onTreeContext };
