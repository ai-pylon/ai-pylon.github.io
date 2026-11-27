import { api, btn, el } from "./state.js";

// ===================================================== SHARED HELPERS ======
// Client-side op cache (#17): each section's payload is fetched ONCE per page
// session and reused when you flip back to it; a section's Refresh button
// drops its keys. The fleet / catalog rarely change within a session.
var _cache = new Map();
function cachedApi(op, args) {
  if (!_cache.has(op)) _cache.set(op, window.AppUIAsyncCache.create({
    ttlMs: Infinity, cacheIf: function (result) { return !!(result && result.ok); }
  }));
  return _cache.get(op).get(JSON.stringify(args || {}), function () { return api(op, args); });
}
function dropCache(op) {
  var cache = _cache.get(op);
  if (cache) cache.clear();
}
function debounce(fn, ms) {
  return window.AppUILifecycle.debounce(fn, ms);
}
function refreshBtn(op, rerender) {
  return btn("↻ Refresh", function () { dropCache(op); rerender(); });
}
function sectionHead(wrap, title, sub, op, rerender) {
  var h = el("div", { style: "display:flex;align-items:center;gap:8px" });
  h.appendChild(el("h2", { style: "margin:0 0 4px;flex:1" }, title));
  if (op) h.appendChild(refreshBtn(op, rerender));
  wrap.appendChild(h);
  if (sub) wrap.appendChild(el("div", { class: "g-sub", style: "margin-bottom:10px" }, sub));
}

export { cachedApi, dropCache, debounce, refreshBtn, sectionHead };
