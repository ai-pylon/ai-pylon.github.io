/** Internal FileExplorer lazy expansion for storage, collection, and virtual nodes. */
const AppUIFileExplorerExpansion = (() => {
  function create({ onExpandChildren, _specToNode, _realDir, backendFor, cachedFileLs, sortEntries, _fileIcon }) {
    async function expandNode(node, done) {
      // Virtual/remote nodes: delegate expansion entirely to the hook
      if ((node.data?.virtual || node.data?.remote) && onExpandChildren) {
        const result = await Promise.resolve(onExpandChildren(node, [], []));
        done(Array.isArray(result) ? result : []);
        return;
      }
      // Collection node: expand to its member specs (storages / sub-collections).
      if (node.data?.collection) {
        const kids = (node.data.childSpecs || []).map(_specToNode);
        done(kids);
        return;
      }
      const dirPath = node.path || '';
      const writable = node.data?.writable !== false;
      // For a synthetic root node (unique path like "__root0"), the backend must
      // receive the root's REAL base (``rootBase``, usually "") — not the synthetic
      // key. Prefer rootBase; otherwise STRIP a leading "__rootN/" from the path
      // (a bare "__root0" would otherwise list a non-existent folder → the empty
      // tree on initial load). Children below the root use their real paths.
      const listPath = (node.data && node.data.sourceRoot && node.data.rootBase != null)
        ? _realDir(node.data.rootBase) : _realDir(dirPath);
      // Backend for THIS node: an explicit per-node backend (collection member or
      // root spec) wins over path-based resolution — so two members with the same
      // relative path (e.g. two users' empty-root "") don't collide.
      const nodeBackend = (node.data && node.data.backendRef) || backendFor(listPath);
      try {
        const result = await cachedFileLs(listPath, nodeBackend);
        // Cold file-storage base on first load → unavailable. The listing is
        // empty but NOT cached (see cachedFileLs). Render empty now and RETRY a
        // few times with backoff so the files appear once the base resolves —
        // without the user having to collapse/re-expand the root.
        if (result && result.unavailable) {
          done([]);
          const n = (node.__feRetry = (node.__feRetry || 0) + 1);
          if (n <= 6) setTimeout(() => { try { expandNode(node, done); } catch (e) {} }, 300 * n);
          return;
        }
        node.__feRetry = 0;
        const entries = (result.entries || []).filter(e => !e.name.startsWith('~$'));
        const sorted = sortEntries(entries);
        // TREE-KEY NAMESPACING: the tree keys nodes by `path`. Two sibling roots
        // with an empty real base (e.g. Guest + Common, both "") have children
        // with identical real paths ("README.md") that would COLLIDE — selecting
        // one highlights both. So each child's TREE path is prefixed with the
        // owning root's synthetic "__rootN" key (carried down from the parent),
        // while data.file.path / backend I/O keep the REAL path. _realDir strips
        // the prefix wherever a backend call needs the real path.
        const keyPfx = (function () {
          const m = /^(__root\d+)(?:\/|$)/.exec(dirPath || '');
          return m ? m[1] + '/' : '';
        })();
        const _tk = p => keyPfx + String(p == null ? '' : p);
        let children = sorted.map(entry => {
          // Carry page-provided virtual-node data (gitlab link/file) so the page's
          // onExpandChildren/onSelect can detect it (the builder otherwise drops
          // custom entry.data). Mirrors the cloud flag.
          const _gl = (entry.data && entry.data.gitlabLink) || entry.gitlabLink || null;
          const _virt = !!(entry.data && entry.data.virtual);
          if (entry.type === 'dir') {
            return { name: entry.name, path: _tk(entry.path), icon: entry.icon || '📂',
                     iconBadge: entry.iconBadge || null, hasChildren: true,
                     data: { writable, backendRef: nodeBackend, gitlabLink: _gl, virtual: _virt } };
          }
          const ext = entry.name.match(/\.[^.]+$/)?.[0] || '';
          const _cs = entry.cloud_state || (entry.cloud ? 'online' : null);
          const _cbadge = _cs === 'online' ? '\u2601' : (_cs === 'local' ? '\u2713' : null);
          // REFERENCE/LINK file (VFS mount: chat link, http/gerrit/gitlab/eridoc/
          // path pointer): the backend entry carries link/mount/ref + a per-kind
          // badge + ref metadata. Preserve them so the node renders as a 🔗 link
          // (badge icon) and onSelect/the context menu can detect it. Previously
          // dropped → a reference looked like a plain file (or didn't stand out).
          const _isRef = !!(entry.link || entry.mount || entry.ref ||
                            (entry.data && (entry.data.link || entry.data.mount)));
          const _refIcon = _isRef ? (entry.badge || entry.icon || '\uD83D\uDD17') : null;
          return {
            name: entry.name, path: _tk(entry.path),
            icon: _refIcon || _fileIcon(ext),
            iconBadge: _cbadge, iconBadgeClass: (_cs ? ('cloud-' + _cs) : null), hasChildren: false,
            data: Object.assign(
              { file: { name: entry.name, path: entry.path, ext, id: entry.id },
                backendRef: nodeBackend, id: entry.id, cloud: !!entry.cloud,
                cloudState: _cs, altUrl: entry.alt_url || null, gitlabLink: _gl },
              _isRef ? { link: true, mount: !!(entry.mount || (entry.data && entry.data.mount)),
                         refKind: entry.refKind || (entry.data && entry.data.refKind) || null,
                         origin: entry.origin || (entry.data && entry.data.origin) || null,
                         target: entry.target || (entry.data && entry.data.target) || null } : {}),
          };
        });
        // Hook: let pages augment children with virtual nodes
        if (onExpandChildren) {
          const augmented = await Promise.resolve(onExpandChildren(node, children, entries));
          if (Array.isArray(augmented)) children = augmented;
        }
        done(children);
      } catch (e) {
        done([]);
      }
    }
    return { expandNode };
  }
  return { create };
})();
