import { renderBar } from "./bar.js";
import { renderShelf } from "./dashboard.js";

var page = {app:null, explorer:null, viewScope:null, vis:{ providerOf: function(u){ var m = /^vis:\/\/([^/]+)/.exec(u||''); return m ? m[1] : ''; } }};
// ------------------------------------------------------------ helpers ----
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){
  return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function $(sel, root){ return (root||document).querySelector(sel); }
async function j(u){
  var result = await window.AppUIApi.requestResponse(u, undefined, {
    method: 'GET', timeout: null, decode: function (response) {
      if (!response.ok) throw new Error(u + ' \u2192 ' + response.status);
      return response.json();
    }
  });
  return result.data;
}
function post(u, body){
  return window.AppUIApi.requestResponse(u, body || {}, {
    method: 'POST', timeout: null, decode: function (response) { return response.json(); }
  }).then(function (result) { return result.data; });
}
function store(key, val){
  try {
    if (val === undefined) { var v = localStorage.getItem('home.'+key); return v ? JSON.parse(v) : null; }
    localStorage.setItem('home.'+key, JSON.stringify(val));
  } catch (_e) { return null; }
}
function ago(ts){
  var s = Math.max(0, (Date.now()-ts)/1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s/60)+'m ago';
  if (s < 86400) return Math.floor(s/3600)+'h ago';
  return Math.floor(s/86400)+'d ago';
}
function secs(s){ s = Number(s)||0; return s < 60 ? Math.round(s)+'s' : s < 3600 ? Math.round(s/60)+'m' : (s/3600).toFixed(1)+'h'; }

// Each top-level group gets an icon + hue so the launchpad reads at a glance.
var GROUPS = {
  ai:        { icon: '🤖', hue: '#8b5cf6', label: 'AI' },
  documents: { icon: '📄', hue: '#3b82f6', label: 'Documents' },
  ericsson:  { icon: '📡', hue: '#0ea5e9', label: 'Ericsson' },
  file:      { icon: '🗂️', hue: '#f59e0b', label: 'Files' },
  knowledge: { icon: '📚', hue: '#10b981', label: 'Knowledge' },
  office:    { icon: '💼', hue: '#ef4444', label: 'Office' },
  platform:  { icon: '🧩', hue: '#6366f1', label: 'Platform' },
  system:    { icon: '⚙️', hue: '#64748b', label: 'System' },
};
var CATALOG = 'vis://tool_catalog';
function groupOf(id){ return String(id||'').split('/')[0]; }
// an app's BROWSE path (manifest category placement, served by /v1/apps as `path`); ids never change
function pathOf(a){ return (a && (a.path || a.app_id)) || ''; }
function gmeta(g){ return GROUPS[g] || { icon: '◆', hue: '#94a3b8', label: g }; }
function capName(n){ return n == null ? null : (n.name || n); }   // tolerate malformed entries

// ------------------------------------------------------------- state -----
var S = {
  apps: [], byId: {}, eps: [], caps: new Set(), assist: {},
  appsSig: '', epsSig: '', loaded: false, epsError: null,
  q: '', filter: '', view: 'grid',
  fav: store('fav') || [], recent: store('recent') || [],
};
var ui = store('ui') || {};
if (ui.view) S.view = ui.view;
if (ui.filter) S.filter = ui.filter;
function saveUi(){ store('ui', { view: S.view, filter: S.filter }); }

   // the AppUIVisExplorer instance — the home page IS a VIS view

function missingCaps(a){
  return (a.needs_capabilities||[]).map(capName).filter(function(n){ return n && !S.caps.has(n); });
}
function toolCount(a){ return (a.ops||[]).filter(function(o){ return o.tool; }).length; }
function isFav(id){ return S.fav.indexOf(id) >= 0; }
function toggleFav(id){
  var i = S.fav.indexOf(id);
  if (i >= 0) S.fav.splice(i, 1); else S.fav.unshift(id);
  store('fav', S.fav);
  renderShelf(); if (page.explorer) page.explorer.rerender();
}
function noteOpen(a){
  S.recent = [{ id: a.app_id, t: Date.now() }].concat(S.recent.filter(function(r){ return r.id !== a.app_id; })).slice(0, 12);
  store('recent', S.recent);
}
// App pages open in a NEW TAB (the launchpad stays put); pass sameTab=true
// to replace this tab instead.
function openApp(a, sameTab){
  if (!a.url) { if (page.explorer) page.explorer.open(CATALOG + '/' + a.app_id); return; }
  noteOpen(a);
  if (sameTab) location.href = a.url; else window.open(a.url, '_blank', 'noopener');
}
function byId(id){ return S.byId[id] || null; }
function setFilter(f){ S.filter = (S.filter === f ? '' : f); saveUi(); renderBar(); if (page.explorer) page.explorer.rerender(); }
function hiddenByFilter(a){
  return (S.filter === 'page' && !a.url) || (S.filter === 'attention' && !missingCaps(a).length) ||
         (S.filter === 'assistant' && !S.assist[a.app_id]) || (S.filter === 'fav' && !isFav(a.app_id));
}


var TREE = { host: null, q: '', root: '', open: store('treeOpen') || {}, sel: '' };

export { esc, $, j, post, store, ago, secs, groupOf, pathOf, gmeta, capName, saveUi, missingCaps, toolCount, isFav, toggleFav, noteOpen, openApp, byId, setFilter, hiddenByFilter, S, TREE, page, GROUPS, CATALOG };
