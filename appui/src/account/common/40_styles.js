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

