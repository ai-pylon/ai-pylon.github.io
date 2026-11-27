/* ChatSurface CONTEXT CHIPS — context added to THIS chat, shown as removable chips above the composer and
 * sent with every turn. Two kinds:
 *   app chips  {id, app_id, label, icon, args, title, text, uris} — an app's exposed context (manifest
 *              chat_context, fetched with ai/llm_server context_get), e.g. a workspace or a .duckdb file;
 *   uri chips  {uri, name, kind} — a file/folder the user pinned (named only, the model reads it on demand).
 * The ➕ Context dialog lists ai/llm_server context_providers: pick an app, fill its params, Add.
 * A host page (the sidebar) already sends its LIVE view each turn; CAP.contextChips.live names it in a fixed
 * "📍 this page" chip so both surfaces show the same row. Persisted with the conversation (meta.context_chips).
 */
window._AppUIChatSurfaceChips = (() => {
  const MAX_CHIPS = 12;
  function create({ CAP, state, call, Dialog, setStatus, q }) {
    let destroyed = false, providers = null;
    state.contextChips = Array.isArray(state.contextChips) ? state.contextChips : [];
    const opt = (CAP.contextChips && typeof CAP.contextChips === 'object') ? CAP.contextChips : {};
    const keyOf = c => c.uri ? 'uri:' + c.uri : (c.id + ':' + JSON.stringify(c.args || {}));
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

    function liveLabel() {
      try { return typeof opt.live === 'function' ? String(opt.live() || '') : String(opt.live || ''); } catch (_e) { return ''; }
    }
    function render() {
      if (destroyed) return;
      const bar = q('#cs-ctx-bar'); if (!bar) return;
      bar.replaceChildren();
      const chips = state.contextChips, live = liveLabel();
      if (!chips.length && !live) { bar.style.display = 'none'; return; }
      bar.style.display = 'flex';
      if (live) {
        const c = el('span', 'cs-ctx-chip cs-ctx-live', '📍 ' + live);
        c.title = 'This page\u2019s live view (what is open / shown) goes with every turn';
        bar.append(c);
      }
      chips.forEach((c, i) => {
        const chip = el('span', 'cs-ctx-chip');
        const lbl = (c.icon || (c.uri ? '📌' : '🧩')) + ' ' + (c.uri ? (c.name || c.uri) : (c.label + (c.title ? ': ' + c.title : '')));
        chip.append(el('span', 'cs-ctx-lbl', lbl));
        chip.title = c.uri ? ('pinned: ' + c.uri) : String(c.text || '').slice(0, 600);
        if (!c.uri) {
          const r = el('button', 'cs-ctx-x', '↻'); r.type = 'button'; r.title = 'Refresh this context';
          r.setAttribute('aria-label', 'Refresh context ' + lbl);
          r.addEventListener('click', () => { refresh(i).catch(e => setStatus('Context refresh failed: ' + (e.message || e))); });
          chip.append(r);
        }
        const x = el('button', 'cs-ctx-x', '×'); x.type = 'button'; x.title = 'Remove from this chat';
        x.setAttribute('aria-label', 'Remove context ' + lbl);
        x.addEventListener('click', () => remove(i));
        chip.append(x);
        bar.append(chip);
      });
    }
    async function fetchChip(spec) {
      const r = await call('context_get', {id: spec.id || spec.app_id, args: spec.args || {}}, 30000);
      if (!r || !r.ok) throw new Error((r && (r._error || r.error)) || 'context_get failed');
      return {id: r.id, app_id: r.app_id, label: r.label, icon: r.icon || '', args: r.args || {},
              title: r.title || '', text: r.text || '', uris: r.uris || []};
    }
    function _put(chip) {
      const k = keyOf(chip), i = state.contextChips.findIndex(c => keyOf(c) === k);
      if (i >= 0) state.contextChips[i] = chip;
      else {
        if (state.contextChips.length >= MAX_CHIPS) throw new Error('at most ' + MAX_CHIPS + ' context chips');
        state.contextChips.push(chip);
      }
      render();
      return chip;
    }
    // spec: {uri, name?, kind?} (a pin) | {id|app_id, args?} (an app's context, fetched now)
    async function add(spec) {
      if (!spec) throw new Error('nothing to add');
      if (spec.uri) return _put({uri: String(spec.uri), name: String(spec.name || ''), kind: String(spec.kind || 'file')});
      return _put(await fetchChip(spec));
    }
    function remove(i) { state.contextChips.splice(i, 1); render(); }
    function clear() { state.contextChips = []; render(); }
    async function refresh(i) {
      const c = state.contextChips[i]; if (!c || c.uri) return;
      const n = await fetchChip(c); if (destroyed) return;
      state.contextChips[i] = n; render(); setStatus('Context refreshed: ' + n.label);
    }
    // The block buildReqBody adds to the system prompt (every turn).
    function text() {
      const chips = state.contextChips; if (!chips.length) return '';
      const parts = [], pins = [];
      chips.forEach(c => {
        if (c.uri) pins.push((c.name ? c.name + ' ' : '') + '<' + c.uri + '>' + (c.kind && c.kind !== 'file' ? ' [' + c.kind + ']' : ''));
        else parts.push('### ' + c.label + (c.title ? ' — ' + c.title : '') + ' (' + c.app_id + ')\n' + c.text);
      });
      if (pins.length) parts.push('### pinned (read / search them on demand)\n' + pins.join('\n'));
      return '[Context added to this chat — use it when relevant]\n' + parts.join('\n\n');
    }
    function snapshot() { return state.contextChips.map(c => Object.assign({}, c)); }
    function apply(list) {
      state.contextChips = (Array.isArray(list) ? list : []).filter(c => c && (c.uri || c.id)).slice(0, MAX_CHIPS);
      render();
    }
    state._applyContextChips = apply;   // the history controller restores a conversation's chips with it

    // IMPROVEMENTS_NEXT #28: providers that declare `auto: true` (manifest chat_context - e.g. the active
    // workspace with its linked repos) are added as chips to a chat that has none yet, so EVERY chat surface
    // knows them, not just the providing app's own page. Not the hosting app's own (its live view goes anyway);
    // CAP.contextChips.auto === false opts a surface out; a removed auto chip stays removed in that chat.
    // IMPROVEMENTS_NEXT #27: the user can turn auto chips off on EVERY surface (AppUIStorage 'ai-chat-auto-context'
    // = false; the checkbox in the Add-context dialog)
    const AUTO_KEY = 'ai-chat-auto-context';
    const autoEnabled = () => {
      try { return !window.AppUIStorage || AppUIStorage.getJSON(AUTO_KEY, true) !== false; } catch (_e) { return true; }
    };
    let _autoDone = false;
    async function autoAdd() {
      if (_autoDone || destroyed || opt.auto === false || !CAP.contextChips || !autoEnabled()) return;
      _autoDone = true;
      try {
        if (!providers) { const r = await call('context_providers', {}, 15000); providers = (r && r.providers) || []; }
      } catch (_e) { return; }
      if (destroyed || state.contextChips.length) return;
      const host = String(opt.hostApp || '');
      for (const p of providers.filter(p => p && p.auto && p.app_id !== host)) {
        try { _put(Object.assign(await fetchChip({id: p.id, args: {}}), {auto: true})); } catch (_e) {}
      }
    }
    setTimeout(() => { autoAdd(); }, 0);

    async function openAdd() {
      if (!Dialog) { setStatus('Dialog unavailable'); return; }
      const body = el('div', 'cs-ctx-add');
      body.style.cssText = 'display:flex;flex-direction:column;gap:8px;min-width:420px;font-size:12px';
      const sel = el('select'); sel.setAttribute('aria-label', 'App whose context to add');
      const about = el('div', 'cs-ctx-about'); about.style.cssText = 'color:var(--text-muted)';
      const form = el('div'); form.style.cssText = 'display:flex;flex-direction:column;gap:6px';
      const msg = el('div'); msg.setAttribute('role', 'status');
      const autoLbl = el('label'); autoLbl.style.cssText = 'display:flex;gap:6px;align-items:center;color:var(--text-muted)';
      const autoCb = el('input'); autoCb.type = 'checkbox'; autoCb.checked = autoEnabled();
      autoCb.addEventListener('change', () => {
        try { if (window.AppUIStorage) AppUIStorage.setJSON(AUTO_KEY, !!autoCb.checked); } catch (_e) {}
        setStatus(autoCb.checked ? 'Automatic context chips: on (new chats)' : 'Automatic context chips: off on every chat');
      });
      autoLbl.append(autoCb, document.createTextNode('Add automatic context (e.g. the active workspace) to new chats on every page'));
      body.append(el('label', null, 'App'), sel, about, form, msg, autoLbl);
      const d = Dialog.show({title: '➕ Add context', body, width: '520px', buttons: [
        {text: 'Cancel'},
        {text: 'Add', primary: true, action: () => {
          const p = (providers || [])[sel.selectedIndex]; if (!p) return false;
          const args = {};
          form.querySelectorAll('input[data-k]').forEach(i => { if (i.value.trim()) args[i.dataset.k] = i.value.trim(); });
          msg.textContent = 'fetching…';
          add({id: p.id, args}).then(c => { setStatus('Context added: ' + c.label + (c.title ? ' — ' + c.title : '')); try { Dialog.close(d); } catch (_e) {} },
            e => { msg.textContent = 'Failed: ' + (e.message || e); });
          return false;   // closed when the fetch succeeds
        }}]});
      const paintForm = () => {
        const p = (providers || [])[sel.selectedIndex];
        form.replaceChildren(); about.textContent = p ? (p.about || '') : '';
        if (!p) return;
        Object.keys(p.params || {}).forEach(k => {
          const row = el('label'); row.style.cssText = 'display:flex;flex-direction:column;gap:2px';
          row.append(el('span', null, k + ' — ' + p.params[k]));
          const inp = el('input'); inp.dataset.k = k; inp.setAttribute('aria-label', k);
          inp.style.cssText = 'font:inherit;padding:3px 6px';
          row.append(inp); form.append(row);
        });
      };
      sel.addEventListener('change', paintForm);
      try {
        if (!providers) { const r = await call('context_providers', {}, 15000); providers = (r && r.providers) || []; }
      } catch (e) { msg.textContent = 'Could not list context providers: ' + (e.message || e); providers = null; return; }
      if (!providers.length) { msg.textContent = 'No app exposes a chat context yet (manifest chat_context).'; return; }
      providers.forEach(p => { const o = el('option', null, (p.icon ? p.icon + ' ' : '') + p.label + '  (' + p.app_id + ')'); sel.append(o); });
      paintForm();
    }

    return {render, add, remove, clear, refresh, text, snapshot, apply, openAdd,
      get chips() { return state.contextChips.slice(); },
      destroy() { destroyed = true; }};
  }
  return {create};
})();
