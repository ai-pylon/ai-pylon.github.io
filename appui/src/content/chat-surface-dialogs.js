/* Details, transcript export, and the engine-history fallback. */
window._AppUIChatSurfaceDialogs = (() => {
  function create({state, Dialog, esc, getChat, CAP, setStatus, newChat}) {
    let active = true;
    // ---- details dialog -----------------------------------------------------
    function showDetails() {
      const chat = getChat();
      const hist = (chat?.getHistory && chat.getHistory()) || [];
      let lastAssistant = null, lastUser = null;
      for (let i = hist.length - 1; i >= 0; i--) {
        if (!lastAssistant && hist[i].role === 'assistant') lastAssistant = hist[i];
        if (!lastUser && hist[i].role === 'user') lastUser = hist[i];
        if (lastAssistant && lastUser) break;
      }
      const req = state.lastReq || {};
      const detail = {
        request: {backend: req.backend || state.backend,
          message: lastUser ? lastUser.content : null, system: req.system || '(none)',
          model: req.model,
          tool_mode: (req.scope && req.scope.length) ? 'scope: ' + req.scope.join(', ')
            : req.flatten ? 'flatten' : req.progressive ? 'hierarchical' : 'no tools'},
        response: {
          content: lastAssistant ? lastAssistant.content : '',
          reasoning: (lastAssistant && lastAssistant.reasoning) || '(none captured)',
          tool_calls: (lastAssistant && lastAssistant.tool_calls) || [],
        },
      };
      const body = document.createElement('div');
      body.style.cssText = 'font-size:11px';
      body.innerHTML =
        '<div style="font-weight:600;color:var(--accent);margin-bottom:2px">REQUEST</div>'
        + '<pre style="white-space:pre-wrap;background:var(--bg);border:1px solid var(--border);'
        + 'border-radius:4px;padding:8px;max-height:200px;overflow:auto">' + esc(JSON.stringify(detail.request, null, 2)) + '</pre>'
        + '<div style="font-weight:600;color:#3ba55d;margin:8px 0 2px">RESPONSE</div>'
        + '<pre style="white-space:pre-wrap;background:var(--bg);border:1px solid var(--border);'
        + 'border-radius:4px;padding:8px;max-height:260px;overflow:auto">' + esc(JSON.stringify(detail.response, null, 2)) + '</pre>';
      if (Dialog) Dialog.show({title: 'Message details', body, width: '560px', buttons: [{text: 'Close'}]});
    }

    // ---- ↗ Export -----------------------------------------------------------
    function exportTranscript() {
      const chat = getChat();
      const md = (chat?.exportChat && chat.exportChat()) || '';
      if (!md.trim()) { setStatus('Nothing to export yet'); return; }
      if (typeof CAP.openInContent === 'function') { CAP.openInContent(md); return; }
      const copying = window.AppUICore.copyText(md).then(() => true, () => false);
      let opened = false;
      try {
        const w = window.open('', '_blank');
        if (w) {
          w.document.title = 'Chat transcript';
          const pre = w.document.createElement('pre');
          pre.style.cssText = 'white-space:pre-wrap;font-family:ui-monospace,Consolas,monospace;padding:16px;font-size:13px';
          pre.textContent = md; w.document.body.appendChild(pre); opened = true;
        }
      } catch (_e) {}
      return copying.then(copied => {
        if (!active) return;
        if (copied) setStatus('Transcript copied to clipboard' + (opened ? ' + opened in a new tab' : ''));
        else setStatus(opened ? 'Transcript opened in a new tab (clipboard unavailable)' : 'Could not copy or open the transcript');
      });
    }

    // engine (localStorage) history fallback when no server history capability
    function openEngineHistory() {
      const chat = getChat();
      if (!Dialog || !chat?.getSessions) { setStatus('History unavailable'); return; }
      const body = document.createElement('div'); body.style.cssText = 'display:flex;flex-direction:column;gap:6px;min-width:460px';
      const listEl = document.createElement('div'); listEl.style.cssText = 'display:flex;flex-direction:column;gap:4px;max-height:52vh;overflow:auto';
      body.append(listEl);
      let close = () => {};
      function renderL() {
        const sessions = (chat.getSessions && chat.getSessions()) || []; listEl.replaceChildren();
        if (!sessions.length) { const e = document.createElement('div'); e.style.cssText = 'color:var(--text-muted);font-size:12px;padding:6px'; e.textContent = 'No saved conversations yet.'; listEl.append(e); return; }
        sessions.forEach(s => {
          const row = document.createElement('div'); row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg)';
          const meta = document.createElement('div'); meta.style.cssText = 'flex:1;min-width:0;cursor:pointer';
          const when = s.updated_at ? new Date(s.updated_at).toLocaleString() : '';
          meta.innerHTML = '<div style="font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(s.title || '(untitled)') + '</div>'
            + '<div style="font-size:10px;color:var(--text-muted)">' + esc(when) + (s.message_count != null ? ' · ' + s.message_count + ' msgs' : '') + '</div>';
          meta.addEventListener('click', () => { try { chat.loadSession(s.id); setStatus('Loaded conversation'); } catch (_e) {} close(); });
          row.append(meta); listEl.append(row);
        });
      }
      renderL();
      const d = Dialog.show({title: 'History', body, width: '560px', buttons: [{text: 'New chat', action: () => newChat()}, {text: 'Close'}]});
      close = () => { try { if (Dialog.close) Dialog.close(d); } catch (_e) {} };   // show() returns the overlay
    }

    return {showDetails, exportTranscript, openEngineHistory, destroy() {active = false;}};
  }
  return {create};
})();
