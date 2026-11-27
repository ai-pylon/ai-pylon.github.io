import { renderBar } from "./bar.js";
import { miniEl } from "./dashboard.js";
import { refreshAll } from "./data.js";
import { $, CATALOG, gmeta, groupOf, openApp, page, pathOf, S, saveUi } from "./state.js";

function appMatches(){
  var toks = S.q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!toks.length) return [];
  return S.apps.map(function(a){
    var t = (a.title||'').toLowerCase(), id = a.app_id.toLowerCase(), d = (a.description||'').toLowerCase(), s = 0;
    for (var i=0;i<toks.length;i++){
      var k = toks[i], v = t.indexOf(k) === 0 ? 100 : t.indexOf(k) > 0 ? 70 : id.indexOf(k) >= 0 ? 55 : d.indexOf(k) >= 0 ? 15 : 0;
      if (!v) return null; s += v;
    }
    return { a: a, s: s };
  }).filter(Boolean).sort(function(x, y){ return y.s - x.s; }).map(function(x){ return x.a; });
}
function renderQuickMatches(){
  var box = $('#hp-qm'); if (!box) return;
  var m = appMatches().slice(0, 10);
  if (!S.q || !m.length) { box.style.display = 'none'; box.innerHTML = ''; return; }
  box.style.display = '';
  box.innerHTML = '<span class="lbl">Apps</span>';
  m.forEach(function(a, i){ box.appendChild(miniEl(a, a.app_id, i === 0 ? 'top1' : '')); });
}

// ----------------------------------------------------------- palette -----
var paletteReady = null;
function paletteCommands(){
  var cmds = [];
  S.apps.slice().sort(function(x, y){ return (x.title||'').localeCompare(y.title||''); }).forEach(function(a){
    var g = gmeta(groupOf(pathOf(a)));
    if (a.url) cmds.push({ name: g.icon + '  ' + a.title + '  —  ' + a.app_id, category: 'Open', action: function(){ openApp(a); } });
    cmds.push({ name: '🧭  Explore ' + a.title + '  —  ' + a.app_id, category: 'Explore', action: function(){ if (page.explorer) page.explorer.open(CATALOG + '/' + a.app_id); } });
    (a.ops||[]).forEach(function(o){
      if (!o.tool) return;
      var tn = (o.tool_schema && o.tool_schema.name) || (a.app_id + '.' + o.name);
      cmds.push({ name: '🔧  ' + tn + '  —  ' + a.title, category: 'Tool',
        action: function(){ if (page.explorer) page.explorer.open(CATALOG + '/' + a.app_id + '.' + o.name); } });
    });
  });
  cmds.push({ name: '↻  Refresh', category: 'Actions', action: function(){ refreshAll(true); } });
  cmds.push({ name: '▦  Toggle grid / list view', category: 'Actions', action: toggleView });
  cmds.push({ name: '🗂️  Browse the Ericsson MOM (VIS)', category: 'Actions', action: function(){ if (page.explorer) page.explorer.open('vis://mom'); } });
  cmds.push({ name: '🛠️  Build a new app (AppUI Guide)', category: 'Actions', action: function(){ window.open('/apps/platform/appui_guide/', '_blank', 'noopener'); } });
  return cmds;
}
function toggleView(){ S.view = S.view === 'grid' ? 'list' : 'grid'; saveUi(); renderBar(); if (page.explorer) page.explorer.setLayout(S.view); }
function openPalette(){
  if (!paletteReady) paletteReady = AppUIAssets.load('palette').then(function(){ AppUIPalette.init({ commands: paletteCommands() }); });
  paletteReady.then(function(){ AppUIPalette.setCommands(paletteCommands()); AppUIPalette.open(); })
    .catch(function(){ var q = $('#hp-q'); if (q) q.focus(); });
}

export { appMatches, renderQuickMatches, paletteCommands, toggleView, openPalette };
