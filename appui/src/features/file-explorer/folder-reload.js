/* In-place FileExplorer reloads with per-folder ownership of async results. */
window.AppUIFileExplorerFolderReload = (() => {
  function create({container, roots, getTree, _realDir, backendFor, cachedFileLs,
    _buildChildNode, onExpandChildren}) {
    const pending = new Map();
    let destroyed = false;
    function reload(keyedOrReal) {
      try {
        if (destroyed) return false;
        var target = getTree();
        if (!target) return false;
        var keyed = String(keyedOrReal);
        var real = _realDir(keyed);
        var be = backendFor(real);
        if (!be || typeof be.list !== 'function') return false;
        // The folder must actually be a rendered row (else there's nothing to
        // setChildren into — a full rebuild is the only way to show it).
        var present = false;
        try {
          var rows = container.querySelectorAll('.tree-row');
          for (var i = 0; i < rows.length; i++) {
            var rp = (rows[i].dataset.path || '').replace(/\\/g, '/');
            if (rp === keyed.replace(/\\/g, '/')) { present = true; break; }
          }
        } catch (e) { present = false; }
        if (!present) return false;
        const ticket = {};
        pending.set(keyed, ticket);
        const current = () => !destroyed && pending.get(keyed) === ticket && getTree() === target;
        Promise.resolve(cachedFileLs(real, be)).then(function (res) {
          if (!current()) return;
          var entries = (res && res.entries) || [];
          var writable = true;
          try { var rspec = roots.find(function (r) { return keyed.indexOf((r.path != null ? r.path : '')) === 0; }); if (rspec) writable = rspec.writable !== false; } catch (e) {}
          var nodes = entries.map(function (en) {
            // Normalize the child path onto the KEYED parent so tree row keys match.
            var child = { name: en.name, type: en.type, path: keyed.replace(/\/$/, '') + '/' + en.name, id: en.id };
            return _buildChildNode(child, be, writable);
          });
          var finish = function (finalNodes) {
            if (!current()) return;
            try { target.setChildren(keyed, finalNodes); } catch (e) {}
          };
          // Honor onExpandChildren augmentation (same as a normal expand) so the
          // reloaded rows match what a fresh expand would show.
          if (onExpandChildren) {
            try {
              return Promise.resolve(onExpandChildren({ path: keyed }, nodes, entries))
                .then(function (aug) { finish(Array.isArray(aug) ? aug : nodes); })
                .catch(function () { finish(nodes); });
            } catch (e) { finish(nodes); }
          } else { finish(nodes); }
        }).catch(function () { /* Preserve the current rows when listing fails. */ })
          .finally(function () { if (pending.get(keyed) === ticket) pending.delete(keyed); });
        return true;
      } catch (e) { return false; }
    }
    function invalidate() { pending.clear(); }
    function destroy() { destroyed = true; invalidate(); }
    return {reload, invalidate, destroy};
  }
  return {create};
})();
