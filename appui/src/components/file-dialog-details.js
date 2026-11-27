/* File picker details and committed deletion, owned by one dialog mount. */
window._AppUIFileDialogDetails = (() => {
  function create({overlay, getSource, isCurrent, nextRequest, isRequestCurrent, onBack, getPath, onRefresh, formatSize, onReadStart}) {
    const reads = AppUILifecycle.createKeyedScopes({pagehide: false, isCurrent});
    const current = () => reads.current();
    const esc = value => AppUITextUtils.esc(value ?? '');
    function cancelReads() { reads.destroy('details'); }
    async function show(kind, path, source = getSource()) {
      if (!current()) return;
      cancelReads();
      onReadStart?.();
      const request = nextRequest();
      const owned = reads.begin('details', {isCurrent: () => isRequestCurrent(request)});
      const valid = () => owned.current();
      const list = overlay.querySelector('.fd-list');
      try {
        const payload = kind === 'read' ? {path, source, max_bytes: 5000} : {path, source};
        const response = await fetch('/api/file.' + kind, {
          method: 'POST', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(payload), signal: owned.signal,
        });
        const data = await response.json();
        if (!valid()) return;
        const content = document.createElement('div');
        content.style.cssText = 'padding:12px;font-size:11px;overflow:auto;color:var(--text-primary);line-height:1.8';
        const heading = document.createElement('b');
        heading.textContent = path.split(/[/\\]/).pop();
        const back = document.createElement('button');
        back.type = 'button'; back.textContent = '<- Back';
        back.onclick = () => { if (valid()) onBack(); };
        content.append(heading, back);
        const body = document.createElement(kind === 'read' ? 'pre' : 'div');
        if (kind === 'read') {
          body.style.cssText = 'white-space:pre-wrap;overflow:auto;max-height:300px';
          body.textContent = data.content || data._error || 'No content';
        } else {
          body.innerHTML = 'Path: <code>' + esc(path) + '</code><br>Size: '
            + esc(data.size ? formatSize(data.size) : 'unknown') + '<br>Modified: '
            + esc(data.modified ? new Date(data.modified * 1000).toLocaleString() : 'unknown')
            + '<br>Type: ' + esc(data.mime || data.type || 'unknown');
        }
        content.appendChild(body); list.replaceChildren(content);
      } catch (error) {
        if (valid() && error.name !== 'AbortError') list.textContent = 'Error: ' + error.message;
      }
    }
    async function remove(path, source = getSource()) {
      if (!current() || !confirm('Delete ' + path.split(/[/\\]/).pop() + '?')) return;
      const folder = getPath();
      // A confirmed deletion completes even if its dialog closes.
      await fetch('/api/file.delete', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({path, source}),
      });
      if (current() && getPath() === folder && getSource() === source) onRefresh();
    }
    return {info: (path, source) => show('info', path, source),
      read: (path, source) => show('read', path, source), remove, cancelReads,
      destroy() { reads.destroy(); },
    };
  }
  return {create};
})();
