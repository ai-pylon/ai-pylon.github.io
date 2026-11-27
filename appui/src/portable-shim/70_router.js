// ---- AppUIRouter: minimal namespaced query-string router -----------------
// The AppForge pod doesn't load the full /appui foundation router, but the
// shared AppUIFileExplorer uses AppUIRouter.create(id).set/get to persist the
// selected file path to the URL (deep-link + refresh-survive). This shim
// provides the SAME contract + URL format (``?appui.<id>.<key>=<value>``) so
// selecting a file in the tree updates the URL and a reload reveals it. If the
// real foundation router is already loaded, keep it.
(function () {
  if (window.AppUIRouter && window.AppUIRouter.create) return;
  // Optional SHORT ALIASES: map a verbose router param (appui.<id>.<key>) to a
  // short query param (e.g. ?wpath=). When an alias is registered, get() reads
  // EITHER form and set() writes the SHORT one — so the address bar stays short
  // with NO promote→verbose→normalize round-trip (which caused a visible URL
  // flicker on refresh). Registered via AppUIRouter.alias(appId, key, short).
  var _aliases = {};   // (appId + '.' + key) -> shortParamName
  function _aliasKey(appId, key) { return (appId || 'page') + '.' + key; }
  function create(appId, onRoute) {
    var prefix = 'appui.' + (appId || 'page') + '.';
    function notify() { try { if (typeof onRoute === 'function') onRoute(); } catch (e) {} }
    var api = {
      get: function (key) {
        try {
          var q = new URLSearchParams(window.location.search);
          var v = q.get(prefix + key);
          if (v != null) return v;
          var sh = _aliases[_aliasKey(appId, key)];
          return sh ? q.get(sh) : null;
        } catch (e) { return null; }
      },
      set: function (key, value, opts) {
        opts = opts || {};
        try {
          var url = new URL(window.location.href);
          var sh = _aliases[_aliasKey(appId, key)];
          var name = sh || (prefix + key);   // write the SHORT alias when registered
          url.searchParams.delete(prefix + key);
          if (sh) url.searchParams.delete(sh);
          if (value === undefined || value === null || value === '') { /* cleared above */ }
          else url.searchParams.set(name, String(value));
          history[opts.replace ? 'replaceState' : 'pushState'](history.state, '', url);
          if (!opts.silent) notify();
        } catch (e) { /* best-effort */ }
      },
      getHash: function (key) {
        try { return new URLSearchParams(window.location.hash.replace(/^#/, '')).get(key); }
        catch (e) { return null; }
      },
    };
    window.addEventListener('popstate', notify);
    return api;
  }
  function alias(appId, key, shortName) { _aliases[_aliasKey(appId, key)] = shortName; }
  window.AppUIRouter = { create: create, alias: alias };
})();

