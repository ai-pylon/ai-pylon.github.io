/* AppUIWorkspaceNav — ONE deep-link helper, both ways (WORKSPACE_CONTEXT_TODO
 * #60). Every app page that shows a document/file/symbol opens it in the
 * workspace with AppUIWorkspaceNav.open(wsUri | {uri|vfs|path, line, newTab}),
 * and the ws-uri (framework.workspace.ws_uri, #2) is the portable key a citation
 * carries. Replaces the hand-built "/apps/knowledge/workspace/?vfs=…" strings
 * scattered in wsrag.js / 77_rag.js.
 *
 * It resolves a ws:// uri to a concrete vfs:// url via the server op
 * knowledge/workspace.resolve_uri (which wraps framework.workspace.ws_to_vfs),
 * strips the vfs:// scheme to the clean ?vfs= value, appends &line=, and either
 * navigates the CURRENT page (when it IS the workspace app) or opens the
 * workspace app in a new tab. A plain vfs url / abs path is opened directly (no
 * resolve round-trip). Pure DOM + fetch; no framework coupling.
 */
(function () {
  "use strict";

  var WS_APP_PATH = "/apps/knowledge/workspace/";

  function _stripVfs(u) { return String(u == null ? "" : u).replace(/^vfs:\/\//i, ""); }

  function _lineQ(line) {
    var n = parseInt(line || 0, 10);
    return (isFinite(n) && n > 0) ? ("&line=" + n) : "";
  }

  function _onWorkspacePage() {
    try { return location.pathname.indexOf(WS_APP_PATH) === 0; } catch (e) { return false; }
  }

  // Resolve a ws:// uri → a concrete vfs:// url via the server op. Returns a
  // Promise<string|null>. A non-ws value passes through unchanged.
  function resolve(uri) {
    var s = String(uri == null ? "" : uri).trim();
    if (!s) return Promise.resolve(null);
    if (!/^ws:\/\//i.test(s)) return Promise.resolve(s);   // already a vfs/abs value
    return fetch("/v1/apps/knowledge/workspace/workspace.resolve_uri", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uri: s })
    }).then(function (r) { return r.json(); })
      .then(function (j) { return (j && j.ok && j.vfs_url) ? j.vfs_url : null; })
      .catch(function () { return null; });
  }

  // Navigate (same page) or open (new tab) the workspace app at a scheme-stripped
  // vfs value + optional &line.
  function _go(strippedVfs, line, newTab) {
    if (!strippedVfs) return false;
    var q = "?vfs=" + encodeURIComponent(strippedVfs) + _lineQ(line);
    if (!newTab && _onWorkspacePage()) {
      // same-page: update the deep link + let the page's own restore open it.
      // Prefer a hook the workspace page registers; else a soft reload with the
      // new ?vfs= (the page reads it on load).
      try {
        if (window.AppUIWorkspaceNav && typeof window.AppUIWorkspaceNav._localOpen === "function") {
          return window.AppUIWorkspaceNav._localOpen(strippedVfs, line);
        }
      } catch (e) { /* fall through to navigation */ }
      try { location.search = q; return true; } catch (e) { /* fall through */ }
    }
    try { window.open(WS_APP_PATH + q, "_blank", "noopener"); return true; }
    catch (e) { return false; }
  }

  /**
   * open(target[, opts]) — open a workspace item.
   *   target : a ws:// uri, a vfs:// url, or an abs path (string); OR an object
   *            {uri|vfs|path, line, newTab}.
   *   opts   : {line, newTab} (when target is a string).
   * Returns a Promise<boolean> (did we navigate/open).
   */
  function open(target, opts) {
    opts = opts || {};
    var uri, vfs, path, line = opts.line, newTab = opts.newTab;
    if (target && typeof target === "object") {
      uri = target.uri; vfs = target.vfs; path = target.path;
      line = (target.line != null) ? target.line : line;
      newTab = (target.newTab != null) ? target.newTab : newTab;
    } else {
      var s = String(target == null ? "" : target).trim();
      if (/^ws:\/\//i.test(s)) uri = s;
      else vfs = s;
    }
    // a direct vfs/abs value opens immediately; a ws-uri resolves first.
    if (vfs || path) {
      return Promise.resolve(_go(_stripVfs(vfs || path), line, newTab));
    }
    if (!uri) return Promise.resolve(false);
    return resolve(uri).then(function (resolved) {
      if (!resolved) return false;
      return _go(_stripVfs(resolved), line, newTab);
    });
  }

  // Build a ws-uri from a workspace name + rel (client-side mirror of
  // framework.workspace.ws_uri; name/link url-encoded, rel keeps slashes).
  function wsUri(workspace, rel, link) {
    rel = String(rel || "").replace(/\\/g, "/").replace(/^\/+/, "");
    var base = "ws://" + encodeURIComponent(workspace || "");
    if (link) base += "/@" + encodeURIComponent(link);
    return base + (rel ? "/" + rel : "");
  }

  var api = { open: open, resolve: resolve, wsUri: wsUri, stripVfs: _stripVfs };
  if (typeof window !== "undefined") {
    // merge onto any existing object (so a page can register _localOpen first)
    window.AppUIWorkspaceNav = Object.assign(window.AppUIWorkspaceNav || {}, api);
  }
})();
