// AppUIPageIntrospect — a HIERARCHICAL, ON-DEMAND, MULTI-TURN view of the live
// page appearance for an embedded AI assistant.
//
// WHY: pushing a full screen dump into the model every turn is wasteful and
// doesn't scale (a page's menu + sidebar tabs + nested sub-areas + content can
// be large). Instead this exposes the page as a TREE the model pulls NODE BY
// NODE across turns — the same proven pattern as docContext's doc.chapter loop
// (the model emits an action, the PAGE services it in JS, and the result is
// folded into the NEXT turn's context). A server tool cannot read an app's own
// live DOM, so introspection MUST be browser-side; this is that engine, shared.
//
// THE LOOP (what the model sees / does):
//   turn 1 context: a compact ROOT OUTLINE — the regions and their child counts.
//       PAGE (<app>) — regions (expand on demand with page.inspect):
//         [menu]     Menu bar — 3 item(s)
//         [sidebar]  Right sidebar — 4 tab(s); active: assistant
//         [content]  Content area — 3 section(s)
//   model emits:  ```action {"type":"page.inspect","path":"sidebar"} ```
//   turn 2 context: the root outline PLUS the expanded node:
//       ▸ sidebar — Right sidebar
//         [sidebar/assistant]  🤖 Assistant [ACTIVE]
//         [sidebar/templates]  📋 Templates — 5 field(s)/button(s)
//         …
//   model can drill deeper: {"type":"page.inspect","path":"sidebar/templates"} …
//   or collapse: {"type":"page.inspect","path":"sidebar","collapse":true}
//
// A PAGE PROVIDES A `nodes(path)` FUNCTION describing its own hierarchy, OR uses
// the built-in DOM scanner (scanDomNodes) which reads the standard AppUI regions
// (#app-menubar / #app-right tabs / #app-content-body) with zero config. The
// loop mechanics (outline, expand set, caps, the action handler) live here so
// every app gets them by supplying a tiny adapter — exactly like docContext.
//
// Exposes: window.AppUIPageIntrospect.create(opts) -> {system, context, onAction, reset}
(function () {
  'use strict';

  // ---- default DOM scanner ------------------------------------------------
  // Reads the live page's three standard regions into the node shape the engine
  // expects, addressed by PATH. A node is {label, value?, children?}. children
  // is [{key, label, hint?}] — key is the NEXT path segment. Any app with the
  // standard AppUI layout gets a sensible tree for free; a page can override
  // with its own nodes(path) for a richer/custom hierarchy.
  function _clip(s, n) { s = (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s; }
  function _visible(e) {
    try { if (e.offsetParent === null && (!e.getClientRects || e.getClientRects().length === 0)) return false; } catch (_e) {}
    return true;
  }
  function _labelsOf(root, sel, cap, max) {
    if (!root || !root.querySelectorAll) return [];
    var seen = {}, out = [];
    var list = root.querySelectorAll(sel);
    for (var i = 0; i < list.length && out.length < (max || 30); i++) {
      var e = list[i]; if (!_visible(e)) continue;
      var t = _clip(e.textContent, cap || 40);
      if (t && !seen[t]) { seen[t] = 1; out.push({ el: e, text: t }); }
    }
    return out;
  }

  // The DOM scanner, as a nodes(path) provider. opts.regions lets a page restrict
  // or relabel which regions are exposed; default = menu, sidebar, content.
  function scanDomNodes(opts) {
    opts = opts || {};
    var D = (typeof document !== 'undefined') ? document : null;
    var appId = opts.appId || '';
    function g(id) { return D ? D.getElementById(id) : null; }

    // region id -> {label, scan()} ; scan returns {value?, children:[{key,label,hint}]}
    var REGIONS = {
      menu: {
        label: 'Menu bar',
        scan: function () {
          var items = _labelsOf(g('app-menubar'), 'button,a,[role=menuitem],.ai-app-menu-item', 40, 20);
          return { value: items.length ? items.map(function (x) { return x.text; }).join(' | ') : '(standard/theme menu)',
                   children: [] };
        },
      },
      sidebar: {
        label: 'Right sidebar',
        scan: function () {
          var right = g('app-right'); var kids = [];
          if (right) {
            var tabs = right.querySelectorAll('.ai-app-sidebar-tab');
            for (var i = 0; i < tabs.length; i++) {
              var b = tabs[i];
              var active = b.classList.contains('active') || b.getAttribute('aria-selected') === 'true';
              kids.push({ key: 'tab' + i, label: _clip(b.textContent, 30) + (active ? ' [ACTIVE]' : ''), _el: b, _active: active });
            }
          }
          return { value: kids.length + ' tab(s)', children: kids };
        },
        // one level deeper: the ACTIVE tab panel's fields/buttons/sections
        deeper: function (seg) {
          var right = g('app-right'); if (!right) return null;
          var tabs = right.querySelectorAll('.ai-app-sidebar-tab');
          var idx = parseInt((seg || '').replace(/^tab/, ''), 10);
          var btn = tabs[idx]; if (!btn) return null;
          // the visible tab PANEL (the active one is shown); scan it generically
          var panel = right.querySelector('.ai-app-sidebar-panel, .ai-app-sidebar-content, [role=tabpanel]') || right;
          return { label: _clip(btn.textContent, 30), value: _scanGeneric(panel), children: [] };
        },
      },
      content: {
        label: 'Content area',
        scan: function () {
          var body = g('app-content-body'); var kids = [];
          var heads = _labelsOf(body, 'h1,h2,h3', 60, 12);
          heads.forEach(function (h, i) { kids.push({ key: 'sec' + i, label: h.text, _el: h.el }); });
          // always offer the live-controls + status pseudo-nodes
          kids.push({ key: 'status', label: 'Status / pills', hint: 'ePEOPLE/SAP/… state chips' });
          kids.push({ key: 'controls', label: 'Fields, buttons & messages', hint: 'form fields (with selectors), visible buttons + any message/result' });
          return { value: heads.length + ' section(s)', children: kids };
        },
        deeper: function (seg) {
          var body = g('app-content-body'); if (!body) return null;
          if (seg === 'status') {
            var pills = _labelsOf(body, '.lv-pill,.ai-pill,.pi-pill,[data-pill],.pill', 30, 20).map(function (x) { return x.text; });
            return { label: 'Status', value: pills.length ? pills.join('  ') : '(no status chips)', children: [] };
          }
          if (seg === 'controls') {
            var btns = _labelsOf(body, 'button', 40, 20).map(function (x) { return x.text; });
            var fields = _fieldsOf(body, 20);
            var msgs = _labelsOf(body, '.lv-msg,.ai-msg,.pi-msg,[role=alert]', 160, 6).map(function (x) { return x.text; });
            var steps = _labelsOf(body, '#lv-steps li,.ai-steps li', 120, 12).map(function (x) { return x.text; });
            var parts = [];
            if (fields.length) parts.push('Fields: ' + fields.join(' | '));
            if (btns.length) parts.push('Buttons: ' + btns.join(' | '));
            if (msgs.length) parts.push('Message: ' + msgs.join(' ⏐ '));
            if (steps.length) parts.push('Steps:\n    - ' + steps.join('\n    - '));
            return { label: 'Fields, buttons & messages', value: parts.join('\n  ') || '(nothing shown)', children: [] };
          }
          // a heading section: text under it until the next same/higher heading
          var m = /^sec(\d+)$/.exec(seg || ''); if (!m) return null;
          var heads = body.querySelectorAll('h1,h2,h3');
          var h = heads[parseInt(m[1], 10)]; if (!h) return null;
          return { label: _clip(h.textContent, 60), value: _sectionText(h), children: [] };
        },
      },
    };
    // allow a page to restrict/rename regions
    if (Array.isArray(opts.regions) && opts.regions.length) {
      var filtered = {};
      opts.regions.forEach(function (r) { if (REGIONS[r]) filtered[r] = REGIONS[r]; });
      REGIONS = filtered;
    }

    return function nodes(path) {
      path = (path || '').replace(/^\/+|\/+$/g, '');
      if (!path) {
        // ROOT: the region list
        var kids = Object.keys(REGIONS).map(function (k) {
          var info; try { info = REGIONS[k].scan(); } catch (_e) { info = { value: '', children: [] }; }
          var hint = info.value || '';
          return { key: k, label: REGIONS[k].label, hint: hint };
        });
        return { label: 'PAGE' + (appId ? (' (' + appId + ')') : ''), children: kids };
      }
      var segs = path.split('/');
      var region = REGIONS[segs[0]];
      if (!region) return null;
      if (segs.length === 1) {
        var r; try { r = region.scan(); } catch (_e) { r = { value: '', children: [] }; }
        return { label: region.label, value: r.value, children: r.children || [] };
      }
      // one level deeper into a region (tab panel / section / pseudo-node)
      if (typeof region.deeper === 'function') {
        var d; try { d = region.deeper(segs.slice(1).join('/')); } catch (_e) { d = null; }
        if (d) return d;
      }
      return null;
    };
  }

  // generic compact scan of an arbitrary container (used for a sidebar tab panel)
  function _scanGeneric(el) {
    if (!el) return '(empty)';
    var heads = _labelsOf(el, 'h1,h2,h3,h4', 50, 8).map(function (x) { return x.text; });
    var btns = _labelsOf(el, 'button', 36, 12).map(function (x) { return x.text; });
    var fields = _fieldsOf(el);
    var parts = [];
    if (heads.length) parts.push('Sections: ' + heads.join(' · '));
    if (fields.length) parts.push('Fields: ' + fields.join(' | '));
    if (btns.length) parts.push('Buttons: ' + btns.join(' | '));
    return parts.join('\n  ') || '(no visible controls)';
  }

  // List the visible form fields of a container as "label [selector]=current" so
  // the model learns the SELECTOR to page.fill and the CURRENT value (for
  // append/suffix). Prefers a stable #id selector, else name=, else a nth-of-type.
  function _fieldsOf(el, max) {
    if (!el || !el.querySelectorAll) return [];
    var out = [];
    var list = el.querySelectorAll('input,select,textarea');
    for (var i = 0; i < list.length && out.length < (max || 16); i++) {
      var f = list[i]; if (!_visible(f)) continue;
      var sel = f.id ? ('#' + f.id)
        : (f.getAttribute && f.getAttribute('name') ? (f.tagName.toLowerCase() + '[name="' + f.getAttribute('name') + '"]') : f.tagName.toLowerCase());
      var label = f.getAttribute && (f.getAttribute('placeholder') || f.getAttribute('aria-label') || f.getAttribute('name')) || f.type || 'field';
      var cur = '';
      try { cur = (f.value != null ? String(f.value) : ''); } catch (_e) { cur = ''; }
      out.push(_clip(label, 24) + ' [' + sel + ']' + (cur ? ('="' + _clip(cur, 30) + '"') : '=(empty)'));
    }
    return out;
  }

  // List visible buttons of a container as "label [selector]" so page.click is
  // one-shot. Prefers a stable #id selector; else a button:nth-of-type fallback
  // isn't stable, so fall back to the label text (the handler resolves a button
  // by id when present; label-only buttons are still inspectable).
  function _buttonsOf(el, max) {
    if (!el || !el.querySelectorAll) return [];
    var out = [], n = 0;
    var list = el.querySelectorAll('button');
    for (var i = 0; i < list.length && out.length < (max || 16); i++) {
      var b = list[i]; if (!_visible(b)) continue;
      var label = _clip(b.textContent, 30); if (!label) continue;
      var sel = b.id ? ('#' + b.id) : null;
      out.push(label + (sel ? (' [' + sel + ']') : ''));
      n++;
    }
    return out;
  }
  function _sectionText(h) {
    try {
      var level = Number(h.tagName.slice(1)) || 1;
      var parts = [_clip(h.textContent, 120)], n = h.nextElementSibling, acc = parts[0].length, CAP = 2000;
      while (n && acc < CAP) {
        if (/^H[1-6]$/.test(n.tagName) && Number(n.tagName.slice(1)) <= level) break;
        var t = _clip(n.textContent, 400); if (t) { parts.push(t); acc += t.length; }
        n = n.nextElementSibling;
      }
      var s = parts.join('\n  '); return s.length > CAP ? s.slice(0, CAP) + '…(truncated)' : s;
    } catch (_e) { return _clip(h.textContent, 120); }
  }

  // ---- the engine ---------------------------------------------------------
  // opts:
  //   nodes(path) -> {label, value?, children:[{key,label,hint?}]} | null
  //                  (REQUIRED unless useDom=true; path '' is the root)
  //   useDom: bool | {appId, regions}  — use the built-in DOM scanner
  //   appId: string (for the root label + the DOM scanner)
  //   kind:  'page' (label); maxExpanded (default 6); valueCap (default 2000)
  //   intro: extra lines prepended to context (e.g. form state), string or fn
  function create(opts) {
    opts = opts || {};
    var appId = opts.appId || '';
    var maxExpanded = opts.maxExpanded || 6;
    var valueCap = opts.valueCap || 2000;
    var nodes = (typeof opts.nodes === 'function')
      ? opts.nodes
      : (opts.useDom ? scanDomNodes(typeof opts.useDom === 'object' ? opts.useDom : { appId: appId }) : null);

    // the set of expanded node paths (insertion-ordered, bounded)
    var expanded = [];
    var _seen = '';   // last page.see vision description (folded into context)
    // #19/#20 — memoize the per-turn context pieces that re-scan the live DOM
    // (the root outline + the actionable fields/buttons quick-ref) by a CHEAP
    // page SIGNATURE, so context() doesn't re-walk the DOM every send when the
    // page hasn't changed. The signature reads only plain properties (region
    // child counts) — no querySelectorAll. A real change (new field/button/
    // section) flips it; a no-op re-send reuses the cached strings. The expanded
    // nodes are rendered FRESH each turn (they're small + the user just asked
    // for them), so an expand/collapse never stales the outline cache.
    var _ctxCache = { sig: null, outline: null, quick: null };

    function _clipVal(v) { v = (v == null ? '' : String(v)); return v.length > valueCap ? v.slice(0, valueCap) + '…(truncated)' : v; }

    // #19/#20 — a cheap DOM signature for the outline + quick-ref memo. Reads
    // only element COUNTS off the standard regions (no querySelectorAll walk of
    // the whole content). A new field/button/section/tab or a navigation flips
    // it; a plain re-send does not. Returns '' when document is unavailable (so
    // we simply never cache-hit, which is safe).
    function _domSig() {
      if (typeof document === 'undefined') return '';
      try {
        var mb = document.getElementById('app-menubar');
        var right = document.getElementById('app-right');
        var body = document.getElementById('app-content-body');
        var loc = '';
        try { loc = (location && (location.pathname + location.hash)) || ''; } catch (_e) {}
        var cnt = function (el, sel) { try { return el ? el.querySelectorAll(sel).length : 0; } catch (_e) { return 0; } };
        return [
          loc,
          cnt(mb, 'button,a,[role=menuitem],.ai-app-menu-item'),
          cnt(right, '.ai-app-sidebar-tab'),
          cnt(body, 'h1,h2,h3'),
          cnt(body, 'input,select,textarea'),
          cnt(body, 'button'),
        ].join('|');
      } catch (_e) { return ''; }
    }

    function _renderNode(path, opened) {
      var node; try { node = nodes(path); } catch (_e) { node = null; }
      if (!node) return '  (node "' + path + '" is no longer available)';
      var lines = [];
      var head = (path ? ('▸ ' + path) : 'PAGE' + (appId ? (' (' + appId + ')') : '')) + (node.label ? (' — ' + node.label) : '');
      lines.push(head);
      if (node.value != null && String(node.value).trim()) lines.push('  ' + _clipVal(node.value).split('\n').join('\n  '));
      var kids = node.children || [];
      kids.forEach(function (c) {
        var childPath = path ? (path + '/' + c.key) : c.key;
        lines.push('  [' + childPath + ']  ' + (c.label || c.key) + (c.hint ? ('  — ' + c.hint) : ''));
      });
      return lines.join('\n');
    }

    function system() {
      return (
        'You can INSPECT THE LIVE PAGE on demand, hierarchically. Each turn you are '
        + 'shown a compact ROOT OUTLINE of the page — its regions (menu, sidebar, '
        + 'content) with child COUNTS, plus the full detail of any node you have '
        + 'EXPANDED. Nodes are addressed by a slash PATH and each shows its '
        + 'children as [path] lines. To look INSIDE a node (a region, a sidebar '
        + 'tab, a content section, the status chips, the buttons), emit ONE fenced '
        + 'action and nothing else:\n'
        + '```action\n{"type":"page.inspect","path":"sidebar"}\n```\n'
        + 'Then drill deeper with the child path you see (e.g. '
        + '{"type":"page.inspect","path":"sidebar/tab1"} or '
        + '{"type":"page.inspect","path":"content/status"}). The expanded node '
        + 'appears in the NEXT turn\'s page outline — read it there, then answer or '
        + 'drill further. Collapse a node you no longer need with '
        + '{"type":"page.inspect","path":"<path>","collapse":true}. Only expand '
        + 'what you need (do not dump the whole tree); the outline + child counts '
        + 'tell you where to look. Never claim a field/button/tab exists unless you '
        + 'have inspected the node that contains it. '
        + 'To ACT on a control (only when the user asks): page.fill {selector, value}, '
        + 'page.click {selector}, page.select {selector, value}, page.read {selector} — '
        + 'the selector may be a CSS selector OR the control\'s visible name (its '
        + 'placeholder, label, aria-label or button text, e.g. {"type":"page.fill",'
        + '"selector":"Find in table","value":"x"}). '
        + 'If you need to know how the page actually LOOKS (layout, alignment, '
        + 'colors, an error banner, whether something is visually off) — not just '
        + 'its structure — emit {"type":"page.see","hint":"<what to check>"}; a '
        + 'screenshot is captured, described by a vision model, and the '
        + 'description appears in the NEXT turn under "WHAT THE PAGE LOOKS LIKE". '
        + 'Add "exact":true for a pixel-true capture (asks the user to share the '
        + 'screen once); omit it for a quick approximate render.'
      );
    }

    function context() {
      var lines = [];
      var intro = (typeof opts.intro === 'function') ? opts.intro() : opts.intro;
      if (intro) lines.push(String(intro));
      lines.push('=== LIVE PAGE (inspect regions on demand with a page.inspect action) ===');

      // #19/#20 — the root outline + quick-ref re-scan the DOM; memoize both by
      // the cheap DOM signature so a no-op re-send (or a drill-down that didn't
      // change the DOM) reuses them instead of re-walking querySelectorAll.
      var sig = _domSig();
      var cacheOk = sig && _ctxCache.sig === sig && _ctxCache.outline != null;
      var outline, quick;
      if (cacheOk) {
        outline = _ctxCache.outline;
        quick = _ctxCache.quick;
      } else {
        outline = _renderNode('', true);   // root outline (region list + counts)
        // ACTIONABLE QUICK-REFERENCE: the visible form fields (selector + current
        // value) are small + stable + the thing most actions target, so surface
        // them up-front so a fill is ONE-SHOT (no inspect round-trip for the
        // common case). Only the CONTENT area's fields (the main form).
        quick = '';
        if (opts.quickFields !== false && typeof document !== 'undefined') {
          try {
            var body = document.getElementById('app-content-body');
            var qparts = [];
            var fields = body ? _fieldsOf(body, 16) : [];
            if (fields.length) {
              qparts.push('\nActionable fields on screen (fill directly with a page.fill '
                + 'action — no need to inspect first):\n  ' + fields.join('\n  '));
            }
            var btns = _buttonsOf(body, 16);
            if (btns.length) {
              qparts.push('\nButtons on screen (click directly with a page.click '
                + 'action):\n  ' + btns.join('\n  '));
            }
            quick = qparts.join('');
          } catch (_e) { quick = ''; }
        }
        // only cache a REAL scan (a valid signature); a '' sig means we couldn't
        // read the DOM, so don't poison the cache with a one-off.
        if (sig) _ctxCache = { sig: sig, outline: outline, quick: quick };
      }
      lines.push(outline);
      if (quick) lines.push(quick);

      // any currently-expanded nodes, in order (rendered fresh — small + just
      // requested, and the DOM-sig memo already covers the heavy outline scan).
      expanded.forEach(function (p) {
        lines.push('');
        lines.push(_renderNode(p, true));
      });
      // VISION: the last page.see description (what the page LOOKS like, from a
      // multimodal model) — folded in so the text model "sees" it this turn.
      if (_seen) {
        lines.push('\n=== WHAT THE PAGE LOOKS LIKE (from a screenshot, described '
          + 'by a vision model) ===\n' + _seen);
      }
      if (!expanded.length) {
        lines.push('\n(Nothing expanded yet — emit a page.inspect action with a '
          + '[path] above to look inside a region.)');
      }
      return lines.join('\n');
    }

    function onAction(type, payload) {
      if (type !== 'page.inspect' || !payload) return false;
      var path = String(payload.path || payload.node || '').replace(/^\/+|\/+$/g, '');
      if (!path) return false;
      if (payload.collapse) {
        expanded = expanded.filter(function (p) { return p !== path && p.indexOf(path + '/') !== 0; });
        return true;
      }
      // validate the path resolves before staging it (so a bad path is a no-op)
      var node = null; try { node = nodes(path); } catch (_e) { node = null; }
      if (!node) return true;   // handled (acknowledged) but nothing to expand
      // de-dupe, then bound the expanded set (drop the oldest)
      expanded = expanded.filter(function (p) { return p !== path; });
      expanded.push(path);
      if (expanded.length > maxExpanded) expanded = expanded.slice(expanded.length - maxExpanded);
      return true;
    }

    function reset() { expanded = []; _seen = ''; _ctxCache = { sig: null, outline: null, quick: null }; }

    // #5 — AUTO-EXPAND the region a just-acted-on element lives in, so a
    // follow-up turn sees that region's detail without a separate page.inspect
    // round-trip. Called by AppUIPageActions after a successful fill/click. Maps
    // the element to a top-level region (menu/sidebar/content) by walking up to
    // the standard region containers; if found, stages that region path (same
    // bounded expand set as page.inspect). Best-effort + silent — a selector in
    // no known region is a no-op. Only meaningful with the DOM scanner.
    function noteSelector(sel, el) {
      try {
        if (typeof document === 'undefined') return;
        var node = el || (sel ? document.querySelector(sel) : null);
        if (!node || !node.closest) return;
        var region = null;
        if (node.closest('#app-content-body')) region = 'content';
        else if (node.closest('#app-right')) region = 'sidebar';
        else if (node.closest('#app-menubar')) region = 'menu';
        if (!region) return;
        // only stage a region the scanner actually exposes
        var root = null; try { root = nodes(''); } catch (_e) { root = null; }
        var known = root && (root.children || []).some(function (c) { return c.key === region; });
        if (!known) return;
        onAction('page.inspect', { path: region });
      } catch (_e) { /* best-effort */ }
    }

    return { system: system, context: context, onAction: onAction, reset: reset,
             // set the last page.see vision description (called by AppUIPageActions)
             setSeen: function (desc) { _seen = desc ? String(desc) : ''; },
             // #5 — auto-expand the region a just-acted-on selector lives in
             noteSelector: noteSelector,
             // exposed for tests/debug
             _expanded: function () { return expanded.slice(); } };
  }

  window.AppUIPageIntrospect = { create: create, scanDomNodes: scanDomNodes };
})();
