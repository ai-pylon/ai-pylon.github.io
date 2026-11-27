/** Internal ChatSurface config dialog; core supplies instance dependencies. */
window._AppUIChatSurfaceConfig = (() => {
  function create({ state, Dialog, esc, call, setStatus, getChat, getBackendSel, _backendHolder, onApply }) {
    // ---- ⚙️ LLM (backend + model + tunables) --------------------------------
    async function openConfig() {
      if (!Dialog) return;
      const backendSel = getBackendSel();
      const backend = state.backend || '';
      if (!state.models[backend]) {
        let r = {};
        try { r = await call('models', {backend}, 15000); } catch (_e) { r = {}; }
        state.models[backend] = (r && r.models) || [];
      }
      const models = state.models[backend] || [];
      const body = document.createElement('div');
      body.style.cssText = 'display:flex;flex-direction:column;gap:10px;min-width:380px';

      // Backend picker (the <select> moved here from the bar). We reparent the
      // live backendSel element into the dialog so its options/selection stay
      // authoritative; on close it's detached again (kept alive for state sync).
      const beWrap = document.createElement('div');
      beWrap.innerHTML = '<div style="font-size:12px;font-weight:600;margin-bottom:4px">Backend</div>';
      backendSel.style.cssText = 'width:100%;box-sizing:border-box;background:var(--bg);color:var(--text-primary);'
        + 'border:1px solid var(--border);border-radius:var(--radius-sm);padding:6px 8px;font-size:12px';
      beWrap.append(backendSel);

      const modelOpts = ['<option value="">(backend default)</option>'].concat(models.map(m => {
        const id = (typeof m === 'string') ? m : (m.id || m.name || '');
        return '<option value="' + esc(id) + '"' + (id === state.model ? ' selected' : '') + '>' + esc(id) + '</option>';
      })).join('');
      const rest = document.createElement('div');
      rest.style.cssText = 'display:flex;flex-direction:column;gap:10px';
      rest.innerHTML =
        '<div><div id="cfg-model-label" style="font-size:12px;font-weight:600;margin-bottom:4px">Model — ' + esc(backend || '(backend)') + '</div>'
        + '<select id="cfg-model" style="width:100%;box-sizing:border-box;background:var(--bg);color:var(--text-primary);'
        + 'border:1px solid var(--border);border-radius:var(--radius-sm);padding:6px 8px;font-size:12px">' + modelOpts + '</select>'
        + (models.length ? '' : '<div style="font-size:11px;color:var(--text-muted);margin-top:3px">No model list available — the backend default is used.</div>') + '</div>'
        + '<div><div style="font-size:12px;font-weight:600;margin-bottom:4px">Temperature</div><div style="display:flex;align-items:center;gap:8px">'
        + '<input type="range" id="cfg-temp" min="0" max="2" step="0.1" value="' + (state.temperature == null ? 0.7 : state.temperature) + '" style="flex:1">'
        + '<span id="cfg-temp-val" style="font-size:12px;width:48px;text-align:right">' + (state.temperature == null ? 'default' : state.temperature) + '</span>'
        + '<label style="font-size:11px;display:flex;align-items:center;gap:4px"><input type="checkbox" id="cfg-temp-def"' + (state.temperature == null ? ' checked' : '') + '> default</label></div></div>';
      body.append(beWrap, rest);

      // ---- routing: fallback chain + per-backend health (llm.routing_status) --
      // Shows WHICH backend answers (default + the fallback order) and each
      // backend's live availability / any tripped circuit breaker, so a user
      // knows the resilience picture without leaving the dialog. Best-effort.
      const routingEl = document.createElement('div');
      routingEl.style.cssText = 'font-size:11px;color:var(--text-muted);border-top:1px solid var(--border);padding-top:8px';
      routingEl.innerHTML = '<div style="font-weight:600;margin-bottom:3px">Routing</div><div id="cfg-routing">loading…</div>';
      body.append(routingEl);
      (async () => {
        let rs = {};
        try { rs = await call('routing_status', {}, 10000); } catch (_e) { rs = {}; }
        const host = body.querySelector('#cfg-routing'); if (!host) return;
        if (!rs || !rs.ok) { host.textContent = 'unavailable'; return; }
        const dot = (b) => {
          const a = (rs.available || {})[b];
          const c = (rs.circuits || {})[b];
          const state2 = c && (c.state || c);
          if (state2 && /open|degraded/i.test(String(state2))) return '🟠';
          return a ? '🟢' : '⚪';
        };
        const chain = (rs.fallback_chain && rs.fallback_chain.length) ? rs.fallback_chain : (rs.default ? [rs.default] : []);
        const chainHtml = chain.map(b => dot(b) + ' ' + esc(b) + (b === rs.default ? ' <span style="opacity:.7">(default)</span>' : '')).join(' → ');
        let extra = '';
        try {
          const circuits = rs.circuits || {};
          const tripped = Object.keys(circuits).filter(k => { const s = circuits[k] && (circuits[k].state || circuits[k]); return s && /open|degraded|half/i.test(String(s)); });
          if (tripped.length) extra = '<div style="margin-top:3px;color:var(--color-warning,#e0a030)">⚠ degraded: ' + tripped.map(esc).join(', ') + '</div>';
        } catch (_e) {}
        host.innerHTML = (chainHtml || '(no chain)') + extra;
      })();

      // When the backend changes in the dialog, refresh the model list for it.
      const onBe = async () => {
        const be = backendSel.value;
        if (!state.models[be]) {
          let r = {};
          try { r = await call('models', {backend: be}, 15000); } catch (_e) { r = {}; }
          state.models[be] = (r && r.models) || [];
        }
        const ms = state.models[be] || [];
        const sel = body.querySelector('#cfg-model');
        if (sel) {
          sel.innerHTML = ['<option value="">(backend default)</option>']
            .concat(ms.map(m => { const id = (typeof m === 'string') ? m : (m.id || m.name || ''); return '<option value="' + esc(id) + '">' + esc(id) + '</option>'; })).join('');
        }
        const lbl = rest.querySelector('#cfg-model-label'); if (lbl) lbl.textContent = 'Model — ' + (be || '(backend)');
      };
      backendSel.addEventListener('change', onBe);

      const temp = body.querySelector('#cfg-temp'), tval = body.querySelector('#cfg-temp-val'), tdef = body.querySelector('#cfg-temp-def');
      temp.addEventListener('input', () => { tdef.checked = false; tval.textContent = temp.value; });
      tdef.addEventListener('change', () => { tval.textContent = tdef.checked ? 'default' : temp.value; });
      function detach() {
        // put backendSel back into an off-DOM holder so it survives dialog close
        backendSel.removeEventListener('change', onBe);
        _backendHolder.append(backendSel);
      }
      function apply() {
        state.backend = backendSel.value || state.backend;
        getChat()?.setBackend(state.backend);
        state.model = body.querySelector('#cfg-model').value || '';
        state.temperature = tdef.checked ? null : parseFloat(temp.value);
        if (state.model) getChat()?.setModel(state.model);
        setStatus('LLM: ' + (state.backend || 'default') + (state.model ? ' · ' + state.model : '') + (state.temperature == null ? '' : ' · temp ' + state.temperature));
        try { if (typeof onApply === 'function') onApply(); } catch (_e) {}
        detach();
      }
      Dialog.show({title: '⚙️ LLM', body, width: '440px', buttons: [
        {text: 'Cancel', action: detach}, {text: 'Apply', primary: true, action: apply}]});
    }
    return { openConfig };
  }
  return { create };
})();
