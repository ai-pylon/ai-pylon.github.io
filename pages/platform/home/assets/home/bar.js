import { $, CATALOG, esc, gmeta, groupOf, page, pathOf, S, saveUi, setFilter } from "./state.js";

function renderBar(){
  var bar = $('#hp-bar'); if (!bar) return;
  var c = {}; S.apps.forEach(function(a){ var g = groupOf(pathOf(a)); c[g] = (c[g]||0) + 1; });
  var cur = page.explorer && page.explorer.current(), curG = cur && page.explorer.mode() === 'node' ? groupOf(cur.path || '') : '';
  var h = '<span class="chip' + (curG ? '' : ' on') + '" data-g="">All <span class="n">' + S.apps.length + '</span></span>';
  Object.keys(c).sort().forEach(function(g){
    var m = gmeta(g);
    h += '<span class="chip' + (curG === g ? ' on' : '') + '" data-g="' + esc(g) + '">' +
      '<span class="sw" style="background:' + m.hue + '"></span>' + esc(m.label) + ' <span class="n">' + c[g] + '</span></span>';
  });
  h += '<span class="sep"></span>';
  [['page', '↗ Page'], ['assistant', '💬 AI'], ['attention', '⚠ Attention'], ['fav', '★ Starred']]
    .forEach(function(f){ h += '<span class="chip' + (S.filter === f[0] ? ' on' : '') + '" data-f="' + f[0] + '">' + f[1] + '</span>'; });
  bar.innerHTML = h;
  // group chips / app filters only mean something on the tool catalog
  var prov = cur ? page.vis.providerOf(cur.uri) : '';
  bar.style.display = (prov && prov !== 'tool_catalog') ? 'none' : '';
  var vw = $('#hp-view');
  if (vw) {
    vw.innerHTML = '<button data-v="grid" class="' + (S.view === 'grid' ? 'on' : '') + '" title="Grid">▦</button>' +
      '<button data-v="list" class="' + (S.view === 'list' ? 'on' : '') + '" title="List">☰</button>';
    vw.querySelectorAll('[data-v]').forEach(function(b){
      b.onclick = function(){ S.view = b.getAttribute('data-v'); saveUi(); renderBar(); if (page.explorer) page.explorer.setLayout(S.view); };
    });
  }
  bar.querySelectorAll('[data-g]').forEach(function(ch){
    ch.onclick = function(){ var g = ch.getAttribute('data-g'); if (page.explorer) page.explorer.open(g ? CATALOG + '/' + g : CATALOG); };
  });
  bar.querySelectorAll('[data-f]').forEach(function(ch){ ch.onclick = function(){ setFilter(ch.getAttribute('data-f')); }; });
}

export { renderBar };
