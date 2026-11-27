  // ---- Shared AppUI STATUS LOG --------------------------------------------
  // A status BAR that also keeps a rolling HISTORY (so transient messages — e.g.
  // per-file upload progress — don't need a toast each). AppUI.setStatus(text)
  // writes the bar's text span + appends to history; a bottom-right 📋 button
  // opens the history in a dialog. Part of AppUI so every shim-based page shares
  // the same status facility instead of ad-hoc toasts.
  var _STATUS_LOG = [];
  var _STATUS_MAX = 200;
  function _statusTextEl() {
    var sb = document.getElementById('app-statusbar');
    if (!sb) return null;
    var el = document.getElementById('aui-status-text');
    if (!el) {
      sb.style.display = 'flex'; sb.style.alignItems = 'center';
      el = document.createElement('span');
      el.id = 'aui-status-text';
      el.className = 'aui-status-text';
      sb.insertBefore(el, sb.firstChild);
    }
    return el;
  }
  function _statusSet(text) {
    text = text == null ? '' : String(text);
    var el = _statusTextEl();
    if (el) el.textContent = text;
    if (text) {
      _STATUS_LOG.push({ t: new Date(), text: text });
      if (_STATUS_LOG.length > _STATUS_MAX) _STATUS_LOG.shift();
    }
  }
  function _esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function _statusShowLog() {
    var body;
    if (_STATUS_LOG.length) {
      body = '<div style="max-height:420px;overflow:auto;font:11px/1.7 ui-monospace,monospace">' +
        _STATUS_LOG.slice().reverse().map(function (e) {
          return '<div><span style="color:var(--text-muted,#888);margin-right:8px">' +
            e.t.toLocaleTimeString() + '</span>' + _esc(e.text) + '</div>';
        }).join('') + '</div>';
    } else {
      body = '<p style="color:var(--text-muted,#888)">No status messages yet.</p>';
    }
    if (window.AppUIDialog && (AppUIDialog.show || AppUIDialog.open)) {
      (AppUIDialog.show || AppUIDialog.open).call(AppUIDialog, { title: 'Status log', body: body, width: '560px' });
    }
  }
  // Minimal shared TOAST — a transient top-right message for WARNINGS/ERRORS
  // (routine progress uses the status bar instead). Self-contained (no AppUI
  // notifications runtime on the shim). Auto-dismisses; errors linger longer.
  function _toast(msg, type) {
    try {
      var host = document.getElementById('aui-toast-host');
      if (!host) {
        host = document.createElement('div');
        host.id = 'aui-toast-host';
        host.className = 'aui-toast-host';
        document.body.appendChild(host);
      }
      var t = document.createElement('div');
      t.className = 'aui-toast aui-toast-' + (type || 'info');
      t.textContent = String(msg == null ? '' : msg);
      host.appendChild(t);
      // Force reflow then show (CSS transition).
      void t.offsetWidth; t.classList.add('is-shown');
      var ttl = (type === 'error') ? 7000 : (type === 'warn' ? 5000 : 3000);
      setTimeout(function () {
        t.classList.remove('is-shown');
        setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 250);
      }, ttl);
    } catch (e) { /* best-effort */ }
  }

  // Mount the 📋 log button in the status bar's RIGHT slot (bottom-right).
  function _mountStatusLogButton() {
    var sb = document.getElementById('app-statusbar');
    if (!sb || document.getElementById('aui-status-log-btn')) return;
    sb.style.display = 'flex'; sb.style.alignItems = 'center';
    var spacer = document.createElement('span');
    spacer.style.cssText = 'flex:1 1 auto';
    var btn = document.createElement('button');
    btn.id = 'aui-status-log-btn';
    btn.type = 'button';
    btn.className = 'aui-status-log-btn';
    btn.title = 'Status log (history)';
    btn.setAttribute('aria-label', 'Open status log');
    btn.textContent = '📋';
    btn.addEventListener('click', function (e) { e.stopPropagation(); _statusShowLog(); });
    sb.appendChild(spacer);
    sb.appendChild(btn);
  }

