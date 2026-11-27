import { renderBar } from "./bar.js";
import { showDetails } from "./details.js";
import { $, byId, CATALOG, esc, gmeta, groupOf, hiddenByFilter, isFav, missingCaps, noteOpen, page, pathOf, post, S, toggleFav } from "./state.js";
import { syncTree } from "./tree.js";

// ------------------------------------------------- VIS node decoration ---
// The explorer is generic; this maps tool-catalog nodes onto live app data.
function decorate(node, ctx){
  if (page.vis.providerOf(node.uri) !== 'tool_catalog') return null;
  var path = node.path || '', g = gmeta(groupOf(path));
  if (!path) return { icon: '🧰', title: 'All apps' };
  if (node.kind === 'group') {
    return { icon: path.indexOf('/') < 0 ? g.icon : '📁', hue: g.hue,
             title: path.indexOf('/') < 0 ? g.label : node.title, subtitle: path };
  }
  if (node.kind === 'app') {
    var a = byId(path);
    if (!a) return { icon: g.icon, hue: g.hue };
    var miss = missingCaps(a), acts = [];
    var badges = [miss.length
      ? '<span class="tag bad" title="missing: ' + esc(miss.join(', ')) + '">⚠ needs ' + esc(miss[0]) + (miss.length > 1 ? ' +' + (miss.length-1) : '') + '</span>'
      : '<span class="tag ok">● ready</span>'];
    if (S.assist[a.app_id]) badges.push('<span class="tag ai" title="' + esc(S.assist[a.app_id]) + '">💬 assistant</span>');
    if ((a.sidebars||[]).length) badges.push('<span class="tag" title="supplies an embeddable sidebar">🧰 sidebar</span>');
    if (ctx.header) {
      if (a.url) acts.push({ label: 'Open page ↗', href: a.url, primary: true, newTab: true, title: 'Opens in a new tab' });
      acts.push({ label: isFav(a.app_id) ? '★ Unpin' : '☆ Pin to home', run: function(){ toggleFav(a.app_id); } });
      acts.push({ label: 'ⓘ Capabilities & prompts', run: function(){ showDetails(a); } });
      acts.push({ label: '⧉ Copy id', run: function(){ copy(a.app_id); } });
    } else {
      acts.push({ label: isFav(a.app_id) ? '★' : '☆', title: isFav(a.app_id) ? 'Unpin' : 'Pin to home',
                  cls: 'star' + (isFav(a.app_id) ? ' on' : ''), run: function(){ toggleFav(a.app_id); } });
      if (a.url) acts.push({ label: 'Open ↗', href: a.url, newTab: true, title: 'Open ' + a.title + ' in a new tab' });
    }
    return { icon: g.icon, hue: g.hue, title: a.title || path, subtitle: a.app_id, badges: badges, actions: acts,
             hidden: !ctx.header && hiddenByFilter(a) };
  }
  if (node.kind === 'namespace') {           // a dotted op prefix inside an app (workspace.rag.*)
    var nat = node.attributes || {};
    return { icon: '📂', hue: g.hue, title: node.title, subtitle: (nat.app_id || path.split(':')[0]) + ' · ' + (nat.namespace || path.split(':')[1] || '') };
  }
  if (node.kind === 'tool') {
    var at = node.attributes || {}, owner = byId(at.app_id) || byId(path.split('.')[0]);
    var b = [];
    if (at.safety === 'confirm') b.push('<span class="tag bad">✏️ writes</span>');
    else if (at.safety) b.push('<span class="tag">read-only</span>');
    if (ctx.search && owner) b.push('<span class="tag">' + esc(owner.title) + '</span>');
    return { icon: '🔧', hue: g.hue, subtitle: ctx.search ? path : '', badges: b,
             actions: ctx.header && owner && owner.url ? [{ label: 'Open ' + esc(owner.title) + ' ↗', href: owner.url, newTab: true }] : [] };
  }
  return { icon: g.icon, hue: g.hue };
}


