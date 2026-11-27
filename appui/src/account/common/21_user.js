  function setUser(u) {
    u = (u || '').trim();
    if (!u) return;
    u = _normalizeSetUser(u);
    current = u;
    try { window.localStorage.setItem(STORE_KEY, u); } catch (e) { /* ignore */ }
    // Bridge to legacy per-app keys so existing app code (e.g. the viewer's
    // sysdoc_fs_user) converges on the same shared account.
    for (var i = 0; i < LEGACY_KEYS.length; i++) {
      try { window.localStorage.setItem(LEGACY_KEYS[i], u); } catch (e) { /* ignore */ }
    }
    // Reflect in the URL (so a reload / share keeps the account) without a nav.
    try {
      var url = new URL(window.location.href);
      url.searchParams.set('user', u);
      window.history.replaceState(null, '', url);
    } catch (e) { /* ignore */ }
    paintButton();
    try { window.dispatchEvent(new CustomEvent('appui:account-change', { detail: { user: u } })); } catch (e) { /* ignore */ }
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

