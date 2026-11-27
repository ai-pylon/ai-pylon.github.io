/**
 * AppUIFeedback — ONE shared feedback/report tab for every fleet page.
 *
 * Before this, remote_ws, the sysdoc_editor viewer, and plantuml_python each
 * reimplemented the SAME feedback form + element picker + issue_report
 * `/v1/issues` submit — and drifted (severity field here, different identity
 * there, outside-click only in one). This renders the tab ONCE; each page
 * injects only its page-specific pieces.
 *
 * Usage:
 *   AppUIFeedback.renderTab(hostEl, {
 *     converter:   'sysdoc_converter',          // context.converter (drives repo_for)
 *     kinds:       [['bug','Bug'],['feature','Idea / request'],['other','Other']],
 *     acctUser:    function(){ return 'guest'; },// reporter identity (X-User)
 *     trackerUrl:  function(){ return 'https://…/issue-report'; },
 *     pickObject:  function(cb){ … cb({selector,text,bbox}|null); return started; },
 *     buildContext:function(){ return {format, source, extra…}; }, // merged into context
 *     submit:      function(body){ return Promise<{ok,id,error}>; }, // transport (REQUIRED)
 *     intro:       'Report a bug or request — it\'s filed into the issue tracker.',
 *     esc:         function(s){…},                // optional HTML-escaper
 *     onOutsideClose: function(){…},              // optional: called to dismiss the panel
 *     extraFields: function(){ return '<label>…</label>'; }, // optional page-specific inputs
 *     metadata:    function(){ return 'pptx · p.3 · deck.pptx'; }, // optional live metadata line
 *     beforeSubmit:function(body,host){ return Promise<body|false>; }, // optional async enrich
 *   });                                           // (upload attachments, resolve source, read extraFields)
 *
 * renderTab returns { refreshMeta } — call refreshMeta() to re-render the live
 * metadata line on a doc/slide change.
 *
 * The contract body it POSTs (via opts.submit) matches
 * apps/documents/issue_report/FEEDBACK_CONTRACT.md:
 *   { kind, title, detail, severity:'medium', source, attachments:[],
 *     context:{ converter, format, object, page_url, …buildContext() } }
 * The user only writes a Comment (+ optional Type + an optional object pick) —
 * everything else is auto-captured. No Severity field (triage re-ranks).
 */
