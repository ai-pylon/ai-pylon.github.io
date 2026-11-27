  function paintButton() {
    var btn = document.getElementById('aui-account-btn');
    if (!btn) return;
    if (_session.signedIn) {
      btn.innerHTML = '<span class="aui-account-icon">\uD83D\uDC64</span><span class="aui-account-name">' + esc(_session.displayName || _session.user || current) + '</span>';
      btn.title = 'Signed in as ' + (_session.displayName || _session.user) + ' — click to manage';
    } else if (_authDisabled()) {
      // No auth backend → claimed-id mode: show the claimed id (click to change).
      btn.innerHTML = '<span class="aui-account-icon">\uD83D\uDC64</span><span class="aui-account-name">' + esc(current || 'guest') + '</span>';
      btn.title = 'Account: ' + (current || 'guest') + ' — click to change (no sign-in on this deployment)';
    } else {
      // Not signed in: offer sign-in; the implicit 'guest' id is NOT labelled.
      btn.innerHTML = '<span class="aui-account-name">Sign in</span>';
      btn.title = 'Sign in';
    }
  }

  // Click handler for the auto-mounted button: sign-in prompt when logged out,
  // the account dialog (change id / switch apps / sign out) when logged in. In
  // no-auth mode, always the claimed-id dialog (sign-in is unavailable).
  function _onAccountClick() {
    if (_session.signedIn || _authDisabled()) openDialog(); else signIn();
  }

