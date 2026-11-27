/** Internal FileExplorer menu policy. Actions are supplied by the owning explorer. */
const AppUIFileExplorerContextMenu = (() => {
  function create({ opts, onConvert, formatOptions, createFile, createFolder,
    chooseFiles, chooseFolder, showProperties, refresh, renameNode,
    moveCopyToDialog, deleteNode, backendFor, onSelect, _fileToolBackend, callTool }) {
    // --- Convert submenu ---
    function _convertSubmenu(file) {
      if (!onConvert) return [];
      const ext = (file.ext || '').toLowerCase();
      const formats = formatOptions[ext];
      if (!formats || !formats.length) return [];
      return formats.map(fmt => ({
        label: fmt.toUpperCase(),
        action: () => onConvert(file, fmt),
      }));
    }

    // opts.contextMenuGroupBuiltins: fold the explorer's own create items into
    // "📄 New ▸" and its rename/move/copy/delete into "✎ Edit ▸" (Open,
    // Properties, Refresh stay top-level, the last two at the end), and tidy
    // doubled separators — so a
    // page that adds many items of its own keeps a short top level.
    const _NEW_BUILTINS = new Set(['New file…', 'New folder…', 'New subfolder…', 'Upload files…', 'Upload folder…']);
    const _EDIT_BUILTINS = new Set(['Rename…', 'Move to…', 'Copy to…', 'Delete', 'Delete folder']);
    function _groupBuiltins(items) {
      const out = [], newer = [], edit = [];
      let newAt = -1, editAt = -1;
      for (const it of items) {
        if (it && !it.submenu && _NEW_BUILTINS.has(it.label)) { if (newAt < 0) newAt = out.length, out.push(null); newer.push(it); continue; }
        if (it && !it.submenu && _EDIT_BUILTINS.has(it.label)) { if (editAt < 0) editAt = out.length, out.push(null); edit.push(it); continue; }
        out.push(it);
      }
      if (newAt >= 0) out[newAt] = newer.length > 1 ? { label: '📄 New', submenu: newer } : newer[0];
      if (editAt >= 0) out[editAt] = edit.length > 1 ? { label: '✎ Edit', submenu: edit } : edit[0];
      // Properties / Refresh always close the menu, even on a root (where the
      // explorer adds them before the page's own items)
      const tail = [];
      for (let i = out.length - 1; i >= 0; i--) {
        const it = out[i];
        if (it && !it.submenu && (it.label === 'Properties' || it.label === 'Refresh')) { tail.unshift(it); out.splice(i, 1); }
      }
      if (tail.length) out.push({ separator: true }, ...tail);
      const tidy = [];
      for (const it of out) {
        if (it && it.separator && (!tidy.length || tidy[tidy.length - 1].separator)) continue;
        tidy.push(it);
      }
      while (tidy.length && tidy[tidy.length - 1].separator) tidy.pop();
      return tidy;
    }

    // --- Context menu ---
    function onContextMenu(node, event) {
      if (!window.AppUIContextMenu) return;
      const isFolder = !node.data?.file && !node.data?.sourceRoot && node.path;
      const file = node.data?.file;
      if (opts.contextMenuMode === 'replace') {
        const kind = node.data?.sourceRoot ? 'root' : isFolder ? 'folder' : 'file';
        const custom = opts.contextMenuItems?.(node, kind) || [];
        if (custom.length) AppUIContextMenu.show(event, custom);
        return;
      }
      // A page may own a node's menu outright: when contextMenuItems returns an
      // array marked `exclusive` (items.exclusive = true) for a folder/file node,
      // ONLY those items are shown — no Open / Rename / Move / Delete built-ins
      // (e.g. a link to a vis:// node or another workspace, which is not a file
      // the backend can rename or delete). Computed once and reused below.
      let pageItems;
      if (opts.contextMenuItems && !node.data?.sourceRoot) {
        pageItems = opts.contextMenuItems(node, isFolder ? 'folder' : 'file') || [];
        if (pageItems.exclusive) {
          if (pageItems.length) AppUIContextMenu.show(event, pageItems);
          return;
        }
      }
      const items = [];

      if (node.data?.sourceRoot && node.data.writable) {
        // A synthetic root node has a UNIQUE path like "__root0" (so sibling
        // roots don't collide); its REAL storage base is node.data.rootBase
        // (usually ''). Use the real base for create/upload — otherwise new
        // files landed under a bogus "__root0/" folder.
        const rootBase = (node.data.rootBase != null ? node.data.rootBase : (node.path || ''));
        const rootBe = node.data.backendRef || null;
        items.push(
          { label: 'New file…', action: () => createFile(rootBase, rootBe) },
          { label: 'New folder…', action: () => createFolder(rootBase, rootBe) },
          { label: 'Upload files…', action: () => chooseFiles(rootBase, rootBe) },
          { label: 'Upload folder…', action: () => chooseFolder(rootBase, rootBe) },
          { separator: true },
          { label: 'Properties', action: () => showProperties(node) },
          { label: 'Refresh', action: refresh },
        );
      } else if (node.data?.sourceRoot) {
        items.push(
          { label: 'Properties', action: () => showProperties(node) },
          { label: 'Refresh', action: refresh },
        );
      }
      // Custom root-level items from the page (e.g. VFS mount edit/remove). Fires
      // for ANY root node, writable or not.
      if (node.data?.sourceRoot && opts.contextMenuItems) {
        const customRoot = opts.contextMenuItems(node, 'root');
        if (customRoot && customRoot.length) items.push({ separator: true }, ...customRoot);
      }
      if (isFolder) {
        const folderBe = (node.data && node.data.backendRef) || null;
        items.push(
          { label: 'New file…', action: () => createFile(node.path, folderBe) },
          { label: 'New subfolder…', action: () => createFolder(node.path, folderBe) },
          { label: 'Upload files…', action: () => chooseFiles(node.path || '', folderBe) },
          { label: 'Upload folder…', action: () => chooseFolder(node.path || '', folderBe) },
        );
        // Custom context menu items from page
        if (opts.contextMenuItems) {
          const custom = pageItems !== undefined ? pageItems : opts.contextMenuItems(node, 'folder');
          if (custom && custom.length) items.push({ separator: true }, ...custom);
        }
        // Delete — only when the owning backend supports it (writable roots).
        if (typeof backendFor(node.path).delete === 'function') {
          const wbe = backendFor(node.path);
          items.push({ separator: true });
          if (typeof wbe.write === 'function') {
            items.push(
              { label: 'Rename…', action: () => renameNode(node) },
              { label: 'Move to…', action: () => moveCopyToDialog(node, false) },
              { label: 'Copy to…', action: () => moveCopyToDialog(node, true) },
            );
          }
          items.push({ label: 'Delete folder', action: () => deleteNode(node) });
        }
        items.push(
          { separator: true },
          { label: 'Properties', action: () => showProperties(node) },
          { label: 'Refresh', action: refresh },
        );
      } else if (file) {
        items.push(
          { label: 'Open', action: () => onSelect(file) },
        );
        // "Open in Explorer" only makes sense for the local file-tool backend —
        // vfs/file_storage have no OS path. Guard it behind the default backend.
        if (backendFor(file.path) === _fileToolBackend) {
          items.push({ label: 'Open in Explorer', action: () => callTool('terminal.exec', {
            cmd: `explorer "${file.path.replace(/\//g, '\\\\').replace(/[/\\\\][^/\\\\]+$/, '')}"`
          })});
        }
        const convertItems = _convertSubmenu(file);
        if (convertItems.length) {
          items.push({ label: 'Convert to', submenu: convertItems });
        }
        // Custom file-level items from the page (e.g. Open with / Share /
        // History). Merged for FILE nodes just as they are for root/folder —
        // without this the host's contextMenuItems(node,'file') was ignored and
        // only the component's built-ins showed.
        if (opts.contextMenuItems) {
          const customFile = pageItems !== undefined ? pageItems : opts.contextMenuItems(node, 'file');
          if (customFile && customFile.length) items.push({ separator: true }, ...customFile);
        }
        // Delete — only when the owning backend supports it (writable roots);
        // read-only mounts (Examples/Templates) omit it.
        if (typeof backendFor(file.path).delete === 'function') {
          const wbe = backendFor(file.path);
          items.push({ separator: true });
          if (typeof wbe.write === 'function') {
            items.push(
              { label: 'Rename…', action: () => renameNode(node) },
              { label: 'Move to…', action: () => moveCopyToDialog(node, false) },
              { label: 'Copy to…', action: () => moveCopyToDialog(node, true) },
            );
          }
          items.push({ label: 'Delete', action: () => deleteNode(node) });
        }
        items.push(
          { separator: true },
          { label: 'Properties', action: () => showProperties(node) },
        );
        items.push(
          { separator: true },
          { label: 'Refresh', action: refresh },
        );
      }

      const shown = opts.contextMenuGroupBuiltins ? _groupBuiltins(items) : items;
      if (shown.length) AppUIContextMenu.show(event, shown);
    }
    return onContextMenu;
  }
  return { create };
})();
