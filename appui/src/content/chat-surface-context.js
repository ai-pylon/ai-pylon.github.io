/** Internal ChatSurface context dialog; core supplies instance dependencies. */
window._AppUIChatSurfaceContext = (() => {
  function create({ state, CAP, Dialog, esc, call, setStatus, getChat }) {
    // ---- ℹ️ Context (now ALSO owns the editable system prompt) --------------
    async function openContext() {
      if (!Dialog) return;
      const body = document.createElement('div'); body.style.cssText = 'min-width:560px;display:flex;flex-direction:column;gap:10px';
      const loc = (typeof CAP.currentLocation === 'function') ? CAP.currentLocation() : null;
      const metaLines = [
        'Backend: ' + (state.backend || '(default)') + (state.model ? ' · model ' + state.model : ''),
        'Tool mode: ' + (state.scope && state.scope.length ? ('scope (' + state.scope.length + ' patterns)') : state.flatten ? 'flatten (all leaf descriptions)' : 'hierarchical (multi-turn)'),
        'Always-available tools: ' + ((state.mandatoryPats && state.mandatoryPats.join(', ')) || 'file/vfs'),
      ];
      if (loc) metaLines.push('Current view: ' + [loc.file && ('file ' + loc.file), loc.folder && ('folder ' + loc.folder), loc.root && ('root ' + loc.root)].filter(Boolean).join(' · '));
      const docNames = (state.projectDocs || []).map(d => d.name).filter(Boolean);
      if (docNames.length) metaLines.push('Project docs: ' + docNames.join(', '));

      // meta line
      const meta = document.createElement('div');
      meta.style.cssText = 'font-size:11px;color:var(--text-muted)';
      meta.textContent = metaLines.join('  ·  ');

      // EDITABLE custom system prompt (moved here from the Tools dialog)
      const sysWrap = document.createElement('div');
      sysWrap.innerHTML = '<div style="font-size:12px;font-weight:600;margin-bottom:4px">Custom system prompt</div>'
        + '<textarea id="cs-sysp" rows="4" style="width:100%;box-sizing:border-box;background:var(--bg-elevated);'
        + 'color:var(--text-primary);border:1px solid var(--border);border-radius:var(--radius-sm);padding:6px 8px;'
        + 'font-family:inherit;font-size:12px;resize:vertical" placeholder="Optional. e.g. You are a terse ops assistant.">'
        + esc(state.system || '') + '</textarea>';

      // Project docs (grounding) — READ-ONLY, so the user sees exactly what the
      // workspace injects (answers "what else is in my context?").
      const docsWrap = document.createElement('div');
      if (state.projectDocsText) {
        docsWrap.innerHTML = '<div style="font-size:12px;font-weight:600;margin:2px 0 2px">Project docs (grounding — prepended to the system prompt)</div>'
          + '<pre style="white-space:pre-wrap;background:var(--bg);border:1px solid var(--border);border-radius:4px;'
          + 'padding:8px;max-height:22vh;overflow:auto;font-size:11px">' + esc(state.projectDocsText.slice(0, 6000)
          + (state.projectDocsText.length > 6000 ? '\n…' : '')) + '</pre>';
      }

      // FULL assembled context the SERVER will actually build — the honest,
      // nothing-hidden view. Includes the mandatory-tool block + tool preamble
      // the server prepends, which the client can't fully know, so we fetch a
      // server-side preview when available and otherwise show what we can.
      const fullWrap = document.createElement('div');
      fullWrap.innerHTML = '<div style="font-size:12px;font-weight:600;margin:2px 0 2px">Full system prompt the server assembles (preview)</div>'
        + '<pre id="cs-full" style="white-space:pre-wrap;background:var(--bg);border:1px solid var(--border);border-radius:4px;'
        + 'padding:8px;max-height:26vh;overflow:auto;font-size:11px;color:var(--text-muted)">Loading…</pre>';

      const note = document.createElement('div');
      note.style.cssText = 'font-size:11px;color:var(--text-muted)';
      note.innerHTML = 'This is the COMPLETE text the model is given before your messages: '
        + '(1) project docs, (2) your custom system prompt, (3) the tool preamble + '
        + 'always-available tools the server adds. Nothing else is injected by this UI.';

      body.append(meta, sysWrap, docsWrap, fullWrap, note);
      const dlg = Dialog.show({title: 'Context sent to the model', body, width: '680px',
        buttons: [{text: 'Close'}, {text: 'Save system prompt', primary: true, action: () => {
          state.system = (body.querySelector('#cs-sysp').value || '').trim();
          getChat()?.setSystem(state.system);
          setStatus('System prompt saved');
        }}]});

      // Fill the full-prompt preview. Prefer a server op (llm.preview) that
      // returns the REAL assembled system prompt so this can't drift; fall back
      // to assembling it client-side from the parts we know. Also disclose the
      // backend's IMPLICIT context (kiro reads its working directory).
      (async () => {
        const full = body.querySelector('#cs-full'); if (!full) return;
        let text = '', implicit = [], files = [];
        try {
          const r = await call('preview', {backend: state.backend,
            system: (body.querySelector('#cs-sysp').value || state.system || ''),
            scope: state.scope || [], progressive: !!state.progressive,
            extra_scope: (state.wiredScope && state.wiredScope.length) ? JSON.stringify(state.wiredScope) : '',
            flatten: !!(state.flatten && !(state.scope && state.scope.length))}, 12000);
          if (r && r.ok && r.system) text = r.system;
          if (r && r.wired && r.wired.length) {
            const meta = document.createElement('div');
            meta.className = 'cs-wired-meta';
            meta.style.cssText = 'font-size:11px;color:var(--text-muted);margin:2px 0 4px';
            meta.textContent = '🔌 wired into this chat: ' + r.wired.join(', ') + ' · scope sent: '
              + ((r.scope_effective || []).join(', ') || '(none)') + (r.scope_tool_count ? ' · ' + r.scope_tool_count + ' tools described' : '');
            full.before(meta);
          }
          if (r && r.implicit_context) implicit = r.implicit_context;
          if (r && r.implicit_files) files = r.implicit_files;
        } catch (_e) {}
        if (!text) {
          const parts = [];
          if (state.projectDocsText) parts.push(state.projectDocsText);
          const cs = (body.querySelector('#cs-sysp').value || state.system || '').trim();
          if (cs) parts.push(cs);
          parts.push('[+ the tool preamble and always-available tools are '
            + 'appended by the server — see the live preview in the Tools dialog]');
          text = parts.join('\n\n');
        }
        full.textContent = text;
        if (implicit.length || files.length) {
          const impWrap = document.createElement('div');
          impWrap.style.cssText = 'margin-top:8px';
          const hdr = document.createElement('div');
          hdr.style.cssText = 'font-size:12px;font-weight:600;margin:2px 0 2px';
          hdr.textContent = 'Implicit backend context (files the agent reads from its working directory)';
          impWrap.append(hdr);
          if (implicit.length) {
            const d = document.createElement('div');
            d.style.cssText = 'font-size:11px;color:var(--text-muted);margin-bottom:6px';
            d.textContent = implicit.join('\n\n');
            impWrap.append(d);
          }
          if (files.length) {
            const listWrap = document.createElement('div');
            listWrap.style.cssText = 'display:flex;flex-direction:column;gap:4px';
            files.forEach(f => {
              const det = document.createElement('details');
              det.style.cssText = 'border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg)';
              const sum = document.createElement('summary');
              sum.style.cssText = 'cursor:pointer;list-style:none;padding:5px 8px;font-size:11px;display:flex;align-items:center;gap:8px';
              const kindBadge = f.kind ? '<span style="font-size:9px;background:var(--bg-active);border:1px solid var(--border);border-radius:8px;padding:0 5px;color:var(--text-muted)">' + esc(f.kind) + '</span>' : '';
              const size = f.bytes ? (f.bytes >= 1024 ? (f.bytes / 1024).toFixed(1) + ' KB' : f.bytes + ' B') : '';
              sum.innerHTML = '<span style="font-family:ui-monospace,Consolas,monospace;color:var(--text-primary);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(f.path) + '</span>'
                + kindBadge + (size ? '<span style="font-size:10px;color:var(--text-muted)">' + esc(size) + '</span>' : '')
                + '<span style="font-size:10px;color:var(--accent)">preview ▸</span>';
              det.append(sum);
              const pre = document.createElement('pre');
              pre.style.cssText = 'margin:0;border-top:1px solid var(--border);white-space:pre-wrap;padding:8px;max-height:30vh;overflow:auto;font-size:11px;color:var(--text-muted)';
              pre.textContent = f.preview || '(no preview)';
              det.append(pre);
              listWrap.append(det);
            });
            impWrap.append(listWrap);
          } else {
            const none = document.createElement('div');
            none.style.cssText = 'font-size:11px;color:var(--text-muted)';
            none.textContent = 'No context files found in the working directory.';
            impWrap.append(none);
          }
          fullWrap.after(impWrap);
        }
      })();
    }
    return { openContext };
  }
  return { create };
})();
