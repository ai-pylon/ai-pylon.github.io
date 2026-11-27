// AppUIPageActions — a shared handler for the generic DOM "do something on the
// page" actions an embedded AI assistant can emit, pairing with
// AppUIPageIntrospect (which lets the model SEE the page). The model locates a
// control by selector (from the introspection) and acts on it:
//
//   page.fill   {selector, value, append?}   — set an input/textarea/select value
//   page.click  {selector}                    — click a button/link/element
//   page.select {selector, value|label}       — choose a <select> option
//   page.check  {selector, checked?}          — set/toggle a checkbox/radio
//   page.read   {selector, all?}              — read text/value of an element
//                                               (result surfaced via onRead)
//
// These are PAGE ACTIONS (fenced ```action blocks the page performs), NOT
// catalog tools. DOM access is the page's (browser-side) — a server tool can't
// reach the live DOM, so the page performs the act and the model sees the
// effect on the NEXT turn's context() / page.read result.
//
// SAFETY: an app opts INTO exactly the verbs it wants (default: fill + read +
// select + check + click) and may pass a `confirm(type, payload, el)` gate to
// require a user ok before a click/fill runs, and a `guard(el)` to veto acting
// on an element outside the app's own region. Nothing here auto-submits beyond
// the single control the model named.
//
// Exposes: window.AppUIPageActions.create(opts) -> { onAction(type,payload) }
(function () {
  'use strict';

  var VERBS = ['fill', 'click', 'select', 'check', 'read', 'see'];

  // #3 — a DEFAULT destructive-control guard. A generic page.click can hit an
  // irreversible submit (Apply / Submit / Delete / Sign in / Confirm / Pay)
  // directly, bypassing an app's semantic confirm (e.g. leave's page.apply which
  // keeps a confirm dialog). A page-agent app with a confirm-gated write SHOULD
  // pass its own `guard`, but this default catches the common case out of the
  // box: veto a CLICK whose target's id/text/name looks destructive, unless the
  // app opts out (opts.defaultGuard === false) or allowlists the element.
  var _DESTRUCTIVE_RE = /\b(apply|submit|delete|remove|sign\s*in|log\s*in|confirm|pay|purchase|checkout|send|publish|book|destroy)\b/i;
  function _looksDestructive(el) {
    if (!el) return false;
    try {
      var hay = [
        el.id || '',
        (el.getAttribute && (el.getAttribute('name') || el.getAttribute('aria-label') || el.getAttribute('data-action'))) || '',
        (el.textContent || '').trim().slice(0, 40),
      ].join(' ');
      return _DESTRUCTIVE_RE.test(hay);
    } catch (_e) { return false; }
  }

  function _toast(kind, msg) {
    try { if (window.AppUIToast && window.AppUIToast[kind]) window.AppUIToast[kind](msg); } catch (_e) {}
  }
  function _fire(el, names) {
    names.forEach(function (n) { try { el.dispatchEvent(new Event(n, { bubbles: true })); } catch (_e) {} });
  }
  function _text(el) {
    if (!el) return '';
    try { if (el.value != null && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return String(el.value); } catch (_e) {}
    try { return (el.innerText != null ? el.innerText : el.textContent) || ''; } catch (_e) { return ''; }
  }

  // opts:
  //   verbs: string[]            — which page.* verbs to allow (default all)
  //   root: () => Element|null   — if given, actions are RESTRICTED to elements
  //                                inside this root (a safety scope)
  //   guard: (el, type) => bool  — optional veto; return false to block
  //   confirm: (type, payload, el) => bool|Promise<bool>  — optional user gate
  //   onRead: (text, payload, el) => void  — receive a page.read result (so the
  //            host can fold it into the next context() or toast it)
  //   toast: bool (default true) — surface a success/error toast per action
  //   introspect: the AppUIPageIntrospect instance (so page.inspect is handled
  //            here too, giving the host ONE onAction to wire)
  function create(opts) {
    opts = opts || {};
    var allow = {};
    (Array.isArray(opts.verbs) ? opts.verbs : VERBS).forEach(function (v) { allow[v] = true; });
    var toastOn = opts.toast !== false;
    var introspect = opts.introspect || null;
    const seeController = window._AppUIPageActionSee.create({opts, allow, introspect, toastOn, _toast});
    const recording = window._AppUIPageActionRecording.create({opts, onAction, introspect, toastOn, _toast});
    const {startRecording, stopRecording, isRecording, getRecording, clearRecording,
      recordAndSave, replayCase, replayCaseById} = recording;
    function _rec(kind, selector, value) {
      seeController.invalidate();
      recording.record(kind, selector, value);
    }

    // A control by its VISIBLE NAME (placeholder / aria-label / <label> / title /
    // button text) — so the model can act in ONE turn ("fill the 'Find in table'
    // box") without first inspecting the page for a CSS selector. Exact match
    // wins over contains; only visible controls; controls outside the chat
    // sidebar itself are preferred.
    function _byName(text, scope) {
      var t = String(text || '').trim().replace(/^["'\[]|["'\]]$/g, '').toLowerCase();
      if (!t || t.length > 80) return null;
      var root = scope || document, best = null, bestScore = 0;
      var els = root.querySelectorAll('input,textarea,select,button,a,[role=button],[role=tab],[contenteditable=true]');
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        if (!(el.offsetParent || (el.getClientRects && el.getClientRects().length))) continue;
        var names = [el.getAttribute('placeholder'), el.getAttribute('aria-label'), el.getAttribute('title'),
                     el.getAttribute('name'), el.id];
        try { if (el.labels) for (var j = 0; j < el.labels.length; j++) names.push(el.labels[j].textContent); } catch (_e) {}
        if (/^(BUTTON|A)$/.test(el.tagName) || el.getAttribute('role')) names.push(el.textContent);
        var score = 0;
        for (var k = 0; k < names.length; k++) {
          var n = String(names[k] || '').trim().toLowerCase();
          if (!n) continue;
          if (n === t) score = Math.max(score, 3);
          else if (n.indexOf(t) >= 0 || (t.length > 3 && t.indexOf(n) >= 0 && n.length > 3)) score = Math.max(score, 2);
        }
        if (!score) continue;
        var inChat = !!(el.closest && el.closest('#app-right, [data-gallery-type], .ai-chat-panel'));
        if (!inChat) score += 0.5;
        if (score > bestScore) { best = el; bestScore = score; }
      }
      return best;
    }

    function _resolve(sel) {
      if (!sel) return null;
      var scope = (typeof opts.root === 'function') ? opts.root() : null;
      var el = null;
      try { el = (scope || document).querySelector(sel); } catch (_e) { el = null; }
      if (!el) el = _byName(sel, scope);      // not a (matching) CSS selector: a visible name
      // if a root scope is set, ensure the element is inside it (block escapes)
      if (el && scope && typeof scope.contains === 'function' && !scope.contains(el)) return null;
      return el;
    }

    function _allowed(type, el) {
      // #3 — OPT-IN destructive-control guard (on when opts.defaultGuard is
      // true). Only a CLICK on a destructive-looking control is vetoed; fills/
      // reads/selects aren't a one-click irreversible write. An app can
      // allowlist with opts.allowClick (a fn el->bool, or an array of selectors)
      // — e.g. a benign "Apply filter" button. The app's own guard still runs
      // too (below), and either veto blocks. Kept opt-in so existing adopters
      // (whose semantic page.apply path legitimately clicks an "Apply" control)
      // aren't silently broken; a new app with a confirm-gated write turns it on.
      if (type === 'page.click' && opts.defaultGuard === true && _looksDestructive(el)) {
        var ok = false;
        try {
          if (typeof opts.allowClick === 'function') ok = !!opts.allowClick(el);
          else if (Array.isArray(opts.allowClick)) ok = opts.allowClick.some(function (s) { try { return el.matches && el.matches(s); } catch (_e) { return false; } });
        } catch (_e) { ok = false; }
        if (!ok) return false;
      }
      if (opts.guard) { try { if (opts.guard(el, type) === false) return false; } catch (_e) {} }
      return true;
    }

    async function _maybeConfirm(type, payload, el) {
      if (!opts.confirm) return true;
      try { return !!(await opts.confirm(type, payload, el)); } catch (_e) { return false; }
    }

    async function onAction(type, payload) {
      // page.inspect → delegate to the introspection engine when wired here.
      if (type === 'page.inspect') {
        return introspect ? introspect.onAction(type, payload) : false;
      }
      if (type === 'page.record_case') return recording.saveCase(payload);
      if (type === 'page.see') return seeController.run(payload);
      if (typeof type !== 'string' || type.indexOf('page.') !== 0) return false;
      var verb = type.slice('page.'.length);
      if (!allow[verb]) return false;
      payload = payload || {};
      // selector key tolerance: the model invents many key names for "the
      // element" (selector/id/el/element/target/css/query, and `path` for a CSS
      // selector on a fill/click — distinct from page.inspect's node path).
      // + the NAME keys a model uses for "the control" (field / control / name /
      // placeholder; label too except on page.select, where label is the option)
      // — resolved by _byName when they aren't CSS
      var sel = String(payload.selector || payload.id || payload.el || payload.element
                       || payload.target || payload.css || payload.query
                       || payload.path || payload.field || payload.control || payload.name
                       || payload.placeholder || (verb !== 'select' ? payload.label : '') || '').trim();
      if (!sel && verb !== 'read') return false;

      var el = _resolve(sel);
      if (!el) {
        if (toastOn) _toast('error', type + ': no element matches ' + (sel || '(no selector)'));
        return true;   // handled (acknowledged) — nothing to act on
      }
      if (!_allowed(type, el)) { if (toastOn) _toast('error', type + ': blocked by guard'); return true; }
      if (!(await _maybeConfirm(type, payload, el))) { if (toastOn) _toast('info', type + ': cancelled'); return true; }

      try {
        if (verb === 'fill') {
          var _v = payload.value != null ? payload.value : (payload.text != null ? payload.text : payload.val);
          var val = _v != null ? String(_v) : '';
          if (payload.append) { try { val = String(el.value || '') + val; } catch (_e) {} }
          el.value = val; _fire(el, ['input', 'change']); if (el.focus) el.focus();
          _rec('fill', sel, val);
          if (toastOn) _toast('success', 'Filled ' + sel + ' = "' + val + '"');
        } else if (verb === 'click') {
          if (el.scrollIntoView) { try { el.scrollIntoView({ block: 'center' }); } catch (_e) {} }
          el.click();
          _rec('click', sel);
          if (toastOn) _toast('success', 'Clicked ' + sel);
        } else if (verb === 'select') {
          var want = payload.value != null ? String(payload.value) : (payload.label != null ? String(payload.label) : '');
          var matched = false;
          try {
            var optsList = el.options || [];
            for (var i = 0; i < optsList.length; i++) {
              var o = optsList[i];
              if (String(o.value) === want || (o.textContent || '').trim() === want) {
                el.selectedIndex = i;
                try { el.value = o.value; } catch (_e) {}   // keep .value in sync
                matched = true; break;
              }
            }
            if (!matched) { el.value = want; matched = (String(el.value) === want); }
            _fire(el, ['input', 'change']);
          } catch (_e) {}
          if (matched) _rec('select', sel, want);
          if (toastOn) _toast(matched ? 'success' : 'error', (matched ? 'Selected ' : 'No option ') + '"' + want + '" in ' + sel);
        } else if (verb === 'check') {
          var checked = (payload.checked != null) ? !!payload.checked : !el.checked;
          el.checked = checked; _fire(el, ['input', 'change']);
          _rec('check', sel);
          if (toastOn) _toast('success', (checked ? 'Checked ' : 'Unchecked ') + sel);
        } else if (verb === 'read') {
          var all = payload.all && (typeof opts.root === 'function' ? opts.root() : document);
          var out;
          if (payload.all) {
            var list = []; try { list = (all || document).querySelectorAll(sel); } catch (_e) { list = []; }
            out = Array.prototype.map.call(list, _text).filter(Boolean);
          } else { out = _text(el); }
          if (typeof opts.onRead === 'function') { try { opts.onRead(out, payload, el); } catch (_e) {} }
          if (toastOn) _toast('info', 'Read ' + sel + ': ' + (Array.isArray(out) ? out.join(' | ') : out).slice(0, 80));
          return { ok: true, read: out };
        }
      } catch (e) {
        if (toastOn) _toast('error', type + ' failed: ' + (e && e.message || e));
      }
      // #5 — tell the introspection engine which selector was just acted on, so
      // it auto-expands the containing region for the NEXT turn (no extra
      // page.inspect round-trip). Only for the mutating verbs (a read doesn't
      // change what the model needs to look at). Best-effort.
      if (introspect && typeof introspect.noteSelector === 'function'
          && (verb === 'fill' || verb === 'click' || verb === 'select' || verb === 'check')) {
        try { introspect.noteSelector(sel, el); } catch (_e) {}
      }
      return true;
    }

    return {
      onAction: onAction,
      verbs: Object.keys(allow),
      // recording controls (the agentic->scripted bridge)
      startRecording, stopRecording, isRecording, getRecording, clearRecording,
      recordAndSave: recordAndSave,
      // #9 — the last id passed to recordAndSave (a Replay button defaults to it)
      get _lastSavedId() { return recording._lastSavedId; },
      // CDP-free replay (runs a saved case in THIS page)
      replayCase: replayCase,
      replayCaseById: replayCaseById,
    };
  }

  window.AppUIPageActions = { create: create };
})();
