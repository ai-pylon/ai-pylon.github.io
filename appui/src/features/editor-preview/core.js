/**
 * AppUIEditorPreview — Reusable source/live-preview split feature.
 *
 * Promotes the pattern the PlantUML page (and friends) build by hand: a
 * horizontal AppUISplit with an editable SOURCE pane on the left and a rendered
 * PREVIEW pane on the right, where edits are debounced and pushed through a
 * caller-supplied `onRender(source)` that returns HTML or SVG to drop into the
 * preview.
 *
 * It reuses the AppUISplit primitive (components/split.js) for the resizable
 * two-pane layout and upgrades the source <textarea> to a CodeMirror editor when
 * `window.CodeMirror` is present (line numbers + the given language mode),
 * falling back to a plain <textarea> otherwise. No framework, no build step —
 * just an IIFE that attaches to `window.AppUIEditorPreview`.
 *
 * Usage:
 *   const ep = AppUIEditorPreview.create({
 *     container: document.querySelector('#editor'),
 *     initialSource: '@startuml\nA -> B\n@enduml',
 *     language: 'plantuml',                 // optional CodeMirror mode
 *     debounceMs: 400,                       // optional (default 400)
 *     async onRender(source) {               // return an SVG/HTML string
 *       const r = await fetch('/api/plantuml_python/convert', {
 *         method: 'POST', headers: { 'Content-Type': 'application/json' },
 *         body: JSON.stringify({ code: source, format: 'svg' }),
 *       }).then(x => x.json());
 *       return r.svg;                         // string | {html}/{svg} | Node
 *     },
 *   });
 *   ep.getSource(); ep.setSource('...'); ep.refresh(); ep.destroy();
 */
