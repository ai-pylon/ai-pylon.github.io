import { renderBar } from "./bar.js";
import { appMatches, openPalette, renderQuickMatches } from "./search.js";
import { $, ago, byId, CATALOG, esc, gmeta, groupOf, isFav, missingCaps, openApp, page, pathOf, S, saveUi, setFilter, store, toolCount } from "./state.js";

// ------------------------------------------------------------ render -----
function greeting(){
  var h = new Date().getHours();
  return h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function renderSkeleton(el){
  el.innerHTML =
    '<div class="hp">' +
      '<section class="hp-hero">' +
        '<p class="hp-hello" id="hp-hello"></p>' +
        '<h1 class="hp-title"><b>pylon-server</b> launchpad</h1>' +
        '<p class="hp-sub" id="hp-sub">Loading the fleet…</p>' +
        '<div class="hp-searchrow">' +
          '<label class="hp-search"><span class="ico">🔍</span>' +
            '<input id="hp-q" type="search" autocomplete="off" spellcheck="false" placeholder="Search apps and tools — e.g. “list files”, “outlook”, “MOM”…" aria-label="Search apps and tools">' +
            '<span class="kbd">/</span></label>' +
          '<button class="hp-btn" id="hp-palette" title="Command palette">⌘ Jump to… <span class="kbd">Ctrl K</span></button>' +
          '<a class="hp-btn" href="/apps/ai/llm_server/" target="_blank" rel="noopener" title="Open the AI chat (new tab)">💬 Ask AI</a>' +
          '<a class="hp-btn" href="/apps/platform/home/projects.htm" title="pylon-server projects: TODO, services, checkpoints, resume briefs, operations">📋 Projects</a>' +
          '<a class="hp-btn" href="/apps/platform/appui_guide/" target="_blank" rel="noopener" title="Gallery, scaffolder and docs for building apps (new tab)">🛠️ Build an app</a>' +
        '</div>' +
      '</section>' +
      '<div class="hp-pulse" id="hp-pulse"></div>' +
      '<div id="hp-shelfwrap"></div>' +
      '<div class="hp-h"><h2>Explore</h2><span class="line"></span><span class="meta" id="hp-count">live from VIS · vis://tool_catalog</span>' +
        '<span class="seg" id="hp-view" role="group" aria-label="View"></span></div>' +
      '<div class="hp-bar" id="hp-bar"></div>' +
      '<div class="hp-qm" id="hp-qm" style="display:none"></div>' +
      '<div id="hp-vis"><div class="hp-empty"><div class="big">⏳</div>Loading…</div></div>' +
      '<div class="hp-h"><h2>Endpoints &amp; capabilities</h2><span class="line"></span><span class="meta" id="hp-epmeta"></span></div>' +
      '<div class="hp-eps" id="hp-eps"></div>' +
    '</div>';
  $('#hp-hello').textContent = greeting() + ' 👋';
  if (page.viewScope) page.viewScope.destroy();
  var owner = page.viewScope = window.AppUILifecycle.createViewScope({host: $('.hp')});
  var q = $('#hp-q');
  var searchLater = window.AppUILifecycle.debounce(function () {
    if (page.explorer) page.explorer.search(S.q);
  }, 220);
  owner.add(searchLater.destroy);
  owner.listen(q, 'input', function(){
    S.q = q.value.trim(); renderQuickMatches();
    searchLater();
  });
  owner.listen(q, 'keydown', function(e){
    if (e.key === 'Enter') {
      var first = appMatches()[0];
      if (first) openApp(first);
    } else if (e.key === 'Escape') {
      q.value = ''; S.q = ''; renderQuickMatches(); if (page.explorer) page.explorer.search(''); q.blur();
    }
  });
  $('#hp-palette').onclick = function(){ openPalette(); };
}

function tile(k, v, s, cls, onClick){
  var d = document.createElement('div');
  d.className = 'hp-tile' + (cls ? ' ' + cls : '') + (onClick ? ' click' : '');
  d.innerHTML = '<span class="k">'+k+'</span><span class="v">'+v+'</span><span class="s">'+s+'</span>';
  if (onClick) { d.onclick = onClick; d.tabIndex = 0; d.onkeydown = function(e){ if (e.key === 'Enter') onClick(); }; }
  return d;
}
function renderPulse(){
  var box = $('#hp-pulse'); if (!box) return;
  var apps = S.apps, pages = apps.filter(function(a){ return a.url; }).length;
  var tools = apps.reduce(function(n, a){ return n + toolCount(a); }, 0);
  var live = S.eps.filter(function(e){ return !e.stale; }).length;
  var attention = apps.filter(function(a){ return missingCaps(a).length; }).length;
  var assistants = Object.keys(S.assist).length;
  var groups = {}; apps.forEach(function(a){ groups[groupOf(pathOf(a))] = 1; });
  box.innerHTML = '';
  box.appendChild(tile('Apps', apps.length, pages + ' with a page · ' + Object.keys(groups).length + ' groups', '',
    function(){ S.filter = ''; saveUi(); renderBar(); if (page.explorer) page.explorer.open(CATALOG); }));
  box.appendChild(tile('LLM tools', tools, 'search them above, or drill into an app', '',
    function(){ var q = $('#hp-q'); if (q) q.focus(); }));
  box.appendChild(tile('Endpoints', '<span class="live' + (live ? '' : ' off') + '"></span>' + live + '/' + S.eps.length,
    S.caps.size + ' capabilities online', live ? 'good' : 'warn',
    function(){ var e = $('#hp-eps'); if (e) e.scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
  box.appendChild(tile('AI assistants', assistants, 'apps with a chat profile', '',
    assistants ? function(){ setFilter('assistant'); } : null));
  box.appendChild(tile('Needs attention', attention, attention ? 'missing a capability — click to show' : 'everything can run',
    attention ? 'warn' : 'good', attention ? function(){ setFilter('attention'); } : null));
  var sub = $('#hp-sub');
  if (sub) sub.textContent = apps.length + ' apps, ' + tools + ' LLM tools and ' + S.caps.size +
    ' live capabilities — all browsable below through VIS. Type to search, or press Ctrl K to jump anywhere.';
}

function miniHtml(a, meta){
  var g = gmeta(groupOf(pathOf(a)));
  return '<span class="ic" style="--hue:'+g.hue+'">'+g.icon+'</span>' +
    '<span style="min-width:0"><div class="nm">'+esc(a.title||a.app_id)+'</div>' +
    (meta ? '<div class="when">'+esc(meta)+'</div>' : '') + '</span>';
}
function miniEl(a, meta, cls){
  var b = document.createElement('div'); b.className = 'hp-mini' + (cls ? ' ' + cls : ''); b.tabIndex = 0;
  b.title = a.app_id + (a.url ? '' : ' (no page — shows its tools)');
  b.innerHTML = miniHtml(a, meta);
  b.onclick = function(){ openApp(a); };
  b.onkeydown = function(e){ if (e.key === 'Enter') openApp(a); };
  return b;
}
function renderShelf(){
  var wrap = $('#hp-shelfwrap'); if (!wrap) return;
  var favs = S.fav.map(byId).filter(Boolean);
  var rec = S.recent.filter(function(r){ return !isFav(r.id) && byId(r.id); }).slice(0, 8);
  var h = '<div class="hp-h"><h2>★ Pinned</h2><span class="line"></span></div>';
  h += favs.length ? '<div class="hp-shelf" id="hp-fav"></div>'
    : '<div class="hp-hint">Star ☆ an app below to pin it here.</div>';
  if (rec.length) h += '<div class="hp-h"><h2>Recently opened</h2><span class="line"></span>' +
    '<a href="#" class="meta" id="hp-clear-recent">clear</a></div><div class="hp-shelf" id="hp-rec"></div>';
  wrap.innerHTML = h;
  var fb = $('#hp-fav'); if (fb) favs.forEach(function(a){ fb.appendChild(miniEl(a, a.url ? groupOf(pathOf(a)) : 'tools')); });
  var when = {}; S.recent.forEach(function(r){ when[r.id] = r.t; });
  var rb = $('#hp-rec'); if (rb) rec.forEach(function(r){ var a = byId(r.id); rb.appendChild(miniEl(a, ago(when[a.app_id]))); });
  var clr = $('#hp-clear-recent');
  if (clr) clr.onclick = function(e){ e.preventDefault(); S.recent = []; store('recent', []); renderShelf(); };
}

// Instant app-name matches above the VIS tool-search results.

export { greeting, renderSkeleton, tile, renderPulse, miniHtml, miniEl, renderShelf };