// "Try it": a read-only tool can be called right from its VIS leaf.
function renderLeaf(node, el){
  if (page.vis.providerOf(node.uri) !== 'tool_catalog' || node.kind !== 'tool') return;
  var at = node.attributes || {}, appId = at.app_id, op = at.op;
  if (!appId || !op) return;
  var owner = byId(appId), params = Object.keys(at.params || {});
  var box = document.createElement('div'); box.className = 'try';
  var base = (typeof window.__PYLON_BASE__ === 'string' && window.__PYLON_BASE__) ? window.__PYLON_BASE__.replace(/\/+$/, '') : '';
  var curl = "curl -X POST " + location.origin + base + "/v1/apps/" + appId + "/" + op +
    " -H 'Content-Type: application/json' -d '{}'";
  if (at.safety === 'confirm') {
    box.innerHTML = '<div class="lbl" style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted)">Try it</div>' +
      '<div class="meta">✏️ This tool changes data, so it can’t be run from here — use ' +
      (owner && owner.url ? '<a href="' + esc(owner.url) + '" target="_blank" rel="noopener">' + esc(owner.title) + '</a>' : 'its app') +
      ' or call it with <code>confirm: true</code>.</div>';
    el.appendChild(box); return;
  }
  box.innerHTML = '<div style="display:flex;align-items:center;gap:8px"><div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted);flex:1">Try it — read-only</div>' +
      '<button class="vx-act" data-curl title="Copy a curl command">⧉ curl</button></div>' +
    (params.length ? '<div class="row">' + params.map(function(p){
      return '<label for="try-' + esc(p) + '">' + esc(p) + '</label><input id="try-' + esc(p) + '" data-p="' + esc(p) +
        '" placeholder="' + esc(String((at.params||{})[p]).slice(0, 90)) + '">';
    }).join('') + '</div>' : '<div class="meta">No parameters.</div>') +
    '<div><button class="vx-act btn primary" data-run>▶ Run ' + esc(op) + '</button> <span class="meta" data-meta></span></div>' +
    '<pre class="out" data-out style="display:none"></pre>';
  el.appendChild(box);
  window.AppUICopyButton.bind(box.querySelector('[data-curl]'), curl, {successText:'Copied'});
  var run = box.querySelector('[data-run]');
  function go(){
    var args = {};
    box.querySelectorAll('[data-p]').forEach(function(i){
      var v = i.value.trim(); if (!v) return;
      try { args[i.getAttribute('data-p')] = JSON.parse(v); } catch (_e) { args[i.getAttribute('data-p')] = v; }
    });
    var out = box.querySelector('[data-out]'), meta = box.querySelector('[data-meta]');
    run.disabled = true; meta.textContent = 'running…'; var t0 = performance.now();
    post('/v1/apps/' + appId + '/' + op, args).then(function(r){
      var txt = JSON.stringify(r, null, 2);
      out.style.display = ''; out.textContent = txt.length > 40000 ? txt.slice(0, 40000) + '\n… (truncated)' : txt;
      meta.textContent = (r && r.ok === false ? '⚠ ' : '✓ ') + Math.round(performance.now() - t0) + ' ms · ' + (txt.length/1024).toFixed(1) + ' KB';
    }).catch(function(e){ out.style.display = ''; out.textContent = String(e); meta.textContent = 'failed'; })
      .then(function(){ run.disabled = false; });
  }
  run.onclick = go;
  box.querySelectorAll('[data-p]').forEach(function(i){ i.addEventListener('keydown', function(e){ if (e.key === 'Enter') go(); }); });
}
function copy(text){
  return window.AppUICore.copyText(text).then(function () {
    if (window.AppUIToast) window.AppUIToast.success('Copied');
    return true;
  }, function () {
    if (window.AppUIToast) window.AppUIToast.error('Copy failed');
    return false;
  });
}

