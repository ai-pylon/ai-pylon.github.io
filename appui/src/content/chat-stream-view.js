/* Private rendering adapter for a single Chat stream. */
const _AppUIChatStreamView = {
  create({opts,current,thinkingEl,getMessages,timers,onReply}) {
    let reply = '', currentToolEl = null, renderTimer = null;
// the tool rows still RUNNING. Parallel calls start together and finish in any order, so a completion is matched
// to ITS row by call id, else by name+args (oldest first) - one `currentToolEl` left the earlier rows spinning
const openTools = [];
function _takeOpen(d, sig) {
  const tid = (d && (d.id || d.toolCallId || (d._meta && d._meta.kiro && d._meta.kiro.toolCallId))) || '';
  let i = tid ? openTools.findIndex(e => e._tid === tid) : -1;
  if (i < 0 && sig && sig !== '|{}') i = openTools.findIndex(e => e._sig === sig);
  if (i < 0 && !(d && (d.name || d.tool || d.toolName))) i = openTools.length ? 0 : -1;   // an unnamed result: the oldest
  return i < 0 ? null : openTools.splice(i, 1)[0];
}
    const _updateThinking = text => {if (thinkingEl) thinkingEl.textContent = text;};
    // The assistant bubble (thinkingEl) is a SEQUENCE of segments in ARRIVAL
    // order — reasoning/answer prose and tool-status rows INTERLEAVED as they
    // actually happened (reason → ⚙ tool → reason → answer), instead of forcing
    // all tool rows above all text. Mechanics:
    //   • a tool row is appended directly to thinkingEl at the current end.
    //   • prose streams into the TRAILING `.ai-chat-prose` segment; when a tool
    //     row is appended we "seal" the current prose segment so the next prose
    //     token starts a FRESH segment AFTER the tool row. Re-rendering a segment
    //     via innerHTML only touches that segment, never the tool rows (the old
    //     interleave/wipe bug).
    // _toolsEl() is kept as an alias (returns thinkingEl) for back-compat with
    // callers that append a row to it — a row appended to thinkingEl lands in
    // sequence just the same.
    let _proseSegment = null;        // the trailing, still-growing prose segment
    // #26: incremental render state. Re-running renderMarkdown over the WHOLE
    // accumulated reply every 150ms tick is O(n^2) on a long answer (a 20KB reply
    // re-parsed in full ~130 times). Instead we render the STABLE PREFIX once,
    // cache its HTML, and only re-render the short growing TAIL each tick. The
    // split point is the last blank-line (\n\n) boundary whose preceding text has
    // BALANCED code fences — so no markdown construct (fence, list, table) is cut
    // across the boundary. _stableLen/_stableHtml hold that cached prefix.
    let _stableLen = 0, _stableHtml = '';
    const _toolsEl = () => thinkingEl;   // back-comapt: append rows in sequence

    // LIVE RUNNING INDICATOR — "⏳ 1m 12s · thinking… / running invoke… / writing…"
    // pinned as the LAST child of the bubble for the whole turn, removed only when
    // the turn ends (final / error / stop). The initial "⏳ Ns…" placeholder is
    // cleared at the first output, which for a reasoning model (thinking tokens
    // stream at once) left the turn with NO visible running state while the Stop
    // button still showed. Every segment is inserted BEFORE it (_append) and the
    // "is X still the last piece" checks skip it (_last).
    let _liveEl = null, _liveTimer = null, _phase = 'thinking';
    const _t0Live = Date.now();
    const _last = () => {
      if (!thinkingEl) return null;
      let n = thinkingEl.lastChild;
      if (n && n === _liveEl) n = n.previousSibling;
      return n;
    };
    const _append = (node) => {
      if (!thinkingEl || !node) return;
      if (_liveEl && _liveEl.parentNode === thinkingEl) thinkingEl.insertBefore(node, _liveEl);
      else thinkingEl.appendChild(node);
    };
    const _fmtLive = ms => { const s = Math.floor(ms / 1000); return s < 60 ? s + 's' : Math.floor(s / 60) + 'm ' + (s % 60) + 's'; };
    const _paintLive = () => {
      if (!_liveEl) return;
      _liveEl.textContent = '\u23f3 ' + _fmtLive(Date.now() - _t0Live) + ' \u00b7 ' + _phase + '\u2026';
      if (thinkingEl && thinkingEl.lastChild !== _liveEl) thinkingEl.appendChild(_liveEl);   // keep it last
    };
    const _ensureLive = () => {
      if (_liveEl || !thinkingEl) return;
      _liveEl = document.createElement('div');
      _liveEl.className = 'ai-chat-live';
      _liveEl.setAttribute('role', 'status');
      _liveEl.setAttribute('aria-live', 'off');
      _liveEl.style.cssText = 'font-size:10.5px;color:var(--text-muted,#888);padding:3px 0 0;font-variant-numeric:tabular-nums';
      thinkingEl.appendChild(_liveEl);
      _paintLive();
      _liveTimer = setInterval(() => { if (!current()) { _endLive(); return; } _paintLive(); }, 1000);
      timers.add(_liveTimer);
    };
    const _setPhase = (p) => { _phase = p; _ensureLive(); _paintLive(); };
    function _endLive() {
      if (_liveTimer) { clearInterval(_liveTimer); timers.delete(_liveTimer); _liveTimer = null; }
      if (_liveEl) { try { _liveEl.remove(); } catch (_e) {} _liveEl = null; }
    }

    const _proseEl = () => {
      if (!thinkingEl) return null;
      // reuse the trailing prose segment if it's still the last child; else make
      // a new one at the end (so prose after a tool row starts a fresh segment).
      if (_proseSegment && _proseSegment.parentNode === thinkingEl
          && _last() === _proseSegment) return _proseSegment;
      const p = document.createElement('div');
      p.className = 'ai-chat-prose';
      _append(p);
      _proseSegment = p;
      return p;
    };
    // Called right before a tool row is appended: seal the current prose segment
    // so subsequent prose opens a new one BELOW the tool row (true interleave).
    let _reasonEl = null, _reasonText = '';   // #2: live reasoning strip state
    // `reply` accumulates across tool rounds; each prose segment shows only the
    // text that arrived AFTER the previous tool row (from _segStart). Rendering
    // the whole reply into every new segment repeated the earlier narration
    // ("Let me check…" twice, three times …) after each tool row.
    let _segStart = 0;
    const _sealProse = () => { _proseSegment = null; _stableLen = 0; _stableHtml = ''; _reasonEl = null; _segStart = reply.length; };

    // #2: a LIVE "reasoning" strip. The model narrates ('I'll search X, then…')
    // BEFORE it emits a tool call; those arrive as `reason` SSE frames (onReason).
    // Render them into a COLLAPSED <details> appended in arrival sequence (so it
    // sits ABOVE the tool rows it precedes, like a prose segment), instead of only
    // backfilling from done.reasoning after the turn. Sealed on a tool row so the
    // next reasoning burst opens a fresh strip below the tool (true interleave).
    const _reasonStrip = () => {
      if (!thinkingEl) return null;
      if (_reasonEl && _reasonEl.parentNode === thinkingEl && _last() === _reasonEl)
        return _reasonEl;
      const d = document.createElement('details');
      d.className = 'ai-chat-reason';
      d.style.cssText = 'margin:2px 0;font-size:11px;color:var(--text-muted,#999)';
      const sm = document.createElement('summary');
      sm.textContent = '\u{1f4ad} reasoning';
      sm.style.cssText = 'cursor:pointer;user-select:none;opacity:.8';
      const body = document.createElement('div');
      body.className = 'ai-chat-reason-body';
      body.style.cssText = 'white-space:pre-wrap;padding:2px 0 2px 14px;opacity:.85';
      d.appendChild(sm); d.appendChild(body);
      _append(d);
      _reasonEl = d; _reasonText = '';
      return d;
    };

    // #26: render `reply` into prose element `p` INCREMENTALLY. Finds the last
    // safe split (a '\n\n' with fence-balanced prefix), renders that prefix ONCE
    // (cached in _stableHtml), and only re-parses the short tail after it each
    // tick — so a long stream isn't re-parsed from byte 0 every time. `trailing`
    // is appended (the ⏳ streaming marker). Falls back to a full render if no
    // safe boundary exists yet (short reply / mid-fence).
    function _renderIncremental(p, text, trailing) {
      if (!p) return;
      // only advance the stable prefix; never move it backward (reply only grows)
      let split = -1;
      // search for the last "\n\n" up to the current end, requiring an even
      // number of ``` fences before it (so we don't split inside a code block).
      let idx = text.lastIndexOf('\n\n');
      while (idx > _stableLen) {
        const fences = (text.slice(0, idx).match(/```/g) || []).length;
        if (fences % 2 === 0) { split = idx + 2; break; }
        idx = text.lastIndexOf('\n\n', idx - 1);
      }
      if (split > _stableLen) {
        // extend the cached stable prefix to the new boundary
        _stableHtml = AppUICore.renderMarkdown(text.slice(0, split));
        _stableLen = split;
      }
      if (_stableLen > 0) {
        const tail = text.slice(_stableLen);
        p.innerHTML = _stableHtml + AppUICore.renderMarkdown(tail) + (trailing || '');
      } else {
        // no safe boundary yet → full render (short/early stream)
        p.innerHTML = AppUICore.renderMarkdown(text) + (trailing || '');
      }
    }

    // Live ELAPSED-SECONDS ticker on the ⏳ indicator so the user sees how long
    // the turn has been running BEFORE the first token/tool arrives (the
    // "⏳ ..." could otherwise sit silent for many seconds, esp. a cold kiro
    // turn). Ticks the thinking element's text once a second until the first
    // real output (token/tool/final) replaces it; _stopElapsed() clears it.
    let _elapsedTimer = null;
    const _t0 = Date.now();
    function _fmt(ms) { const s = Math.floor(ms / 1000); return s < 60 ? (s + 's') : (Math.floor(s / 60) + 'm ' + (s % 60) + 's'); }
    function _tick() {
      if (!current() || !thinkingEl || !_elapsedTimer) return;
      // only drive the placeholder text (not once real content is in the bubble)
      thinkingEl.textContent = '\u23f3 ' + _fmt(Date.now() - _t0) + '\u2026';
    }
    function _startElapsed() {
      if (_elapsedTimer || !thinkingEl) return;
      _tick();
      _elapsedTimer = setInterval(_tick, 1000);
      timers.add(_elapsedTimer);
    }
    function _stopElapsed(_clearText) {
      if (_elapsedTimer) { clearInterval(_elapsedTimer); timers.delete(_elapsedTimer); _elapsedTimer = null; }
      // Real output is arriving (token / tool / reasoning / final / error): drop
      // the "⏳ Ns…" placeholder TEXT wherever it sits in the bubble. It used to
      // be cleared only before a tool row, so the prose element was appended next
      // to it and a frozen "⏳ 3s…" stayed above the finished answer.
      if (!thinkingEl) return;
      for (const n of Array.from(thinkingEl.childNodes)) {
        if (n.nodeType === 3 && /^\s*\u23f3/.test(n.nodeValue || '')) n.remove();
        else if (n.nodeType === 1 && n.tagName === 'P' && !n.className && /^\s*\u23f3/.test(n.textContent || '')) n.remove();
      }
    }
    // Start immediately — the thinking bubble already exists ("⏳ ...").
    _startElapsed();

    function clearPending() {
      if (renderTimer !== null) {clearTimeout(renderTimer);timers.delete(renderTimer);renderTimer = null;}
      _stopElapsed();
      _endLive();          // the turn is over → drop the running indicator
    }
    function renderFinal(reply) {
      if(!current())return;
      _stopElapsed(); _endLive();
      const p = _proseEl();
      if(p)p.innerHTML=AppUICore.renderMarkdown(reply);
      AppUIChatUI.attachApplyButtons(p||thinkingEl,opts.onApplyCode
        ? code=>{if(current())opts.onApplyCode(code);}
        : undefined);
      try { AppUIChatUI.attachCopyButtons(p||thinkingEl); } catch (_e) {}
      const messages=getMessages();if(messages)messages.scrollTop=messages.scrollHeight;
    }
    function renderError(error,reply,isAbort) {
      if(!current())return;
      _stopElapsed(); _endLive();
      const p = _proseEl();
      if (p) {
        if (reply) {
          p.innerHTML = AppUICore.renderMarkdown(reply + (isAbort ? '\n\n\u23f9 Stopped' : '\n\n\u26a0\ufe0f ' + error.message));
        } else {
          p.textContent = isAbort ? '\u23f9 Stopped' : 'Error: ' + error.message;
        }
      }
    }
    function renderStats(elapsed,toolCount,meta) {
      if(!current())return;
      if (thinkingEl) {
        const statsEl = document.createElement('div');
        statsEl.style.cssText = 'font-size:10px;color:var(--text-muted,#666);padding:4px 0;text-align:right;';
        statsEl.textContent = `${elapsed}s${toolCount ? ` | ${toolCount} tools` : ''}`
          + _AppUIChatStreamView.formatStats(meta);
        statsEl.title = 'Token count is ESTIMATED (~chars/4) unless the backend reports real usage';
        // Optional per-message "details" affordance — only when a caller wires
        // opts.onDetails (the standalone LLM page does; the sidebar does not, so
        // its footer is unchanged). Keeps the details UI in ONE place.
        if (typeof opts.onDetails === 'function') {
          statsEl.appendChild(document.createTextNode(' \u00b7 '));
          const link = document.createElement('a');
          link.href = '#'; link.textContent = 'details';
          link.className = 'ui-chat-details';
          link.style.cssText = 'color:var(--text-muted,#666);text-decoration:underline;cursor:pointer';
          link.addEventListener('click', e => {
            e.preventDefault();
            try { opts.onDetails({elapsed, toolCount, element: thinkingEl}); } catch (_e) {}
          });
          statsEl.appendChild(link);
        }
        thinkingEl.appendChild(statsEl);
      }
    }
    // Render an approve/deny row for a paused write invoke. On a choice, POST
    // {invoke_id, approve} to the confirm endpoint (opts.confirmUrl — a string
    // or ()=>string the surface supplies; else derived from opts.llmUrl). The
    // row disables after a decision; the stream resumes server-side.
    function renderConfirm(payload, opts2) {
      if (!current() || !thinkingEl) return;
      const row = document.createElement('div');
      row.className = 'ai-chat-confirm';
      row.style.cssText = 'margin:4px 0;padding:6px 8px;border:1px solid var(--color-warning,#e0a030);border-radius:4px;background:var(--bg-elevated);font-size:11px';
      const idTxt = (payload && payload.id) || 'a write tool';
      let argsTxt = '';
      try { argsTxt = payload && payload.args ? JSON.stringify(payload.args) : ''; } catch { argsTxt = ''; }
      const head = document.createElement('div');
      head.innerHTML = '⚠ Approve write: <b>' + AppUICore.escHtml(idTxt) + '</b>'
        + (argsTxt ? ' <span style="color:var(--text-muted)">' + AppUICore.escHtml(argsTxt.slice(0, 200)) + '</span>' : '');
      // #1: show the op's dry_run PREVIEW (what the write WOULD do) inside the row
      // so the user decides with the effect in front of them, not just the args.
      // The server pre-fetches it by invoking the op WITHOUT confirm. Collapsed.
      let previewEl = null;
      if (payload && payload.preview != null) {
        previewEl = document.createElement('details');
        previewEl.style.cssText = 'margin:4px 0 0;font-size:10.5px';
        previewEl.open = true;   // show by default so the effect is visible pre-decision
        const sm = document.createElement('summary');
        sm.textContent = 'preview (dry run)';
        sm.style.cssText = 'cursor:pointer;color:var(--text-muted);user-select:none';
        const pre = document.createElement('pre');
        pre.style.cssText = 'white-space:pre-wrap;margin:3px 0 0;padding:4px 6px;background:var(--bg);'
          + 'border:1px solid var(--border);border-radius:4px;max-height:30vh;overflow:auto;color:var(--text-muted)';
        let ptxt = '';
        try { ptxt = typeof payload.preview === 'string' ? payload.preview
                     : JSON.stringify(payload.preview, null, 2); } catch { ptxt = String(payload.preview); }
        pre.textContent = ptxt;
        previewEl.append(sm, pre);
      }
      const btns = document.createElement('div');
      btns.style.cssText = 'display:flex;gap:6px;margin-top:5px';
      const mk = (label, approve, danger) => {
        const b = document.createElement('button'); b.type = 'button'; b.textContent = label;
        b.style.cssText = 'border:1px solid var(--border);border-radius:4px;padding:2px 10px;font-size:11px;cursor:pointer;'
          + (approve ? 'background:var(--color-success,#3ba55d);color:#fff;border-color:transparent'
                     : 'background:transparent;color:var(--text-muted)');
        b.addEventListener('click', async () => {
          btns.querySelectorAll('button').forEach(x => { x.disabled = true; });
          b.textContent = approve ? '✔ Approved' : '✕ Denied';
          let url = '';
          try {
            const cu = opts2 && opts2.confirmUrl;
            url = (typeof cu === 'function') ? cu() : (cu || '');
          } catch { url = ''; }
          if (!url) { try { url = (opts2.llmUrl || '').replace(/\/$/, '') + '/chat/confirm'; } catch { url = ''; } }
          try { await fetch(url, {method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({invoke_id: payload.invoke_id, approve: approve})}); } catch {}
        });
        return b;
      };
      btns.append(mk('Approve', true), mk('Deny', false));
      row.append(head);
      if (previewEl) row.append(previewEl);   // #1: dry_run preview before the buttons
      row.append(btns);
      _sealProse();
      _append(row);
      _setPhase('waiting for your approval');
      const messages = getMessages(); if (messages) messages.scrollTop = messages.scrollHeight;
    }
    return {clearPending,renderFinal,renderError,renderStats,renderConfirm, callbacks: {
      onRetryWait: (attempt) => {
        if (!current()) return;
        _updateThinking('\u27f3 Backend waking up\u2026 (' + (attempt + 1) * 3 + 's)');
      },
      onToken: (token, fullReply) => {
        if (!current()) return;
        _stopElapsed();   // real content arriving → stop the elapsed placeholder
        if (_phase !== 'writing') _setPhase('writing');
        reply = fullReply; onReply(fullReply);
        if (renderTimer === null) {
          renderTimer = setTimeout(() => {
            if (!current()) return;
            timers.delete(renderTimer);
            const p = _proseEl();
            // #26: incremental render (stable prefix cached, only the tail is
            // re-parsed) instead of renderMarkdown(whole reply) every tick —
            // proven identical to the full render (dev/framework/appui/
            // test_incremental_md.cjs, 157/157 streaming steps).
            if (p) _renderIncremental(p, reply.slice(_segStart), '<span style="color:#888"> \u23f3</span>');
            const messages = getMessages(); if (messages) AppUICore.smartScroll(messages);
            renderTimer = null;
          }, 150);
          timers.add(renderTimer);
        }
      },
      onToolCall: (payload) => {
        if (!current()) return;
        _stopElapsed(true);   // a tool row is about to render → stop + clear placeholder
        try {
          const d = JSON.parse(payload);
          // Some transports (e.g. the ai/llm_server app) emit the SAME event name
          // for a tool's RUNNING start and its OK/ERROR completion, carrying a
          // ``status`` field, instead of a separate tool-result event. Detect
          // that SHAPE narrowly — a top-level status of exactly 'ok'/'error' on
          // a {name,args,status} payload with NO gateway ``_meta`` — so the
          // gateway/sidebar path (which uses _meta.kiro + separate tool_result
          // events and never sets a top-level 'ok'/'error' status) is untouched.
          // (the workspace agent says 'completed' / 'failed' for the same thing)
          const st0 = d.status === 'completed' ? 'ok' : d.status === 'failed' ? 'error' : d.status;
          const sysLlmShape = !d._meta && (st0 === 'ok' || st0 === 'error') && (d.name != null);
          const status = sysLlmShape ? st0 : null;
          const sig = (d.name || d.tool || d.toolName || '') + '|' + JSON.stringify(d.args || d.arguments || d.input || {});
          const openEl = status ? _takeOpen(d, sig) : null;
          if (openEl) {
            const out = d.output != null ? d.output : (d.result != null ? d.result : '');
            const ms = (typeof d.ms === 'number') ? d.ms : (openEl._t0 ? Date.now() - openEl._t0 : undefined);
            AppUICore.markToolDone(openEl, out, ms);
            if (status === 'error') openEl.style.borderLeftColor = 'var(--color-error, #d92d3a)';
            if (openEl === currentToolEl) currentToolEl = null;
            if (!openTools.length) _setPhase('thinking');
            return;
          }
          const meta = d._meta && d._meta.kiro ? d._meta.kiro : {};
          const toolName = meta.toolName || d.kind || d.name || d.toolName || d.tool || 'tool';
          const title = d.title || toolName;
          const tid = d.id || d.toolCallId || meta.toolCallId || '';
          const idTag = tid ? ` [#${String(tid).slice(-6)}]` : '';
          const displayName = (toolName !== title ? `${toolName}: ${title}` : title) + idTag;
          const toolArgs = d.rawInput || d.arguments || d.args || d.input || d.parameters || '';
          currentToolEl = AppUICore.createToolStatus(displayName, typeof toolArgs === 'object' ? JSON.stringify(toolArgs, null, 2) : toolArgs);
          currentToolEl._sig = sig;
          currentToolEl._tid = tid;
          currentToolEl._t0 = Date.now();
          if (!status) {
            openTools.push(currentToolEl);
            const shown = (toolArgs && typeof toolArgs === 'object' && toolArgs.id) ? String(toolArgs.id).split('.').slice(-2).join('.') : displayName;
            _setPhase('running ' + String(shown).slice(0, 40));
          }
          // A ai/llm_server tool event that ALREADY carries a terminal status (no
          // preceding running row) renders as a completed row immediately.
          if (status) {
            const out = d.output != null ? d.output : (d.result != null ? d.result : '');
            _sealProse();
            if (_toolsEl()) _append(currentToolEl);
            AppUICore.markToolDone(currentToolEl, out, (typeof d.ms === 'number') ? d.ms : undefined);
            if (status === 'error') currentToolEl.style.borderLeftColor = 'var(--color-error, #d92d3a)';
            currentToolEl = null;
            return;
          }
          if (opts.onToolCall) {
            opts.onToolCall(toolName, typeof toolArgs === 'string' ? JSON.parse(toolArgs) : toolArgs).catch(() => {});
          }
        } catch {
          currentToolEl = AppUICore.createToolStatus('tool', payload);
        }
        { _sealProse(); if (_toolsEl() && currentToolEl) _append(currentToolEl); }
      },
      onToolResult: (payload) => {
        if (!current()) return;
        let d = null;
        try { d = JSON.parse(payload); } catch { d = null; }
        const el = _takeOpen(d && typeof d === 'object' ? d : {}, d && typeof d === 'object' && (d.name || d.tool || d.toolName)
          ? (d.name || d.tool || d.toolName) + '|' + JSON.stringify(d.args || d.arguments || d.input || {}) : '');
        if (el) {
          const ms = (d && typeof d === 'object' && typeof d.ms === 'number') ? d.ms : (el._t0 ? Date.now() - el._t0 : undefined);
          if (d && typeof d === 'object') AppUICore.markToolDone(el, d.result || d.output || d, ms);
          else AppUICore.markToolDone(el, payload, ms);
          if (el === currentToolEl) currentToolEl = null;
          if (!openTools.length) _setPhase('thinking');
        }
      },
      // #2: live reasoning frames → a collapsed strip in arrival sequence.
      onReason: (frag, full) => {
        if (!current() || !thinkingEl) return;
        _stopElapsed();
        if (_phase !== 'thinking') _setPhase('thinking'); else _ensureLive();
        const d = _reasonStrip();
        if (!d) return;
        // prefer the cumulative `full` the engine passes; else append the frag.
        _reasonText = (typeof full === 'string' && full) ? full : (_reasonText + (frag || ''));
        const body = d.querySelector('.ai-chat-reason-body');
        if (body) body.textContent = _reasonText;
        // live progress on the COLLAPSED strip: the latest thinking + its size, so
        // a long think (minutes on a big prompt) is visibly moving
        const sm = d.querySelector('summary');
        if (sm) {
          const tailTxt = _reasonText.replace(/\s+/g, ' ').trim().slice(-90);
          const n = _reasonText.length;
          sm.textContent = '\u{1f4ad} reasoning \u00b7 ' + (n >= 1000 ? (n / 1000).toFixed(1) + 'k' : n) + ' chars \u2014 \u2026' + tailTxt;
          sm.title = 'click to read the full reasoning';
        }
        const messages = getMessages(); if (messages) AppUICore.smartScroll(messages);
      },
    }};
  },

  // Pure formatter for the stats footer's token/throughput suffix (unit-
  // testable). Given {elapsedMs, replyChars, usage?}, returns a string like
  // "  ·  ~420 tok  ·  86 tok/s" (leading separator included) or '' when there's
  // nothing to show. Prefers a backend-reported usage.completion_tokens /
  // output_tokens / total_tokens; otherwise ESTIMATES tokens as ~chars/4.
  formatStats(meta) {
    if (!meta) return '';
    const u = meta.usage || null;
    let tokens = null, estimated = true;
    if (u && typeof u === 'object') {
      const real = u.completion_tokens != null ? u.completion_tokens
        : (u.output_tokens != null ? u.output_tokens
          : (u.total_tokens != null ? u.total_tokens : null));
      if (real != null && isFinite(real)) { tokens = Math.round(real); estimated = false; }
    }
    if (tokens == null) {
      const chars = Number(meta.replyChars || 0);
      if (chars > 0) tokens = Math.max(1, Math.round(chars / 4));
    }
    if (tokens == null) return '';
    const parts = [(estimated ? '~' : '') + tokens + ' tok'];
    const secs = Number(meta.elapsedMs || 0) / 1000;
    if (secs > 0.2 && tokens > 0) {
      const tps = tokens / secs;
      parts.push((tps >= 10 ? Math.round(tps) : tps.toFixed(1)) + ' tok/s');
    }
    return '  \u00b7  ' + parts.join('  \u00b7  ');
  },
};
window._AppUIChatStreamView = _AppUIChatStreamView;
