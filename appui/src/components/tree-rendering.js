/* Tree node DOM and event wiring, with host-owned selection/expansion state. */
var AppUITreeRendering = (() => {
  function create({ rowDecorations, checkedPaths, getActivePath, setActivePath, _isExpanded, _isCollapsed, basePadding, indent, alignLeafIndent, listen, _dbg, _toggleNode, container, opts, isDraggable, _clearDragOver, _setExpanded, appendChildren }) {
    function _buildNode(node, depth, isRoot) {
      const wrap = document.createElement('div');
      wrap.className = 'tree-node-wrap';

      const row = document.createElement('div');
      const canExpand = node.hasChildren !== false;
      row.className = 'tree-row' + (node.path === getActivePath() ? ' active' : '')
        + (canExpand ? ' tree-folder' : ' tree-file');
      row.dataset.path = node.path || '';
      row.title = node.title || node.path || node.name || '';
      row.setAttribute('role', 'treeitem');
      row.setAttribute('aria-expanded', canExpand ? String(_isExpanded(node.path)) : 'false');
      row.style.paddingLeft = (basePadding + depth * indent) + 'px';

      // Twisty
      const twist = document.createElement('span');
      twist.className = 'twisty';
      if (canExpand) {
        twist.textContent = _isExpanded(node.path) ? '▾' : '▸';
      } else {
        twist.textContent = ' ';
        if (alignLeafIndent) twist.style.visibility = 'hidden';
        else twist.style.display = 'none';
      }

      // Icon (optional). Supports an overlapped badge glyph via node.iconBadge
      // (e.g. a 🔗 link badge composited onto a 📁 folder) rather than two emoji
      // sitting side-by-side. The badge sits over the base icon's bottom-right.
      const iconEl = document.createElement('span');
      iconEl.className = 'tree-icon';
      if (node.iconBadge) {
        iconEl.classList.add('tree-icon-badged');
        const base = document.createElement('span');
        base.className = 'tree-icon-base';
        base.textContent = node.icon || '';
        const bdg = document.createElement('span');
        bdg.className = 'tree-icon-badge' + (node.iconBadgeClass ? ' ' + node.iconBadgeClass : '');
        bdg.textContent = node.iconBadge;
        iconEl.append(base, bdg);
      } else {
        iconEl.textContent = node.icon || '';
      }

      // Name
      const nameEl = document.createElement('span');
      nameEl.className = 'tree-name';
      nameEl.textContent = node.name || '';
      // Per-node text style hook: a derived/twin node (converted .htm/.md/_files
      // under an original) renders in ITALIC via a node class. node.className is
      // a space-separated extra-class string applied to the row; node.italic is
      // a convenience flag. No-op for ordinary nodes.
      if (node.className) {
        String(node.className).split(/\s+/).forEach((c) => { if (c) row.classList.add(c); });
      }
      if (node.italic) nameEl.style.fontStyle = 'italic';

      row.append(twist, iconEl, nameEl);
      if (opts.checkable && (typeof opts.checkable !== 'function' || opts.checkable(node))) {
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.className = 'tree-checkbox';
        input.setAttribute('aria-label', 'Select ' + (node.name || node.path));
        input.checked = checkedPaths.has(node.path);
        row.insertBefore(input, iconEl);
        listen(input, 'click', event => event.stopPropagation());
        listen(input, 'keydown', event => event.stopPropagation());
        listen(input, 'change', () => {
          if (input.checked) checkedPaths.add(node.path); else checkedPaths.delete(node.path);
          container.querySelectorAll('.tree-checkbox').forEach(other => {
            other.checked = checkedPaths.has(other.closest('.tree-row').dataset.path);
          });
          if (opts.onCheck) opts.onCheck(node, input.checked, [...checkedPaths]);
        });
      }
      if (node.badge) {
        const badge = document.createElement('span');
        badge.className = 'tree-badge' + (node.badgeClass ? ' ' + node.badgeClass : '');
        badge.textContent = node.badge;
        badge.title = node.badgeTitle || node.badge;     // full text when ellipsized
        row.appendChild(badge);
      }
      wrap.appendChild(row);
      // Additive host hook: let a caller decorate the row with inline controls
      // or extra badges the declarative fields can't express (e.g. the catalog
      // chain tree's "write" pill, the dependency tree's colored type dot). It
      // runs after the standard row is built and must not replace it. No-op for
      // callers that don't pass it, so existing trees are unchanged.
      if (typeof opts.decorateRow === 'function') {
        const decorate = () => {
          try { opts.decorateRow(node, row, { nameEl, iconEl, twist }); } catch (_e) { /* a bad decorator must not break the tree */ }
        };
        rowDecorations?.set(row, decorate);
        decorate();
      }
      // Children container
      const children = document.createElement('div');
      children.className = 'tree-children';
      wrap.appendChild(children);

      // Twisty click -> expand/collapse
      if (canExpand) {
        listen(twist, 'click', (e) => {
          _dbg("[tree] CLICK twisty", (node && node.path), "isTrusted=" + e.isTrusted);
          e.stopPropagation();
          _toggleNode(node, children, twist, depth, false, row);
        });
      }

      // Row click -> select (or expand if parent node)
      listen(row, 'click', (ev) => {
        _dbg("[tree] CLICK row", (node && node.path), "isTrusted=" + (ev && ev.isTrusted));
        if (canExpand) {
          _toggleNode(node, children, twist, depth, false, row);
        }
        // Activate THIS specific row only. Matching by path (setActive) would
        // highlight EVERY row sharing the same relative path — e.g. a
        // ``README.md`` that exists under BOTH the guest and common roots would
        // light up in both. Clicking marks the exact clicked node.
        container.querySelectorAll('.tree-row.active').forEach(r => r.classList.remove('active'));
        row.classList.add('active');
        setActivePath(node.path || '');
        if (opts.onSelect) opts.onSelect(node);
      });

      // Context menu
      if (opts.contextMenu) {
        listen(row, 'contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const items = opts.contextMenu(node);
          if (items && items.length && typeof AppUIContextMenu !== 'undefined') {
            AppUIContextMenu.show(e, items);
          }
        });
      } else if (opts.onContextMenu) {
        listen(row, 'contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          opts.onContextMenu(node, e);
        });
      }

      // Draggable
      if (isDraggable) {
        row.draggable = true;
        listen(row, 'dragstart', (e) => {
          e.stopPropagation();
          e.dataTransfer.setData('text/plain', node.path || '');
          e.dataTransfer.effectAllowed = 'all';   // allow move + copy + link cursors
          if (opts.onDragStart) opts.onDragStart(node, e);
          row.classList.add('dragging');
        });
        listen(row, 'dragend', () => {
          row.classList.remove('dragging');
          _clearDragOver();
        });
      }

      // Drop target
      if (opts.onDrop) {
        listen(row, 'dragover', (e) => {
          e.preventDefault();
          e.stopPropagation();
          // Cursor feedback mirrors the drop semantics: Alt = link, Ctrl/⌘ =
          // copy, else move (see the explorer's onDrop modifier mapping).
          e.dataTransfer.dropEffect = e.altKey ? 'link' : ((e.ctrlKey || e.metaKey) ? 'copy' : 'move');
          row.classList.add('drag-over');
        });
        listen(row, 'dragleave', () => {
          row.classList.remove('drag-over');
        });
        listen(row, 'drop', (e) => {
          e.preventDefault();
          e.stopPropagation();
          row.classList.remove('drag-over');
          opts.onDrop(node, e);
        });
      }

      // Auto-expand: if node has inline children, render them immediately (no async)
      // Otherwise fall back to onExpand callback
      // #1 (evaluated): the chunked `appendChildren` below bounds the SIBLING-
      // width freeze (a folder with thousands of entries). A node seeded with
      // INLINE children at many PRE-EXPANDED levels still recurses synchronously
      // within a chunk (each _buildNode re-enters appendChildren for its own
      // inline children). In practice that doesn't jank because deep trees are
      // seeded ONE LEVEL at a time and fetch deeper levels LAZILY via onExpand
      // (the `hasChildren !== false` branch) rather than shipping the whole
      // subtree inline. True windowed virtualization (routing the tree through
      // AppUIVirtualScroll) is a nested-container → flat-list rewrite — deferred
      // until a real deep-pre-expanded tree is measured to jank.
      if (node.children && node.children.length > 0 && !(typeof _isCollapsed === 'function' && _isCollapsed(node.path))) {
        _setExpanded(node.path, true);
        twist.textContent = '▾';
        row?.setAttribute('aria-expanded', 'true');
        // Chunked append (via the host helper) so a node seeded with thousands
        // of inline children doesn't build them all synchronously → freeze.
        // Fallback to a plain loop if the helper wasn't provided (older host).
        if (typeof appendChildren === 'function') {
          appendChildren(children, node.children, depth + 1);
        } else {
          node.children.forEach(child => {
            children.appendChild(_buildNode(child, depth + 1, false));
          });
        }
      } else if (_isExpanded(node.path) && node.hasChildren !== false) {
        _toggleNode(node, children, twist, depth, true, row);
      } else if (node.children && node.children.length > 0) {
        // inline children the user collapsed: drawn closed (expanding rebuilds them)
        twist.textContent = '▸';
        row?.setAttribute('aria-expanded', 'false');
      }

      return wrap;
    }

    return _buildNode;
  }
  return {create};
})();
window.AppUITreeRendering = AppUITreeRendering;
