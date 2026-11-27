/* FileExplorer session-cache tree prebuild, independent of DOM and instance state. */
window._AppUIFileExplorerSessionPrebuild = (() => {
      function build(roots, {readExpanded, readCache, backendFor, cacheKey, sortEntries, fileIcon, now = Date.now}) {
      // Build tree nodes with inline children from sessionStorage cache
      // This makes AppUITree render the full expanded tree instantly (no async onExpand calls)
      let expanded = {};
      expanded = readExpanded() || {};

      function _buildChildren(parentPath, parentBackend, ancestors = new Set()) {
        // Resolve the backend that owns this subtree (same resolution expandNode
        // uses) so prebuilt children carry a backendRef and remain expandable —
        // without it, expanding a prebuilt dir fell back to path-based resolution
        // and could hit the WRONG root's backend (e.g. common children trying the
        // "My storage" backend → empty). Key the cache the SAME way cachedFileLs
        // does: `<backendId>|<path>` (NOT the bare path), else we read nothing.
        const be = parentBackend || backendFor(parentPath);
        if (be && be.noPersistCache) return null;
        const ssKey = 'fe_ls_' + cacheKey(parentPath, be);
        if (ancestors.has(ssKey)) return null;
        const visited = new Set(ancestors); visited.add(ssKey);
        try {
          const stored = readCache(ssKey);
          if (!stored) return null;
          const parsed = JSON.parse(stored);
          if (!parsed || !parsed.data || !parsed.data.entries) return null;
          if (now() - parsed.ts > 60000) return null; // expired
          const entries = parsed.data.entries.filter(e => !e.name.startsWith('~$'));
          const sorted = sortEntries(entries);
          return sorted.map(entry => {
            const childPath = entry.path || (parentPath + '/' + entry.name);
            const isDir = entry.type === 'dir';
            const ext = entry.name.match(/\.[^.]+$/)?.[0] || '';
            const node = {
              name: entry.name,
              path: childPath,
              icon: isDir ? '📂' : fileIcon(ext),
              hasChildren: isDir,
              data: isDir ? { writable: true, backendRef: be, id: entry.id }
                          : { file: { name: entry.name, path: childPath, ext }, backendRef: be, id: entry.id },
            };
            // Recursively add children if this node was expanded
            if (isDir && expanded[childPath]) {
              const kids = _buildChildren(childPath, be, visited);
              if (kids) node.children = kids;
            }
            return node;
          });
        } catch (_) {
          return null;
        }
      }

      return roots.map(node => {
        // ``node`` is already a built tree node (from _buildTreeRoots) with the
        // correct data.backendRef + data.rootBase + synthetic path. Do NOT re-run
        // _specToNode on it (that expects a RAW spec and would null out backendRef
        // and set rootBase to the synthetic '__rootN' key → prebuilt children
        // unexpandable). Attach cached children in place.
        if (!node.data?.collection && expanded[node.path]) {
          const rootBackend = (node.data && node.data.backendRef) || null;
          const base = (node.data && node.data.rootBase != null) ? node.data.rootBase : (node.path || '');
          const kids = _buildChildren(base, rootBackend);
          if (kids) node.children = kids;
        }
        return node;
      });
    }

  return {build};
})();
