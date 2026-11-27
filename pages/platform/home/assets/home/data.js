import { renderBar } from "./bar.js";
import { renderPulse, renderShelf } from "./dashboard.js";
import { renderEndpoints } from "./endpoints.js";
import { mountExplorer } from "./explorer.js";
import { renderQuickMatches } from "./search.js";
import { $, S, byId, esc, j, page, post } from "./state.js";
import { renderTreeBody } from "./tree.js";

// -------------------------------------------------------------- data -----
// Endpoints poll every 5s (cheap); the app list every 30s. Sections re-render
// only when their data signature changed (no flicker, focus/scroll kept), and
// polling pauses while the tab is hidden. A fleet change also refreshes the
// VIS view, so a newly discovered app/tool shows up on its own.
var _baseMatch = /^(.*)\/apps\/platform\/home(?:\/|$)/.exec(location.pathname || '');
var BASE = (_baseMatch && _baseMatch[1]) ? _baseMatch[1] : '';
function _withBase(u){
  if (!BASE || !u || u.charAt(0) !== '/' || u.indexOf('//') === 0) return u;
  if (u === BASE || u.indexOf(BASE + '/') === 0) return u;
  return BASE + u;
}

async function loadApps(){
  var r = await j('/v1/apps');
  var apps = (r.apps || []).map(function(a){
    return a && a.url ? Object.assign({}, a, { url: _withBase(a.url) }) : a;
  }).sort(function(x, y){ return (x.title||'').localeCompare(y.title||''); });
  S.apps = apps; S.byId = {}; apps.forEach(function(a){ S.byId[a.app_id] = a; }); S.loaded = true;
  try {
    var g = await post('/v1/apps/platform/appui_guide/apps', {});
    var as = {};
    (g.apps || []).forEach(function(x){ if (x.has_chat_profile) as[x.app_id] = x.profile_id || 'assistant'; });
    S.assist = as;
  } catch (_e) {}
  return apps.map(function(a){ return a.app_id + '@' + a.version; }).join('|');
}
async function loadEps(){
  var r = await j('/v1/endpoints');
  var eps = r.endpoints || [], caps = new Set();
  eps.forEach(function(e){ if (!e.stale) (e.capabilities||[]).forEach(function(c){ caps.add(c.name || c); }); });
  S.eps = eps; S.caps = caps; S.epsError = null;
  return eps.map(function(e){ return e.endpoint + (e.stale ? '!' : '') + (e.flapping ? '~' : '') + ':' +
    (e.capabilities||[]).map(function(c){ return c.name; }).sort().join(','); }).join('|');
}

function status(){
  if (page.app && page.app.setStatus) page.app.setStatus(S.apps.length + ' apps · ' + S.eps.filter(function(e){ return !e.stale; }).length +
    ' endpoint(s) online · ' + S.caps.size + ' capabilities · updated ' + new Date().toLocaleTimeString());
}
async function refreshAll(force){
  var appsChanged = false, epsChanged = false;
  try { var sa = await loadApps(); appsChanged = force || sa !== S.appsSig; S.appsSig = sa; }
  catch (e) { if (!S.loaded) { var b = $('#hp-vis'); if (b) b.innerHTML = '<div class="hp-empty"><div class="big">⚠️</div>Could not load apps: ' + esc(e.message) + '</div>'; } }
  try { var se = await loadEps(); epsChanged = force || se !== S.epsSig; S.epsSig = se; }
  catch (e) { S.epsError = String(e); epsChanged = true; }
  if (appsChanged || epsChanged) { renderPulse(); renderBar(); renderShelf(); renderQuickMatches(); renderTreeBody(); }
  if (epsChanged) renderEndpoints();
  if (!page.explorer) mountExplorer();
  else if (appsChanged) (force ? page.explorer.refresh() : page.explorer.rerender());
  status();
}
async function pollEps(){
  if (document.hidden) return;
  try {
    var se = await loadEps();
    if (se !== S.epsSig) { S.epsSig = se; renderPulse(); renderEndpoints(); renderTreeBody(); if (page.explorer) page.explorer.rerender(); }
  } catch (e) { if (!S.epsError) { S.epsError = String(e); renderEndpoints(); } }
  status();
}
async function pollApps(){
  if (document.hidden) return;
  try {
    var sa = await loadApps();
    if (sa !== S.appsSig) { S.appsSig = sa; renderPulse(); renderBar(); renderShelf(); renderTreeBody(); if (page.explorer) page.explorer.refresh(); }
  } catch (_e) {}
}

export { loadApps, loadEps, status, refreshAll, pollEps, pollApps };
