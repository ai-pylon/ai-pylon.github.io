  // ---- Shared LDAP session (fleet-wide) ----------------------------------
  // Identity has TWO layers: (1) the claimed id above (no password, used to
  // scope storage), and (2) an optional REAL login — an LDAP session on the
  // fleet file-storage app. When signed in, the session identity is authoritative
  // and shown in the widget; when not, the widget shows a "Sign in" button and
  // the implicit claimed id ('guest') is used WITHOUT labelling it. The login
  // dialog + endpoints are the SAME ones file_storage uses, so any page that
  // includes account.js gets identical sign-in behaviour.
  var _session = { signedIn: false, user: '', displayName: '', loaded: false };

  // Resolve the AUTH backend base (where /v1/login + /v1/whoami live). History:
  // this was the file_storage app, but file_storage is RETIRED on AppForge — so
  // the base is now OVERRIDABLE and the widget NO-AUTH-degrades when it's absent:
  //   window.APPUI_AUTH_BASE = '…'   explicit base (full URL or app-root path)
  //   window.APPUI_NO_AUTH = true    no auth backend → claimed-id mode only
  // Default (back-compat): the sibling 'file-storage' slug / platform path.
  function _authDisabled() { return !!window.APPUI_NO_AUTH; }
  function _fsBase() {
    var ov = (window.APPUI_AUTH_BASE || '').trim && window.APPUI_AUTH_BASE;
    if (ov) return String(ov).replace(/\/$/, '');
    if (isLocal()) return '/pages/file/file_storage';
    return ownerBase() + '/file-storage';
  }

  function _emitChange() {
    try { window.dispatchEvent(new CustomEvent('appui:account-change', { detail: {
      user: _session.signedIn ? _session.user : current,
      signedIn: _session.signedIn, displayName: _session.displayName
    } })); } catch (e) { /* ignore */ }
  }

  // Fetch session state from the fleet file-storage /v1/whoami. Same-origin
  // credentials carry the session cookie. Updates _session + repaints.
  function whoami() {
    if (_authDisabled()) {
      // No auth backend on this deployment — operate in claimed-id mode without
      // probing a dead /v1/whoami (which 404s). Not "signed in"; the account is
      // the claimed id (default 'guest'). Paint + emit so host pages still gate.
      _session.signedIn = false; _session.loaded = true;
      paintButton(); _emitChange();
      return Promise.resolve(_session);
    }
    return fetch(_fsBase() + '/v1/whoami', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        _session.signedIn = (j.identity_source === 'session');
        _session.user = j.user || '';
        _session.displayName = j.display_name || '';
        _session.loaded = true;
        // When signed in, adopt the authenticated identity as the shared account
        // so storage scoping follows the real user. When NOT signed in, drop any
        // previously-authenticated id back to 'guest' so a logout actually
        // de-scopes (otherwise the stale signum lingered and e.g. the file tree
        // kept showing the signed-out user's storage).
        if (_session.signedIn && j.user) {
          current = j.user;
          try { window.localStorage.setItem(STORE_KEY, current); } catch (e) {}
        } else if (!_session.signedIn) {
          current = 'guest';
          try { window.localStorage.setItem(STORE_KEY, current); } catch (e) {}
        }
        paintButton();
        _emitChange();
        return _session;
      })
      .catch(function () {
        // The session backend (file_storage /v1/whoami) is unreachable or
        // RETIRED (404) on this deployment. Degrade gracefully to "not signed
        // in" rather than leaving the widget blank: a failed probe must still
        // PAINT the Sign-in button and EMIT the change event, so host pages that
        // gate on sign-in state (e.g. apps_manager) still render + show status
        // instead of hanging on an unresolved session.
        _session.signedIn = false;
        _session.user = '';
        _session.displayName = '';
        _session.loaded = true;
        paintButton();
        _emitChange();
        return _session;
      });
  }

  // The SHARED sign-in dialog (same signum+password LDAP flow as file_storage).
  // Renders with AppUIDialog if present, else a minimal fallback panel.
  function signIn() {
    var bodyHtml =
      '<div class="aui-acct">' +
      '<p class="aui-acct-note">Sign in with your Ericsson signum. Your password is used once to sign in and is never stored.</p>' +
      '<label class="aui-acct-lbl" for="aui-si-user">Signum</label>' +
      '<input id="aui-si-user" autocomplete="username" placeholder="e.g. emp01">' +
      '<label class="aui-acct-lbl" for="aui-si-pass" style="margin-top:6px">Password</label>' +
      '<input id="aui-si-pass" type="password" autocomplete="current-password">' +
      '<div id="aui-si-err" class="aui-acct-err" style="display:none"></div>' +
      '<div class="aui-acct-row" style="margin-top:10px;justify-content:flex-end">' +
      '<button type="button" id="aui-si-go" class="aui-acct-save">Sign in</button></div>' +
      '</div>';
    var closed = false;
    function wire(closeFn) {
      var err = document.getElementById('aui-si-err');
      function showErr(m) { if (err) { err.textContent = m; err.style.display = m ? 'block' : 'none'; } }
      function go() {
        var u = (document.getElementById('aui-si-user') || {}).value;
        var p = (document.getElementById('aui-si-pass') || {}).value;
        u = (u || '').trim();
        if (!u || !p) { showErr('Signum and password required.'); return; }
        showErr('');
        var btn = document.getElementById('aui-si-go'); if (btn) { btn.disabled = true; btn.textContent = 'Signing in…'; }
        fetch(_fsBase() + '/v1/login', { method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ signum: u, password: p }) })
          .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, j: j }; }); })
          .then(function (res) {
            if (btn) { btn.disabled = false; btn.textContent = 'Sign in'; }
            if (!res.ok) {
              showErr(res.status === 401 ? 'Invalid signum or password.'
                    : res.status === 501 ? 'Sign-in is not enabled on this server.'
                    : ('Sign-in failed: ' + ((res.j && res.j.error) || ('HTTP ' + res.status))));
              return;
            }
            if (closeFn) closeFn();
            whoami();
          })
          .catch(function (e) { if (btn) { btn.disabled = false; btn.textContent = 'Sign in'; } showErr('Sign-in error: ' + (e.message || e)); });
      }
      var g = document.getElementById('aui-si-go'); if (g) g.addEventListener('click', go);
      var pw = document.getElementById('aui-si-pass'); if (pw) pw.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); go(); } });
      var uf = document.getElementById('aui-si-user'); if (uf) setTimeout(function () { try { uf.focus(); } catch (e) {} }, 0);
    }
    if (window.AppUIDialog && AppUIDialog.show) {
      AppUIDialog.show({ title: 'Sign in', buttons: [], body: bodyHtml });
      wire(function () { closed = true; try { if (AppUIDialog.close) AppUIDialog.close(); } catch (e) {} });
    } else {
      var old = document.getElementById('aui-si-fallback'); if (old) old.remove();
      var panel = document.createElement('div');
      panel.id = 'aui-si-fallback'; panel.className = 'aui-acct-fallback';
      panel.innerHTML = '<div class="aui-acct-fallback-inner"><button type="button" id="aui-si-x" class="aui-acct-save" style="float:right">×</button>' + bodyHtml + '</div>';
      document.body.appendChild(panel);
      var x = document.getElementById('aui-si-x'); if (x) x.addEventListener('click', function () { panel.remove(); });
      wire(function () { panel.remove(); });
    }
  }

  function signOut() {
    return fetch(_fsBase() + '/v1/logout', { method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(function () { _session.signedIn = false; _session.displayName = ''; return whoami(); })
      .catch(function () { _session.signedIn = false; _emitChange(); });
  }

