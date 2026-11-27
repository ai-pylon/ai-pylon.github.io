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
  var current = (qsUser() || stored() || legacyStored() || 'alice').trim() || 'alice';
  // If we resolved from a query/legacy source, persist to the canonical key now
  // so every app converges on one value, and seed the legacy keys too.
  try {
    if (current) {
      window.localStorage.setItem(STORE_KEY, current);
      for (var _li = 0; _li < LEGACY_KEYS.length; _li++) {
        try { window.localStorage.setItem(LEGACY_KEYS[_li], current); } catch (e) { /* ignore */ }
      }
    }
  } catch (e) { /* ignore */ }

  function _normalizeSetUser(value) { return value; }

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
    var bodyHtml =
      '<div class="aui-acct">' +
      '<label class="aui-acct-lbl" for="aui-acct-input">Account id</label>' +
      '<div class="aui-acct-row">' +
      '<input id="aui-acct-input" value="' + esc(current) + '" aria-label="Account id">' +
      '<button type="button" id="aui-acct-save" class="aui-acct-save">Change</button>' +
      '</div>' +
      '<p class="aui-acct-note">Scopes your file storage + saves across the fleet. No password — a claimed id.</p>' +
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

  function _wireSessionActions() {}

  function paintButton() {
    var btn = document.getElementById('aui-account-btn');
    if (!btn) return;
    btn.innerHTML = '<span class="aui-account-icon">\u25CB</span><span class="aui-account-name">' + esc(current) + '</span>';
    btn.title = 'Account: ' + current + ' — click to change or switch apps';
  }

  function _onAccountClick() { openDialog(); }

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

  var _accountStyleExtra = "";
  function _mountAccountBehavior(btn) {
    btn.setAttribute('aria-label', 'Account — click to change or switch apps');
    btn.addEventListener('click', openDialog);
  }

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
