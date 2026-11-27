/**
 * AppUITree  --  lazy-expanding tree component
 *
 * Usage:
 *   const tree = AppUITree.create({
 *     container: document.getElementById('tree'),
 *     onSelect: (node) => { console.log('selected', node.path); },
 *     onExpand: (node, callback) => {
 *       fetch('/api/children?path=' + node.path).then(r => r.json()).then(children => {
 *         callback(children); // [{name, path, icon, hasChildren, data}]
 *       });
 *     },
 *     onDrop: (node, data) => { console.log('dropped on', node.path, data); },
 *     draggable: true,
 *     storageKey: 'myTree:expanded'
 *   });
 *   tree.setRoots([{name: 'Root', path: '/', hasChildren: true}]);
 *   tree.setActive('/some/path');
 *   tree.expandTo('/some/deep/path');
 *
 * Node: {name, path, icon, hasChildren, data}
 *   - name: display text
 *   - path: unique identifier / path string
 *   - icon: optional emoji or HTML
 *   - hasChildren: boolean, whether twisty should appear
 *   - data: any page-specific state
 *
 * Options:
 *   - container: DOM element for the tree
 *   - onSelect(node): called when a node is clicked
 *   - checkable: true or predicate(node), enables independent checkboxes
 *   - checkedPaths: initial checked node paths (no implicit descendant cascade)
 *   - onCheck(node, checked, paths): called when a checkbox changes
 *   - onExpand(node, callback): called when a node is expanded; callback receives children array
 *   - onDrop(node, transferData): called when something is dropped on a node
 *   - draggable: boolean (default false)  --  make tree nodes draggable
 *   - onDragStart(node, event): called when drag starts on a node
 *   - storageKey: localStorage key for expanded state (default: 'uitree:expanded')
 *   - indent: pixels per depth level (default: 12)
 *   - basePadding: base left padding (default: 8)
 *   - alignLeafIndent: reserve the disclosure-column width for leaves so
 *     file and folder names line up (default: true)
 *   - autoScrollActive: scroll the highlighted/active item into view (default true)
 *   - matchFn(node, lowercasedQuery): optional custom filter predicate (default
 *     matches node.name only); return true to keep the node. Used with
 *     searchable / setFilter so a tree can match on more than the name.
 *   - decorateRow(node, rowEl, {nameEl, iconEl, twist}): optional hook to append
 *     inline controls/badges a declarative field can't express (e.g. a "write"
 *     pill or a colored type dot). Runs after the standard row is built.
 *     tree.refreshDecorations() reapplies it in place; keep decorators idempotent.
 */
