  window.AppUIAccount = {
    user: function () { return current; },
    setUser: setUser,
    open: openDialog,
    mount: mount
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
  }
})();
