/** Internal FileExplorer URL persistence and backend-aware cold-tree navigation. */
const AppUIFileExplorerRouting = (() => {
  function create({ opts, storageKey, roots, defaultBackend, cachedFileLs, getTree,
    _realDir, _rootKeyFor, _buildChildNode, sortEntries, onExpandChildren, onSelect }) {
    // Built-in URL route persistence. When `routeKey` is set, the explorer
    // persists the selected file path to the URL (?appui.<routeId>.<routeKey>)
    // on selection and RESTORES/reveals it after mount — so EVERY page that uses
    // the shared explorer gets deep-linkable, refresh-surviving selection for
    // free, with no per-page router wiring. `routeId` namespaces the param
    // (defaults to the storageKey). Silently inert if AppUIRouter isn't loaded.
    const routeKey = opts.routeKey || null;        // e.g. 'file' / 'path'
    const routeId = opts.routeId || storageKey;    // URL param namespace
    // routeShort: when true, persist/read the deep-link via the BARE key as the
    // query param (e.g. ?wpath=) instead of the verbose ?appui.<id>.<key>= — so
    // the URL stays short and never flickers between the two forms. Opt-in per
    // explorer; the alias target is simply the key itself (no hardcoded map).
    const routeShort = !!opts.routeShort;
    let _router = null;
    function _getRouter() {
      if (!routeKey) return null;
      if (!_router && typeof AppUIRouter !== 'undefined' && AppUIRouter.create) {
        if (routeShort && AppUIRouter.alias) {
          try { AppUIRouter.alias(routeId, routeKey, routeKey); } catch (e) { /* best-effort */ }
        }
        _router = AppUIRouter.create(routeId);
      }
      return _router;
    }
    // Map a selected node to the path to PERSIST in the URL. When the owning
    // root declares a `routePrefix` (e.g. 'common' or '<user>'), the stored path
    // is OWNER-QUALIFIED (``<routePrefix>/<node.path>``) so a reload/deep-link is
    // unambiguous even when multiple roots share a relative path (''). Falls back
    // to the raw node path when no routePrefix is set.
    function _routePathForNode(node) {
      const p = (node && node.path) || '';
      try {
        const beRef = node && node.data && node.data.backendRef;
        for (const r of roots) {
          if (r && r.backend === beRef && r.routePrefix) {
            // Strip the synthetic "__rootN/" tree-key prefix → the REAL relpath.
            const real = p.replace(/^__root\d+\//, '');
            return r.routePrefix.replace(/\/$/, '') + '/' + real;
          }
        }
      } catch (e) { /* best-effort */ }
      // No routePrefix: persist the REAL path (drop the synthetic tree-key).
      return p.replace(/^__root\d+\//, '');
    }
    function _persistRoute(path) {
      const r = _getRouter();
      if (r) { try { r.set(routeKey, path || '', { replace: true, silent: true }); } catch (e) { /* best-effort */ } }
    }
    // Reveal (expand + select) the path saved in the URL, DETERMINISTICALLY.
    // Rather than simulate clicks (which race the tree's async lazy-render), we
    // list each ancestor folder via its backend and inject the children with
    // tree.setChildren — awaiting each list so the next segment is guaranteed to
    // exist before we descend. Works on a COLD tree (nothing cached). After the
    // chain is open we select the leaf AND notify the host onSelect (setActive
    // alone only toggles the .active class; the host must learn of the selection
    // so e.g. file_storage shows the file's folder instead of ALL files).
    async function _revealRoute(want, options) {
      options = options || {};
      const specs = roots.filter(r => !(r && r.type === 'collection'));
      // OWNER-QUALIFIED path (``<routePrefix>/<relpath>``): if `want` starts with
      // a root's routePrefix, that root is the owner — strip the prefix to get
      // the real tree path. Otherwise fall back to probing roots by first segment.
      let qualifiedRoot = null, qualifiedIdx = -1;
      for (let ri = 0; ri < specs.length; ri++) {
        const r = specs[ri];
        if (r && r.routePrefix) {
          const pfx = r.routePrefix.replace(/\/$/, '') + '/';
          if (want === r.routePrefix || want.indexOf(pfx) === 0) {
            qualifiedRoot = r; qualifiedIdx = ri;
            want = want === r.routePrefix ? '' : want.slice(pfx.length);
            break;
          }
        }
      }
      const parts = want.split('/').filter(Boolean);
      if (!parts.length) return false;
      const first = parts[0];
      // Determine the owning root: the routePrefix-matched one, else probe each
      // root's first-level listing for `first`. Lists are cached (cheap repeat).
      let chosen = null;
      if (qualifiedRoot) {
        const r = qualifiedRoot, be = r.backend || defaultBackend, base = _realDir(r.path || '');
        const rootKey = _rootKeyFor(r, roots.indexOf(r));
        chosen = { be, base, writable: r.writable !== false, rootKey };
      }
      for (let ri = 0; !chosen && ri < specs.length; ri++) {
        const r = specs[ri];
        const be = r.backend || defaultBackend;
        const base = _realDir(r.path || '');
        try {
          const res = await cachedFileLs(base, be);
          const entries = (res && res.entries) || [];
          if (entries.some(e => e.name === first || e.path === (base ? base + '/' + first : first))) {
            const rootKey = _rootKeyFor(r, roots.indexOf(r));
            chosen = { be, base, writable: r.writable !== false, rootKey };
            break;
          }
        } catch (e) { /* try next root */ }
      }
      if (!chosen) return false;  // path not under any visible root (base may be cold → retry)
      const be = chosen.be;
      // Inject level-by-level, starting at the ROOT so each parent row exists
      // before we set its children. `injectKey` is the tree node whose children
      // we replace: the synthetic root key for the base level, then real paths.
      // TREE-KEY NAMESPACING: child tree keys are prefixed with the owning
      // root's synthetic "__rootN" key (matching the lazy-expand builder) so
      // same-named files in sibling empty-path roots (Guest/Common README) don't
      // collide. The real backend path stays in data.file.path. `_pfx` is the
      // "__rootN/" prefix when the root base is empty-ish, else "".
      const _pfx = /^__root\d+$/.test(chosen.rootKey) ? (chosen.rootKey + '/') : '';
      let acc = chosen.base;
      let injectKey = chosen.rootKey;
      for (let i = 0; i < parts.length; i++) {
        let res;
        try { res = await cachedFileLs(acc, be); } catch (e) { return; }
        const entries = ((res && res.entries) || []).filter(e => !e.name.startsWith('~$'));
        let children = sortEntries(entries).map(e => {
          const n = _buildChildNode(e, be, chosen.writable);
          n.path = _pfx + n.path;   // namespace the TREE key (data.file.path stays real)
          return n;
        });
        if (onExpandChildren) {
          const aug = await Promise.resolve(onExpandChildren({ path: acc }, children, entries));
          if (Array.isArray(aug)) children = aug;
        }
        try { const tree = getTree(); if (tree && tree.setChildren) tree.setChildren(injectKey, children); } catch (e) { /* best-effort */ }
        // Descend: next level's folder = acc/parts[i]; stop before the leaf.
        if (i < parts.length - 1) {
          acc = acc ? acc + '/' + parts[i] : parts[i];
          injectKey = _pfx + acc;
        }
      }
      // Select the leaf + notify host (same enriched shape a click produces).
      try { const tree = getTree(); if (tree && tree.setActive) tree.setActive(_pfx + want); } catch (e) {}
      // QUIET reveal: skip the host onSelect notification. A reveal triggered BY
      // an already-open file (e.g. the deep-link reveal re-expanding its root)
      // must NOT call onSelect → previewFile again, or it forms an infinite
      // reveal→onSelect→preview→reveal loop (the reported "preview refreshing
      // infinitely"). setActive (highlight only) still runs so the row shows.
      if (options && options.quiet) return true;
      try {
        const ext = (want.indexOf('.') >= 0) ? want.slice(want.lastIndexOf('.')) : '';
        const name = want.indexOf('/') >= 0 ? want.slice(want.lastIndexOf('/') + 1) : want;
        onSelect(Object.assign({ name: name, path: want, ext: ext }, { backend: be, backendRef: be }));
      } catch (e) { /* best-effort */ }
      return true;
    }
    function _restoreRoute() {
      const r = _getRouter();
      if (!r) return;
      let want = null;
      try { want = r.get(routeKey); } catch (e) { /* best-effort */ }
      if (!want) return;
      // Retry with backoff: the owning backend's base can be COLD at init (the
      // file-storage base resolves async via /ports), so the first reveal may
      // find no root. Keep retrying until the base warms and the path resolves,
      // or we exhaust attempts. Deferred a tick first so setRoots has rendered.
      let attempt = 0;
      function tryReveal() {
        Promise.resolve(_revealRoute(want)).then(function (ok) {
          if (ok) return;
          if (attempt++ < 10) setTimeout(tryReveal, 300 + attempt * 150);
        }).catch(function () {
          if (attempt++ < 10) setTimeout(tryReveal, 300 + attempt * 150);
        });
      }
      setTimeout(tryReveal, 0);
    }

    // Public reveal-by-REAL-PATH: resolve the owning root + expand/activate the
    // node WITHOUT the caller needing the explorer's internal "__rootN/" tree
    // key. ``want`` is a root-relative path, optionally owner-qualified with a
    // root's routePrefix (e.g. "workspace/RRP/sub"). _revealRoute probes the
    // roots (routePrefix match, else first-segment listing) so a path-less root
    // is handled internally. Retries while a cold backend base warms. Returns a
    // Promise<bool> (revealed?). This is the supported alternative to expandTo(
    // "__root0/…") — pages should prefer it and never hardcode a root index.
    function goToPath(want, options) {
      want = String(want == null ? '' : want).replace(/^\/+/, '');
      if (!want) return Promise.resolve(false);
      return new Promise(function (resolve) {
        let attempt = 0;
        function tryReveal() {
          Promise.resolve(_revealRoute(want, options)).then(function (ok) {
            if (ok) { resolve(true); return; }
            if (attempt++ < 10) setTimeout(tryReveal, 300 + attempt * 150);
            else resolve(false);
          }).catch(function () {
            if (attempt++ < 10) setTimeout(tryReveal, 300 + attempt * 150);
            else resolve(false);
          });
        }
        setTimeout(tryReveal, 0);
      });
    }
    return { _routePathForNode, _persistRoute, _restoreRoute, goToPath };
  }
  return { create };
})();
