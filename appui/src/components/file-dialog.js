/**
 * UI/AppUIFileDialog  --  file explorer dialog using the pylon-server tools API.
 *
 * Fetches directory listings via /api/file.list and lets user navigate
 * and select files.
 *
 * Usage:
 *   AppUIFileDialog.open({
 *     title: 'Open Document',
 *     startPath: 'C:/Users/ejasung/Downloads',
 *     filter: ['.docx', '.pptx'],   // file extensions to show
 *     onSelect: (path) => loadTemplate(path),
 *     allowFolders: true,           // optional: a "Use this folder" button
 *     list: async path => [{name, type: 'dir'|'file', size}],   // optional own listing
 *     legacyApi: true,              // optional: the v1 /api/file.* endpoints (sources select)
 *   });
 * Without `list` it lists through file/vfs `list` (v2 hosts); legacyApi uses /api/file.ls.
 */
const AppUIFileDialog = (function() {

  let _overlay = null;
  let _opts = {};
  let _currentPath = '';
  let _history = [];
  let _menuScope = null;
  let _readScopes = null;
  let _navigationRequest = 0;
  let _details = null;
  let _list = null;
  let _controls = null;

  function open(opts) {
    if (opts?.signal?.aborted) return;
    _opts = Object.assign({
      title: 'Open File',
      startPath: '',
      filter: null,  // null = all files, or ['.docx', '.pptx']
      showHidden: false,
      onSelect: null,
    }, opts);

    _currentPath = _opts.startPath || '';
    _history = [];
    if (_createDialog() === false) return;
    _navigate(_currentPath);
  }

  function _createDialog() {
    close();
    const dialog = document.createElement('div');
    dialog.style.cssText = 'height:420px;display:flex;flex-direction:column;min-height:0;';
    const reads=AppUILifecycle.createKeyedScopes({host:dialog,signal:_opts.signal});_readScopes=reads;
    let overlay = null;
    overlay = AppUIDialog.show({
      title: _opts.title, body: dialog, width: '600px', buttons: [],signal:reads.signal,
      onClose() {
        if (_overlay !== overlay) return;
        const teardown=AppUILifecycle.createScope();
        [reads,_menuScope,_details,_list,_controls].forEach(resource=>teardown.add(resource));
        _controls=null;_list=null;_details=null;_menuScope=null;
        if(_readScopes===reads)_readScopes=null;
        _navigationRequest++;_overlay=null;
        teardown.destroy();
      }
    });
    _overlay = overlay;
    if (!overlay) {reads.destroy();if(_readScopes===reads)_readScopes=null;return false;}
    _details = window._AppUIFileDialogDetails.create({
      overlay, getSource:()=>overlay.querySelector('.fd-source')?.value || '',
      isCurrent:()=>_overlay===overlay,
      nextRequest:()=>++_navigationRequest,
      isRequestCurrent:request=>request===_navigationRequest,
      onBack:()=>_navigate(_currentPath),
      getPath:()=>_currentPath,
      onRefresh:()=>_navigate(_currentPath),
      formatSize:_formatSize,
      onReadStart:()=>{_list?.destroy();_list=null;},
    });

    _controls = window._AppUIFileDialogControls.create({
      container:dialog,onCancel:close,onBack:_goBack,onUp:_goUp,
      onNavigate:_navigate,onSelect:_selectCurrent,
    });
    if (_opts.allowFolders) {                  // a folder is a valid answer too (a folder of traces / tables)
      const use = document.createElement('button');
      use.type = 'button'; use.className = 'ai-btn'; use.textContent = 'Use this folder';
      use.title = 'Choose the folder shown above';
      use.style.cssText = 'align-self:flex-start;margin-top:6px';
      use.addEventListener('click', () => { const p = _currentPath, cb = _opts.onSelect; if (!p) return; close(); if (cb) cb(p); });
      dialog.appendChild(use);
    }
    _loadSources(_controls.source,reads);
  }

  async function _loadSources(selectEl,reads) {
    if (!_opts.legacyApi) { selectEl.style.display = 'none'; return; }   // file/vfs: one namespace (vfs:// urls)
    const owner=reads.begin('sources');if(!owner.current())return;
    try {
      const resp = await fetch('/api/file.plugins', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}',signal:owner.signal});
      const data = await resp.json();
      if(!owner.current())return;
      const plugins = data.plugins || [];
      const icons = {local: '📁', ssh: '🔗', gitlab: '🦊', gerrit: '🔀', http: '🌐', eridoc: '📚'};
      selectEl.innerHTML = plugins.map(p =>
        `<option value="${_escape(p.id)}">${icons[p.id] || '📄'} ${_escape(p.name || p.id)}</option>`
      ).join('');
    } catch {}
    finally{owner.destroy();}
  }

  // Directory listing: the host's own `list(path)` (-> [{name, type:'dir'|'file', size}])
  // when given; else the legacy /api/file.ls; else file/vfs list (the v2 file layer).
  let _legacyApi = null;                      // null = unknown, false = not served by this host
  async function _listing(path, source, signal) {
    if (typeof _opts.list === 'function') return {entries: await _opts.list(path, source)};
    if (_opts.legacyApi && _legacyApi !== false) {
      try {
        const resp = await fetch('/api/file.ls', {method: 'POST', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({path: path || '', source}), signal});
        if (resp.ok) { _legacyApi = true; return await resp.json(); }
        if (resp.status === 404) _legacyApi = false;
        else return {_error: 'listing failed (' + resp.status + ')'};
      } catch (e) { if (e && e.name === 'AbortError') throw e; _legacyApi = false; }
    }
    const p = String(path || '').replace(/\\/g, '/');
    const resp = await fetch('/v1/apps/file/vfs/list', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({url: 'vfs://' + p}), signal});
    const r = await resp.json();
    if (!r || r.ok === false) return {_error: (r && (r._error || r.error)) || 'listing failed'};
    const base = (r.path || p).replace(/\/+$/, '');
    return {entries: (r.entries || []).map(e => ({name: e.name, type: e.kind === 'dir' ? 'dir' : 'file', size: e.size,
      path: (base ? base + '/' : '') + e.name}))};
  }

  async function _navigate(path) {
    if (!_overlay) return;
    const overlay = _overlay;
    _menuScope?.destroy(); _menuScope = null;
    _list?.destroy(); _list = null;
    _details?.cancelReads();
    const request = ++_navigationRequest;
    const owner=_readScopes.begin('listing',{isCurrent:()=>_overlay===overlay&&request===_navigationRequest});
    if(!owner.current())return;
    const pathInput = overlay.querySelector('.fd-path');
    const listEl = overlay.querySelector('.fd-list');
    pathInput.value = path;
    listEl.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:12px">Loading...</div>';

    try {
      const source = _overlay.querySelector('.fd-source')?.value || '';
      const data = await _listing(path, source, owner.signal);
      if (!owner.current()) return;
      if (data._error) {
        listEl.innerHTML = `<div style="padding:16px;color:#f44;font-size:12px">${_escape(data._error)}</div>`;
        return;
      }

      if (_currentPath !== path) {
        _history.push(_currentPath);
      }
      _currentPath = path;

      const entries = data.entries || data.files || data.items || [];
      _renderList(entries, listEl);
    } catch (e) {
      if (!owner.current()) return;
      listEl.innerHTML = `<div style="padding:16px;color:#f44;font-size:12px">Error: ${_escape(e.message)}</div>`;
    } finally{owner.destroy();}
  }

  function _renderList(entries, listEl) {
    const overlay = _overlay;
    _list = window._AppUIFileDialogList.create({
      container:listEl, entries, filter:_opts.filter, showHidden:_opts.showHidden,
      path:_currentPath, formatSize:_formatSize,
      onNavigate:_navigate, onContext:_showContextMenu,
      onSelect:path=>{ if (_overlay===overlay) overlay.querySelector('.fd-filename').value=path; },
      onOpen:path=>{ if (_overlay!==overlay) return; overlay.querySelector('.fd-filename').value=path; _selectCurrent(); },
    });
  }

  async function _showContextMenu(e, path, type) {
    const overlay = _overlay;
    if (!overlay) return;
    _menuScope?.destroy();
    const scope = AppUILifecycle.createViewScope({parent:_readScopes,pagehide:false,isCurrent:()=>_overlay===overlay});
    _menuScope = scope;
    const details = _details, source = overlay.querySelector('.fd-source')?.value || '';
    const items = [
      {label: '📋 Copy path', action: () => { AppUICore.copyText(path); }},
      {label: '📄 File info', action: () => details.info(path,source)},
    ];
    if (type === 'file') {
      items.push({label: '👁 Preview', action: () => details.read(path,source)});
      items.push({label: '📖 Read content', action: () => details.read(path,source)});
      items.push({sep: true});
      items.push({label: '🗑 Delete', action: () => details.remove(path,source), danger: true});
    } else {
      items.push({label: '📂 Open here', action: () => _navigate(path)});
      items.push({label: '📋 Copy as path', action: () => { AppUICore.copyText(path); }});
    }

    await AppUIAssets.load('contextMenu');
    if (!scope.current()) return;
    const menu = AppUIContextMenu.show(e, items.map(item => item.sep ? {separator: true} : item), {signal:scope.signal});
    menu.style.zIndex = String(Number(overlay.style.zIndex) + 1);

  }

  function _selectCurrent() {
    const path = _overlay.querySelector('.fd-filename').value.trim().replace(/"/g, '');
    if (!path) return;
    const onSelect = _opts.onSelect;
    close();
    if (onSelect) onSelect(path);
  }

  function _goBack() {
    if (_history.length) _navigate(_history.pop());
  }

  function _goUp() {
    if (!_currentPath) return;
    const parent = _currentPath.replace(/[/\\][^/\\]*$/, '');
    if (parent !== _currentPath) _navigate(parent);
  }

  function close() {
    if (_overlay) AppUIDialog.close(_overlay);
  }

  function _escape(s) {
    return AppUITextUtils.esc(s || '');
  }

  function _formatSize(bytes) {
    if (bytes < 1024) return bytes + 'B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + 'KB';
    return (bytes / 1024 / 1024).toFixed(1) + 'MB';
  }


  return { open, close };
})();
window.AppUIFileDialog = AppUIFileDialog;