if (typeof window !== 'undefined' && window.AppUIFeedback) {
  // Already defined (e.g. a page ships its own appui-feedback.js and the shared
  // feedback bundle also loaded). Re-running would redeclare `const
  // AppUIFeedback` → SyntaxError, so skip. This file is thus idempotent.
} else {
const AppUIFeedback = (function () {
  'use strict';

  function _esc(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function renderTab(host, opts) {
    opts = opts || {};
    var esc = opts.esc || _esc;
    var kinds = opts.kinds || [['bug', 'Bug'], ['feature', 'Idea / request'], ['other', 'Other']];
    var intro = opts.intro || "Report a bug or request — it's filed into the issue tracker.";
    var tracker = (typeof opts.trackerUrl === 'function') ? opts.trackerUrl() : (opts.trackerUrl || '');
    if (typeof opts.submit !== 'function') {
      host.innerHTML = '<div style="padding:10px;color:#c33">feedback: no submit transport configured</div>';
      return;
    }

    var kindOpts = kinds.map(function (k) {
      return '<option value="' + esc(k[0]) + '">' + esc(k[1]) + '</option>';
    }).join('');

    host.innerHTML =
      '<div class="aui-fb" style="display:flex;flex-direction:column;height:100%">' +
        '<div class="aui-fb-head" style="border-bottom:1px solid var(--border);padding:6px 8px">' +
          '<span class="ws-hint" style="font-size:11px">' + esc(intro) + '</span>' +
        '</div>' +
        '<div style="flex:1;overflow:auto;padding:10px;display:flex;flex-direction:column;gap:8px">' +
          '<label class="ai-dialog-field"><span class="ai-dialog-label">Type</span>' +
            '<select id="aui-fb-kind" class="ai-input">' + kindOpts + '</select></label>' +
          '<label class="ai-dialog-field" style="flex:1;display:flex;flex-direction:column"><span class="ai-dialog-label">Comment</span>' +
            '<textarea id="aui-fb-body" rows="7" style="flex:1" placeholder="What\'s wrong / what you\'d like…"></textarea></label>' +
          // Optional page-specific extra fields (e.g. "include source" /
          // "attach render" checkboxes). opts.extraFields returns an HTML
          // string; its values are read back in opts.beforeSubmit via the host.
          (opts.extraFields ? ('<div id="aui-fb-extra">' + (opts.extraFields() || '') + '</div>') : '') +
          // Optional live metadata line (format/page/name). opts.metadata()
          // returns a string; refreshed on render + whenever the page calls the
          // returned refresh handle.
          (opts.metadata ? '<div id="aui-fb-meta" class="ws-hint" style="font-size:11px"></div>' : '') +
          (opts.pickObject ?
          '<div style="display:flex;align-items:center;gap:8px">' +
            '<button id="aui-fb-pick" class="ai-btn" style="font-size:12px">🎯 Point at element</button>' +
            '<span id="aui-fb-target" class="ws-hint" style="font-size:11px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span>' +
            '<button id="aui-fb-clear" class="ai-btn" style="font-size:11px;display:none">clear</button>' +
          '</div>' : '') +
          '<div id="aui-fb-status" class="ws-hint" style="font-size:11px;min-height:14px"></div>' +
          (tracker ?
          '<div style="border-top:1px solid var(--border);margin-top:4px;padding-top:8px">' +
            '<a href="' + esc(tracker) + '/" target="_blank" rel="noopener" class="ws-hint" style="font-size:11px">Open the issue tracker ↗</a>' +
          '</div>' : '') +
        '</div>' +
        '<div style="border-top:1px solid var(--border);padding:8px;text-align:right">' +
          '<button id="aui-fb-send" class="ai-btn ai-btn-primary">Submit</button>' +
        '</div>' +
      '</div>';

    var st = host.querySelector('#aui-fb-status');
    var picked = null;
    var tgtEl = host.querySelector('#aui-fb-target');
    var clrBtn = host.querySelector('#aui-fb-clear');
    var _picking = false;

    function setPicked(p) {
      picked = p;
      if (!tgtEl) return;
      if (p) {
        tgtEl.textContent = '🎯 ' + (p.selector || p.text || 'element') + (p.text ? (' — “' + p.text + '”') : '');
        tgtEl.title = p.selector || '';
        if (clrBtn) clrBtn.style.display = '';
      } else {
        tgtEl.textContent = ''; tgtEl.title = ''; if (clrBtn) clrBtn.style.display = 'none';
      }
    }
    if (clrBtn) clrBtn.onclick = function () { setPicked(null); };

    // Live metadata (format/page/name): render now + expose a refresh handle so
    // the page can re-render it on a doc/slide change (opt-in via opts.metadata).
    var metaEl = host.querySelector('#aui-fb-meta');
    function refreshMeta() {
      if (metaEl && typeof opts.metadata === 'function') {
        try { metaEl.textContent = opts.metadata() || ''; } catch (e) { /* best-effort */ }
      }
    }
    refreshMeta();

    var pickBtn = host.querySelector('#aui-fb-pick');
    if (pickBtn && opts.pickObject) {
      pickBtn.onclick = function () {
        if (_picking) return;
        st.textContent = 'Click any element on the page… (Esc to cancel)';
        _picking = true;
        if (host.__fbPicking) host.__fbPicking(true);   // let the page suppress outside-close
        var started = opts.pickObject(function (p) {
          _picking = false;
          if (host.__fbPicking) host.__fbPicking(false);
          if (p) { setPicked(p); st.textContent = 'Captured ' + (p.selector || 'element'); }
          else { st.textContent = ''; }
        });
        if (started === false) { _picking = false; if (host.__fbPicking) host.__fbPicking(false); st.textContent = 'Open/render a document first to pick an element.'; }
      };
    }

    host.querySelector('#aui-fb-send').onclick = function () {
      var bodyTxt = (host.querySelector('#aui-fb-body').value || '').trim();
      if (!bodyTxt && !picked) { st.textContent = 'describe the issue (or point at an element)'; return; }
      var uiKind = host.querySelector('#aui-fb-kind').value;
      var kind = picked ? 'rendering_gap' : uiKind;
      var title = (bodyTxt.split('\n')[0] || (picked ? ('re: ' + picked.selector) : 'Feedback')).slice(0, 80);

      var ctx = { converter: opts.converter || null, object: picked || null, page_url: location.href };
      if (typeof opts.buildContext === 'function') {
        try {
          var extra = opts.buildContext() || {};
          for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) ctx[k] = extra[k];
        } catch (e) { /* best-effort context */ }
      }
      var body = {
        kind: kind, title: title,
        detail: bodyTxt || ('re: ' + (picked && picked.selector)),
        severity: 'medium',                 // not a user field — triage re-ranks
        source: ctx.source || null,
        attachments: ctx.attachments || [],
        context: ctx
      };
      var btn = host.querySelector('#aui-fb-send'); btn.disabled = true; btn.textContent = 'submitting…';
      // Optional ASYNC pre-submit step (opt-in): the page may enrich the body
      // (e.g. upload render(s)/doc to file-storage → attachments[], read back
      // its extraFields, resolve a durable source) and MUST resolve to the body
      // to send (or a falsy value to abort). Defaults to the body unchanged, so
      // pages not using it (remote_ws) are unaffected.
      var _pre = (typeof opts.beforeSubmit === 'function')
        ? Promise.resolve(opts.beforeSubmit(body, host))
        : Promise.resolve(body);
      _pre.then(function (finalBody) {
        if (!finalBody) {   // page aborted (e.g. consent declined)
          btn.disabled = false; btn.textContent = 'Submit'; return null;
        }
        return Promise.resolve(opts.submit(finalBody));
      }).then(function (res) {
        if (res === null) return;   // aborted above
        btn.disabled = false; btn.textContent = 'Submit';
        res = res || {};
        if (res.ok && res.id) {
          var who = (typeof opts.acctUser === 'function') ? opts.acctUser() : '';
          st.innerHTML = 'Filed #' + esc(String(res.id).slice(0, 8)) +
            (who ? (' as ' + esc(who)) : '') +
            (tracker ? ('. <a href="' + esc(tracker) + '/" target="_blank" rel="noopener">View in tracker ↗</a>') : '.');
          host.querySelector('#aui-fb-body').value = ''; setPicked(null);
        } else {
          st.textContent = 'could not file: ' + (res.error || 'error');
        }
      }).catch(function (e) {
        btn.disabled = false; btn.textContent = 'Submit';
        st.textContent = 'issue tracker unreachable' + (e && e.message ? (': ' + e.message) : '');
      });
    };

    // Return a small handle so the page can refresh live metadata on a
    // doc/slide change (opt-in). Back-compat: renderTab previously returned
    // undefined — callers that ignore this are unaffected.
    return { refreshMeta: refreshMeta };
  }

  return { renderTab: renderTab, _esc: _esc };
})();
if (typeof window !== 'undefined') window.AppUIFeedback = AppUIFeedback;
if (typeof module !== 'undefined' && module.exports) module.exports = AppUIFeedback;
}
