/* Per-backend tool scope and model preferences; current engine supplied lazily. */
window._AppUIChatSurfacePreferences = (() => {
  function create({state, getChat, refreshScopeBtn}) {
    // ---- remember tool scope PER BACKEND (improvement idea) -----------------
    // The chosen tool scope/flatten is a property of what the model (backend)
    // can do, so persist it keyed by backend and restore it when that backend
    // becomes active (bootstrap-resolved or user-switched). localStorage via
    // AppUIStorage, mirroring chat.js's own 'ai-chat-backend' convention. A host
    // that passed an explicit opts.scope keeps that as the seed for a backend
    // with no saved choice yet.
    const _SCOPE_KEY = 'ai-chat-scope';
    function _scopeStoreKey(backend) { return _SCOPE_KEY + ':' + (backend || '_'); }
    function persistScope() {
      try {
        if (!window.AppUIStorage) return;
        AppUIStorage.setJSON(_scopeStoreKey(state.backend),
          {scope: (state.scope || []).slice(), flatten: !!state.flatten});
      } catch (_e) {}
    }
    let _lastScopeBackend = state.backend || '';
    function restoreScopeFor(backend) {
      // Save the CURRENT backend's scope before switching away (so an un-applied
      // switch doesn't lose the prior selection), then load the new one.
      try {
        if (_lastScopeBackend && _lastScopeBackend !== backend) {
          if (window.AppUIStorage) AppUIStorage.setJSON(_scopeStoreKey(_lastScopeBackend),
            {scope: (state.scope || []).slice(), flatten: !!state.flatten});
        }
      } catch (_e) {}
      _lastScopeBackend = backend || '';
      let saved = null;
      try { if (window.AppUIStorage) saved = AppUIStorage.getJSON(_scopeStoreKey(backend), null); } catch (_e) { saved = null; }
      if (saved && (Array.isArray(saved.scope) || typeof saved.flatten === 'boolean')) {
        state.scope = Array.isArray(saved.scope) ? saved.scope.slice() : [];
        state.flatten = !!saved.flatten;
        state.progressive = (state.scope.length === 0) && !state.flatten;
        refreshScopeBtn();
      }
    }

    // ---- remember MODEL + TEMPERATURE per backend (improvement idea) --------
    // Same seam as the scope memory: a chosen model/temperature belongs to a
    // backend, so persist {model, temperature} keyed by backend and restore when
    // that backend activates. The config dialog's Apply calls persistPrefs; the
    // backends controller calls restorePrefsFor on resolve/switch.
    const _PREFS_KEY = 'ai-chat-prefs';
    function _prefsStoreKey(backend) { return _PREFS_KEY + ':' + (backend || '_'); }
    function persistPrefs() {
      try {
        if (!window.AppUIStorage) return;
        AppUIStorage.setJSON(_prefsStoreKey(state.backend),
          {model: state.model || '', temperature: (state.temperature == null ? null : state.temperature)});
      } catch (_e) {}
    }
    let _lastPrefsBackend = state.backend || '';
    function restorePrefsFor(backend) {
      try {
        if (_lastPrefsBackend && _lastPrefsBackend !== backend && window.AppUIStorage) {
          AppUIStorage.setJSON(_prefsStoreKey(_lastPrefsBackend),
            {model: state.model || '', temperature: (state.temperature == null ? null : state.temperature)});
        }
      } catch (_e) {}
      _lastPrefsBackend = backend || '';
      let saved = null;
      try { if (window.AppUIStorage) saved = AppUIStorage.getJSON(_prefsStoreKey(backend), null); } catch (_e) { saved = null; }
      if (saved && typeof saved === 'object') {
        state.model = saved.model || '';
        state.temperature = (saved.temperature == null ? null : saved.temperature);
        try { const chat = getChat(); if (state.model && chat && chat.setModel) chat.setModel(state.model); } catch (_e) {}
      }
    }

    return {persistScope, restoreScopeFor, persistPrefs, restorePrefsFor};
  }
  return {create};
})();
