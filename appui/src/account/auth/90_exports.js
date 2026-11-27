  window.AppUIAccount = {
    user: function () { return current; },
    setUser: setUser,
    open: openDialog,
    mount: mount,
    // Session / LDAP sign-in (shared across all fleet pages) — see below.
    signedIn: function () { return _session.signedIn; },
    displayName: function () { return _session.displayName; },
    whoami: whoami,
    signIn: signIn,
    signOut: signOut,
    onChange: function (fn) { if (typeof fn === 'function') window.addEventListener('appui:account-change', function (e) { fn((e && e.detail) || {}); }); }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _autoMount);
  } else {
    _autoMount();
  }
  function _autoMount() {
    // A page can opt out of the auto-mounted button (window.APPUI_ACCOUNT_NO_MOUNT)
    // when it renders its own account button but still wants the shared store +
    // dialog (e.g. the viewer).
    if (!window.APPUI_ACCOUNT_NO_MOUNT) mount();
    injectStyles();  // dialog styles are needed either way
    // Resolve the LDAP session state so the widget shows Sign in vs the signed-in
    // identity. Fires 'appui:account-change' when known; the shim's buildAccount
    // (and any page listener) repaints accordingly.
    try { whoami(); } catch (e) { /* best-effort */ }
  }
})();
