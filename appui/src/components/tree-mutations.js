/* Incremental rendered-tree insertion/removal. */
var AppUITreeMutations = (() => {
  function create({ container, basePadding, indent, _buildNode, isDestroyed }) {
    function insertNode(parentPath, nodeData) {
      if (isDestroyed()) return;
      // Find parent's children container
      const normalized = (parentPath || '').replace(/\\/g, '/');
      const rows = container.querySelectorAll('.tree-row');
      let parentWrap = null;
      let parentDepth = 0;
      for (const row of rows) {
        const rpath = (row.dataset.path || '').replace(/\\/g, '/');
        if (rpath === normalized || row.dataset.path === parentPath) {
          parentWrap = row.closest('.tree-node-wrap');
          const pl = parseInt(row.style.paddingLeft) || 0;
          parentDepth = Math.round((pl - basePadding) / indent);
          break;
        }
      }
      if (!parentWrap) return false;
      let childContainer = parentWrap.querySelector('.tree-children');
      if (!childContainer) {
        childContainer = document.createElement('div');
        childContainer.className = 'tree-children';
        parentWrap.appendChild(childContainer);
      }
      // Build the node
      const node = {
        name: nodeData.name,
        path: parentPath + '/' + nodeData.name,
        hasChildren: nodeData.type === 'dir',
        icon: nodeData.icon || (nodeData.type === 'dir' ? '📂' : ''),
      };
      // Skip if a child with this name already exists (e.g. re-upload / overwrite)
      // — leave the existing row rather than duplicating it.
      const _existingNames = childContainer.querySelectorAll(':scope > .tree-node-wrap > .tree-row > .tree-name');
      for (const _el of _existingNames) {
        if ((_el.textContent || '') === nodeData.name) return true;
      }
      const newEl = _buildNode(node, parentDepth + 1, false);
      // Insert sorted (folders first, then alphabetical)
      const existing = childContainer.querySelectorAll(':scope > .tree-node-wrap > .tree-row');
      let inserted = false;
      for (const row of existing) {
        const isFolder = row.classList.contains('tree-folder');
        const rowName = row.querySelector('.tree-name')?.textContent || '';
        if (node.hasChildren && !isFolder) { childContainer.insertBefore(newEl, row.closest('.tree-node-wrap')); inserted = true; break; }
        if (node.hasChildren === isFolder && nodeData.name.localeCompare(rowName) < 0) { childContainer.insertBefore(newEl, row.closest('.tree-node-wrap')); inserted = true; break; }
      }
      if (!inserted) childContainer.appendChild(newEl);
      return true;
    }

    function removeNode(path) {
      if (isDestroyed()) return;
      const normalized = (path || '').replace(/\\/g, '/');
      const rows = container.querySelectorAll('.tree-row');
      for (const row of rows) {
        const rpath = (row.dataset.path || '').replace(/\\/g, '/');
        if (rpath === normalized || row.dataset.path === path) {
          const wrap = row.closest('.tree-node-wrap');
          if (wrap) { wrap.remove(); return true; }
        }
      }
      return false;
    }

    return {insertNode, removeNode};
  }
  return {create};
})();
window.AppUITreeMutations = AppUITreeMutations;
