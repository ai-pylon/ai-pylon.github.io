/** Internal FileExplorer Properties dialog. Loaded before core by the feature bundle.
 * Backend resolution and navigation stay with the owning explorer instance.
 */
const AppUIFileExplorerProperties = (() => {
  function create({ opts, backendFor, goToPath, expandTo }) {
    // --- Properties dialog ---
    // Generic across backends: shows name/type/path, plus size+modified+id when
    // the backend can supply them (``fileMeta(node)`` → {size, modified, id, ...}).
    async function showProperties(node) {
      const isFolder = !node.data?.file;
      const file = node.data?.file || node;
      // Prefer the node's OWN backend (data.backendRef) over backendFor(path):
      // a ROOT node has path "" — backendFor("") resolves to the ACTIVE/first
      // root's backend, so a non-active workspace root would borrow the active
      // workspace's path (the "C:/…/workspace reports RRP's path" bug). The
      // per-root backend is stashed on data.backendRef by _buildTreeRoots.
      const _be = (function () {
        try {
          if (node.data && node.data.backendRef) return node.data.backendRef;
          return backendFor(node.path);
        } catch (e) { return null; }
      })();
      let meta = {};
      try {
        if (_be && typeof _be.fileMeta === 'function') {
          meta = (await Promise.resolve(_be.fileMeta(file))) || {};
        }
      } catch (e) { /* best-effort — show what we have */ }
      const fmtSize = (n) => {
        if (n == null || isNaN(n)) return '—';
        if (n < 1024) return n + ' B';
        if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
        return (n / (1024 * 1024)).toFixed(1) + ' MB';
      };
      const fmtTime = (t) => {
        if (!t) return '—';
        try { return new Date(typeof t === 'number' && t < 1e12 ? t * 1000 : t).toLocaleString(); }
        catch (e) { return String(t); }
      };
      const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
      // Strip the synthetic "__rootN/" tree-key prefix so Properties shows the
      // REAL name/relpath (never the internal root key the tree uses).
      const unkey = (s) => String(s == null ? '' : s).replace(/^__root\d+\//, '').replace(/^__root\d+$/, '');
      // A ROOT node carries authoritative identity on node.data — its visible
      // `name` is a DECORATIVE label (often "<name> (<path>)") that must NOT be
      // treated as a filename (splitting it on "/" yielded garbage like
      // "Intent)"). Every explorer root is marked data.sourceRoot with its real
      // base in data.rootBase; a remote_ws workspace root also carries
      // data.workspace {name, path}. Prefer the structured source for both the
      // displayed name and path.
      const _ws = node.data && node.data.workspace;
      const _isRoot = !!(node.data && (node.data.sourceRoot || node.data.workspace
                        || node.data.root || node.data.rootBackend)) || node.isRoot === true;
      let dispName, _rootPath = null;
      if (_ws && (_ws.name || _ws.path)) {
        // Workspace root: the registry entry owns the real name + path.
        dispName = _ws.name || String(_ws.path || '').replace(/[/\\]+$/, '').split(/[/\\]/).pop() || _ws.path || '';
        _rootPath = _ws.path || null;
      } else if (_isRoot) {
        // Other root (source/mount): rootBase is the real path. Prefer a clean
        // name = the last path segment of rootBase; else strip a trailing
        // " (…path…)" decoration from the label. Never split the label on "/".
        const _rb = (node.data && node.data.rootBase) || '';
        _rootPath = _rb || null;
        const _rbName = _rb ? String(_rb).replace(/[/\\]+$/, '').split(/[/\\]/).pop() : '';
        dispName = (unkey(node.name || '').replace(/\s*\([^)]*\)\s*$/, '').trim())
                   || _rbName || unkey(node.name || '');
      } else {
        dispName = unkey(node.name || file.name || '').split(/[/\\]/).pop();
      }
      // Path shown in Properties: a canonical vfs:// URL. Prefer the OneDrive-
      // corrected real copy (altUrl) when present; otherwise ask the backend for
      // the node's absolute vfs path (absPath) so EVERY file shows a real vfs
      // path (not the internal tree-relative path); fall back to the raw path.
      const _altUrl = node.data?.altUrl || file.altUrl || null;
      const _cloudState = node.data?.cloudState || (node.data?.cloud ? 'online' : null);
      const _rawPath = unkey(node.path || file.path || '');
      let _absPath = null;
      try {
        if (_be && typeof _be.absPath === 'function') {
          // A root node has node.path === "" ; some backends' absPath do
          // `(node && node.path) || node` and, on an empty path, fall through to
          // stringify the NODE itself → a "…/[object Object]" artifact. Pass an
          // explicit string path (the root's rootBase, or "") so absPath resolves
          // the base cleanly instead of stringifying the object.
          const _probe = _isRoot ? { path: (node.data && node.data.rootBase) || '', data: node.data }
                                  : node;
          _absPath = _be.absPath(_probe) || null;
        }
      } catch (e) { /* best-effort */ }
      // Defensive: scrub any "[object Object]" / trailing empty segment an older
      // backend absPath may still produce for an empty-path root.
      if (_absPath) {
        _absPath = _absPath.replace(/\/+\[object Object\]\/?$/i, '').replace(/\/+$/, '') || _absPath;
      }
      // For a root, node.path is "" (which would collapse to an empty/odd
      // absPath), so the workspace/rootBase path is the right thing to show.
      const _vfsPath = _altUrl || _rootPath || _absPath || _rawPath;
      const rows = [
        ['Name', esc(dispName)],
        ['Type', isFolder ? 'Folder' : 'File'],
        ['Path', esc(_vfsPath)],
      ];
      // KIND — distinguish an ACTUAL file from a REFERENCE/LINK (a VFS mount:
      // chat link, http/gerrit/gitlab/eridoc/path pointer). The node carries
      // link/refKind/origin/target (from the ref-node merge). For a link, show
      // the friendly kind + the REAL target path it points to, and (async) a
      // ref-counter: how many links in the workspace point at the same target.
      const _d = node.data || {};
      const _isLink = !!(_d.link || _d.mount || _d.refKind);
      const _REFLABEL = { path: 'same-host file', ssh: 'SSH folder', http: 'web page', gerrit: 'Gerrit',
        gitlab: 'GitLab', eridoc: 'Eridoc', wiki: 'Wiki', upload: 'uploaded source',
        archive: 'archive member', chat: 'chat conversation' };
      if (_isLink) {
        const _kn = _REFLABEL[_d.refKind] || _d.refKind || 'reference';
        // A link whose target is a GIT REPO is called out as such (and the row
        // is upgraded async below if the git status isn't known yet).
        if (_d.isGit) rows[1] = ['Kind', '\uD83C\uDF3F Git repository link (' + esc(_kn) + ')'];
        else rows[1] = ['Kind', '\uD83D\uDD17 Reference / link (' + esc(_kn) + ')'];
        const _tgt = _d.target || _d.origin;
        if (_tgt) rows.push(['Link target', '<span data-link-target>' + esc(_tgt) + '</span>']);
        // References INFO (not just a count): the other links that point at the
        // SAME target, listed by path — filled async below.
        rows.push(['Other references', '<div data-reflist style="color:var(--text-muted,#64748b)">…</div>']);
      } else if (_d.isGit) {
        rows[1] = ['Kind', '\uD83C\uDF3F Git repository (folder)'];
      } else {
        rows[1] = ['Kind', isFolder ? '\uD83D\uDCC1 Actual folder' : '\uD83D\uDCC4 Actual file'];
      }
      if (_altUrl && _absPath && _altUrl !== _absPath) {
        rows.push(['Placeholder path', esc(_absPath)]);
      }
      if (!isFolder && _cloudState) {
        rows.push(['Cloud', _cloudState === 'online'
          ? '\u2601 Online-only (not downloaded)'
          : '\u2713 Downloaded (available offline)']);
      }
      if (!isFolder) {
        rows.push(['Size', fmtSize(meta.size != null ? meta.size : file.size)]);
        rows.push(['Modified', fmtTime(meta.modified || meta.mtime || file.modified)]);
        if (meta.id || file.id) rows.push(['Id', esc(meta.id || file.id)]);
        if (meta.content_type) rows.push(['Content type', esc(meta.content_type)]);
      }
      const body = '<table class="aui-props"><tbody>' + rows.map(r =>
        '<tr><th style="text-align:left;padding:3px 12px 3px 0;color:var(--text-muted,#64748b);white-space:nowrap;vertical-align:top">' +
        r[0] + '</th><td style="padding:3px 0;word-break:break-all">' + r[1] + '</td></tr>').join('') +
        '</tbody></table>';
      // --- Custom (user-defined) metadata section ---------------------------
      // The backend's fileMeta may return `custom` {k:v} + the explorer may
      // expose setFileMeta(node, {k:v}) → render an EDITABLE "More details"
      // section (e.g. source of data, owner, notes). Users add/edit/remove
      // arbitrary fields; saving merges ('' deletes a key).
      const be2 = _be || backendFor(node.path);
      const canEdit = be2 && typeof be2.setFileMeta === 'function';
      const custom = (meta && meta.custom) || {};
      let customHtml = '';
      if (canEdit || Object.keys(custom).length) {
        const crows = Object.keys(custom).map((k) =>
          '<div class="aui-cm-row" style="display:flex;gap:6px;margin:3px 0">' +
          '<input class="aui-cm-k" value="' + esc(k) + '" placeholder="key" style="flex:0 0 34%;font-size:12px"' + (canEdit ? '' : ' readonly') + '>' +
          '<input class="aui-cm-v" value="' + esc(custom[k]) + '" placeholder="value" style="flex:1;font-size:12px"' + (canEdit ? '' : ' readonly') + '>' +
          '</div>').join('');
        customHtml =
          '<div style="margin-top:12px;border-top:1px solid var(--border,#3f4147);padding-top:8px">' +
          '<div style="font-weight:600;font-size:12px;margin-bottom:4px">More details' +
          (canEdit ? ' <span style="font-weight:400;color:var(--text-muted,#64748b);font-size:11px">(e.g. source, owner, notes)</span>' : '') + '</div>' +
          '<div id="aui-cm-rows">' + crows + '</div>' +
          (canEdit ? '<div style="margin-top:6px;display:flex;gap:6px">' +
            '<button id="aui-cm-add" class="ai-btn" style="font-size:11px">+ Add field</button>' +
            '<button id="aui-cm-save" class="ai-btn ai-btn-primary" style="font-size:11px">Save details</button>' +
            '<span id="aui-cm-msg" style="font-size:11px;color:var(--text-muted,#64748b);align-self:center"></span>' +
            '</div>' : '') +
          '</div>';
      }
      if (window.AppUIDialog && AppUIDialog.show) {
        const bodyEl = document.createElement('div');
        bodyEl.innerHTML = body + customHtml;
        if (canEdit) {
          const rowsBox = bodyEl.querySelector('#aui-cm-rows');
          const addBtn = bodyEl.querySelector('#aui-cm-add');
          const saveBtn = bodyEl.querySelector('#aui-cm-save');
          const msg = bodyEl.querySelector('#aui-cm-msg');
          if (addBtn) addBtn.onclick = () => {
            const row = document.createElement('div');
            row.className = 'aui-cm-row';
            row.style.cssText = 'display:flex;gap:6px;margin:3px 0';
            row.innerHTML = '<input class="aui-cm-k" placeholder="key" style="flex:0 0 34%;font-size:12px">' +
              '<input class="aui-cm-v" placeholder="value" style="flex:1;font-size:12px">';
            rowsBox.appendChild(row);
          };
          if (saveBtn) saveBtn.onclick = () => {
            // Build a FULL replacement map: start from current keys set to '' (so
            // removed rows are deleted), then overlay the rows present now.
            const next = {};
            Object.keys(custom).forEach((k) => { next[k] = ''; });
            bodyEl.querySelectorAll('.aui-cm-row').forEach((row) => {
              const k = (row.querySelector('.aui-cm-k').value || '').trim();
              const v = row.querySelector('.aui-cm-v').value || '';
              if (k) next[k] = v;
            });
            saveBtn.disabled = true; if (msg) msg.textContent = 'saving…';
            Promise.resolve(be2.setFileMeta(file, next)).then(() => {
              saveBtn.disabled = false; if (msg) msg.textContent = 'saved';
            }).catch((e) => { saveBtn.disabled = false; if (msg) msg.textContent = 'failed: ' + e.message; });
          };
        }
        AppUIDialog.show({ title: 'Properties', buttons: [{ text: 'Close' }], body: bodyEl });
        // Async: for a LINK node, fill the REFERENCES INFO — the other links in
        // the workspace that point at the same target, listed by path (not just
        // a count). Via the page hook opts.refInfo(target) → Promise<{count,
        // paths:[]}> (or a bare number for back-compat). Leaves "—" on failure.
        if (_isLink && (_d.target || _d.origin)) {
          const _rl = bodyEl.querySelector('[data-reflist]');
          if (_rl) {
            const _hook = (typeof opts.refInfo === 'function') ? opts.refInfo
                        : (typeof opts.refCount === 'function') ? opts.refCount : null;
            Promise.resolve(_hook ? _hook(_d.target || _d.origin) : null).then((info) => {
              let count, paths;
              if (info && typeof info === 'object') { count = info.count; paths = info.paths || []; }
              else { count = info; paths = []; }
              if (count == null) { _rl.textContent = '—'; return; }
              const self = unkey(node.path || file.path || '');
              const others = paths.filter((p) => p && p !== self && unkey(p) !== self);
              const head = count + (count === 1 ? ' reference' : ' references')
                         + ' point to this target' + (others.length ? ':' : '.');
              _rl.innerHTML = esc(head) + (others.length
                ? ('<ul style="margin:4px 0 0;padding-left:18px">' +
                   others.map((p) => '<li style="word-break:break-all">' +
                     '<a href="#" class="aui-refpath" data-p="' + esc(unkey(p)) + '" ' +
                     'title="reveal this reference in the tree" ' +
                     'style="color:var(--accent,#5865f2);text-decoration:none;cursor:pointer">' +
                     '\uD83D\uDD17 ' + esc(unkey(p)) + '</a></li>').join('') + '</ul>')
                : '');
              // Clicking a reference path REVEALS it in the tree (goToPath
              // resolves the owning root; falls back to expandTo), then closes
              // the Properties dialog. Routed through the page hook when given
              // (opts.revealPath) so the page can also preview it if desired.
              [].slice.call(_rl.querySelectorAll('.aui-refpath')).forEach((a) => {
                a.onclick = (ev) => {
                  ev.preventDefault();
                  const p = a.getAttribute('data-p') || '';
                  try {
                    if (typeof opts.revealPath === 'function') opts.revealPath(p);
                    else if (typeof goToPath === 'function') goToPath(p);
                    else expandTo(p, { includeSelf: true });
                  } catch (e) { /* best-effort */ }
                  // Close the Properties dialog. AppUIDialog.close takes the
                  // overlay; find the overlay containing this list, else fall
                  // back to clicking the dialog's Close button / Escape.
                  try {
                    const ov = _rl.closest('.ui-dialog-overlay, .aui-dialog-overlay, [class*="dialog-overlay"]');
                    if (window.AppUIDialog && AppUIDialog.close && ov) AppUIDialog.close(ov);
                    else {
                      const btn = _rl.closest('[class*="dialog"]') &&
                        _rl.closest('[class*="dialog"]').querySelector('button');
                      if (btn) btn.click();
                      else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
                    }
                  } catch (e) { /* best-effort */ }
                };
              });
            }).catch(() => { _rl.textContent = '—'; });
          }
          // DEAD-TARGET: ask the page (opts.refTargetMissing) whether this link's
          // target still exists. If it's gone, badge the Link-target row '⚠ target
          // missing' and offer a 'Remove dead link' button (opts.removeDeadLink).
          if (typeof opts.refTargetMissing === 'function') {
            Promise.resolve(opts.refTargetMissing(node, _d.target || _d.origin)).then((missing) => {
              if (!missing) return;
              const _lt = bodyEl.querySelector('[data-link-target]');
              if (_lt) _lt.innerHTML = esc(_d.target || _d.origin || '') +
                ' <span style="color:var(--color-danger,#ed4245);font-weight:600">\u26A0 target missing</span>';
              if (typeof opts.removeDeadLink === 'function') {
                const _row = document.createElement('div');
                _row.style.cssText = 'margin-top:8px';
                _row.innerHTML = '<button type="button" data-rm-dead class="aui-btn" ' +
                  'style="font-size:12px;padding:3px 10px;cursor:pointer">\uD83D\uDDD1 Remove dead link</button>' +
                  '<span style="font-size:11px;color:var(--text-muted,#64748b);margin-left:8px">the link\u2019s target no longer exists</span>';
                const _tbl = bodyEl.querySelector('table.aui-props');
                if (_tbl && _tbl.parentNode) _tbl.parentNode.insertBefore(_row, _tbl.nextSibling);
                const _b = _row.querySelector('[data-rm-dead]');
                if (_b) _b.onclick = () => {
                  _b.disabled = true; _b.textContent = 'removing\u2026';
                  Promise.resolve(opts.removeDeadLink(node)).then((ok) => {
                    if (ok !== false) {
                      try {
                        const ov = _row.closest('[class*="dialog-overlay"]');
                        if (window.AppUIDialog && AppUIDialog.close && ov) AppUIDialog.close(ov);
                      } catch (e) { /* best-effort */ }
                    } else { _b.disabled = false; _b.textContent = '\uD83D\uDDD1 Remove dead link'; }
                  }).catch(() => { _b.disabled = false; _b.textContent = '\uD83D\uDDD1 Remove dead link'; });
                };
              }
            }).catch(() => { /* best-effort — leave as-is */ });
          }
        }
      } else {
        alert(rows.map(r => r[0] + ': ' + String(r[1]).replace(/&[^;]+;/g, '')).join('\n'));
      }
    }
    return showProperties;
  }
  return { create };
})();
