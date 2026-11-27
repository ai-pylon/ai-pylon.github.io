/* Filterable absolute folder selection over a host-provided flat folder list. */
window.AppUIFlatFolderPicker = (() => {
  function create({container: host, startPath = "/", sourceLabel = "", listFolders,
    makeMatcher = AppUITextUtils.makeMatcher, cacheKey = path => path}) {
    if (!host || typeof listFolders !== "function" || typeof makeMatcher !== "function") {
      throw new Error("AppUIFlatFolderPicker: container, listFolders and makeMatcher required");
    }
    const esc = value => AppUITextUtils.esc(value);
    const sshHost = sourceLabel;
    const scope = AppUILifecycle.createScope();
    let generation = 0;
    var _start = String(startPath || "/").replace(/\\/g, "/").replace(/\/+$/, "") || "/";
    host.innerHTML =
      '<div style="display:flex;gap:6px;margin-bottom:4px">' +
        '<input class="rpp-start ai-input" style="flex:1;font-size:12px" placeholder="/home/you  (browse root)" value="' + esc(_start) + '">' +
        '<button type="button" class="rpp-go ai-btn" style="white-space:nowrap">Browse</button>' +
        '<button type="button" class="rpp-root ai-btn" title="browse from /" style="white-space:nowrap">/</button>' +
      '</div>' +
      '<input class="rpp-filter ai-input" placeholder="filter (regex ok) — or type an absolute path to use it directly" style="font-size:12px">' +
      '<div class="rpp-tree" style="max-height:200px;overflow:auto;border:1px solid var(--border,#2a2c31);border-radius:5px;margin:3px 0;font-size:12px">pick a browse root, then Browse…</div>' +
      '<div class="rpp-sel" style="font-size:11px;color:var(--text-muted,#9aa0a6);margin:4px 0"></div>';
    var startEl = host.querySelector(".rpp-start"),
        goBtn = host.querySelector(".rpp-go"),
        rootBtn = host.querySelector(".rpp-root"),
        filterEl = host.querySelector(".rpp-filter"),
        treeEl = host.querySelector(".rpp-tree"),
        selEl = host.querySelector(".rpp-sel");
    var _folders = [], _chosen = _start, _base = _start;
    // PERF (#12): cache the flattened list per browse base for this picker's
    // lifetime so re-Browsing a base we already walked serves instantly instead
    // of re-firing an SFTP list-tree (depth=3) walk. Keyed by host + absolute base.
    var _treeCache = new Map();
    function _cacheKey(b) { return cacheKey(b); }
    // PERF (#12): debounce the filter re-render — typing fires one input event per
    // keystroke, and each _renderTree rebuilds up to 500 rows + rewires handlers.
    var _filterTimer = null;
    function _renderSel() { if (scope.destroyed) return; selEl.innerHTML = "Selected: <b>" + esc(_chosen || _base) + "</b>"; }
    function _absOf(relUnderBase) {
      if (!relUnderBase) return _base;
      return (_base === "/" ? "" : _base) + "/" + relUnderBase;
    }
    function _renderTree(q) {
      if (scope.destroyed) return;
      const version = generation;
      var m = makeMatcher(q);
      var rows = _folders.filter(function (f) { return m(f.path); });
      // Row 0 = the browse base itself (selectable).
      var html = ['<div class="rpp-opt" data-p="" style="padding:4px 8px;cursor:pointer' +
        (_chosen === _base ? ";background:var(--accent-bg,rgba(79,195,247,.15))" : "") + '">📁 ' + esc(_base) + " (this folder)</div>"];
      rows.slice(0, 500).forEach(function (f) {
        var pad = 8 + f.depth * 16, leaf = f.path.split("/").pop();
        var abs = _absOf(f.path);
        html.push('<div class="rpp-opt" data-p="' + esc(f.path) + '" ' +
          'style="padding:4px 8px 4px ' + pad + 'px;cursor:pointer;white-space:nowrap' +
          (_chosen === abs ? ";background:var(--accent-bg,rgba(79,195,247,.15))" : "") + '">📁 ' + esc(leaf) + "</div>");
      });
      treeEl.innerHTML = html.join("");
      [].forEach.call(treeEl.querySelectorAll(".rpp-opt"), function (el) {
        el.onmouseenter = function () { if (scope.destroyed || version !== generation) return; el.style.background = "var(--bg-hover,#2a2c31)"; };
        el.onmouseleave = function () { if (scope.destroyed || version !== generation) return; var p = el.getAttribute("data-p"); var abs = p ? _absOf(p) : _base; if (abs !== _chosen) el.style.background = ""; };
        el.onclick = function () { if (scope.destroyed || version !== generation) return; var p = el.getAttribute("data-p"); _chosen = p ? _absOf(p) : _base; filterEl.value = ""; _renderSel(); _renderTree(""); };
      });
    }
    function _load() {
      if (scope.destroyed) return;
      const version = ++generation;
      if (_filterTimer !== null) { clearTimeout(_filterTimer); _filterTimer = null; }
      _base = String(startEl.value || "/").replace(/\\/g, "/").replace(/\/+$/, "") || "/";
      _chosen = _base; _renderSel();
      // PERF (#12): serve a previously-walked base from cache (no SFTP round-trip).
      var _ck = _cacheKey(_base);
      if (_treeCache.has(_ck)) {
        _folders = _treeCache.get(_ck);
        if (!_folders.length) { treeEl.innerHTML = '<div style="padding:6px;color:var(--text-muted,#9aa0a6)">(empty, unreachable, or not a folder — type an absolute path, or pick this folder)</div>'; return; }
        _renderTree(""); return;
      }
      treeEl.innerHTML = "loading folders on " + esc(sshHost || "remote") + "…";
      const requestedBase = _base;
      Promise.resolve().then(() => scope.destroyed ? [] : listFolders(requestedBase)).then(function (out) {
        if (scope.destroyed || version !== generation) return;
        _folders = out; _treeCache.set(_ck, out);
        if (!out.length) { treeEl.innerHTML = '<div style="padding:6px;color:var(--text-muted,#9aa0a6)">(empty, unreachable, or not a folder — type an absolute path, or pick this folder)</div>'; return; }
        _renderTree("");
      }).catch(function () { if (scope.destroyed || version !== generation) return; treeEl.innerHTML = '<div style="padding:6px;color:var(--text-muted,#9aa0a6)">(could not list — type an absolute path)</div>'; });
    }
    scope.listen(goBtn, "click", _load);
    scope.listen(rootBtn, "click", function () { startEl.value = "/"; _load(); });
    scope.listen(startEl, "keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); _load(); } });
    scope.listen(filterEl, "input", function () {
      var v = filterEl.value.trim();
      // An absolute path typed into the filter is used DIRECTLY as the choice —
      // apply immediately (no debounce; it's a single cheap render).
      if (v.charAt(0) === "/") {
        if (_filterTimer) { clearTimeout(_filterTimer); _filterTimer = null; }
        _chosen = v.replace(/\/+$/, "") || "/"; _renderSel(); _renderTree(""); return;
      }
      // PERF (#12): debounce substring/regex filtering so a fast typist triggers
      // one tree rebuild after they pause, not one per keystroke.
      if (_filterTimer) clearTimeout(_filterTimer);
      _filterTimer = setTimeout(function () { _filterTimer = null; _renderTree(filterEl.value.trim()); }, 140);
    });
    _renderSel();
    return {
      get: function () { return _chosen || _base; },
      setStart: function (p) { if (scope.destroyed) return; startEl.value = String(p || "/"); _load(); },
      destroy: function () {
        scope.destroy();
        if (_filterTimer !== null) clearTimeout(_filterTimer);
        _filterTimer = null; _treeCache.clear(); host.innerHTML = "";
      }
    };
  }
  return {create};
})();
