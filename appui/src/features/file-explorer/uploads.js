/** Internal FileExplorer uploads, dropped directories, file pickers, and creation. */
const AppUIFileExplorerUploads = (() => {
  function create({ backendFor, _realDir, notice, invalidateCache, refresh,
    getTree, _fileIcon, onSelect }) {
    // --- File operations ---
    const readFileB64 = file => AppUIFileUtils.readBase64(file);

    function _readDropEntries(entries, done) {
      AppUIFileUtils.readEntries(entries, {
        mapFile(file, relPath) {
          try {
            Object.defineProperty(file, 'webkitRelativePath', { value: relPath, configurable: true });
            return file;
          } catch (e) {
            return { name: file.name, size: file.size, type: file.type,
              webkitRelativePath: relPath, _file: file,
              slice: file.slice ? file.slice.bind(file) : undefined };
          }
        },
      }).then(done);
    }

        async function uploadFiles(files, targetDir, be = null) {
          // Keep the ORIGINAL (synthetic-keyed) dir for the tree insert — the
          // tree matches rows by their key (e.g. "__root0/sub"), while the
          // backend write needs the REAL relpath (via _realDir).
          const keyedDir = (targetDir == null ? '' : String(targetDir));
          targetDir = _realDir(targetDir);
          const b = be || backendFor(targetDir);
          if (!b || typeof b.write !== 'function') { notice('This location is read-only', 'warn'); return; }
          const uploaded = [];           // top-level entry names (for tree insert)
          const topKinds = {};           // name -> 'file' | 'folder'
          const madeDirs = new Set();    // relpaths we've already mkdir'd this run
          async function ensureDir(rel) {
            // mkdir -p the (relative-to-targetDir) dir chain, best-effort.
            if (!rel || madeDirs.has(rel)) return;
            const parts = rel.split('/').filter(Boolean);
            let cur = '';
            for (const p of parts) {
              cur = cur ? cur + '/' + p : p;
              if (madeDirs.has(cur)) continue;
              madeDirs.add(cur);
              if (typeof b.mkdir === 'function') {
                try { await b.mkdir(targetDir ? (targetDir + '/' + cur) : cur); } catch (e) {}
              }
            }
          }
          for (const file of files) {
            // A folder upload (webkitdirectory) gives each file a
            // webkitRelativePath like "mydir/sub/file.txt" — preserve that
            // structure under targetDir. A plain file upload has just file.name.
            const rel = (file.webkitRelativePath || file.name).replace(/\\/g, '/').replace(/^\/+/, '');
            const slash = rel.indexOf('/');
            const top = slash >= 0 ? rel.slice(0, slash) : rel;
            if (!(top in topKinds)) { topKinds[top] = slash >= 0 ? 'folder' : 'file'; uploaded.push(top); }
            notice(`Uploading ${rel}…`);
            const dir = rel.lastIndexOf('/') >= 0 ? rel.slice(0, rel.lastIndexOf('/')) : '';
            if (dir) await ensureDir(dir);
            const content_b64 = await readFileB64(file);
            await b.write(targetDir ? (targetDir + '/' + rel) : rel, content_b64, { b64: true });
          }
          // Selective insert: drop the cached listing for the target dir, then
          // ADD only the new nodes to the tree (so other open folders don't
          // re-fetch / collapse). The parentKey is the synthetic tree key of the
          // target node — fall back to a scoped refresh only if the parent row
          // isn't currently rendered (insertNode returns false).
          invalidateCache(targetDir);
          const parentKey = keyedDir;
          let allInserted = true;
          const tree = getTree();
          if (tree && typeof tree.insertNode === 'function' && parentKey) {
            for (const nm of uploaded) {
              const _isFolder = topKinds[nm] === 'folder';
              // Give an uploaded FILE its extension-derived icon so the new row
              // shows the right icon immediately (the optimistic insert bypasses
              // the listing path's _buildChildNode/_fileIcon; without this the
              // file rendered with NO icon until a full refresh).
              const _ext = _isFolder ? '' : (nm.indexOf('.') >= 0 ? nm.slice(nm.lastIndexOf('.') + 1).toLowerCase() : '');
              const _icon = _isFolder ? '📂' : (typeof _fileIcon === 'function' ? _fileIcon(_ext) : '📄');
              const ok = tree.insertNode(parentKey, { name: nm, type: _isFolder ? 'folder' : 'file', icon: _icon });
              if (!ok) { allInserted = false; break; }
            }
          } else {
            allInserted = false;
          }
          if (!allInserted) refresh(parentKey || targetDir);   // scoped reload of just the target folder (keyed), else full
          notice(`${files.length} file${files.length === 1 ? '' : 's'} uploaded`, 'success');
        }

    function createFolder(parentPath = '', be = null) {
      if (!window.AppUIDialog) {
        const name = prompt('New folder name:');
        if (name) _doCreateFolder(parentPath, name, be);
        return;
      }
      AppUIDialog.prompt('New folder name', '', name => {
        if (name) _doCreateFolder(parentPath, name.trim(), be);
      });
    }

    async function _doCreateFolder(parentPath, name, be = null) {
      if (!name || name.includes('/') || name.includes('\\')) {
        notice('Invalid folder name', 'warn');
        return;
      }
      parentPath = _realDir(parentPath);
      const folderPath = parentPath ? parentPath + '/' + name : name;
      // Prefer the EXPLICIT backend of the originating node (so a create under a
      // synthetic-keyed root — e.g. Common vs Guest, both empty-path — hits the
      // RIGHT store; backendFor() can't disambiguate sibling empty-path roots).
      const b = be || backendFor(folderPath);
      if (!b || typeof b.mkdir !== 'function') { notice('This location is read-only', 'warn'); return; }
      await b.mkdir(folderPath);
      invalidateCache(parentPath);
      refresh(parentPath);
      notice(`Created ${name}`, 'success');
      // Reveal the new folder: expand its parent(s) + select it.
      try { const tree = getTree(); if (tree && tree.expandTo) tree.expandTo(folderPath); } catch (e) {}
    }

    function createFile(parentPath = '', be = null) {
      if (!window.AppUIDialog) {
        const name = prompt('New file name:');
        if (name) _doCreateFile(parentPath, name.trim(), be);
        return;
      }
      AppUIDialog.prompt('New file name', '', name => {
        if (name) _doCreateFile(parentPath, name.trim(), be);
      });
    }

    async function _doCreateFile(parentPath, name, be = null) {
      if (!name || name.includes('/') || name.includes('\\')) {
        notice('Invalid file name', 'warn');
        return;
      }
      parentPath = _realDir(parentPath);
      const filePath = parentPath ? parentPath + '/' + name : name;
      const b = be || backendFor(filePath);
      if (!b || typeof b.write !== 'function') { notice('This location is read-only', 'warn'); return; }
      try {
        // Write a NON-EMPTY placeholder: the file_storage backend rejects an
        // empty request body with 400 ("empty body"), so a brand-new file could
        // never be created (the POST failed and nothing appeared in the tree).
        // A single newline is a valid, minimal starting content for a text file.
        await b.write(filePath, '\n', {});
      } catch (e) {
        notice('Could not create ' + name + ': ' + (e && e.message || e), 'error');
        return;
      }
      invalidateCache(parentPath);
      refresh(parentPath);
      notice(`Created ${name}`, 'success');
      // Reveal the new file: expand its parent folder(s) + select it. expandTo
      // marks all ancestors expanded, re-renders, and retries setActive until
      // the node appears (children load async after refresh). This makes a file
      // created inside a (collapsed) folder visible instead of hidden.
      try { const tree = getTree(); if (tree && tree.expandTo) tree.expandTo(filePath); } catch (e) {}
      // Open the new (empty) file in the host editor, if the page wants it.
      try { if (onSelect) onSelect({ name, path: filePath, ext: (name.match(/\.[^.]+$/) || [''])[0] }); } catch (e) {}
    }

    function chooseFiles(targetDir, _chooseBe = null) {
      const picker = document.createElement('input');
      picker.type = 'file';
      picker.multiple = true;
      picker.addEventListener('change', () => {
        const files = [...picker.files];
        if (files.length) uploadFiles(files, targetDir, _chooseBe).catch(e => notice(e.message, 'error'));
      }, { once: true });
      picker.click();
    }

    function chooseFolder(targetDir, _chooseBe = null) {
      // Folder upload: webkitdirectory makes the picker select a whole directory;
      // each file then carries a webkitRelativePath so uploadFiles can recreate
      // the subtree (mkdir -p + write) under targetDir.
      const picker = document.createElement('input');
      picker.type = 'file';
      picker.multiple = true;
      picker.webkitdirectory = true;
      picker.setAttribute('webkitdirectory', '');
      picker.setAttribute('directory', '');
      picker.addEventListener('change', () => {
        const files = [...picker.files];
        if (files.length) uploadFiles(files, targetDir, _chooseBe).catch(e => notice(e.message, 'error'));
      }, { once: true });
      picker.click();
    }
    return { _readDropEntries, uploadFiles, createFolder, createFile, chooseFiles, chooseFolder };
  }
  return { create };
})();