// The tool catalog only lists apps that expose LLM tools (`tool` facet). Any other
// app (e.g. knowledge/workspace_rag: in_process + http ops only) still gets a view
// in the content area, built from /v1/apps — instead of a bare "no such node".
function renderMissing(uri, _reply, el){
  if (page.vis.providerOf(uri) !== 'tool_catalog') return false;
  var path = String(uri).replace(/^vis:\/\/[^/]+\/?/, '');
  var appId = path.split(':')[0], dot = appId.indexOf('.');
  if (dot > 0) appId = appId.slice(0, dot);
  var a = byId(appId);
  if (!a) {
    // a group whose apps all lack tools: list them so the group is still browsable
    var kids = S.apps.filter(function(x){ return pathOf(x).indexOf(path + '/') === 0; });
    if (!kids.length) return false;
    el.innerHTML = '<div class="hp-miss"><div class="hp-miss-h">' + esc(path) + '</div>' +
      '<div class="hp-miss-d">No LLM tools under this group, so it is not in the tool catalog.</div>' +
      kids.map(function(x){ return '<div class="hp-miss-op"><a data-vis="' + esc(CATALOG + '/' + x.app_id) + '">' + esc(x.title || x.app_id) +
        '</a> <span class="muted">' + esc(x.app_id) + '</span></div>'; }).join('') + '</div>';
    el.querySelectorAll('[data-vis]').forEach(function(x){ x.onclick = function(){ page.explorer.open(x.getAttribute('data-vis')); }; });
    return true;
  }
  var g = gmeta(groupOf(pathOf(a))), miss = missingCaps(a), ops = a.ops || [];
  var opRow = function(o){
    var d = (o.tool_schema && o.tool_schema.description) || o.description || '';
    return '<div class="hp-miss-op"><code>' + esc(o.name) + '</code>' +
      (o.safety === 'confirm' ? ' <span class="w" title="writes">✏️</span>' : '') +
      ' <span class="muted">' + esc((o.facets || []).join(' · ')) + '</span>' +
      (d ? '<div class="muted">' + esc(d.length > 220 ? d.slice(0, 220) + '…' : d) + '</div>' : '') + '</div>';
  };
  el.innerHTML = '<div class="hp-miss">' +
    '<div class="hp-miss-h"><span style="color:' + g.hue + '">' + g.icon + '</span> ' + esc(a.title || a.app_id) +
      ' <span class="muted">' + esc(a.app_id) + '</span></div>' +
    (a.description ? '<div class="hp-miss-d">' + esc(a.description) + '</div>' : '') +
    '<div class="hp-miss-a">' +
      (a.url ? '<a class="btn primary" href="' + esc(a.url) + '" target="_blank" rel="noopener">↗ Open page</a>' : '') +
      '<button class="btn" data-act="details">ⓘ Capabilities &amp; prompts</button>' +
      (miss.length ? '<span class="bad">missing: ' + esc(miss.join(', ')) + '</span>' : '<span class="ok">● ready</span>') +
    '</div>' +
    '<div class="hp-miss-d muted">This app exposes no LLM tools (no <code>tool</code> facet), so it is not in the tool catalog. ' +
      'Its ' + ops.length + ' operation' + (ops.length === 1 ? '' : 's') + ' (in-process / HTTP):</div>' +
    ops.map(opRow).join('') + '</div>';
  var det = el.querySelector('[data-act="details"]'); if (det) det.onclick = function(){ showDetails(a); };
  var pg = el.querySelector('a.btn[href]'); if (pg) pg.addEventListener('click', function(){ noteOpen(a); });
  return true;
}

function mountExplorer(){
  var host = $('#hp-vis'); if (!host || page.explorer) return;
  AppUIAssets.load('visExplorer').then(function(){
    host.innerHTML = '';
    page.vis = window.AppUIVisExplorer;
    page.explorer = AppUIVisExplorer.create({
      container: host, uri: CATALOG, providers: true, layout: S.view,
      route: 'home', routeAlias: 'vis',   // AppUIRouter deep link: ?vis=<vis uri>
      decorate: decorate, renderLeaf: renderLeaf, renderMissing: renderMissing,
      onNavigate: function(node){
        renderBar(); syncTree(true);
        var meta = $('#hp-count');
        if (meta) meta.textContent = node.search ? (node.hits || []).length + ' tool hits for “' + node.search + '”'
          : 'live from VIS · ' + (node.uri || '');
      },
    });
    // remember opens that happen through a card/header "Open ↗" link
    host.addEventListener('click', function(e){
      var a = e.target.closest('a[href*="/apps/"]'); if (!a) return;
      var hit = S.apps.filter(function(x){ return x.url === a.getAttribute('href'); })[0];
      if (hit) noteOpen(hit);
    }, true);
  }).catch(function(e){
    host.innerHTML = '<div class="hp-empty"><div class="big">⚠️</div>Could not load the VIS explorer: ' + esc(e) + '</div>';
  });
}

export { decorate, renderLeaf, copy, mountExplorer };