const AppUITree = (function() {
  'use strict';

  // Diagnostic logging for tree expand/collapse/toggle — OFF by default so it
  // never spams the console in normal use. Opt in with
  //   localStorage.setItem('appui.treeDebug','1')   (persists)   or
  //   window.__APPUI_TREE_DEBUG = true               (this session)
  // then reload. (These logs traced a deep-link re-expand bug; kept behind the
  // flag so they're recoverable without shipping console noise.)
  let _TREE_DEBUG = null;
  function _treeDebug() {
    if (_TREE_DEBUG === null) {
      try {
        _TREE_DEBUG = !!(window.__APPUI_TREE_DEBUG) ||
          (typeof localStorage !== 'undefined' && localStorage.getItem('appui.treeDebug') === '1');
      } catch (e) { _TREE_DEBUG = false; }
    }
    return _TREE_DEBUG;
  }
  function _dbg() {
    if (!_treeDebug()) return;
    try { console.log.apply(console, arguments); } catch (e) { /* ignore */ }
  }

  function create(opts) {
    opts = opts || {};
    const container = opts.container;
    if (!container) throw new Error('AppUITree: container is required');

    const storageKey = opts.storageKey || null;
    const indent = Number.isFinite(opts.indent) ? opts.indent : 12;
    const basePadding = Number.isFinite(opts.basePadding) ? opts.basePadding : 8;
    const alignLeafIndent = opts.alignLeafIndent !== false;
    const isDraggable = !!opts.draggable;
    const autoScrollActive = opts.autoScrollActive !== false;
    const checkedPaths = new Set(opts.checkedPaths || []);
    const rowDecorations = new WeakMap();
    function setCheckedPaths(paths) {
      checkedPaths.clear();
      for (const path of paths || []) checkedPaths.add(path);
      container.querySelectorAll('.tree-checkbox').forEach(input => {
        input.checked = checkedPaths.has(input.closest('.tree-row').dataset.path);
      });
    }

    let expandedState = {};
    if (storageKey) {
      expandedState = AppUIStorage.getJSON(storageKey, {}) || {};
    }

    let destroyed = false;
    let activationTimer = null;
    const scrollFrames = new Set();
    // Pending chunked-append rAF ids, cancelled on destroy / collapse so a huge
    // folder's in-flight build stops cleanly.
    const buildFrames = new Set();
    // FREEZE FIX: build a node's children in CHUNKS across animation frames when
    // there are many siblings. A folder with thousands of entries otherwise
    // appends thousands of row subtrees in ONE synchronous pass → the tab
    // freezes (same class of bug as the sysdoc outline). Small sets build
    // synchronously (instant); large sets paint the first chunk immediately and
    // stream the rest, keeping the UI responsive. `depthFor(child)` yields the
    // child's depth (roots use 0; children use parent depth + 1).
    const _CHUNK = 120;
    function _appendChildren(childContainer, childNodes, depthFor) {
      const nodes = childNodes || [];
      if (nodes.length <= _CHUNK) {
        const frag = document.createDocumentFragment();
        for (const c of nodes) frag.appendChild(_buildNode(c, depthFor(c), false));
        childContainer.appendChild(frag);
        return;
      }
      let i = 0;
      // Tag this container's in-flight build so a collapse/re-expand supersedes it.
      const token = (childContainer.__buildTok = (childContainer.__buildTok || 0) + 1);
      const step = () => {
        if (destroyed || childContainer.__buildTok !== token) return;
        const frag = document.createDocumentFragment();
        const end = Math.min(nodes.length, i + _CHUNK);
        for (; i < end; i++) frag.appendChild(_buildNode(nodes[i], depthFor(nodes[i]), false));
        childContainer.appendChild(frag);
        if (i < nodes.length) {
          const f = requestAnimationFrame(step);
          buildFrames.add(f);
        }
      };
      const f = requestAnimationFrame(step);
      buildFrames.add(f);
    }
    function listen(target, event, callback) {
      const guarded = e => {if (!destroyed) callback(e);};
      target.addEventListener(event, guarded);
      return guarded;
    }
    let activePath = null;
    let roots = [];
    let _filteredRoots = null; // null = no filter active
    let filterText = '';

    // Search support
    let _searchEl = null;
    if (opts.searchable) {
      _searchEl = document.createElement('input');
      _searchEl.type = 'text';
      _searchEl.className = 'tree-search';
      _searchEl.placeholder = opts.searchPlaceholder || 'Search...';
      _searchEl.style.cssText = 'width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:4px;background:var(--bg-elevated);color:var(--text-primary);font-size:12px;margin-bottom:6px;box-sizing:border-box;';
      container.before(_searchEl);
      listen(_searchEl, 'input', () => setFilter(_searchEl.value));
    }

    function setFilter(query) {
      if (destroyed) return;
      filterText = String(query || '').trim().toLowerCase();
      if (_searchEl) _searchEl.value = String(query || '');
      _filteredRoots = filterText ? _filterNodes(roots, filterText) : null;
      _render();
    }

    function _filterNodes(nodes, query) {
      const result = [];
      // A caller may match on more than the name (e.g. the catalog tree matches
      // a tool's description too) via opts.matchFn(node, query) → boolean. The
      // query passed in is already lowercased. Default stays name-only.
      const matchFn = (typeof opts.matchFn === 'function') ? opts.matchFn : null;
      for (const node of nodes) {
        const nameMatch = matchFn ? !!matchFn(node, query) : (node.name || '').toLowerCase().includes(query);
        // Children can live inline (node.children — what the renderer expands)
        // OR under node.data.children; recurse whichever is present so the
        // filter's auto-expand matches how the tree actually renders.
        const kids = (node.children && node.children.length) ? node.children
          : (node.data?.children || []);
        const children = kids.length ? _filterNodes(kids, query) : [];
        if (nameMatch || children.length > 0) {
          const clone = Object.assign({}, node);
          if (children.length > 0) {
            // Write the filtered children back to WHERE this node carries them,
            // so the renderer (node.children) and any data.children consumer agree.
            if (node.children && node.children.length) clone.children = children;
            else clone.data = Object.assign({}, clone.data, { children });
            clone.hasChildren = true;
            // Auto-expand matching groups
            _setExpanded(clone.path, true);
          }
          result.push(clone);
        }
      }
      return result;
    }

    function _saveState() {
      if (storageKey) AppUIStorage.setJSON(storageKey, expandedState);
    }

    function _isExpanded(path) {
      return !!expandedState[path];
    }

    function _setExpanded(path, expanded) {
      if (destroyed) return;
      if (expanded) expandedState[path] = true;
      // a COLLAPSE is remembered explicitly (false), so a node that carries INLINE children - drawn
      // expanded by default - stays collapsed across a re-render / reload (absent = never toggled)
      else expandedState[path] = false;
      _saveState();
    }

    // true when the user collapsed this node (vs. never toggled it)
    function _isCollapsed(path) { return expandedState[path] === false; }

    function setRoots(nodes) {
      if (destroyed) return;
      roots = nodes || [];
      _filteredRoots = filterText ? _filterNodes(roots, filterText) : null;
      _render();
    }

    function _render() {
      if (destroyed) return;
      container.replaceChildren();
      const displayRoots = _filteredRoots !== null ? _filteredRoots : roots;
      _appendChildren(container, displayRoots, () => 0);
    }

    const _buildNode = AppUITreeRendering.create({ rowDecorations, checkedPaths, getActivePath: () => activePath, setActivePath: value => { activePath = value; }, _isExpanded, _isCollapsed, basePadding, indent, alignLeafIndent, listen, _dbg, _toggleNode, container, opts, isDraggable, _clearDragOver, _setExpanded, appendChildren: (c, nodes, depth) => _appendChildren(c, nodes, () => depth) });

    function _toggleNode(node, container, twist, depth, forceOpen, row) {
      const expanded = _isExpanded(node.path);
      _dbg("[tree] toggle", (node && node.path), expanded ? (forceOpen ? "(re-expand)" : "→collapse") : "→expand", "forceOpen=" + !!forceOpen);
      if (expanded && !forceOpen) {
        // Collapse
        _setExpanded(node.path, false);
        container.replaceChildren();
        twist.textContent = '▸';
        row?.setAttribute('aria-expanded', 'false');
        return;
      }

      // Expand
      _setExpanded(node.path, true);
      twist.textContent = '▾';
      row?.setAttribute('aria-expanded', 'true');

      // INLINE children and no onExpand (e.g. the charts library): build them again. A collapse
      // emptied the container and nothing else would refill it - the node showed open but empty.
      // (A tree WITH onExpand keeps asking it: its inline children may only be a first seed.)
      if (!opts.onExpand && node.children && node.children.length) {
        container.replaceChildren();
        _appendChildren(container, node.children, () => depth + 1);
        return;
      }

      if (!opts.onExpand) return;

      // Show a spinner on the twist while children load (async backends like the
      // GitLab link tree or a remote scope can take a moment). Restore the arrow
      // when done() fires. Guard with a token so a fast collapse/re-expand can't
      // let a stale callback flip the arrow back.
      const _spinTok = (twist.__spinTok = (twist.__spinTok || 0) + 1);
      twist.textContent = '';
      twist.classList.add('is-loading');
      let _spun = true;
      const _stopSpin = () => {
        if (!_spun || twist.__spinTok !== _spinTok) return;
        _spun = false;
        twist.classList.remove('is-loading');
        twist.textContent = _isExpanded(node.path) ? '▾' : '▸';
      };

      opts.onExpand(node, (childNodes) => {
        if (destroyed) return;
        _stopSpin();
        container.replaceChildren();
        _appendChildren(container, childNodes, () => depth + 1);
      });
    }

    function _clearDragOver() {
      container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    }

    function setActive(path) {
      if (destroyed) return;
      activePath = path;
      const normalized = path ? path.replace(/\\/g, '/') : '';
      container.querySelectorAll('.tree-row.active').forEach(r => r.classList.remove('active'));
      container.querySelectorAll('.tree-row').forEach(r => {
        const rpath = (r.dataset.path || '').replace(/\\/g, '/');
        if (rpath === normalized || r.dataset.path === path) {
          r.classList.add('active');
          if (autoScrollActive) {
            // Defer until after the current render/expand layout has settled;
            // otherwise a newly revealed child can still be outside the
            // sidebar's scroll viewport.
            let frame;
            frame = requestAnimationFrame(() => {
              scrollFrames.delete(frame);
              if (!destroyed && r.isConnected) r.scrollIntoView({block: 'nearest', inline: 'nearest'});
            });
            scrollFrames.add(frame);
          }
        }
      });
    }

    function highlight(path) {
      setActive(path);
    }

    function expandTo(path, options) {
      if (destroyed) return;
      // Diagnostic: surface every programmatic expand request (helps trace why a
      // deep-link group does/doesn't open). Gated behind the tree-debug flag.
      _dbg("[tree] expandTo", path, options || {});
      // Mark all ancestors as expanded, then re-render
      const includeSelf = !!(options && options.includeSelf);
      const normalized = path.replace(/\\/g, '/');
      const parts = normalized.split('/');
      // FAST PATH — avoid the full _render() tree rebuild (which re-toggles every
      // root + every open folder, the visible "tree refreshes when it expands"
      // churn) when nothing actually needs to change: if every ancestor (and the
      // target, when includeSelf) is ALREADY expanded, just ensure the row is
      // active and return. _render() only needs to run when an expand-state bit
      // actually flips.
      let _needsRender = false;
      {
        let acc = '';
        for (let i = 0; i < parts.length - (includeSelf ? 0 : 1); i++) {
          acc += (i > 0 ? '/' : '') + parts[i];
          if (acc && !_isExpanded(acc) && !_isExpanded(acc.replace(/\//g, '\\'))) { _needsRender = true; break; }
        }
      }
      if (!_needsRender) {
        // Already in the desired expand-state → no rebuild. Just (re)activate the
        // target row if it's present (cheap, class-only; no re-render).
        try {
          let found = container.querySelector('.tree-row[data-path="' + CSS.escape(path) + '"]')
                   || container.querySelector('.tree-row[data-path="' + CSS.escape(normalized) + '"]');
          if (found) { setActive(found.dataset.path); }
        } catch (e) {}
        return;
      }
      let accumulated = '';
      for (let i = 0; i < parts.length - (includeSelf ? 0 : 1); i++) {
        accumulated += (i > 0 ? '/' : '') + parts[i];
        if (accumulated) {
          // Try both forward-slash and backslash versions
          _setExpanded(accumulated, true);
          _setExpanded(accumulated.replace(/\//g, '\\'), true);
        }
      }
      // Also expand with original separators
      const origParts = path.split(/[\/\\]/);
      let origAcc = '';
      for (let i = 0; i < origParts.length - (includeSelf ? 0 : 1); i++) {
        origAcc += (i > 0 ? '\\' : '') + origParts[i];
        if (origAcc) _setExpanded(origAcc, true);
      }
      _render();
      // Retry setActive until node appears (async children loading)
      let retries = 0;
      if (activationTimer) clearTimeout(activationTimer);
      function tryActivate() {
        if (destroyed) return;
        // Try matching with both separators
        let found = container.querySelector('.tree-row[data-path="' + CSS.escape(path) + '"]');
        if (!found) found = container.querySelector('.tree-row[data-path="' + CSS.escape(normalized) + '"]');
        if (!found) found = container.querySelector('.tree-row[data-path="' + CSS.escape(path.replace(/\//g, '\\')) + '"]');
        if (found) {
          setActive(found.dataset.path);
        } else if (retries < 20) {
          retries++;
          activationTimer = setTimeout(tryActivate, 200);
        }
      }
      tryActivate();
    }

    function refresh() {
      if (destroyed) return;
      _render();
      if (activePath) setActive(activePath);
    }

    // Reveal a deep path by EXPANDING each ancestor and INJECTING its children,
    // then highlight + scroll the leaf — the generic deep-link / tree-navigation
    // primitive shared by every lazy AppUITree (NRM, MOM, …).
    //
    // `path`   — the full node path of the target leaf (same separator the tree
    //            uses for node.path), INCLUDING the rootPath prefix. e.g.
    //            "28.541/ManagedElement/GNBDUFunction/RRMPolicyRatio".
    // `opts.rootPath` — the node path whose children are the FIRST descend level
    //            (e.g. the spec node "28.541"); the leading part of `path`. The
    //            remaining segments after it are the ones we descend. Default ''.
    // `opts.getChildren(ancestorPath, index)` — REQUIRED for a lazy tree: returns
    //            (or resolves to) the child node array to inject UNDER
    //            `ancestorPath` (the node just opened); `index` is 0 for the
    //            rootPath level, 1 for its child, … Return falsy to stop.
    //            Omit for an already-rendered tree (falls back to expandTo).
    // `opts.select` — setActive the leaf when done (default true).
    // Returns Promise<bool> (revealed the leaf?).
    async function revealPath(path, opts2) {
      if (destroyed) return false;
      opts2 = opts2 || {};
      const getChildren = opts2.getChildren;
      const sep = path.indexOf('\\') >= 0 && path.indexOf('/') < 0 ? '\\' : '/';
      const rootPath = opts2.rootPath != null ? String(opts2.rootPath) : '';
      let rest = path;
      if (rootPath && path.indexOf(rootPath + sep) === 0) rest = path.slice(rootPath.length + 1);
      else if (rootPath && path === rootPath) rest = '';
      const segs = rest.split(/[\/\\]/).filter(Boolean);
      if (!segs.length) return false;
      if (typeof getChildren !== 'function') { expandTo(path, { includeSelf: false }); return true; }
      // ancestorPath starts at rootPath; inject its children (segment 0's level),
      // then descend: ancestorPath grows by one segment each step.
      let ancestorPath = rootPath;
      for (let i = 0; i < segs.length; i++) {
        let kids = null;
        try { kids = await Promise.resolve(getChildren(ancestorPath, i)); } catch (e) { kids = null; }
        if (!kids || !kids.length) { return i > 0; }
        try { setChildren(ancestorPath, kids); } catch (e) { /* best-effort */ }
        ancestorPath = ancestorPath ? ancestorPath + sep + segs[i] : segs[i];
        if (i === segs.length - 1) break;   // leaf reached; its own children not needed
      }
      if (opts2.select !== false) setActive(path);
      return true;
    }

    function setChildren(path, children) {
      if (destroyed) return;
      _setExpanded(path, true);
      const normalized = path.replace(/\\/g, '/');
      const rows = container.querySelectorAll('.tree-row');
      for (const row of rows) {
        const rpath = (row.dataset.path || '').replace(/\\/g, '/');
        if (rpath === normalized || row.dataset.path === path) {
          const wrap = row.closest('.tree-node-wrap');
          if (!wrap) break;
          const childContainer = wrap.querySelector('.tree-children');
          if (!childContainer) break;
          const twist = row.querySelector('.twisty');
          if (twist) twist.textContent = '▾';
          row.setAttribute('aria-expanded', 'true');
          const pl = parseInt(row.style.paddingLeft) || 0;
          const depth = Math.round((pl - basePadding) / indent);
          childContainer.replaceChildren();
          _appendChildren(childContainer, children, () => depth + 1);
          break;
        }
      }
    }

    function getExpanded() {
      return { ...expandedState };
    }

    function setExpanded(states) {
      if (destroyed) return;
      expandedState = states || {};
      _saveState();
    }

    function collapseAll() {
      if (destroyed) return;
      expandedState = {};
      _saveState();
      _render();
    }

    function expandAll() {
      if (destroyed) return;
      // Expand all currently rendered nodes (can't expand unloaded children)
      container.querySelectorAll('.tree-node-wrap').forEach(wrap => {
        const row = wrap.querySelector('.tree-row');
        if (row && row.dataset.path) expandedState[row.dataset.path] = true;
      });
      _saveState();
      _render();
    }

    const {insertNode, removeNode} = AppUITreeMutations.create({ container, basePadding, indent, _buildNode, isDestroyed: () => destroyed });

    function expandToLevel(level) {
      if (destroyed) return;
      // Collapse everything, then expand nodes at depth < level
      expandedState = {};
      function _walkNodes(nodes, depth) {
        if (depth >= level) return;
        (nodes || []).forEach(node => {
          if (node.hasChildren !== false) {
            expandedState[node.path] = true;
          }
        });
      }
      _walkNodes(roots, 0);
      // For deeper levels, we need the loaded children  --  re-render triggers expansion
      _saveState();
      _render();
    }

    const keyboard = AppUITreeKeyboard.bind({container, listen});

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      if (activationTimer) clearTimeout(activationTimer);
      activationTimer = null;
      scrollFrames.forEach(frame => cancelAnimationFrame(frame));
      scrollFrames.clear();
      buildFrames.forEach(frame => cancelAnimationFrame(frame));
      buildFrames.clear();
      keyboard.destroy();
      _searchEl?.remove();
      _searchEl = null;
      roots = []; _filteredRoots = null; filterText = ''; activePath = null; expandedState = {};
      container.replaceChildren();
    }

    return {
      destroy,
      isDestroyed: function () { return destroyed; },
      setRoots,
      setCheckedPaths,
      getCheckedPaths: () => [...checkedPaths],
      refreshDecorations() {
        if (destroyed) return;
        container.querySelectorAll('.tree-row').forEach(row => rowDecorations.get(row)?.());
      },
      setFilter,
      setActive,
      highlight,
      setChildren,
      expandTo,
      revealPath,
      refresh,
      getExpanded,
      setExpanded,
      collapseAll,
      expandAll,
      expandToLevel,
      insertNode,
      removeNode
    };
  }

  return { create };
})();
window.AppUITree = AppUITree;

/**
 * Connect an AppUIEventBus to this tree for live file updates.
 * Handles: dir_created, deleted, renamed events on the 'files' channel.
 *
 * Usage: AppUITree.connectEventBus(tree, bus, rootPath)
 */
AppUITree.connectEventBus = function(tree, bus, rootPath) {
    // Handle directory creation
    bus.on('files', 'dir_created', (data) => {
        const path = data.path || '';
        if (!path.startsWith(rootPath)) return;
        const sep = path.includes('/') ? '/' : '\\';
        const parent = path.substring(0, path.lastIndexOf(sep));
        const name = path.substring(path.lastIndexOf(sep) + 1);
        tree.insertNode(parent, { name, type: 'dir' });
    });

    // Handle deletion
    bus.on('files', 'deleted', (data) => {
        const path = data.path || '';
        if (!path.startsWith(rootPath)) return;
        tree.removeNode(path);
    });

    // Handle rename
    bus.on('files', 'renamed', (data) => {
        const oldPath = data.old_path || '';
        const newPath = data.path || '';
        if (!oldPath.startsWith(rootPath) && !newPath.startsWith(rootPath)) return;
        // Remove old, insert new
        tree.removeNode(oldPath);
        const sep = newPath.includes('/') ? '/' : '\\';
        const parent = newPath.substring(0, newPath.lastIndexOf(sep));
        const name = newPath.substring(newPath.lastIndexOf(sep) + 1);
        const type = data.is_dir ? 'dir' : 'file';
        tree.insertNode(parent, { name, type });
    });
};
