/**
 * AI Core  --  shared utilities for ai-float.js and ai-sidebar.js
 * 
 * Provides:
 *   AppUICore.escHtml(s)            --  escape HTML entities
 *   AppUICore.renderMarkdown(text)  --  markdown to HTML (with fallback)
 *   AppUICore.smartScroll(el)       --  scroll only if user is near bottom
 *   AppUICore.parseSSE(chunk, cb)   --  parse SSE lines, dispatch events
 *   AppUICore.streamChat(opts)      --  full streaming chat with tool support
 */
var AppUICore = window.AppUICore || (function() {

  const {escHtml,renderMarkdown}=window._AppUICoreMarkdown;

  // --- Smart Scroll ---
  function smartScroll(el, threshold) {
    if (!el) return;
    threshold = threshold || 80;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < threshold) {
      el.scrollTop = el.scrollHeight;
    }
  }

  function forceScroll(el) {
    if (el) el.scrollTop = el.scrollHeight;
  }

  const {parseSSE,streamChat}=window._AppUICoreStream;

  // --- Tool Status UI Helpers ---
  // A tool row: "⚙ name  ⏱ 1.2s" — the elapsed time ticks while the tool runs and
  // freezes when markToolDone is called (or shows the backend-reported ms). Click
  // to expand args + output; the expanded detail SCROLLS (60vh) instead of being
  // clipped at a fixed height.
  const _TOOL_OPEN_H = '60vh';
  function _fmtElapsed(ms) {
    if (!(ms >= 0)) return '';
    if (ms < 1000) return ms + 'ms';
    const s = ms / 1000;
    return s < 60 ? s.toFixed(s < 10 ? 1 : 0) + 's' : Math.floor(s / 60) + 'm ' + Math.round(s % 60) + 's';
  }
  function _isLargeOutput(o) {
    if (typeof o === 'string') return o.length > 2048;
    if (o && typeof o === 'object') {
      if (Array.isArray(o)) return o.length > 12;
      const ks = Object.keys(o);
      if (ks.length > 12) return true;
      for (let i = 0; i < ks.length; i++) {
        const v = o[ks[i]];
        if (typeof v === 'string' && v.length > 512) return true;
        if (Array.isArray(v) && v.length > 8) return true;
        if (v && typeof v === 'object' && Object.keys(v).length > 8) return true;
      }
    }
    return false;
  }
  function _formatToolOutput(output) {
    let outStr;
    try { outStr = typeof output === 'string' ? output : JSON.stringify(output, null, 2); }
    catch { outStr = String(output); }
    if (!outStr) return '';
    // the detail scrolls, so keep a generous amount (a read window / search page)
    if (outStr.length > 60000) outStr = outStr.slice(0, 60000) + '\n\u2026 (truncated at 60k chars)';
    return '\u2192 ' + outStr;
  }
  function _materializeToolOutput(el) {
    if (!el || !el._hasPendingOutput) return;
    const raw = el._pendingOutput;
    el._hasPendingOutput = false;
    el._pendingOutput = undefined;
    const out = el.querySelector('.tool-output');
    if (out) out.textContent = _formatToolOutput(raw);
  }
  function _toggleToolDetail(el) {
    const detail = el.querySelector('.tool-detail');
    if (!detail) return;
    const isOpen = detail.style.maxHeight && detail.style.maxHeight !== '0px';
    if (!isOpen && el._hasPendingOutput) _materializeToolOutput(el);
    detail.style.maxHeight = isOpen ? '0px' : _TOOL_OPEN_H;
    detail.style.overflow = isOpen ? 'hidden' : 'auto';
  }
  function createToolStatus(toolName, args) {
    const el = document.createElement('div');
    el.className = 'ai-tool-status';
    el.style.cssText = 'margin:3px 0;padding:2px 8px;background:var(--bg-elevated);border-left:2px solid var(--color-info, #ce93d8);border-radius:2px;font-size:10px;cursor:pointer;display:block';
    const argsStr = args ? (typeof args === 'string' ? args : JSON.stringify(args)).slice(0, 4000) : '';
    el.innerHTML = `<span style="color:var(--color-info, #ce93d8)">⚙ ${escHtml((toolName || 'tool').slice(0, 60))}</span>`
      + ` <span class="tool-elapsed" style="color:var(--text-muted);font-variant-numeric:tabular-nums" title="time spent in this tool call">\u23f1 0s</span>`
      + `${argsStr ? `<div class="tool-detail" style="color:var(--text-muted);font-size:10px;max-height:0;overflow:hidden;transition:max-height 0.3s;white-space:pre-wrap;word-break:break-all;margin-top:2px;cursor:text">${escHtml(argsStr)}</div>` : ''}`;
    el._t0 = Date.now();
    const tick = () => {
      const e = el.querySelector('.tool-elapsed');
      if (!e || el._done) return;
      e.textContent = '\u23f1 ' + _fmtElapsed(Math.floor((Date.now() - el._t0) / 1000) * 1000);
    };
    el._timer = setInterval(() => {
      // stop on completion, detachment or a 30 min safety cap (no leaked timers)
      if (el._done || (!el.isConnected && Date.now() - el._t0 > 5000) || Date.now() - el._t0 > 1800000) {
        clearInterval(el._timer); el._timer = null; return;
      }
      tick();
    }, 1000);
    el.onclick = (e) => {
      // selecting / scrolling inside the open output must not collapse it
      if (e.target.closest && e.target.closest('.tool-detail')) return;
      e.stopPropagation();
      _toggleToolDetail(el);
    };
    return el;
  }

  function markToolDone(el, output, ms) {
    if (!el) return;
    el.style.borderLeftColor = 'var(--color-success)';
    const label = el.querySelector('span');
    if (label) label.innerHTML = label.innerHTML.replace('...', ' \u2714');
    // elapsed: the backend-reported duration when given, else the row's own clock;
    // ms === null = unknown (a replayed history row) → no time shown
    if (!el._done) {
      el._done = true;
      if (el._timer) { clearInterval(el._timer); el._timer = null; }
      const e = el.querySelector('.tool-elapsed');
      const took = (typeof ms === 'number' && ms >= 0) ? ms
        : (ms === null ? null : (el._t0 ? Date.now() - el._t0 : null));
      if (e) { if (took != null) e.textContent = '\u23f1 ' + _fmtElapsed(took); else e.remove(); }
    }
    // AI_ASSISTANT #2: render the tool's OUTPUT in the collapsible detail (not
    // just tint the border) so the user can expand a row and see WHAT the tool
    // returned. Append below the args; create the detail block if the row had
    // no args (so an args-less tool still shows its result). Idempotent: a
    // re-render / re-mark replaces any prior output block.
    if (output === undefined || output === null || output === '') return;
    let detail = el.querySelector('.tool-detail');
    if (!detail) {
      detail = document.createElement('div');
      detail.className = 'tool-detail';
      detail.style.cssText = 'color:var(--text-muted);font-size:10px;max-height:0;overflow:hidden;transition:max-height 0.3s;white-space:pre-wrap;word-break:break-all;margin-top:2px;cursor:text';
      el.appendChild(detail);
    }
    const isOpen = !!(detail.style.maxHeight && detail.style.maxHeight !== '0px');
    // keep the args (existing content), drop any previous output block, append fresh
    const prev = detail.querySelector('.tool-output');
    if (prev) prev.remove();
    const out = document.createElement('div');
    out.className = 'tool-output';
    out.style.cssText = 'margin-top:4px;padding-top:4px;border-top:1px dashed var(--border,#444)';
    // #35: defer JSON.stringify + huge text-node creation for collapsed large outputs
    // until the user actually clicks the row to expand it.
    if (!isOpen && _isLargeOutput(output)) {
      el._pendingOutput = output;
      el._hasPendingOutput = true;
      out.textContent = '\u2192 (click to expand output)';
    } else {
      el._hasPendingOutput = false;
      el._pendingOutput = undefined;
      const formatted = _formatToolOutput(output);
      if (!formatted) return;
      out.textContent = formatted;
    }
    detail.appendChild(out);
  }

  // --- Format Utilities ---
  function fmtSize(n) {
    if (!n) return '';
    if (n > 1e9) return (n/1e9).toFixed(1)+' GB';
    if (n > 1e6) return (n/1e6).toFixed(1)+' MB';
    if (n > 1e3) return (n/1e3).toFixed(1)+' KB';
    return n + ' B';
  }

  function fmtDate(ts) {
    return ts ? new Date(ts * 1000).toLocaleString() : '';
  }

  function copyFallback(text) {
    let input;
    try {
      input = document.createElement('textarea');
      input.value = text;
      input.style.position = 'fixed';
      input.style.opacity = '0';
      document.body.appendChild(input);
      input.focus?.({preventScroll: true});
      input.select();
      if (!document.execCommand('copy')) throw new Error('Clipboard is unavailable');
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error);
    } finally {
      input?.remove();
    }
  }

  function copyText(text, {fallbackOnError = false} = {}) {
    text = text == null ? '' : String(text);
    if (!navigator.clipboard?.writeText) return copyFallback(text);
    let write;
    try {
      write = navigator.clipboard.writeText(text);
    } catch (error) {
      write = Promise.reject(error);
    }
    return Promise.resolve(write).catch(error => {
      if (!fallbackOnError) throw error;
      return copyFallback(text);
    });
  }

  function downloadBlob(blob, filename, options) {
    options = options || {};
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = filename || 'download';
    if (options.rel) link.rel = options.rel;
    function cleanup() {
      URL.revokeObjectURL(url);
      link.remove();
    }
    try {
      if (options.attach) document.body.appendChild(link);
      link.click();
    } catch (error) {
      cleanup();
      throw error;
    }
    window.setTimeout(cleanup, options.revokeDelay == null ? 0 : options.revokeDelay);
  }

  function downloadText(text, filename, type) {
    downloadBlob(new Blob([text == null ? '' : String(text)], {type: type || 'text/plain'}), filename);
  }

  function downloadJson(value, filename) {
    downloadText(JSON.stringify(value, null, 2), filename || 'download.json', 'application/json');
  }

  // --- Public API ---
  return {
    escHtml,
    fmtSize,
    fmtDate,
    copyText,
    downloadBlob,
    downloadText,
    downloadJson,
    renderMarkdown,
    smartScroll,
    forceScroll,
    parseSSE,
    streamChat,
    createToolStatus,
    markToolDone,
    // Theme toggle
    toggleTheme() {
      return AppUITheme.toggle();
    },
    setTheme(theme) {
      return AppUITheme.set(theme);
    },
    initTheme() {
      return AppUITheme.restore();
    },
    steer: window._AppUICoreSteering,

    // --- Tools (call sync or async with auto-callback wiring) ---
    tools: (function() {
      let _schema = null;  // cached tool list

      async function list() {
        if (!_schema) {
          const r = await fetch('/tools');
          const d = await r.json();
          _schema = d.tools || [];
        }
        return _schema;
      }

      async function call(name, params = {}) {
        const r = await fetch(`/api/${name}`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(params)
        });
        return r.json();
      }

      async function asyncCall(name, params = {}, onDone = null) {
        // Look up what event this tool emits
        const tools = await list();
        const tool = tools.find(t => t.name === name);
        if (!tool || !tool.emits) {
          throw new Error(`Tool ${name} does not support async (no emits declared)`);
        }
        // NOTE: Legacy AppUICore.events SSE listener removed.
        // Pages that need async completion callbacks should use AppUIEventBus directly:
        //   const bus = new AppUIEventBus(['tools']);
        //   bus.on('tools', tool.emits, data => { bus.close(); onDone(data); });
        if (onDone) {
          console.warn('AppUICore.tools.asyncCall: onDone callback ignored — use AppUIEventBus for async tool events');
        }
        // Fire the async call
        const r = await fetch(`/api/${name}!async`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(params)
        });
        return r.json();
      }

      return { list, call, asyncCall };
    })(),
  };
})();

// Auto-restore saved theme on load
AppUICore.initTheme();
window.AppUICore = AppUICore;
