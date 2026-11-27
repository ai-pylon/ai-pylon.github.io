/* ChatSurface backend bootstrap, precedence and selector lifecycle. */
window.AppUIChatSurfaceBackends = (() => {
  function create({state, call, getSelect, getChat, getPreferredBackend, onBackendResolved}) {
    let destroyed = false, request = 0;
    const scope = AppUILifecycle.createScope();
    async function loadBackendsBootstrap() {
      const id = ++request;
      const current = () => !destroyed && id === request;
      if (!current()) return;
      let r = null;
      try { r = await call('bootstrap', {}, 20000); } catch (_e) { r = null; }
      if (!current()) return;
      if (r && r.ok) {
        state.backends = r.backends || [];
        state.mandatory = r.mandatory_resolved || [];
        state.mandatoryPats = r.mandatory_tools || [];
        state.defaultBackend = r.default || '';
        if (r.model_backend && (r.models || []).length) state.models[r.model_backend] = r.models;
        paintBackendOptions();
      } else {
        // fallback to individual ops
        try { const b = await call('backends', {}, 20000); if (!current()) return; state.backends = (b && b.backends) || []; state.defaultBackend = (b && b.default) || ''; } catch (_e) {}
        if (!current()) return;
        paintBackendOptions();
      }
    }
    function paintBackendOptions() {
      const backendSel = getSelect();
      if (destroyed || !backendSel) return;
      backendSel.innerHTML = '';
      state.backends.forEach(b => {
        const o = document.createElement('option');
        o.value = b.name;
        o.textContent = b.name + (b.ready ? ' ●' : (b.available ? ' ○' : ' (n/a)'));
        backendSel.appendChild(o);
      });
      // Prefer, in order: the HOST's explicit backend (getPreferredBackend —
      // e.g. a chat_profile's `backend`, a deliberate per-mount choice that must
      // win so an embedded sidebar can default to ericai), then the SERVER
      // default (beats a stale per-browser saved backend), then a ready backend,
      // then available, then first. An explicit host choice is NOT stale, so it
      // ranks above the global server default.
      const byName = n => state.backends.find(b => b.name === n);
      const avail = b => b && b.available;
      const pref = (getPreferredBackend() && avail(byName(getPreferredBackend())) ? byName(getPreferredBackend()) : null)
        || (state.defaultBackend && avail(byName(state.defaultBackend)) ? byName(state.defaultBackend) : null)
        || state.backends.find(b => b.ready)
        || state.backends.find(b => b.available)
        || state.backends[0];
      state.backend = (pref || {}).name || state.backend || '';
      if (state.backend) {
        backendSel.value = state.backend;
        // Restore this backend's remembered tool scope (if any) BEFORE the chat
        // engine is told the backend, so the first turn uses the right scope.
        try { if (typeof onBackendResolved === 'function') onBackendResolved(state.backend); } catch (_e) {}
        // Override the engine's stale saved backend so the LLM dialog + turns
        // use the resolved default, not a previously-persisted choice.
        getChat()?.setBackend(state.backend);
      }
    }

    function bind(select) {
      if (destroyed) return;
      scope.listen(select, 'change', () => {
        state.backend = select.value;
        state.model = '';
        try { if (typeof onBackendResolved === 'function') onBackendResolved(select.value); } catch (_e) {}
        getChat()?.setBackend(select.value);
      });
    }
    return {loadBackendsBootstrap, paintBackendOptions, bind, destroy() {destroyed = true; request++; scope.destroy();}};
  }
  return {create};
})();