const AppUIEditorPreview = (function () {
  'use strict';

  function create(opts) {
    opts = opts || {};
    const container = typeof opts.container === 'string'
      ? document.querySelector(opts.container)
      : opts.container;
    if (!container) throw new Error('AppUIEditorPreview: container is required');
    if (typeof opts.onRender !== 'function') throw new Error('AppUIEditorPreview: onRender(source) is required');
    if (typeof window.AppUISplit === 'undefined') throw new Error('AppUIEditorPreview: AppUISplit (components/split.js) not loaded');

    const onRender = opts.onRender;
    const debounceMs = Number.isFinite(opts.debounceMs) ? opts.debounceMs : 400;
    const language = opts.language || null;
    const sourceLabel = opts.sourceLabel || 'Source';
    const previewLabel = opts.previewLabel || 'Preview';

    let editor = null;          // textarea OR CodeMirror adapter (shared .value / addEventListener)
    let cm = null;              // raw CodeMirror instance when upgraded
    let previewEl = null;       // the preview content host
    let split = null;           // AppUISplit handle
    let debounceTimer = null;
    let inFlight = false;
    let pending = false;
    let destroyed = false;
    let renderSeq = 0;          // guards against out-of-order async renders

    // --- Build the two panes, then hand them to AppUISplit -------------------
    function buildSourcePane(host) {
      const pane = document.createElement('div');
      pane.className = 'appui-ep-pane appui-ep-source';
      pane.style.cssText = 'display:flex;flex-direction:column;height:100%;min-width:0';
      const head = document.createElement('div');
      head.className = 'appui-ep-pane-head';
      head.textContent = sourceLabel;
      head.style.cssText = 'padding:4px 10px;font-size:12px;font-weight:600;color:var(--text-muted,#64748b);border-bottom:1px solid var(--border,#e2e8f0);flex:0 0 auto';
      const textarea = document.createElement('textarea');
      textarea.className = 'appui-ep-textarea';
      textarea.spellcheck = false;
      textarea.setAttribute('aria-label', sourceLabel);
      textarea.style.cssText = 'flex:1 1 auto;width:100%;box-sizing:border-box;border:none;outline:none;resize:none;padding:8px 10px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;line-height:1.5;background:var(--bg-primary,#fff);color:var(--text-primary,#0f172a)';
      textarea.value = opts.initialSource == null ? '' : String(opts.initialSource);
      pane.append(head, textarea);
      host.appendChild(pane);
      // Upgrade AFTER the textarea is in the DOM so CodeMirror can size itself.
      editor = _makeEditor(textarea);
      editor.addEventListener('input', scheduleRender);
      // CodeMirror needs a refresh once its container is laid out/visible.
      if (cm) { setTimeout(refreshEditor, 0); setTimeout(refreshEditor, 60); }
    }

    function buildPreviewPane(host) {
      const pane = document.createElement('div');
      pane.className = 'appui-ep-pane appui-ep-preview';
      pane.style.cssText = 'display:flex;flex-direction:column;height:100%;min-width:0';
      const head = document.createElement('div');
      head.className = 'appui-ep-pane-head';
      head.textContent = previewLabel;
      head.style.cssText = 'padding:4px 10px;font-size:12px;font-weight:600;color:var(--text-muted,#64748b);border-bottom:1px solid var(--border,#e2e8f0);flex:0 0 auto';
      previewEl = document.createElement('div');
      previewEl.className = 'appui-ep-canvas';
      previewEl.setAttribute('aria-label', previewLabel);
      previewEl.style.cssText = 'flex:1 1 auto;overflow:auto;padding:10px;background:var(--bg-secondary,#f8fafc)';
      pane.append(head, previewEl);
      host.appendChild(pane);
    }

    // --- CodeMirror upgrade (optional) --------------------------------------
    // Returns an ADAPTER that preserves the subset of the textarea API this
    // feature relies on — `.value` get/set + `.addEventListener('input'|'change')`
    // + `.focus()` — so the rest of the code never branches on which backend is
    // live. Falls back to the raw textarea when CodeMirror is absent.
    function _makeEditor(textarea) {
      if (typeof window.CodeMirror === 'undefined' || !textarea) return textarea;
      try {
        cm = window.CodeMirror.fromTextArea(textarea, {
          mode: language || null,
          lineNumbers: true,
          lineWrapping: true,
          indentUnit: 2,
          tabSize: 2,
          viewportMargin: Infinity,
        });
      } catch (e) {
        cm = null;
        return textarea;   // CM variant/mode mismatch — keep the plain textarea.
      }
      return {
        get value() { return cm.getValue(); },
        set value(v) { cm.setValue(v == null ? '' : String(v)); },
        addEventListener(type, fn) {
          if (type === 'input' || type === 'change') cm.on('change', fn);
        },
        focus() { try { cm.focus(); } catch (e) {} },
        _cm: cm,
      };
    }

    function refreshEditor() { try { cm && cm.refresh(); } catch (e) {} }

    // --- Debounced render flow ----------------------------------------------
    function scheduleRender() {
      if (destroyed) return;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(runRender, debounceMs);
    }

    function _setPreview(result) {
      if (!previewEl) return;
      if (result == null) return;                 // leave the current render in place
      if (result instanceof Node) {
        previewEl.replaceChildren(result);
      } else {
        const r = typeof result === 'object'
          ? (result.svg != null ? result.svg : result.html)
          : result;
        previewEl.innerHTML = r == null ? '' : String(r);
      }
    }

    function _setError(err) {
      if (!previewEl) return;
      const msg = (err && err.message) || String(err);
      const esc = s => String(s).replace(/[&<>"]/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
      previewEl.innerHTML =
        '<p style="padding:12px;color:#b91c1c;font-size:13px;white-space:pre-wrap">' + esc(msg) + '</p>';
    }

    // Run onRender for the CURRENT source. If one is already in flight, mark the
    // request pending so the LATEST source renders once the current one settles
    // (prevents dropping the newest edit).
    function runRender() {
      if (destroyed) return;
      if (inFlight) { pending = true; return; }
      inFlight = true;
      pending = false;
      const source = getSource();
      const seq = ++renderSeq;
      Promise.resolve()
        .then(() => onRender(source))
        .then(result => { if (!destroyed && seq === renderSeq) _setPreview(result); })
        .catch(err => { if (!destroyed && seq === renderSeq) _setError(err); })
        .then(() => {
          inFlight = false;
          if (pending && !destroyed) { pending = false; runRender(); }
        });
    }

    // --- Public API ----------------------------------------------------------
    function getSource() { return editor ? editor.value : ''; }

    function setSource(value, options) {
      if (editor) editor.value = value == null ? '' : String(value);
      refreshEditor();
      if (!options || options.render !== false) runRender();  // re-render by default
    }

    function refresh() { refreshEditor(); runRender(); }

    function focus() { if (editor && editor.focus) editor.focus(); }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      clearTimeout(debounceTimer);
      if (cm) { try { cm.toTextArea(); } catch (e) {} cm = null; }
      if (split && split.destroy) split.destroy();
      editor = null; previewEl = null; split = null;
    }

    // --- Mount ---------------------------------------------------------------
    split = window.AppUISplit.create({
      container,
      direction: 'horizontal',
      ratio: Number.isFinite(opts.ratio) ? opts.ratio : 0.45,
      minSize: Number.isFinite(opts.minSize) ? opts.minSize : 160,
      className: opts.className ? ('appui-ep ' + opts.className) : 'appui-ep',
      primaryLabel: sourceLabel,
      secondaryLabel: previewLabel,
      primary: buildSourcePane,
      secondary: buildPreviewPane,
    });

    // Initial render of the seed source (if any).
    if (getSource().trim()) runRender();

    return {
      getSource,
      setSource,
      refresh,
      focus,
      destroy,
      get editor() { return editor; },
      get cm() { return cm; },
      get previewElement() { return previewEl; },
      get splitHandle() { return split; },
    };
  }

  return { create };
})();
window.AppUIEditorPreview = AppUIEditorPreview;
