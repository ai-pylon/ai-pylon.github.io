/* Persisted expansion state used while building a FileExplorer tree. */
window._AppUIFileExplorerExpansionState = (() => {
  function prepare({roots, startCollapsed, rootKeyFor, read, write}) {
    let snapshot = null;
    try {
      if (startCollapsed || roots.some(root => root && root.expanded)) {
        const saved = read() || {};
        if (startCollapsed) snapshot = saved;
        const expanded = startCollapsed ? {} : saved;
        roots.forEach((root, index) => {
          if (root && root.expanded) {
            Object.defineProperty(expanded, rootKeyFor(root, index), {
              value: true, enumerable: true, configurable: true, writable: true,
            });
          }
        });
        write(expanded);
      }
    } catch (_) {} // Storage can be unavailable or full; tree creation still works.
    return {
      restore() {
        if (snapshot === null) return;
        const saved = snapshot;
        snapshot = null;
        try { write(saved); } catch (_) {}
      },
    };
  }
  return {prepare};
})();
