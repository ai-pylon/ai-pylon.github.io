/** Internal FileExplorer root identity, node shapes, ordering, and icons. */
const AppUIFileExplorerNodeModel = (() => {
  function create({ roots, treeOptions }) {
    // Strip a leading synthetic root segment ("__root0/…") from a path. The tree
    // gives each path-less storage root a UNIQUE key "__rootN" so sibling roots
    // don't collide, but that key is NOT a real storage path — it must never
    // reach a backend write/mkdir/move (that produced files stored under a bogus
    // "__root0/" folder). The real base of a root is '', so drop the prefix.
    function _realDir(path) {
      const p = (path == null ? '' : String(path));
      // Strip ALL leading synthetic "__rootN/" segments (a child under a
      // synthetic root could carry more than one, e.g. "__root0/__root1/x" —
      // stripping only the first left a bogus "__root1/x" path on create).
      let out = p;
      while (/^__root\d+(?:\/|$)/.test(out)) out = out.replace(/^__root\d+(?:\/|$)/, '');
      return out;
    }

    // Count the non-collection ("storage") roots. The synthetic "__rootN" key
    // exists ONLY to disambiguate MULTIPLE path-less roots whose children would
    // otherwise collide in the tree's path-keyed state (e.g. file_storage's "My
    // storage" + "common" both path:''). When there is a SINGLE storage root,
    // there is nothing to collide with, so we key rows by their REAL relative
    // path (root = '') and the ugly "__root0/" prefix never appears — the
    // remote_ws workspace tree is exactly this case.
    function _storageRootCount() {
      let n = 0;
      for (const r of roots) { if (!(r && r.type === 'collection')) n++; }
      return n;
    }
    // Canonical tree key for root spec `r` at index `i`. Non-empty real path →
    // that path. Empty path + MULTIPLE storage roots → synthetic "__rootN".
    // Empty path + SINGLE storage root → '' (real relpath keying; no prefix).
    function _rootKeyFor(r, i) {
      if (r && r.path != null && r.path !== '') return r.path;
      return (_storageRootCount() > 1) ? ('__root' + i) : '';
    }

    // Build the top-level root tree nodes. A path-less root gets a UNIQUE
    // synthetic key '__rootN' ONLY when several such roots coexist (so siblings
    // don't collide in the tree's path-keyed expand/active state); a lone root
    // keys by '' (real relpath). Its REAL base stays in data.rootBase. SHARED by
    // init and refresh() so the root node PATHS (and persisted-expansion keys)
    // are identical — otherwise refresh rebuilt roots under a different key, the
    // persisted expansion didn't apply, and the tree COLLAPSED after a create.
    function _buildTreeRoots() {
      return roots.map((r, i) => {
        if (r && r.type === 'collection') return _specToNode(r);
        const rootKey = _rootKeyFor(r, i);
        return {
          name: r.name || (r.path || '').split(/[/\\]/).pop() || 'root',
          path: rootKey,
          icon: r.icon || '📁',
          iconBadge: r.iconBadge || null,
          hasChildren: true,
          // Merge the root config's OWN data (e.g. a remote_ws workspace root
          // carries data.workspace {name,path}) so downstream consumers (the
          // Properties dialog, context menu) can read the authoritative root
          // identity. The explorer-owned flags win on key collision.
          data: Object.assign({}, (r && r.data) || {},
                { sourceRoot: true, writable: r.writable !== false,
                  backendRef: r.backend || null, rootBase: r.path || '' }),
        };
      });
    }

    // Map a root/collection SPEC to a tree node. Aligned with pylon-server's VFS
    // "mounts" + PylonDB "federation" model: a root can be a STORAGE (has a
    // backend) or a COLLECTION (type:'collection', children:[spec…]) that GROUPS
    // other storages / sub-collections recursively. A collection node carries no
    // backend — it's pure grouping; its member specs are stashed on the node and
    // resolved on expand (see expandNode). This lets a user "add a collection"
    // and get the whole nested subtree in one action.
    function _specToNode(spec) {
      if (spec && spec.type === 'collection') {
        return {
          name: spec.name || 'Collection',
          path: spec.path || ('collection:' + (spec.name || Math.random().toString(36).slice(2))),
          icon: spec.icon || '📚',
          hasChildren: true,
          data: { collection: true, childSpecs: spec.children || [] },
        };
      }
      // Storage root.
      return {
        name: spec.name || (spec.path || '').split(/[/\\]/).pop(),
        path: spec.path,
        icon: spec.icon || '📁',
        hasChildren: true,
        data: { sourceRoot: true, writable: spec.writable !== false,
                mountKey: spec.data && spec.data.mountKey, backendRef: spec.backend || null,
                // The REAL storage base for this root (usually '') — the context
                // menu's New file/folder + expandNode use rootBase, not the node
                // path (which may be a synthetic '__rootN' from the other builder).
                rootBase: spec.path || '',
                collectionData: spec.data },
      };
    }

    function _buildChildNode(entry, be, writable) {
      const _gl = (entry.data && entry.data.gitlabLink) || entry.gitlabLink || null;
      const _virt = !!(entry.data && entry.data.virtual);
      // REFERENCE/LINK metadata — a mount/link node (chat link, http/gerrit/
      // gitlab/eridoc/path/ssh pointer). Computed for BOTH dirs and files so a
      // DIRECTORY link (e.g. an ssh folder that is a git repo) keeps its ref
      // fields on node.data — previously the dir branch dropped them, so a linked
      // folder reached the context menu as a plain local folder (no link/git
      // actions, wrong icon). Extra fields (is_git/isGit, gitTarget, is_workspace/
      // isWorkspace) are passed through so pages can badge/act on them.
      const _isRef = !!(entry.link || entry.mount || entry.ref ||
                        (entry.data && (entry.data.link || entry.data.mount)));
      const _d = entry.data || {};
      const _refData = _isRef ? {
        link: true, mount: !!(entry.mount || _d.mount),
        refKind: entry.refKind || _d.refKind || null,
        origin: entry.origin || _d.origin || null,
        target: entry.target || _d.target || null,
      } : null;
      const _gitExtra = {};
      if (entry.gitTarget || _d.gitTarget) _gitExtra.gitTarget = entry.gitTarget || _d.gitTarget;
      if (entry.isGit || _d.isGit || entry.is_git) _gitExtra.isGit = true;
      if (entry.isWorkspace || _d.isWorkspace || entry.is_workspace) _gitExtra.isWorkspace = true;
      if (entry.type === 'dir') {
        return { name: entry.name, path: entry.path,
                 icon: (_isRef && (entry.badge || entry.icon)) ? (entry.badge || entry.icon) : (entry.icon || '📂'),
                 iconBadge: entry.iconBadge || null, hasChildren: true,
                 data: Object.assign(
                   { writable: writable !== false, backendRef: be, gitlabLink: _gl, virtual: _virt },
                   _refData || {}, _gitExtra) };
      }
      const ext = (entry.name.match(/\.[^.]+$/) || [''])[0];
      const _cs = entry.cloud_state || (entry.cloud ? 'online' : null);
      const _cbadge = _cs === 'online' ? '\u2601' : (_cs === 'local' ? '\u2713' : null);
      return {
        name: entry.name, path: entry.path,
        icon: (_isRef && (entry.badge || entry.icon)) ? (entry.badge || entry.icon) : _fileIcon(ext),
        iconBadge: _cbadge, iconBadgeClass: (_cs ? ('cloud-' + _cs) : null), hasChildren: false,
        data: Object.assign(
          { file: { name: entry.name, path: entry.path, ext, id: entry.id }, backendRef: be,
            id: entry.id, cloud: !!entry.cloud, cloudState: _cs },
          _refData || {}, _gitExtra),
      };
    }

    // --- Tree expansion ---
    function sortEntries(entries) {
      const byName = (left, right) => left.name.localeCompare(right.name);
      if (treeOptions.order === 'folders-first') {
        return [
          ...entries.filter(entry => entry.type === 'dir').sort(byName),
          ...entries.filter(entry => entry.type !== 'dir').sort(byName),
        ];
      }
      return [...entries].sort(byName);
    }

    function _fileIcon(ext) {
      const icons = {
        '.docx': '📝', '.doc': '📝', '.pptx': '📊', '.ppt': '📊',
        '.xlsx': '📈', '.xls': '📈', '.pdf': '📕', '.md': '📓',
        '.html': '🌐', '.json': '📋', '.png': '🖼️', '.svg': '🎨',
        '.puml': '🔧', '.txt': '📄',
      };
      return icons[ext] || '📄';
    }
    return { _realDir, _rootKeyFor, _buildTreeRoots, _specToNode, _buildChildNode, sortEntries, _fileIcon };
  }
  return { create };
})();
