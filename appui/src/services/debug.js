/**
 * AppUIDebug — shared, zero-config debug capture + issue reporting for EVERY
 * AppUI page. Before this, apps hand-rolled their own console buffers (e.g.
 * page_automation's window.__palog) and each re-implemented the issue_report
 * submit. This gives one surface:
 *
 *   AppUI.debug.log(...args)        // app-level breadcrumb (ring buffer)
 *   AppUI.debug.getLog()           // the captured breadcrumbs (array of strings)
 *   AppUI.debug.snapshot()         // {page_id, url, log, errors, diagnostics, ...}
 *   AppUI.debug.reportIssue(opts)  // prefilled issue dialog -> issue_report.submit
 *
 * It auto-captures:
 *   - app breadcrumbs logged via AppUI.debug.log (and the legacy window.__palog
 *     if a page still uses it)
 *   - uncaught errors + unhandled promise rejections (installed once)
 *   - the AppUI asset/loader diagnostics snapshot
 *   - page id (from <body data-page-id>) and the current URL
 *
 * Reporting posts to the platform issue tracker (apps/documents/issue_report)
 * via its `submit` op, with all the context attached — so a user clicks "Report
 * issue", types a sentence, and triage gets the full debug bundle.
 */
(function () {
  'use strict';
  if (typeof window === 'undefined' || window.AppUIDebug) return;

  var MAX = 300;
  var _log = [];        // ring buffer of breadcrumb strings
  var _errors = [];     // uncaught errors / rejections
  var _hooked = false;

  function _fmt(args) {
    try {
      return Array.prototype.map.call(args, function (a) {
        if (a instanceof Error) return a.message + (a.stack ? ' | ' + a.stack.split('\n')[1] : '');
        return (typeof a === 'object') ? JSON.stringify(a) : String(a);
      }).join(' ');
    } catch (e) { return String(args); }
  }

  function log() {
    var line = Date.now() + ' ' + _fmt(arguments);
    _log.push(line);
    if (_log.length > MAX) _log.shift();
    if (window.APPUI_DEBUG) { try { console.log.apply(console, ['[appui]'].concat([].slice.call(arguments))); } catch (e) {} }
    return line;
  }

  function _installHooks() {
    if (_hooked) return;
    _hooked = true;
    try {
      window.addEventListener('error', function (e) {
        _errors.push({ kind: 'error', msg: String(e.message || e.error || e), at: Date.now(),
          src: (e.filename || '') + ':' + (e.lineno || '') });
        if (_errors.length > 50) _errors.shift();
      });
      window.addEventListener('unhandledrejection', function (e) {
        var r = e && e.reason;
        _errors.push({ kind: 'rejection', msg: (r && r.message) ? r.message : String(r), at: Date.now() });
        if (_errors.length > 50) _errors.shift();
      });
    } catch (e) {}
  }

  function pageId() {
    try { return document.body && document.body.getAttribute('data-page-id') || 'app'; }
    catch (e) { return 'app'; }
  }

  function getLog() {
    // merge our buffer with a legacy page buffer (window.__palog) if present.
    var legacy = (window.__palog && Array.isArray(window.__palog)) ? window.__palog : [];
    return _log.concat(legacy.map(function (l) { return 'legacy: ' + l; }));
  }

  function snapshot(extra) {
    var diag = {};
    try { diag = (window.AppUIAssets && window.AppUIAssets.diagnostics) ? window.AppUIAssets.diagnostics() : {}; } catch (e) {}
    return {
      page_id: pageId(),
      page_url: (typeof location !== 'undefined') ? location.href : '',
      user_agent: (typeof navigator !== 'undefined') ? navigator.userAgent : '',
      ts: Date.now(),
      log: getLog(),
      errors: _errors.slice(),
      diagnostics: diag,
      extra: extra || null,
    };
  }

  // Resolve the issue_report submit transport. Prefer a page-provided submit;
  // else POST to the platform op edge directly.
  function _defaultSubmit(body) {
    return fetch('/v1/apps/documents/issue_report/submit', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (r) { return r.json(); });
  }

  /**
   * reportIssue(opts?) — open a tiny prefilled dialog; on submit, file an issue
   * with the full debug snapshot attached. opts:
   *   title     prefill title (default: "<page_id>: issue")
   *   kind      'bug' | 'feature' | 'other' (default 'bug')
   *   submit    function(body)->Promise (default: issue_report.submit op)
   *   extra     any extra context object to attach
   *   onDone    function(result)
   */
  function reportIssue(opts) {
    opts = opts || {};
    var submit = opts.submit || _defaultSubmit;
    var snap = snapshot(opts.extra);
    var Dialog = window.AppUIDialog;
    var esc = (window.AppUITextUtils && window.AppUITextUtils.esc) ||
      function (s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; };
    var defTitle = opts.title || (snap.page_id + ': issue');

    function doSubmit(title, detail, kind) {
      var body = {
        kind: kind || opts.kind || 'bug',
        title: title || defTitle,
        detail: detail || '',
        source: 'appui.debug',
        context: snap,     // the full auto-captured debug bundle
      };
      log('reportIssue submit', body.kind, body.title);
      return submit(body).then(function (res) {
        if (opts.onDone) { try { opts.onDone(res); } catch (e) {} }
        return res;
      });
    }

    if (!Dialog || !Dialog.show) {
      // headless fallback: submit immediately with the snapshot (no UI).
      return doSubmit(defTitle, 'Auto-reported (no dialog available).', opts.kind);
    }
    var bodyHtml =
      '<div style="display:flex;flex-direction:column;gap:.5rem;min-width:420px">' +
      '<label style="font-size:.85em;opacity:.8">What went wrong? (one sentence)</label>' +
      '<input id="pa-rpt-title" value="' + esc(defTitle) + '" style="padding:.4rem;font:inherit">' +
      '<textarea id="pa-rpt-detail" rows="4" placeholder="Steps / what you expected…" style="padding:.4rem;font:inherit"></textarea>' +
      '<label style="font-size:.78em;opacity:.65">Attached automatically: page, URL, ' +
      snap.log.length + ' debug lines, ' + snap.errors.length + ' error(s), diagnostics.</label>' +
      '</div>';
    return Dialog.show({
      title: 'Report an issue', body: bodyHtml, width: '520px',
      buttons: [
        { text: 'Cancel' },
        { text: 'Send report', primary: true, action: function () {
          var t = (document.getElementById('pa-rpt-title') || {}).value || defTitle;
          var d = (document.getElementById('pa-rpt-detail') || {}).value || '';
          doSubmit(t, d, opts.kind).then(function (res) {
            try { window.AppUI && window.AppUI.toast &&
              window.AppUI.toast(res && res.ok ? ('Issue filed: ' + (res.id || '')) : ('Report failed: ' + ((res && res._error) || '?')),
                res && res.ok ? 'ok' : 'bad'); } catch (e) {}
          });
        } },
      ],
    });
  }

  _installHooks();

  window.AppUIDebug = {
    log: log,
    getLog: getLog,
    snapshot: snapshot,
    reportIssue: reportIssue,
    clear: function () { _log.length = 0; _errors.length = 0; },
  };
})();
