/* ChatSurface host location context and workspace indicator. */
window.AppUIChatSurfaceLocation = (() => {
  function create({ CAP, state, setStatus, getChat, getIndicator }) {
    let destroyed = false, started = false;
    const scope = AppUILifecycle.createScope();
    function _locBlock(loc) {
      if (!loc) return '';
      const lines = [];
      if (loc.root) lines.push('workspace/root: ' + loc.root);
      if (loc.folder) lines.push('current folder (cwd): ' + loc.folder);
      if (loc.file) lines.push('selected file: ' + loc.file);
      const files = loc.files || loc.folder_files || loc.current_folder_files;
      if (Array.isArray(files) && files.length) {
        lines.push('cwd listing (' + files.length + '): ' + files.slice(0, 60).join(', ')
          + (files.length > 60 ? ' …' : ''));
      }
      // AVAILABLE workspaces (so the model knows other workspaces exist — it can
      // tell the user to switch, instead of claiming a name doesn't exist).
      if (Array.isArray(loc.workspaces) && loc.workspaces.length) {
        lines.push('available workspaces: ' + loc.workspaces.join(', ')
          + ' (the user must SWITCH workspace in the UI to browse another; you only see the current one\u2019s files)');
      }
      // An APP is showing the open file (a host-embedded viewer) — say what is on
      // screen and that its bound tools can analyse it (host: viewer_* tools).
      const v = loc.viewer;
      if (v && v.app) {
        let line = 'shown in viewer: ' + (v.label || v.app) + ' (' + v.app + ')';
        if (v.table) line += ' · table ' + v.table;
        if (v.sql && !v.table) line += ' · SQL ' + String(v.sql).slice(0, 200);
        if (v.where) line += ' · filter ' + String(v.where).slice(0, 200);
        if (v.rows != null) line += ' · ' + v.rows + ' rows';
        lines.push(line);
        if (Array.isArray(v.columns) && v.columns.length) {
          lines.push('  columns (' + v.columns.length + '): ' + v.columns.slice(0, 60).join(', ') + (v.columns.length > 60 ? ' …' : ''));
        }
        if (Array.isArray(v.accepts) && v.accepts.length) {
          lines.push('  its ' + v.accepts.map(x => x === 'where' ? 'filter' : x.toUpperCase()).join(' / ')
            + ' box can be FILLED for the user by replying with a fenced ```ws-view {"' + v.accepts.join('" | "') + '": …, "run"?: true}``` block (only when asked to fill / put / set it)');
        }
        if (Array.isArray(v.tools) && v.tools.length) {
          lines.push('  analyse what is shown with: ' + v.tools.join(', ')
            + ' (bound to this file' + (v.view ? '; "this view" = the filter/sort on screen' : '') + ')');
        }
      }
      if (Array.isArray(loc.tabs) && loc.tabs.length > 1) {
        lines.push('open tabs (' + loc.tabs.length + '): ' + loc.tabs.slice(0, 20).map(t =>
          (t.name || '?') + (t.active ? ' [active]' : '')).join(', '));
      }
      // UI actions the HOST performs from the reply (its onResponse parses ```ws-open / ```ws-view fences) -
      // a reply block works on every backend, no server-declared UI tool needed
      if (Array.isArray(loc.open_with) && loc.open_with.length) {
        lines.push('other previewers for this file: ' + loc.open_with.map(o => (o.label || o.app) + ' (' + o.app + ')').join(', ')
          + ' — open one in a NEW tab (only when asked) by replying with a fenced ```ws-open {"app_id": …, "params"?: {…}, "title"?: …}``` block (the current tab stays)');
      }
      // PINNED context (host: files / folders the user pinned to this chat) — named by uri, never inlined;
      // the model reads / outlines / searches them with its tools when the question needs them.
      const pins = _pins(loc);
      if (pins.length) {
        lines.push('pinned context (' + pins.length + ', read / search on demand): '
          + pins.map(p => (p.name ? p.name + ' ' : '') + '<' + p.uri + '>' + (p.kind && p.kind !== 'file' ? ' [' + p.kind + ']' : '')).join(', '));
      }
      // what is LINKED into the workspace: code repos (searched in place by the host's code tools, never on a
      // remote forge), other links, and VIS nodes (the default navigation scope)
      if (loc.workspace) lines.unshift('workspace: ' + loc.workspace + (loc.open_uri ? '   open item: ' + loc.open_uri : ''));
      if (Array.isArray(loc.linked_repos) && loc.linked_repos.length) {
        lines.push('linked CODE repos (' + loc.linked_repos.length + ', search them IN PLACE): '
          + loc.linked_repos.slice(0, 20).map(r => (r.repo || r.ns) + (r.indexed ? ' (indexed)' : '')
            + (r.target ? ' <' + r.target + '>' : '')).join('; '));
        const how = loc.linked_repos.find(r => r && r.search);
        if (how) lines.push('  search a linked repo with: ' + how.search.replace(new RegExp("'" + (how.repo || '') + "'", 'g'), "'<repo>'"));
      }
      if (Array.isArray(loc.links) && loc.links.length) {
        lines.push('other links: ' + loc.links.slice(0, 20).map(l => (l.name || '?') + (l.role ? ' (' + l.role + ')' : '')
          + (l.target ? ' <' + l.target + '>' : '')).join('; '));
      }
      if (Array.isArray(loc.linked_vis) && loc.linked_vis.length) {
        lines.push('linked VIS: ' + loc.linked_vis.slice(0, 20).map(v => v.uri + (v.title ? ' (' + v.title + ')' : '')
          + (v.description ? ' - ' + String(v.description).slice(0, 120) : '')).join('; '));
      }
      if (!lines.length) return '';
      return 'CURRENT WORKSPACE VIEW (the user may refer to "this workspace / '
        + 'this folder / this file"):\n' + lines.join('\n');
    }
    function _pins(loc) {
      const raw = (loc && Array.isArray(loc.context_uris)) ? loc.context_uris : [];
      return raw.slice(0, 20).map(p => (typeof p === 'string') ? { uri: p } : p)
        .filter(p => p && typeof p.uri === 'string' && p.uri);
    }
    function _locSig(loc) {
      if (!loc) return '';
      return [loc.root, loc.folder, loc.file,
        (loc.files || loc.folder_files || loc.current_folder_files || []).length,
        (loc.workspaces || []).join(','),
        loc.viewer ? [loc.viewer.app, loc.viewer.table, loc.viewer.sql, loc.viewer.where, loc.viewer.view].join('~') : '',
        (loc.tabs || []).map(t => t.name + (t.active ? '*' : '')).join(','),
        _pins(loc).map(p => p.uri).join(',')].join('|');
    }
    // Recompute the location block from the host. ``explicit`` = user clicked 📍.
    // Returns true if the view changed since last capture.
    function refreshLocation(explicit) {
      if (destroyed) return false;
      const chat = getChat();
      if (typeof CAP.currentLocation !== 'function') return false;
      let loc = null;
      try { loc = CAP.currentLocation(); } catch (_e) { loc = null; }
      const sig = _locSig(loc);
      const changed = sig !== state.locationSig;
      state.locationSig = sig;
      state.locationContext = _locBlock(loc);
      renderWsIndicator();   // keep the bar's current-workspace label in sync
      if (explicit) {
        if (!loc) { setStatus('No current view to share'); return false; }
        if (changed) {
          // mid-conversation: nudge the model with the updated view so it reacts
          if (chat && chat.getHistory && (chat.getHistory() || []).length) {
            const parts = [];
            if (loc.file) parts.push('file: ' + loc.file);
            else if (loc.folder) parts.push('folder: ' + loc.folder);
            if (loc.root) parts.push('root: ' + loc.root);
            chat.send('[current view updated] ' + parts.join(' · '));
          }
          setStatus('Workspace view shared (updated)');
        } else {
          setStatus('Workspace view unchanged — already shared');
        }
      }
      return changed;
    }
    // Render the current-workspace indicator from the latest location. Shows a
    // short "📂 <folder-or-root>" with the file if one is selected. Tooltip has
    // the full paths. No-op if the host provides no location.
    function renderWsIndicator() {
      if (destroyed) return;
      const _wsIndicatorEl = getIndicator();
      if (!_wsIndicatorEl) return;
      let loc = null;
      try { loc = (typeof CAP.currentLocation === 'function') ? CAP.currentLocation() : null; } catch (_e) { loc = null; }
      if (!loc || (!loc.root && !loc.folder && !loc.file)) {
        _wsIndicatorEl.textContent = ''; _wsIndicatorEl.title = ''; return;
      }
      const short = p => { if (!p) return ''; const s = String(p).replace(/[\\/]+$/, ''); const segs = s.split(/[\\/]/); return segs.slice(-2).join('/'); };
      const label = short(loc.folder || loc.root) || short(loc.root) || '(workspace)';
      const fileName = loc.file ? String(loc.file).split(/[\\/]/).pop() : '';
      _wsIndicatorEl.textContent = '📂 ' + label + (fileName ? ' · ' + fileName : '');
      _wsIndicatorEl.title = [loc.root && ('workspace/root: ' + loc.root),
        loc.folder && ('cwd: ' + loc.folder), loc.file && ('file: ' + loc.file)]
        .filter(Boolean).join('\n');
    }
    // Back-compat alias for the 📍 button.
    function sendCurrentLocation() { refreshLocation(true); }

    function start() {
      if (destroyed || started || typeof CAP.currentLocation !== 'function') return;
      started = true;
      scope.listen(window, 'workspace-changed', () => {
        if (destroyed || getChat()?.isStreaming) return;
        try {
          const changed = refreshLocation(false);
          // #7 — proactive nav nudge: if the view actually changed and a
          // conversation is already going, hint (once per change) that the
          // assistant now sees the new page, so a long-idle sidebar doesn't
          // answer about a stale view. The context itself is still re-pulled at
          // the next send (onSendStart), so this is purely a visible cue.
          const chat = getChat();
          if (changed && chat && chat.getHistory && (chat.getHistory() || []).length) {
            setStatus('View changed — the assistant will use the current page on your next message.');
          }
        } catch (_e) {}
      });
      const timer = setInterval(() => {
        if (destroyed || document.hidden || getChat()?.isStreaming) return;
        try { renderWsIndicator(); } catch (_e) {}
      }, 4000);
      scope.add(() => clearInterval(timer));
    }
    return {refreshLocation, renderWsIndicator, sendCurrentLocation, start,
      destroy() {destroyed = true; scope.destroy();}};
  }
  return {create};
})();
