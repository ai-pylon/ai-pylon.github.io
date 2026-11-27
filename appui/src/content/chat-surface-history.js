/* Server conversation history with host-provider or default-op routing. */
window.AppUIChatSurfaceHistory = (() => {
  function create({ CAP, call, state, getChat, Dialog, esc, newChat, q, setStatus }) {
    // Server-history routing: a host may supply its own {save,list,load,delete}
    // via CAP.serverHistoryProvider; otherwise use ai/llm_server's chat_* ops.
    const _histProv = (CAP.serverHistoryProvider && typeof CAP.serverHistoryProvider === 'object')
      ? CAP.serverHistoryProvider : null;
    const histSave = (b, ms) => _histProv && typeof _histProv.save === 'function'
      ? _histProv.save(b) : call('chat_save', b, ms);
    const histList = (ms) => _histProv && typeof _histProv.list === 'function'
      ? _histProv.list() : call('chat_list', {}, ms);
    const histLoad = (id, ms) => _histProv && typeof _histProv.load === 'function'
      ? _histProv.load(id) : call('chat_load', {id}, ms);
    const histDelete = (id, ms) => _histProv && typeof _histProv.delete === 'function'
      ? _histProv.delete(id) : call('chat_delete', {id}, ms);
    // Rename / pin — only via the default ai/llm_server op (a host provider that
    // doesn't implement rename simply won't get the buttons; see hasRename).
    const hasRename = !_histProv || typeof _histProv.rename === 'function';
    const histRename = (id, patch, ms) => _histProv && typeof _histProv.rename === 'function'
      ? _histProv.rename(id, patch) : call('chat_rename', Object.assign({id}, patch), ms);
    // Export-all / import — default-op only (a host provider that doesn't
    // implement them won't get the buttons; see hasPortability).
    const hasPortability = !_histProv || (typeof _histProv.exportAll === 'function' && typeof _histProv.import === 'function');
    const histExportAll = (ms) => _histProv && typeof _histProv.exportAll === 'function'
      ? _histProv.exportAll() : call('chat_export_all', {}, ms);
    const histImport = (payload, ms) => _histProv && typeof _histProv.import === 'function'
      ? _histProv.import(payload) : call('chat_import', payload, ms);
    // Auto-title: after the first save of a session whose title is still the raw
    // first-message default, summarize the opening turn into a concise title via
    // llm.summarize, then persist it with chat_rename. Fire-and-forget, guarded
    // so it runs at most once per session. Skipped for a host provider without
    // rename, or when the title was already customized.
    const _autoTitled = new Set();
    async function _maybeAutoTitle(sid, msgs) {
      if (!hasRename || !sid || _autoTitled.has(sid)) return;
      _autoTitled.add(sid);
      try {
        const firstUser = (msgs.find(m => m.role === 'user') || {}).content || '';
        const firstBot = (msgs.find(m => m.role === 'assistant') || {}).content || '';
        const src = (firstUser + '\n' + firstBot).trim();
        if (!src) return;
        const r = await call('summarize', {text: src, max_words: 7, purpose: 'title'}, 20000);
        const title = (r && (r.summary || r.text || r.result) || '').trim().replace(/^["'\s]+|["'\s.]+$/g, '');
        if (title && title.length > 2 && title.length <= 80) {
          await histRename(sid, {title}, 10000);
        }
      } catch (_e) { /* best-effort — a failed summary just keeps the default title */ }
    }
    async function autosaveSession() {
      if (!CAP.serverHistory) return;
      const chat = getChat();
      const hist = (chat?.getHistory && chat.getHistory()) || [];
      // Keep the DEBUG detail of each turn (tool calls + results, reasoning,
      // usage, and why a turn was cut) — not just {role, content} — so a bad
      // answer can be diagnosed from the saved chat afterwards.
      const _DEBUG_KEYS = ['id', 'parent_id', 'replay_of', 'timestamp', 'tool_calls', 'reasoning', 'usage',
        'round_trace', 'finish_reason', 'stopped', 'partial', 'aborted', 'error', 'elapsed_ms', 'tool_count'];
      const msgs = hist.filter(m => m.role === 'user' || m.role === 'assistant').map(m => {
        const o = {role: m.role, content: m.content};
        _DEBUG_KEYS.forEach(k => {
          const v = m[k];
          if (v == null || v === '' || v === false || (Array.isArray(v) && !v.length)) return;
          o[k] = v;
        });
        return o;
      });
      if (msgs.length < 2) return;
      try {
        const wiring = (state.agent || (state.wired && (state.wired.scope.length || state.wired.workflows.length)))
          ? {agent: state.agent || '', scope: (state.wired || {}).scope || [], workflows: (state.wired || {}).workflows || []} : null;
        const chips = (state.contextChips || []).length ? state.contextChips.map(c => Object.assign({}, c)) : null;
        const meta = (wiring || chips) ? Object.assign({}, wiring ? {wiring} : {}, chips ? {context_chips: chips} : {}) : undefined;
        const r = await histSave({id: state.activeSessionId || undefined, messages: msgs, backend: state.backend,
                                  meta}, 20000);
        if (r && r.ok) {
          state.activeSessionId = r.id;
          // Title the chat on the save of its SECOND turn (llm.summarize purpose=title -> chat_rename,
          // fire-and-forget): a one-turn chat keeps its first-message title and costs no summary call
          // (IMPROVEMENTS_NEXT #7). Exactly at 2 user messages, so a restored longer chat is not re-titled.
          if (msgs.filter(m => m.role === 'user').length === 2) { _maybeAutoTitle(r.id, msgs); }
        }
      } catch (_e) {}
    }
    async function openServerHistory() {
      if (!Dialog) return;
      const body = document.createElement('div');
      body.style.cssText = 'display:flex;flex-direction:column;gap:6px;min-width:480px';
      // Search box — client-side filter over title + backend (idea: search history).
      const search = document.createElement('input');
      search.type = 'search'; search.placeholder = 'Search conversations…';
      search.style.cssText = 'font:inherit;font-size:12px;padding:4px 8px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-elevated);color:var(--text-primary)';
      const listEl = document.createElement('div');
      listEl.style.cssText = 'display:flex;flex-direction:column;gap:4px;max-height:54vh;overflow:auto';
      // Export-all / Import toolbar (portable JSON backup/transfer).
      const bar = document.createElement('div');
      bar.style.cssText = 'display:flex;gap:6px;justify-content:flex-end';
      if (hasPortability) {
        const exp = document.createElement('button'); exp.type = 'button'; exp.className = 'tt-ctl'; exp.textContent = '⭳ Export all';
        exp.title = 'Download every saved conversation as a JSON file';
        exp.addEventListener('click', async () => {
          try {
            const r = await histExportAll(20000);
            const data = (r && (r.export || r)) || {};
            const blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
            const name = 'chat-history-' + new Date().toISOString().slice(0, 10) + '.json';
            if (window.AppUICore && AppUICore.downloadBlob) AppUICore.downloadBlob(blob, name);
            else { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
            setStatus('Exported ' + ((data && data.count) || 0) + ' conversation(s)');
          } catch (e) { setStatus('Export failed: ' + (e.message || e)); }
        });
        const imp = document.createElement('button'); imp.type = 'button'; imp.className = 'tt-ctl'; imp.textContent = '⭱ Import';
        imp.title = 'Import conversations from an exported JSON file (keeps existing)';
        imp.addEventListener('click', () => {
          const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/json,.json';
          inp.addEventListener('change', async () => {
            const f = inp.files && inp.files[0]; if (!f) return;
            try {
              const text = await f.text();
              const parsed = JSON.parse(text);
              const r = await histImport({export: parsed.export || parsed, mode: 'skip'}, 30000);
              if (r && r.ok) { setStatus('Imported ' + r.imported + ', skipped ' + r.skipped); await refresh(); }
              else { setStatus('Import failed: ' + ((r && r.error) || 'bad file')); }
            } catch (e) { setStatus('Import failed: ' + (e.message || e)); }
          });
          inp.click();
        });
        bar.append(exp, imp);
      }
      body.append(search, bar, listEl);
      let close = () => {};
      let _all = [];   // cached full session list for client-side filtering
      function paint() {
        const q = (search.value || '').trim().toLowerCase();
        const sessions = q
          ? _all.filter(s => ((s.title || '') + ' ' + (s.backend || '') + ' ' + (s.id || '')).toLowerCase().includes(q.replace(/^#/, '')))
          : _all;
        listEl.replaceChildren();
        if (!sessions.length) {
          const e = document.createElement('div'); e.style.cssText = 'color:var(--text-muted);font-size:12px;padding:6px';
          e.textContent = _all.length ? 'No conversations match “' + search.value + '”.' : 'No saved conversations on the server yet.';
          listEl.append(e); return;
        }
        sessions.forEach(s => {
          const row = document.createElement('div');
          row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg)';
          const meta = document.createElement('div'); meta.style.cssText = 'flex:1;min-width:0;cursor:pointer';
          const when = s.updated_at ? new Date(s.updated_at).toLocaleString() : '';
          meta.innerHTML = '<div style="font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'
            + (s.pinned ? '\ud83d\udccc ' : '') + esc(s.title || '(untitled)') + '</div>'
            + '<div style="font-size:10px;color:var(--text-muted)">' + esc(when) + (s.message_count != null ? ' · ' + s.message_count + ' msgs' : '') + (s.backend ? ' · ' + esc(s.backend) : '')
            + (s.older_format ? ' · <span title="Saved in the older format: text only - no tool rows, timestamps or stats">older format</span>' : '')
            + ' · <span style="font-family:ui-monospace,Consolas,monospace" title="conversation id ' + esc(s.id || '') + '">#' + esc(String(s.id || '').slice(0, 8)) + '</span></div>';
          meta.addEventListener('click', async () => { const full = await histLoad(s.id, 15000); if (full && full.ok && full.session) { loadServerSession(full.session); close(); } });
          row.append(meta);
          if (hasRename) {
            const pin = document.createElement('button'); pin.type = 'button'; pin.className = 'tt-ctl';
            pin.textContent = s.pinned ? 'Unpin' : 'Pin'; pin.title = 'Pin to the top';
            pin.addEventListener('click', async (e) => { e.stopPropagation(); await histRename(s.id, {pinned: !s.pinned}, 10000); await refresh(); });
            const ren = document.createElement('button'); ren.type = 'button'; ren.className = 'tt-ctl'; ren.textContent = 'Rename';
            ren.addEventListener('click', async (e) => {
              e.stopPropagation();
              const next = window.prompt('Rename conversation', s.title || '');
              if (next != null && next.trim()) { await histRename(s.id, {title: next.trim()}, 10000); await refresh(); }
            });
            row.append(pin, ren);
          }
          const del = document.createElement('button'); del.type = 'button'; del.className = 'tt-ctl'; del.textContent = 'Delete';
          del.addEventListener('click', async (e) => { e.stopPropagation(); await histDelete(s.id, 10000); await refresh(); });
          row.append(del); listEl.append(row);
        });
      }
      async function refresh() {
        let r = {};
        try { r = await histList(15000); } catch (_e) { r = {}; }
        _all = (r && r.sessions) || [];
        paint();
      }
      search.addEventListener('input', paint);
      refresh();
      const d = Dialog.show({title: '🕑 History (server)', body, width: '600px', buttons: [{text: 'New chat', action: () => { newChat(); }}, {text: 'Close'}]});
      close = () => { try { if (Dialog.close) Dialog.close(d); } catch (_e) {} };   // show() returns the overlay
    }
    function loadServerSession(session) {
      newChat(true); state.activeSessionId = session.id;
      const msgs = (session.messages || []).filter(m => m && (m.role === 'user' || m.role === 'assistant'))
        .map(m => Object.assign({}, m, {content: String(m.content == null ? '' : m.content)}));
      const chat = getChat();
      if (chat && typeof chat.setHistory === 'function') {
        // through the ENGINE: the bubbles come back with their controls, and the next turn SENDS this history
        // (painting DOM only left the engine empty - the model then had no idea what "continue" meant)
        chat.setHistory(msgs);
      } else {
        const host = q('.ai-chat-messages');
        if (host) {
          msgs.forEach(m => {
            const div = document.createElement('div'); div.className = 'ai-chat-msg ' + (m.role === 'user' ? 'user' : 'assistant');
            const md = (m.role === 'assistant' && window.AppUIMarkdown?.render) ? window.AppUIMarkdown.render(m.content || '') : esc(m.content || '');
            div.innerHTML = '<div class="ai-chat-bubble">' + md + '</div>'; host.appendChild(div);
          });
          host.scrollTop = host.scrollHeight;
        }
      }
      const w = session.meta && session.meta.wiring;   // #30: the conversation's agent + wired tools come back with it
      if (w && typeof state._applyWiring === 'function') state._applyWiring(w, 'Wiring of this conversation restored');
      const cc = session.meta && session.meta.context_chips;   // and its context chips
      if (Array.isArray(cc) && typeof state._applyContextChips === 'function') state._applyContextChips(cc);
      setStatus('Loaded “' + (session.title || 'conversation') + '” (server) - it continues this conversation.' + (w ? ' Wiring restored.' : ''));
    }

    return {autosaveSession, openServerHistory, loadServerSession};
  }
  return {create};
})();
