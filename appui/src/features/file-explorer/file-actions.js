/** Internal FileExplorer delete, rename, and intra/cross-backend transfer actions. */
const AppUIFileExplorerFileActions = (() => {
  function create({ roots, backendFor, _realDir, notice, invalidateCache, refresh }) {
    // Resolve the backend for a NODE: prefer its own backendRef (set when the
    // node was built, so sibling empty-path roots don't collide), else fall back
    // to path-matching. Fixes mkdir/rename/delete/move hitting the WRONG store
    // (e.g. a Guest node resolving to the read-only Common backend).
    function _beFor(node) {
      return (node && node.data && node.data.backendRef) || backendFor((node && node.path) || '');
    }

    // Delete a file or folder node via the owning root's backend. Confirms first
    // (AppUIDialog.confirm, else window.confirm), then invalidates + refreshes.
    function deleteNode(node) {
      if (!node || !node.path) return;
      const be = _beFor(node);
      if (!be || typeof be.delete !== 'function') { notice('This location is read-only', 'warn'); return; }
      const name = node.name || node.path.split(/[/\\]/).pop() || node.path;
      const isFolder = !node.data?.file && node.data && !node.data.sourceRoot;
      const msg = 'Delete ' + (isFolder ? 'folder' : 'file') + ' "' + name + '"' +
        (isFolder ? ' and all its contents' : '') + '? This cannot be undone.';
      const run = () => {
        const realPath = _realDir(node.path);
        // Pass id (file) when known so file_storage deletes by id; else by path.
        const target = (node.data && node.data.file && node.data.file.id)
          ? { id: node.data.file.id, path: realPath, name: name }
          : { path: realPath, name: name };
        Promise.resolve(be.delete(target)).then(() => {
          invalidateCache();
          refresh();
          notice('Deleted ' + name, 'success');
        }).catch(e => notice('Could not delete ' + name + ': ' + (e && e.message || e), 'error'));
      };
      if (window.AppUIDialog && AppUIDialog.confirm) AppUIDialog.confirm(msg, run);
      else if (window.confirm(msg)) run();
    }

    // --- Move / Copy -------------------------------------------------------
    // Core primitive: copy (or move) a file/folder node into destDir. Works
    // WITHIN one root's backend (read source → write under destDir → delete the
    // source if moving). Folders recurse. destDir '' = that root's top level.
    // Returns a Promise. Both drag-drop and the "Copy/Move to…" dialog use this.
    // Copy ONE entry (file or folder, recursing) from a SOURCE backend to a
    // DESTINATION backend. When srcBe === dstBe this is an intra-store copy; when
    // they differ it's a CROSS-WORKSPACE copy (read bytes from the source store,
    // write them into the destination store) — the basis for inter-workspace
    // drag-and-drop. destDir '' = the destination root's top level. Returns a
    // Promise. Used by drag-drop and the "Copy/Move to…" dialog.
    function _copyEntryX(srcBe, dstBe, srcPath, destPath) {
      return Promise.resolve(srcBe.list(srcPath)).then(entries => {
        const kids = (entries && entries.entries) || null;
        const looksFolder = Array.isArray(kids);
        if (!looksFolder) {
          return Promise.resolve(srcBe.read({ path: srcPath })).then(r => {
            const content = (r && (r.content != null ? r.content : r)) || '';
            // Prefer a BINARY-safe transfer when both backends expose it (so a
            // non-text file survives a cross-store copy); else fall back to the
            // text write path (back-compat with text-only backends).
            if (r && r.encoding === 'base64' && typeof dstBe.writeBytes === 'function') {
              return dstBe.writeBytes(destPath, content);
            }
            return dstBe.write(destPath, content, {});
          });
        }
        const mk = dstBe.mkdir ? Promise.resolve(dstBe.mkdir(destPath)) : Promise.resolve();
        return mk.then(() => (kids || []).reduce((p, e) => p.then(() => {
          return _copyEntryX(srcBe, dstBe, e.path, destPath + '/' + e.name);
        }), Promise.resolve()));
      });
    }

    // Back-compat single-backend wrapper (unchanged callers).
    function _copyEntry(be, srcPath, destPath) {
      return _copyEntryX(be, be, srcPath, destPath);
    }

    function moveOrCopyNode(node, destDir, copy, dstBe) {
      if (!node || !node.path) return Promise.resolve();
      const srcBe = _beFor(node);
      dstBe = dstBe || srcBe;                 // default: same store (intra-workspace)
      if (!dstBe || typeof dstBe.write !== 'function') { notice('Destination is read-only', 'warn'); return Promise.resolve(); }
      const name = node.name || node.path.split(/[/\\]/).pop();
      const srcPath = _realDir(node.path);
      destDir = _realDir(destDir);
      const dest = (destDir ? destDir.replace(/\/+$/, '') + '/' : '') + name;
      const crossStore = (srcBe !== dstBe);
      if (!crossStore) {
        // Intra-store guards: no-op onto self + can't nest a folder into itself.
        const srcNorm = srcPath.replace(/^\/+|\/+$/g, '');
        const destNorm = dest.replace(/^\/+|\/+$/g, '');
        if (destNorm === srcNorm) return Promise.resolve();
        if ((destNorm + '/').indexOf(srcNorm + '/') === 0) {
          notice('Cannot move a folder into itself', 'warn'); return Promise.resolve();
        }
      }
      const verb = copy ? 'Copied' : 'Moved';
      // SAME-STORE MOVE: prefer the backend's NATIVE rename/move (atomic, works
      // for folders, no byte read/write) when available. copy+delete is only the
      // fallback (and the only option for a cross-store transfer or an actual
      // copy). This is why a same-workspace drag-to-move now uses /v1/vfs/rename
      // instead of a fragile recursive read->write->delete.
      if (!copy && !crossStore && typeof srcBe.rename === 'function') {
        return Promise.resolve(srcBe.rename(srcPath, dest))
          .then(() => { invalidateCache(); refresh(); notice(verb + ' ' + name, 'success'); })
          .catch(e => notice('Could not move ' + name + ': ' + (e && e.message || e), 'error'));
      }
      return _copyEntryX(srcBe, dstBe, srcPath, dest)
        .then(() => (copy ? null : srcBe.delete && srcBe.delete(
          (node.data && node.data.file && node.data.file.id)
            ? { id: node.data.file.id, path: srcPath, name }
            : { path: srcPath, name })))
        .then(() => { invalidateCache(); refresh(); notice(verb + ' ' + name, 'success'); })
        .catch(e => notice('Could not ' + (copy ? 'copy' : 'move') + ' ' + name + ': ' + (e && e.message || e), 'error'));
    }

    // Resolve the destination FOLDER for a drop/paste onto `targetNode`:
    // a folder → into it; a file → into its parent folder; a root → that root's base.
    function _destDirFor(targetNode) {
      if (!targetNode) return '';
      if (targetNode.data && targetNode.data.sourceRoot) return targetNode.data.rootBase || '';
      const isFolder = !targetNode.data?.file;
      if (isFolder) return targetNode.path;
      return targetNode.path.replace(/[/\\][^/\\]+$/, '') === targetNode.path ? '' : targetNode.path.replace(/[/\\][^/\\]+$/, '');
    }

    // Rename a file/folder in place (same parent) via backend.rename(from,to),
    // falling back to copy+delete through moveOrCopyNode semantics when the
    // backend lacks a native rename.
    function renameNode(node) {
      if (!node || !node.path) return;
      // Use the node's OWN backend (so a synthetic-keyed root resolves to the
      // right store), and strip the synthetic "__rootN/" prefix from the paths
      // (otherwise the backend gets `__root0/foo` → "not found" / 404 on rename).
      const be = (node.data && node.data.backendRef) || backendFor(node.path);
      if (!be || typeof be.write !== 'function') { notice('This location is read-only', 'warn'); return; }
      const realPath = _realDir(node.path);
      const cur = node.name || realPath.split(/[/\\]/).pop();
      const parent = realPath.indexOf('/') >= 0 ? realPath.replace(/[/\\][^/\\]+$/, '') : '';
      const doRename = (newName) => {
        newName = (newName || '').trim();
        if (!newName || newName === cur || /[/\\]/.test(newName)) return;
        const to = (parent ? parent + '/' : '') + newName;
        const done = () => { invalidateCache(); refresh(); notice('Renamed to ' + newName, 'success'); };
        const fail = e => notice('Could not rename: ' + (e && e.message || e), 'error');
        if (typeof be.rename === 'function') Promise.resolve(be.rename(realPath, to)).then(done).catch(fail);
        else _copyEntry(be, realPath, to).then(() => be.delete && be.delete({ path: realPath, name: cur })).then(done).catch(fail);
      };
      if (window.AppUIDialog && AppUIDialog.prompt) AppUIDialog.prompt('Rename to', cur, doRename);
      else doRename(window.prompt('Rename to:', cur));
    }

    // "Copy to…/Move to…": pick a destination folder from the SAME root's tree,
    // then moveOrCopyNode. Presents the folder list as a simple select dialog.
    function moveCopyToDialog(node, copy) {
      if (!node || !node.path) return;
      const be = _beFor(node);
      if (!be || typeof be.write !== 'function') { notice('This location is read-only', 'warn'); return; }
      // Gather candidate destination folders by walking the root's listing.
      const rootBase = (function () {
        for (const r of roots) { if (r.backend === be) return r.path || ''; }
        return '';
      })();
      const folders = ['/ (top level)'];
      const paths = [''];
      const collect = (dir) => Promise.resolve(be.list(dir)).then(res => {
        const entries = (res && res.entries) || [];
        return entries.filter(e => e.type === 'dir').reduce((p, e) => p.then(() => {
          // don't offer the node's own subtree as a destination
          if ((e.path + '/').indexOf(node.path.replace(/\/+$/, '') + '/') === 0) return;
          folders.push(e.path); paths.push(e.path);
          return collect(e.path);
        }), Promise.resolve());
      });
      collect(rootBase).then(() => {
        if (!(window.AppUIDialog && AppUIDialog.form)) {
          // Fallback: prompt for a path.
          const p = window.prompt((copy ? 'Copy' : 'Move') + ' to folder path:', '');
          if (p != null) moveOrCopyNode(node, p.trim(), copy);
          return;
        }
        AppUIDialog.form({
          title: (copy ? 'Copy' : 'Move') + ' "' + (node.name || node.path) + '" to',
          fields: [{ name: 'dest', type: 'select', label: 'Destination folder',
                     options: folders.map((f, i) => ({ v: paths[i], l: f })), default: paths[0] }],
          onSubmit: (vals) => moveOrCopyNode(node, vals.dest || '', copy),
        });
      });
    }
    return { _beFor, _destDirFor, deleteNode, moveOrCopyNode, renameNode, moveCopyToDialog };
  }
  return { create };
})();
