/** Internal FileExplorer drag state, modifier mapping, and page drop hooks. */
const AppUIFileExplorerDragDrop = (() => {
  function create({ opts, _beFor, _destDirFor, _readDropEntries, uploadFiles,
    moveOrCopyNode, notice, invalidateCache, refresh }) {
    let _dragSrc = null;
    return {
      onDragStart(node) { _dragSrc = node; },
      onDrop: opts.draggable === false ? null : function(targetNode, e) {
        // EXTERNAL OS drop (drag a file OR FOLDER from the desktop onto a tree
        // row): upload each into the target node's dir using the target's OWN
        // backend (so a drop on Guest/Common hits the right store). Files come
        // via dataTransfer.files; FOLDERS do NOT appear there — they only come
        // via the webkitGetAsEntry() directory API, which we read recursively
        // into File objects carrying a webkitRelativePath so uploadFiles (which
        // already honors webkitRelativePath + ensureDir) recreates the tree.
        // Snapshot synchronously; DataTransfer is invalidated after the handler returns.
        const captured = AppUIFileUtils.captureDrop(e && e.dataTransfer);
        var extFiles = captured.files;
        var entries = captured.entries;
        var hasDir = entries.some(entry => entry.isDirectory);
        if (extFiles.length || entries.length) {
          _dragSrc = null;
          if (!targetNode) return;
          var tBe = _beFor(targetNode);
          if (!tBe || typeof tBe.write !== 'function') { notice('Can\'t upload here (read-only)', 'warn'); return; }
          var tDir = _destDirFor(targetNode);
          // If any entry is a directory, read the whole tree via the entry API
          // (covers folders); else use the plain files list (faster, no recursion).
          if (hasDir) {
            _readDropEntries(entries, function (fileObjs) {
              if (!fileObjs.length) { notice('Nothing to upload (empty or unreadable folder)', 'warn'); return; }
              uploadFiles(fileObjs, tDir, tBe).catch(function (err) { notice(err.message || String(err), 'error'); });
            });
          } else {
            uploadFiles(extFiles, tDir, tBe).catch(function (err) { notice(err.message || String(err), 'error'); });
          }
          return;
        }
        const src = _dragSrc; _dragSrc = null;
        if (!src || !targetNode || src.path === targetNode.path) return;
        // CUSTOM DROP HOOK: a page can fully own node-onto-node drops (e.g. the
        // Opened tree's synthetic group list, where a "move" is a localStorage
        // re-grouping, not a filesystem move). When opts.onNodeDrop returns
        // truthy (or a Promise), the built-in move/copy/link is SKIPPED — so a
        // synthetic/read-only backend never hits "Destination is read-only".
        if (typeof opts.onNodeDrop === 'function') {
          var _handled = false;
          try { _handled = opts.onNodeDrop(src, targetNode, { alt: !!(e && e.altKey), copy: !!(e && (e.ctrlKey || e.metaKey)) }); } catch (err) { _handled = true; }
          if (_handled) {
            try { if (_handled.then) _handled.catch(function () {}); } catch (e2) {}
            return;
          }
        }
        const _srcBe = _beFor(src);
        const _dstBe = _beFor(targetNode);
        const destDir = _destDirFor(targetNode);
        const _crossStore = (_srcBe !== _dstBe);
        // Modifier mapping: Alt = LINK (a reference, no byte copy), Ctrl/⌘ =
        // COPY, plain = MOVE. Linking is delegated to the page (opts.onLink);
        // CROSS-WORKSPACE drops (different backends) are also delegated to the
        // page (opts.onCrossMove) so it can do a binary-safe server-side
        // transfer — the generic text read/write here would corrupt a binary.
        const _wantLink = !!(e && e.altKey);
        const _copy = !!(e && (e.ctrlKey || e.metaKey));
        if (_wantLink) {
          if (typeof opts.onLink === 'function') {
            try {
              Promise.resolve(opts.onLink(src, destDir, _dstBe, { srcBackend: _srcBe }))
                .then(() => { invalidateCache(); refresh(); })
                .catch(err => notice('Could not link: ' + (err && err.message || err), 'error'));
            } catch (err) { notice('Could not link: ' + (err && err.message || err), 'error'); }
          } else {
            notice('Linking is not available here', 'warn');
          }
          return;
        }
        if (_crossStore) {
          if (typeof opts.onCrossMove === 'function') {
            try {
              Promise.resolve(opts.onCrossMove(src, destDir, _dstBe, { srcBackend: _srcBe, copy: _copy }))
                .then(() => { invalidateCache(); refresh(); })
                .catch(err => notice('Could not ' + (_copy ? 'copy' : 'move') + ': ' + (err && err.message || err), 'error'));
            } catch (err) { notice('Could not transfer: ' + (err && err.message || err), 'error'); }
          } else {
            notice('Can only move within the same storage', 'warn');
          }
          return;
        }
        moveOrCopyNode(src, destDir, _copy);
      },
    };
  }
  return { create };
})();
