/* GENERATED AppUI account distribution. Edit src/account/ and rebuild portable artifacts. */
(function () {
  'use strict';
  if (window.AppUIAccount) return;

  var STORE_KEY = 'appui.account.user';
  // The fleet apps. `slug` is the AppForge deploy slug (hyphenated, served at
  // /{owner}/{slug}/); `local` is the LOCAL ai-pylon page path (served at
  // /pages/documents/<app>/). Links are built per-environment (see appHref) so
  // the dialog works on BOTH the local platform and an AppForge deployment —
  // previously it always used the AppForge owner-segment layout, so on the local
  // platform (/pages/documents/<app>/) every link pointed at a non-existent
  // /pages/<slug>/ address.
  var FLEET = [
    { slug: 'sysdoc-editor', local: 'documents/sysdoc_editor', label: 'SysDoc Editor' },
    { slug: 'plantuml-python', local: 'documents/plantuml_python', label: 'PlantUML' },
    { slug: 'issue-report', local: 'documents/issue_report', label: 'Issue tracker' },
    { slug: 'file-storage', local: 'file/file_storage', label: 'File storage' },
    { slug: 'apps-manager', local: 'documents/apps_manager', label: 'Apps manager' }
  ];

  function qsUser() {
    try { return new URLSearchParams(window.location.search).get('user'); } catch (e) { return null; }
  }
  function stored() {
    try { return window.localStorage.getItem(STORE_KEY); } catch (e) { return null; }
  }
  // Legacy per-app keys that existing apps already read/write. We bridge them to
  // the canonical key so the account is genuinely SHARED across apps (same
  // origin → shared localStorage) instead of each app diverging to its own id.
  var LEGACY_KEYS = ['sysdoc_fs_user'];
  function legacyStored() {
    for (var i = 0; i < LEGACY_KEYS.length; i++) {
      try { var v = window.localStorage.getItem(LEGACY_KEYS[i]); if (v) return v; } catch (e) { /* ignore */ }
    }
    return null;
  }
  // Retired accounts: demo/placeholder ids that were removed from the platform.
  // A stale value cached in localStorage (or a legacy per-app key, or a bookmarked
  // ?user=) must NOT stick — collapse it to the standard 'guest' account.
  var RETIRED = { viewer: 1, alice: 1, anonymous: 1 };
  function _clean(v) {
    v = (v || '').trim();
    return (!v || RETIRED[v.toLowerCase()]) ? '' : v;
  }
  var current = (_clean(qsUser()) || _clean(stored()) || _clean(legacyStored()) || 'guest').trim() || 'guest';
  // If we resolved from a query/legacy source, persist to the canonical key now
  // so every app converges on one value, and seed the legacy keys too. Also
  // overwrites any retired value still sitting in storage/URL.
  try {
    if (current) {
      window.localStorage.setItem(STORE_KEY, current);
      for (var _li = 0; _li < LEGACY_KEYS.length; _li++) {
        try { window.localStorage.setItem(LEGACY_KEYS[_li], current); } catch (e) { /* ignore */ }
      }
      // Scrub a retired ?user= from the URL so a reload doesn't re-adopt it.
      try {
        var _q = qsUser();
        if (_q && RETIRED[_q.trim().toLowerCase()]) {
          var _u = new URL(window.location.href);
          _u.searchParams.set('user', current);
          window.history.replaceState(null, '', _u);
        }
      } catch (e) { /* ignore */ }
    }
  } catch (e) { /* ignore */ }

  function _normalizeSetUser(value) { return RETIRED[value.toLowerCase()] ? "guest" : value; }

  // Owner segment base: /{owner}/{slug}/...  → '/{owner}'. Lets us build sibling
  // app URLs. Falls back to '' (same-level) if the path is shallow.
  function ownerBase() {
    var parts = window.location.pathname.split('/').filter(Boolean);
    // parts[0] is the owner (e.g. 'ejasung'); parts[1] is this app's slug.
    return parts.length >= 1 ? '/' + parts[0] : '';
  }
  function thisSlug() {
    var parts = window.location.pathname.split('/').filter(Boolean);
    return parts.length >= 2 ? parts[1] : '';
  }

  // Which environment are we in? LOCAL ai-pylon serves pages at /pages/...;
  // AppForge serves each app at /{owner}/{slug}/. Detect from the path.
  function isLocal() {
    return window.location.pathname.split('/').filter(Boolean)[0] === 'pages';
  }
  // Build the correct href to a fleet app, carrying the current account id.
  function appHref(a) {
    var q = '?user=' + encodeURIComponent(current);
    if (isLocal()) {
      // /pages/<local>/  (e.g. /pages/documents/plantuml_python/)
      return '/pages/' + a.local + '/' + q;
    }
    // AppForge: /{owner}/<slug>/
    return ownerBase() + '/' + a.slug + '/' + q;
  }
  // Is this fleet entry the current app? Compare against the local path tail or
  // the AppForge slug depending on environment.
  function appIsHere(a) {
    if (isLocal()) {
      return window.location.pathname.indexOf('/pages/' + a.local + '/') === 0
          || window.location.pathname.indexOf('/pages/' + a.local) === 0;
    }
    return a.slug === thisSlug();
  }

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

  function openDialog() {
    var links = FLEET.map(function (a) {
      var here = appIsHere(a);
      var href = appHref(a);
      return '<li class="aui-acct-app' + (here ? ' is-here' : '') + '">' +
        '<a href="' + esc(href) + '"' + (here ? ' aria-current="page"' : '') + '>' +
        esc(a.label) + (here ? ' <span class="aui-acct-here">· here</span>' : '') + '</a></li>';
    }).join('');
    var bodyHtml = _accountDialogBody(links);

    if (window.AppUIDialog && AppUIDialog.show) {
      AppUIDialog.show({ title: 'Account', buttons: [], body: bodyHtml });
      wireDialog();
    } else {
      // Minimal fallback: a positioned panel.
      var old = document.getElementById('aui-acct-fallback');
      if (old) old.remove();
      var panel = document.createElement('div');
      panel.id = 'aui-acct-fallback';
      panel.className = 'aui-acct-fallback';
      panel.innerHTML = '<div class="aui-acct-fallback-inner"><button type="button" id="aui-acct-x" class="aui-acct-save" style="float:right">×</button>' + bodyHtml + '</div>';
      document.body.appendChild(panel);
      var x = document.getElementById('aui-acct-x');
      if (x) x.addEventListener('click', function () { panel.remove(); });
      wireDialog();
    }
  }

  function _accountDialogBody(links) {
    // Signed in via LDAP: show the authenticated identity + Sign out (NOT the
    // claimed-id editor — you can't just claim a different signum under LDAP).
    // Signed out (or AppForge claimed-id mode): the claimed-id picker.
    var identityHtml;
    if (_session.signedIn) {
      identityHtml =
        '<div class="aui-acct-ident">' +
        '<span class="aui-account-icon">\uD83D\uDC64</span> ' +
        '<strong>' + esc(_session.displayName || _session.user) + '</strong>' +
        (_session.user && _session.displayName ? ' <span class="aui-acct-here">(' + esc(_session.user) + ')</span>' : '') +
        '</div>' +
        '<div class="aui-acct-row" style="justify-content:flex-end">' +
        '<button type="button" id="aui-acct-signout" class="aui-acct-save">Sign out</button>' +
        '</div>' +
        '<p class="aui-acct-note">Signed in with your Ericsson signum (LDAP session).</p>';
    } else {
      identityHtml =
        '<label class="aui-acct-lbl" for="aui-acct-input">Account id</label>' +
        '<div class="aui-acct-row">' +
        '<input id="aui-acct-input" value="' + esc(current) + '" aria-label="Account id">' +
        '<button type="button" id="aui-acct-save" class="aui-acct-save">Change</button>' +
        '</div>' +
        '<p class="aui-acct-note">Scopes your file storage + saves across the fleet. ' +
        '<a href="#" id="aui-acct-signin-link">Sign in</a> with your signum for private files.</p>';
    }
    var bodyHtml =
      '<div class="aui-acct">' + identityHtml +
      '<div class="aui-acct-apps"><span class="aui-acct-lbl">Open another app as this account</span><ul>' + links + '</ul></div>' +
      '</div>';

    return bodyHtml;
  }

  function wireDialog() {
    var input = document.getElementById('aui-acct-input');
    var save = document.getElementById('aui-acct-save');
    function commit() {
      var v = input && input.value.trim();
      if (v) { setUser(v);
        // Update the app links in the open dialog to carry the new id.
        document.querySelectorAll('.aui-acct-app a').forEach(function (a) {
          try { var u = new URL(a.href); u.searchParams.set('user', v); a.href = u.href; } catch (e) {} });
        if (window.AppUINotifications) AppUINotifications.show('Account: ' + v, 'success');
      }
    }
    if (save) save.addEventListener('click', commit);
    if (input) input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
    _wireSessionActions();
  }

  function _wireSessionActions() {
    // Signed-in dialog: Sign out.
    var out = document.getElementById('aui-acct-signout');
    if (out) out.addEventListener('click', function () {
      try { if (window.AppUIDialog && AppUIDialog.close) AppUIDialog.close(); } catch (e) {}
      var fb = document.getElementById('aui-acct-fallback'); if (fb) fb.remove();
      signOut();
    });
    // Signed-out dialog: a "Sign in" link that opens the LDAP sign-in flow.
    var si = document.getElementById('aui-acct-signin-link');
    if (si) si.addEventListener('click', function (e) {
      e.preventDefault();
      try { if (window.AppUIDialog && AppUIDialog.close) AppUIDialog.close(); } catch (ex) {}
      var fb2 = document.getElementById('aui-acct-fallback'); if (fb2) fb2.remove();
      signIn();
    });
  }

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

  function injectStyles() {
    if (document.getElementById('aui-account-styles')) return;
    var css =
      '.aui-account-btn{display:inline-flex;align-items:center;gap:6px;border:0;background:transparent;cursor:pointer;font:inherit;color:inherit;padding:4px 10px;border-radius:6px;}' +
      '.aui-account-btn:hover{background:rgba(0,0,0,.06);}' +
      '.aui-account-inmenubar{margin-left:auto;}' +
      '.aui-account-floating{position:fixed;top:8px;right:12px;z-index:1000;background:var(--bg-primary,#fff);border:1px solid var(--border-color,#cbd5e1)!important;box-shadow:0 1px 4px rgba(0,0,0,.1);}' +
      '.aui-account-icon{color:#2563eb;}' +
      '.aui-account-name{font-weight:600;}' +
      '.aui-acct{min-width:300px;max-width:420px;display:flex;flex-direction:column;gap:8px;}' +
      '.aui-acct-lbl{font-size:12px;font-weight:600;color:var(--text-muted,#64748b);}' +
      '.aui-acct-row{display:flex;gap:8px;}' +
      '.aui-acct-row input{flex:1 1 auto;padding:7px 9px;border:1px solid var(--border-color,#cbd5e1);border-radius:5px;font:inherit;}' +
      '.aui-acct-save{padding:7px 14px;border:0;border-radius:5px;background:var(--accent-color,#2563eb);color:#fff;font-weight:600;cursor:pointer;}' +
      '.aui-acct-note{font-size:11px;color:var(--text-muted,#64748b);margin:0;}' +
      _accountStyleExtra +
      '.aui-acct-apps ul{list-style:none;margin:6px 0 0;padding:0;display:flex;flex-direction:column;gap:2px;}' +
      '.aui-acct-app a{display:block;padding:7px 10px;border-radius:5px;text-decoration:none;color:var(--text-primary,#1e293b);}' +
      '.aui-acct-app a:hover{background:#eef2ff;}' +
      '.aui-acct-app.is-here a{color:var(--text-muted,#64748b);cursor:default;}' +
      '.aui-acct-here{font-size:11px;color:var(--text-muted,#94a3b8);}' +
      '.aui-acct-fallback{position:fixed;inset:0;z-index:3000;background:rgba(15,23,42,.3);display:flex;align-items:flex-start;justify-content:center;}' +
      '.aui-acct-fallback-inner{background:#fff;margin-top:60px;padding:18px;border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,.2);}';
    var style = document.createElement('style');
    style.id = 'aui-account-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

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

  function mount() {
    if (document.getElementById('aui-account-btn')) return;
    injectStyles();
    var btn = document.createElement('button');
    btn.id = 'aui-account-btn';
    btn.type = 'button';
    btn.className = 'aui-account-btn ai-app-user';
    _mountAccountBehavior(btn);
    var menubar = document.getElementById('app-menubar') || document.querySelector('.ai-app-menubar');
    if (menubar) {
      btn.classList.add('aui-account-inmenubar');
      menubar.appendChild(btn);
      // An AppUI shell may populate/replace the menubar AFTER this runs, wiping
      // the button. Observe the menubar and re-append if our button goes missing.
      if (!menubar._auiAccountObserved) {
        menubar._auiAccountObserved = true;
        try {
          var obs = new MutationObserver(function () {
            if (!document.getElementById('aui-account-btn') && menubar.isConnected) {
              menubar.appendChild(btn);
              paintButton();
            }
          });
          obs.observe(menubar, { childList: true });
        } catch (e) { /* ignore */ }
      }
    } else {
      btn.classList.add('aui-account-floating');  // fixed top-right
      document.body.appendChild(btn);
    }
    paintButton();
  }

  var _accountStyleExtra = ".aui-acct-err{color:#b91c1c;font-size:12px;margin-top:6px;}";
  function _mountAccountBehavior(btn) {
    btn.setAttribute('aria-label', 'Account');
    btn.addEventListener('click', _onAccountClick);
    if (!window._auiAcctRepaint) {
      window._auiAcctRepaint = true;
      window.addEventListener('appui:account-change', paintButton);
    }
  }

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
