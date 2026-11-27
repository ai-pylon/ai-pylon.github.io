/**
 * AppUIFileExplorer — Reusable file explorer sidebar component.
 *
 * Provides a tree-based file browser with:
 *   - Lazy-loading directory expansion (via file.ls API)
 *   - Real-time file monitoring (AppUIFileWatch integration)
 *   - Folder creation, file upload, drag-and-drop
 *   - Context menu with customizable actions
 *   - Search/filter built into the tree
 *
 * Usage:
 *   const explorer = AppUIFileExplorer.create({
 *     container: document.querySelector('.sidebar-content'),
 *     roots: [
 *       { name: 'Project', path: '/path/to/root', icon: '📁', writable: true },
 *     ],
 *     watchPaths: ['/path/to/root'],
 *     onSelect(file) { console.log('Selected:', file.name, file.path); },
 *     onConvert(file, format) { ... },  // optional: enable "Convert to" submenu
 *     formatOptions: { '.docx': ['html','pdf'], '.pptx': ['html','pdf'] },
 *     storageKey: 'my-page-tree',
 *     tree: { order: 'mixed', alignIndent: true, compactIndent: false },
 *   });
 *
 *   explorer.refresh();
 *   explorer.destroy();
 */
const AppUIFileExplorer = (() => {

  // Default conversion format options per extension
  const DEFAULT_FORMATS = {
    '.pptx': ['html', 'pdf', 'png', 'md', 'svg', 'json', 'txt'],
    '.docx': ['html', 'pdf', 'png', 'md', 'txt', 'json'],
    '.xlsx': ['html', 'pdf', 'png', 'json'],
    '.md':   ['html', 'pdf', 'pptx', 'docx'],
    '.puml': ['svg', 'png', 'mermaid'],
    '.plantuml': ['svg', 'png', 'mermaid'],
    '.emf':  ['svg', 'png'],
    '.pdf':  ['html', 'png'],
    '.html': ['pdf'],
    '.mmd':  ['svg', 'png'],
  };

  function create(opts = {}) {
    const container = opts.container;
    if (!container) throw new Error('AppUIFileExplorer: container required');

    const roots = opts.roots || [];
    const watchPaths = opts.watchPaths || roots.map(r => r.path);
    const onSelect = opts.onSelect || function() {};
    const onFolderSelect = opts.onFolderSelect || null;  // (node) => called when folder clicked (for index file handling)
    const onConvert = opts.onConvert || null;
    const onExpandChildren = opts.onExpandChildren || null;  // (node, children, rawEntries) => augmented children or Promise
    const formatOptions = opts.formatOptions || DEFAULT_FORMATS;
    const storageKey = opts.storageKey || 'ai-file-explorer';
    const toolPrefix = opts.toolPrefix || '';  // e.g. 'sysdoc_converter_dev.'
    // Mirrors the current SysDocs Editor layout while allowing pages to opt
    // back into folders-first ordering where that is more useful.
    const treeOptions = Object.assign({
      order: 'mixed',
      alignIndent: true,
      compactIndent: false,
      basePadding: 6,
    }, opts.tree || {});

    let tree = null, chrome = null;
    let watcher = null;

    // --- API helpers ---
    async function callTool(name, params = {}) {
      const r = await fetch('/api/' + name.replace(/\./g, '/'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      return r.json();
    }

        // --- Backend adapter -------------------------------------------------
        // The explorer is backend-agnostic: all storage I/O goes through a pluggable
        // adapter so the SAME tree works over file.* tools (default), the vfs.* app,
        // or the file_storage app. A root may carry its own `backend`; otherwise
        // `opts.defaultBackend` is used; otherwise a built-in file-tool backend that
        // reproduces the original hardcoded behaviour (fully backward compatible).
        //   backend.list(path)  -> Promise<{entries:[{name,type,path,...}]}>
        //   backend.write(path, content_b64) -> Promise  (optional)
        //   backend.mkdir(path) -> Promise               (optional)
        //   backend.delete(node)/rename(from,to)         (optional)
        const _fileToolBackend = {
          list(path) { return callTool('file.ls', { path }); },
          async write(path, content_b64) {
            const r = await callTool(toolPrefix + 'file.write_b64', { path, content_b64 });
            if (r && r._error) {
              const r2 = await callTool('sysdoc_converter_dev.organize', {
                action: 'upload', file: path.split('/').pop(), to: path.replace(/\/[^/]*$/, ''), content_b64,
              });
              if (r2 && r2._error) throw new Error(r2._error);
            }
          },
          async mkdir(folderPath) {
            let r = await callTool('sysdoc_converter_dev.organize', { action: 'create_folder', to: folderPath });
            if (r && r._error) r = await callTool('terminal.exec', { cmd: `mkdir "${folderPath.replace(/\//g, '\\\\')}"` });
          },
          caps: { rename: false, mkdir: true, upload: true },
        };
        const defaultBackend = opts.defaultBackend || _fileToolBackend;
        // Resolve the backend that owns a given node/path: the root whose path is a
        // prefix of `path` and carries its own backend, else the default.
        function backendFor(path) {
          let best = null;
          for (const r of roots) {
            if (!r.backend) continue;
            const rp = r.path || '';
            if (path === rp || (rp && path && path.indexOf(rp + '/') === 0) || !rp) {
              if (!best || (r.path || '').length > (best.path || '').length) best = r;
            }
          }
          return (best && best.backend) || defaultBackend;
        }
    
    const { _realDir, _rootKeyFor, _buildTreeRoots, _specToNode,
      _buildChildNode, sortEntries, _fileIcon } = AppUIFileExplorerNodeModel.create({
      roots, treeOptions,
    });
    const { cachedFileLs, invalidateCache, cacheKey } = AppUIFileExplorerListingCache.create({
      backendFor, defaultBackend,
    });

    function notice(msg, type = 'info') {
      if (opts.onNotice) opts.onNotice(msg, type);
      else if (window.AppUIToast && AppUIToast[type]) AppUIToast[type](msg);
    }

    const { _readDropEntries, uploadFiles, createFolder, createFile, chooseFiles, chooseFolder } =
      AppUIFileExplorerUploads.create({
        backendFor, _realDir, notice, invalidateCache, refresh,
        getTree: () => tree, _fileIcon, onSelect,
      });

    const { _beFor, _destDirFor, deleteNode, moveOrCopyNode, renameNode, moveCopyToDialog } =
      AppUIFileExplorerFileActions.create({
        roots, backendFor, _realDir, notice, invalidateCache, refresh,
      });

    const { _routePathForNode, _persistRoute, _restoreRoute, goToPath } =
      AppUIFileExplorerRouting.create({
        opts, storageKey, roots, defaultBackend, cachedFileLs, getTree: () => tree,
        _realDir, _rootKeyFor, _buildChildNode, sortEntries, onExpandChildren, onSelect,
      });
    const { expandNode } = AppUIFileExplorerExpansion.create({
      onExpandChildren, _specToNode, _realDir, backendFor, cachedFileLs, sortEntries, _fileIcon,
    });
    const showProperties = AppUIFileExplorerProperties.create({
      opts, backendFor, goToPath, expandTo,
    });
    const onContextMenu = AppUIFileExplorerContextMenu.create({
      opts, onConvert, formatOptions, createFile, createFolder,
      chooseFiles, chooseFolder, showProperties, refresh, renameNode,
      moveCopyToDialog, deleteNode, backendFor, onSelect, _fileToolBackend, callTool,
    });

    const dragDrop = AppUIFileExplorerDragDrop.create({
      opts, _beFor, _destDirFor, _readDropEntries, uploadFiles,
      moveOrCopyNode, notice, invalidateCache, refresh,
    });

    // --- Init ---
    function init() {
      chrome = window._AppUIFileExplorerChrome.create({container, opts, createFolder, chooseFiles, refresh});

      // Create tree
      if (typeof AppUITree === 'undefined') {
        container.querySelector('.fe-tree').textContent = 'AppUITree not loaded';
        return;
      }

      const expansionState = window._AppUIFileExplorerExpansionState.prepare({
        roots, startCollapsed: opts.startCollapsed, rootKeyFor: _rootKeyFor,
        read: () => AppUIStorage.getJSON(storageKey, {}),
        write: value => AppUIStorage.setJSON(storageKey, value),
      });
      try {
        tree = AppUITree.create({
          container: container.querySelector('.fe-tree'),
          storageKey,
          draggable: opts.draggable !== false,
          // Allow a page to DISABLE the tree's built-in filter box (opts.searchable
          // === false) — e.g. the remote_ws Workspace tab supplies its own richer
          // Filter/Find widget, so the tree's "Filter files…" was a DUPLICATE field.
          // Defaults true (back-compat).
          searchable: opts.searchable !== false,
          searchPlaceholder: 'Filter files...',
          indent: Number.isFinite(treeOptions.indent)
            ? treeOptions.indent
            : (treeOptions.compactIndent ? 8 : 14),
          basePadding: treeOptions.basePadding,
          alignLeafIndent: treeOptions.alignIndent !== false,
          onSelect(node) {
            if (node.data?.file) {
              // Pass the owning backend + file id along with the file so the host's
              // onSelect reads from the CORRECT account. Without this it only got
              // {name,path,ext} and had to guess the backend by path — which fails
              // when two roots share path "" (e.g. "My storage" vs read-only
              // "common"): the common file was read from My storage → empty.
              var _f = node.data.file;
              var _be = (node.data && node.data.backendRef) || null;
              var _id = (node.data && node.data.id) || (_f && _f.id) || null;
              onSelect(Object.assign({}, _f, { id: _id, backend: _be, backendRef: _be }));
              _persistRoute(_routePathForNode(node));
            } else if (onFolderSelect && node.hasChildren) {
              onFolderSelect(node);
            }
            // NOTE: do NOT call tree.setActive(node.path) here. opts.onSelect fires
            // ONLY from the tree's row-click handler, which has ALREADY marked the
            // exact clicked row active. setActive() matches by PATH and would add
            // .active to EVERY row sharing that relative path — so a file whose
            // relpath exists under two roots/subtrees (e.g. the same file visible
            // under a parent workspace AND a nested folder) would light up (and
            // auto-scroll to) the WRONG row — the reported "clicking a file
            // highlights another file". Programmatic reveals (goToPath, line ~234)
            // still call setActive with the fully-qualified root-prefixed path.
          },
          onExpand: expandNode,
          onContextMenu,
          onDragStart: dragDrop.onDragStart,
          onDrop: dragDrop.onDrop,
        });

        chrome.placeSearchInHeader();

        // Set roots. Thread each root's OWN backend as backendRef so roots that
        // share a relative path (e.g. two file_storage roots both at "") resolve to
        // the correct backend instead of colliding on path-based backendFor — the
        // "clicking Examples expands My storage / both highlight" bug. Also give each
        // root a UNIQUE node path (rootKey) so the tree's path-keyed active/expand
        // state doesn't conflate two empty-path roots.
        const treeRoots = _buildTreeRoots();
      // Pre-build tree with cached children for instant rendering
        const expandedRoots = window._AppUIFileExplorerSessionPrebuild.build(treeRoots, {
          readExpanded: () => AppUIStorage.getJSON(storageKey, {}),
          readCache: key => sessionStorage.getItem(key), backendFor, cacheKey, sortEntries, fileIcon: _fileIcon
        });
        tree.setRoots(expandedRoots);

      } finally {
        expansionState.restore();
      }

      // Restore a deep-linked / refresh-persisted selection from the URL (no-op
      // unless the page passed `routeKey`). Done after setRoots so the tree
      // exists; expandTo lazy-loads any intermediate folders.
      _restoreRoute();

      // File watch integration
      if (typeof AppUIFileWatch !== 'undefined' && watchPaths.length) {
        watcher = AppUIFileWatch.create({
          paths: watchPaths,
          debounce: 600,
          onChange(events) {
            let structuralChange = false;
            for (const evt of events) {
              if (evt.event === 'created' || evt.event === 'deleted' || evt.event === 'renamed') {
                const path = (evt.data?.path || '').replace(/\\/g, '/');
                // Skip artifact directories (golden/converted/diff)
                if (!path.match(/\/(golden|converted|diff)\//)) {
                  structuralChange = true;
                  break;
                }
              }
            }
            if (structuralChange) refresh();
          },
        });
      }
    }

    const folderReload = window.AppUIFileExplorerFolderReload.create({
      container, roots, getTree: () => tree, _realDir, backendFor, cachedFileLs,
      _buildChildNode, onExpandChildren,
    });

    function refresh(scopePath) {
      // scopePath (optional): invalidate ONLY that directory's listing so the
      // other open folders keep their cached listings and don't re-fetch on the
      // setRoots re-expand. Omit for a full clear (structural / unknown scope).
      invalidateCache(scopePath);
      // SCOPED reload: when a specific folder changed (e.g. after an upload) and
      // that folder's row is currently rendered, reload ONLY its children in
      // place (tree.setChildren) instead of rebuilding the WHOLE tree
      // (tree.setRoots) — so other open folders don't collapse/re-fetch and the
      // tree doesn't visibly refresh wholesale. Falls through to the full rebuild
      // when there's no scope, the row isn't rendered, or the backend can't list.
      if (scopePath != null && scopePath !== '' && tree && typeof tree.setChildren === 'function') {
        if (folderReload.reload(scopePath)) return;
      }
      folderReload.invalidate();
      if (tree) {
        // Rebuild roots with the SAME builder/paths as init so the persisted
        // expansion state still applies — otherwise the tree collapsed after a
        // refresh (e.g. right after creating a file). AppUITree re-expands
        // persisted-open roots on setRoots and re-fetches their children.
        tree.setRoots(_buildTreeRoots());
      }
    }
    function expandTo(path, options) {
      if (tree) tree.expandTo(path, options);
    }

    function setActive(path) {
      if (tree) tree.setActive(path);
    }

    function destroy() {
      folderReload.destroy();
      chrome?.destroy(); chrome = null;
      if (watcher) { watcher.destroy(); watcher = null; }
      tree?.destroy?.();
      container.innerHTML = '';
      tree = null;
    }

    init();

    // Runtime multi-root management: add/remove a storage root (e.g. "another
    // user's storage") after creation. The spec is the same {name,path,icon,
    // writable,backend} shape as opts.roots.
    function addRoot(spec) {
      if (!spec || !spec.path) return;
      if (roots.some(r => r.path === spec.path)) return;  // dedupe
      roots.push(spec);
      refresh();
    }
    function removeRoot(path) {
      const i = roots.findIndex(r => r.path === path);
      if (i >= 0) { roots.splice(i, 1); refresh(); }
    }
    // Convenience open/save over the owning root's backend.
    function openNode(node) {
      const p = (node && node.path) || node;
      const be = backendFor(p);
      if (!be.read) return Promise.resolve(null);
      return Promise.resolve(be.read(node && node.path ? node : { path: p })).then(r => {
        const content = r && (r.content != null ? r.content : r);
        if (opts.onOpen) opts.onOpen((node && node.path ? node : { path: p }), content);
        return content;
      });
    }
    function saveNode(path, content, writeOpts) {
      const be = backendFor(path);
      if (!be.write) return Promise.resolve();
      return Promise.resolve(be.write(path, content, writeOpts)).then(() => {
        invalidateCache();
        refresh();
        if (opts.onSave) opts.onSave(path, content);
      });
    }

    return { refresh, expandTo, setActive, destroy, isDestroyed: () => { try { return !!(tree && tree.isDestroyed && tree.isDestroyed()); } catch (e) { return false; } }, invalidateCache, createFolder, chooseFiles, chooseFolder, insertNode: (p, d) => tree.insertNode(p, d), removeNode: (p) => tree.removeNode(p), setChildren: (p, c) => { try { return tree.setChildren(p, c); } catch (e) {} }, addRoot, removeRoot, openNode, saveNode, backendFor, goToPath };
  }

  return { create, DEFAULT_FORMATS };
})();
window.AppUIFileExplorer = AppUIFileExplorer;
