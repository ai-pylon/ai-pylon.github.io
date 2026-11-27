/* ChatPanel context helpers; loaded by the aiSidebar bundle. */
window._AppUIChatPanelContext = (() => {
  // Default cap on per-turn page context (characters). A page's live snapshot
  // (selection/tree/open file) can be large; the surface re-sends context()
  // every turn, so an uncapped snapshot resends kilobytes each message and can
  // crowd the window. Hosts override with opts.contextMaxChars (0 = uncapped).
  const DEFAULT_CONTEXT_MAX = 8000;

  // Wrap a host context() with a size cap + a cheap CHANGE GATE (#16): remember
  // the last RAW result and its already-capped form, and when the host returns
  // the identical snapshot, return the cached capped string without re-capping.
  // Supports sync or Promise-returning host context(). Returns the original
  // value (or null) when there's nothing to wrap.
  function wrapContext(hostContext, maxChars) {
    if (typeof hostContext !== 'function') return (hostContext || null);
    const cap = (maxChars === undefined) ? DEFAULT_CONTEXT_MAX : maxChars;
    let lastRaw = null, lastOut = '';
    let warnedTruncate = false;   // #4: one-time size-cap telemetry
    const process = (raw) => {
      const s = String(raw == null ? '' : raw);
      if (s === lastRaw) return lastOut;        // unchanged → reuse (no re-cap)
      lastRaw = s;
      if (cap > 0 && s.length > cap) {
        // #4 — the snapshot is being CLIPPED; today it truncated silently so a
        // page author couldn't tell their current-view context was cut. Emit a
        // ONE-TIME debug note (per wrapped context) naming the overflow + cap so
        // it's diagnosable without spamming the console each turn.
        if (!warnedTruncate) {
          warnedTruncate = true;
          try {
            console.debug('[AppUIChatPanel] page context() truncated: ' + s.length
              + ' chars → cap ' + cap + '. Return a more compact snapshot, or raise '
              + 'opts.contextMaxChars (0 = uncapped) if the full view is needed.');
          } catch (_e) { /* console unavailable */ }
        }
        lastOut = s.slice(0, cap) + '\n… [context truncated at ' + cap + ' chars]';
      } else {
        lastOut = s;
      }
      return lastOut;
    };
    return function () {
      let v;
      try { v = hostContext.apply(null, arguments); } catch (_e) { return lastOut; }   // the turn's question is passed on
      if (v && typeof v.then === 'function') return v.then(process).catch(() => lastOut);
      return process(v);
    };
  }

  // ---- DOC-GROUNDED chat helper (shared) ----------------------------------
  // Build the {system, context, onAction, examplePrompts, reset} bundle for a
  // page that renders a (possibly large) DOCUMENT and wants its assistant to be
  // grounded in what the user SEES plus the document STRUCTURE, and to fetch more
  // on demand — the pattern first built for the sysdoc viewer, factored here so
  // any doc page reuses it instead of copy-pasting ~200 lines. Pass:
  //   getRoot()     → the DOM root holding the rendered doc (an element or a
  //                   shadowRoot). Required.
  //   getScroller() → the scroll container used to decide what's VISIBLE
  //                   (optional; defaults to getRoot()).
  //   docLabel()    → a short string naming the open doc (optional).
  //   idPrefix      → prefix for synthetic heading ids (default 'doc-h-').
  //   kind          → noun used in the prompts (default 'document').
  // Returns an object to spread into mountProfile opts: { system, context,
  // onAction, examplePrompts, reset }. `reset()` clears fetched-chapter staging
  // (call when the page loads a different document).
  function docContext(opts) {
    opts = opts || {};
    const getRoot = typeof opts.getRoot === 'function' ? opts.getRoot : () => null;
    const getScroller = typeof opts.getScroller === 'function' ? opts.getScroller : getRoot;
    const docLabel = typeof opts.docLabel === 'function' ? opts.docLabel : () => '';
    const idPrefix = opts.idPrefix || 'doc-h-';
    const kind = opts.kind || 'document';
    const CHAPTER_CAP = opts.chapterCap || 7000;
    const VISIBLE_CAP = opts.visibleCap || 4000;
    const MAX_OUTLINE = opts.maxOutline || 120;
    let requested = {};
    let _chCache = null;   // AI_ASSISTANT #20: memoized heading scan {root, sig, list}

    const cleanText = (node) => {
      if (!node) return '';
      try { if (node.innerText && node.innerText.trim()) return node.innerText; } catch (_e) { /* no innerText */ }
      try {
        const c = node.cloneNode ? node.cloneNode(true) : null;
        if (c && c.querySelectorAll) { c.querySelectorAll('style,script,link,head').forEach((n) => n.remove()); return c.textContent || ''; }
      } catch (_e) { /* fall */ }
      return node.textContent || '';
    };
    const chapters = () => {
      const root = getRoot();
      if (!root || !root.querySelectorAll) return [];
      // AI_ASSISTANT #20: cache the heading scan so context() doesn't re-walk the
      // whole DOM (querySelectorAll('h1..h6') + build the outline) on EVERY send.
      // The outline only changes when the doc content changes — gate on a CHEAP
      // signature (the root node identity + its childElementCount, a plain
      // property read) so a stable doc reuses the prior scan; a new load /
      // streaming append (child count changes) invalidates it. reset() also
      // clears it when the page swaps documents.
      let sig;
      try { sig = (root.childElementCount || 0) + ':' + (root.children && root.children.length || 0); } catch (_e) { sig = null; }
      if (_chCache && _chCache.root === root && sig != null && _chCache.sig === sig) return _chCache.list;
      const out = [];
      [...root.querySelectorAll('h1,h2,h3,h4,h5,h6')].forEach((h, i) => {
        const txt = (h.textContent || '').trim().replace(/\s+/g, ' ');
        if (!txt) return;
        if (h.closest && h.closest('[data-zone="header"],[data-zone="footer"],.doc-header,.doc-footer')) return;
        if (!h.id) h.id = idPrefix + i;
        out.push({ id: h.id, level: Number(h.tagName.slice(1)) || 1, title: txt.slice(0, 140) });
      });
      _chCache = { root, sig, list: out };
      return out;
    };
    const findHead = (root, idOrTitle) => {
      if (!root || !root.querySelector) return null;
      // querySelector works on BOTH an Element and a ShadowRoot (getElementById
      // is NOT available on a ShadowRoot — that was the bug).
      let h = null;
      try { h = root.querySelector('#' + (window.CSS && CSS.escape ? CSS.escape(idOrTitle) : idOrTitle)); } catch (_e) { h = null; }
      if (h) return h;
      const want = String(idOrTitle || '').trim().toLowerCase();
      if (!want) return null;
      const heads = [...root.querySelectorAll('h1,h2,h3,h4,h5,h6')];
      // normalize heading text (collapse tabs/spaces) and match by prefix OR
      // containment, so a title request like "Scope" finds "1\tScope".
      const norm = (x) => (x.textContent || '').trim().replace(/\s+/g, ' ').toLowerCase();
      return heads.find((x) => norm(x).startsWith(want))
          || heads.find((x) => norm(x).includes(want)) || null;
    };
    const chapterText = (idOrTitle) => {
      const root = getRoot();
      if (!root || !root.querySelectorAll) return '';
      const head = findHead(root, idOrTitle);
      if (!head) return '';
      const level = Number(head.tagName.slice(1)) || 1;
      const parts = [(head.textContent || '').trim()];
      let n = head.nextElementSibling, acc = parts[0].length;
      while (n && acc < CHAPTER_CAP) {
        if (/^H[1-6]$/.test(n.tagName) && Number(n.tagName.slice(1)) <= level) break;
        const t = cleanText(n).trim(); if (t) { parts.push(t); acc += t.length; }
        n = n.nextElementSibling;
      }
      if (parts.length === 1) { const all = cleanText(root); const at = all.indexOf(parts[0]); if (at >= 0) return all.slice(at, at + CHAPTER_CAP); }
      let txt = parts.join('\n');
      if (txt.length > CHAPTER_CAP) txt = txt.slice(0, CHAPTER_CAP) + '\n…(section truncated)';
      return txt;
    };
    const visibleText = () => {
      const root = getRoot(), scroller = getScroller();
      if (!root || !root.querySelectorAll) return '';
      let vr = null; try { vr = (scroller || root).getBoundingClientRect(); } catch (_e) { vr = null; }
      let text = '';
      if (vr) {
        for (const b of [...root.querySelectorAll('p,li,td,h1,h2,h3,h4,h5,h6,pre,.page')]) {
          if (text.length >= VISIBLE_CAP) break;
          let r; try { r = b.getBoundingClientRect(); } catch (_e) { continue; }
          if (r.bottom < vr.top || r.top > vr.bottom) continue;
          const t = cleanText(b).trim(); if (t) text += (text ? '\n' : '') + t;
        }
      }
      if (!text) text = cleanText(root).trim().slice(0, VISIBLE_CAP);
      if (text.length > VISIBLE_CAP) text = text.slice(0, VISIBLE_CAP) + '\n…';
      return text;
    };

    const system =
      'You are a READING assistant for an open ' + kind + ' (often a 3GPP/Ericsson '
      + 'spec). Each turn you are given the ' + kind + ' name, its CHAPTER OUTLINE '
      + '(each has an id + title), the text CURRENTLY VISIBLE on screen, and the full '
      + 'text of any chapters you previously requested. Help the user understand it — '
      + 'summarize, explain, define, find and quote — GROUNDED in that text; never '
      + 'invent clause numbers, values, or text you were not shown. The ' + kind + ' '
      + 'can be large, so you only see part of it. When you need a chapter you do NOT '
      + 'have the text for, REQUEST it by emitting ONE fenced action block and nothing '
      + 'else:\n```action\n{"type":"doc.chapter","id":"<id from the outline>"}\n```\n'
      + 'Its text appears next turn; then answer. You may request by outline id '
      + '(preferred) or exact title. Reply in prose/markdown.';

    function context() {
      const root = getRoot();
      if (!root) return 'No ' + kind + ' open yet.';
      const lines = [];
      const label = docLabel();
      if (label) lines.push('Open ' + kind + ': ' + label);
      const chs = chapters();
      if (chs.length) {
        let shown = chs.filter((c) => c.level <= 2);
        if (shown.length > MAX_OUTLINE) shown = shown.slice(0, MAX_OUTLINE);
        else if (shown.length < 30) shown = chs.slice(0, MAX_OUTLINE);
        const list = shown.map((c) => '  '.repeat(Math.max(0, c.level - 1)) + '- [' + c.id + '] ' + c.title).join('\n');
        const more = chs.length > shown.length ? ('\n  (… ' + (chs.length - shown.length) + ' more sub-sections; request a chapter to see its text + sub-sections)') : '';
        lines.push('\nCHAPTER OUTLINE (' + chs.length + ' headings; request one with a doc.chapter action):\n' + list + more);
      }
      const vis = visibleText();
      if (vis) lines.push('\n--- CURRENTLY VISIBLE TEXT ---\n' + vis);
      for (const id of Object.keys(requested)) { const t = chapterText(id); if (t) lines.push('\n--- REQUESTED CHAPTER [' + id + '] ---\n' + t); }
      if (!chs.length && !vis) lines.push('\n(The ' + kind + ' is not readable yet — it may still be loading, or be a binary/image format.)');
      return lines.join('\n');
    }
    function onAction(type, payload) {
      if (type !== 'doc.chapter' || !payload) return;
      const key = payload.id || payload.title || payload.chapter;
      if (!key) return;
      requested[key] = true;
      try {
        const head = findHead(getRoot(), key);
        if (head && head.scrollIntoView) head.scrollIntoView({ block: 'start' });
      } catch (_e) { /* best-effort */ }
    }
    return {
      system, context, onAction, reset() { requested = {}; _chCache = null; },
      examplePrompts: opts.examplePrompts || [
        'Summarize this ' + kind + ' in a few bullet points.',
        'What is on the part I\'m viewing?',
        'List the main chapters / sections.',
        'Explain the 3GPP terms or abbreviations here.',
      ],
    };
  }

  return { wrapContext, docContext };
})();
