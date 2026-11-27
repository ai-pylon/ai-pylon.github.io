/* Absolute-path folder picker. The host supplies shallow directory names; no transport is assumed. */
window.AppUIFolderPicker = (() => {
  function create({container: holder, startPath = "/", sourceLabel = "", listDirectories}) {
    if (!holder || typeof listDirectories !== "function") throw new Error("AppUIFolderPicker: container and listDirectories required");
    const esc = value => AppUITextUtils.esc(value);
    const sshHost = sourceLabel;
    const scope = AppUILifecycle.createScope();
    let generation = 0;
    var _base = String(startPath || "/").replace(/\\/g, "/").replace(/\/+$/, "") || "/";
    var _chosen = _base;
    holder.innerHTML =
      '<div style="display:flex;gap:6px;margin-bottom:4px">' +
        '<input class="cpp-path ai-input" style="flex:1;font-size:12px" placeholder="/home/you  (type a path, or browse below)" value="' + esc(_base) + '">' +
        '<button type="button" class="cpp-go ai-btn" style="white-space:nowrap">Go</button>' +
        '<button type="button" class="cpp-root ai-btn" title="browse from /" style="white-space:nowrap">/</button>' +
      '</div>' +
      '<div class="cpp-tree" style="max-height:240px;overflow:auto;border:1px solid var(--border,#2a2c31);border-radius:5px;margin:3px 0;font-size:12px">loading…</div>' +
      '<div class="cpp-sel" style="font-size:11px;color:var(--text-muted,#9aa0a6);margin:4px 0"></div>' +
      '<div class="cpp-err ws-hint" style="font-size:11px;color:var(--color-danger,#ed4245);min-height:1em"></div>';
    var pathEl = holder.querySelector(".cpp-path"),
        goBtn = holder.querySelector(".cpp-go"),
        rootBtn = holder.querySelector(".cpp-root"),
        treeEl = holder.querySelector(".cpp-tree"),
        selEl = holder.querySelector(".cpp-sel"),
        errEl = holder.querySelector(".cpp-err");
    // cache: absolute dir path -> array of child dir names (one SFTP list each)
    var _cache = new Map();
    function _renderSel() { selEl.innerHTML = "Selected: <b>" + esc(_chosen) + "</b>"; }
    function _join(base, name) { return (base === "/" ? "" : base) + "/" + name; }
    function _list(path) {
      if (_cache.has(path)) return Promise.resolve(_cache.get(path));
      return Promise.resolve().then(() => scope.destroyed ? [] : listDirectories(path)).then(function (dirs) {
        if (!scope.destroyed) _cache.set(path, dirs);
        return dirs;
      });
    }
    // render a single expandable node row
    function _row(absPath, label, depth, version) {
      var row = document.createElement("div");
      row.className = "cpp-node"; row.setAttribute("data-abs", absPath);
      row.style.cssText = "padding:3px 8px 3px " + (8 + depth * 16) + "px;cursor:pointer;white-space:nowrap";
      row.innerHTML = '<span class="cpp-tw" style="display:inline-block;width:12px;color:var(--text-muted,#9aa0a6)">▸</span> 📁 ' + esc(label);
      var kids = document.createElement("div"); kids.style.display = "none"; kids.className = "cpp-kids";
      var expanded = false, loaded = false;
      function select() {
        if (scope.destroyed || version !== generation) return;
        _chosen = absPath; pathEl.value = absPath; _renderSel();
        [].forEach.call(treeEl.querySelectorAll(".cpp-node"), function (n) { n.style.background = ""; });
        row.style.background = "var(--accent-bg,rgba(79,195,247,.15))";
      }
      function toggle() {
        if (scope.destroyed || version !== generation) return;
        expanded = !expanded;
        row.querySelector(".cpp-tw").textContent = expanded ? "▾" : "▸";
        kids.style.display = expanded ? "" : "none";
        if (expanded && !loaded) {
          loaded = true;
          kids.innerHTML = '<div style="padding:3px 8px 3px ' + (8 + (depth + 1) * 16) + 'px;color:var(--text-muted,#9aa0a6)">…</div>';
          _list(absPath).then(function (dirs) {
            if (scope.destroyed || version !== generation) return;
            kids.innerHTML = "";
            if (!dirs.length) { kids.innerHTML = '<div style="padding:3px 8px 3px ' + (8 + (depth + 1) * 16) + 'px;color:var(--text-muted,#9aa0a6)">(no sub-folders)</div>'; return; }
            dirs.forEach(function (n) { kids.appendChild(_row(_join(absPath, n), n, depth + 1, version)); });
          }).catch(function (e) { if (scope.destroyed || version !== generation) return; kids.innerHTML = '<div style="padding:3px 8px;color:var(--color-danger,#ed4245)">' + esc(e.message || "list failed") + "</div>"; });
        }
      }
      row.querySelector(".cpp-tw").onclick = function (ev) { ev.stopPropagation(); toggle(); };
      row.onclick = function () { select(); };
      row.ondblclick = function () { if (!expanded) toggle(); };
      var frag = document.createElement("div");
      frag.appendChild(row); frag.appendChild(kids);
      return frag;
    }
    function _load(base) {
      if (scope.destroyed) return;
      const version = ++generation;
      _base = String(base || "/").replace(/\\/g, "/").replace(/\/+$/, "") || "/";
      _chosen = _base; pathEl.value = _base; _renderSel(); errEl.textContent = "";
      treeEl.innerHTML = "loading " + esc(sshHost) + " …";
      _list(_base).then(function (dirs) {
        if (scope.destroyed || version !== generation) return;
        treeEl.innerHTML = "";
        // row 0 = the base itself (selectable "this folder")
        var baseRow = document.createElement("div");
        baseRow.className = "cpp-node"; baseRow.setAttribute("data-abs", _base);
        baseRow.style.cssText = "padding:4px 8px;cursor:pointer;white-space:nowrap;background:var(--accent-bg,rgba(79,195,247,.15))";
        baseRow.innerHTML = "📁 " + esc(_base) + " (this folder)";
        baseRow.onclick = function () {
          if (scope.destroyed || version !== generation) return;
          _chosen = _base; pathEl.value = _base; _renderSel();
          [].forEach.call(treeEl.querySelectorAll(".cpp-node"), function (n) { n.style.background = ""; });
          baseRow.style.background = "var(--accent-bg,rgba(79,195,247,.15))";
        };
        treeEl.appendChild(baseRow);
        if (!dirs.length) { var e = document.createElement("div"); e.style.cssText = "padding:6px;color:var(--text-muted,#9aa0a6)"; e.textContent = "(no sub-folders — use this folder, or type a path)"; treeEl.appendChild(e); return; }
        dirs.forEach(function (n) { treeEl.appendChild(_row(_join(_base, n), n, 0, version)); });
      }).catch(function (e) {
        if (scope.destroyed || version !== generation) return;
        treeEl.innerHTML = '<div style="padding:6px;color:var(--text-muted,#9aa0a6)">(could not list — type an absolute path to use it directly)</div>';
        errEl.textContent = e.message || "list failed";
      });
    }
    scope.listen(goBtn, "click", function () { _load(pathEl.value); });
    scope.listen(rootBtn, "click", function () { _load("/"); });
    scope.listen(pathEl, "keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); _chosen = String(pathEl.value || "/").replace(/\/+$/, "") || "/"; _renderSel(); _load(_chosen); }
    });
    _renderSel();
    _load(_base);
    return { get: function () { return (pathEl.value || "").trim() || _chosen || _base; }, destroy: function () { scope.destroy(); _cache.clear(); holder.innerHTML = ""; } };
  }
  return {create};
})();
