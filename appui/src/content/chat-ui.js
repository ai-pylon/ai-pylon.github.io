/**
 * Content/Chat UI  --  DOM construction, message rendering, input handling.
 * Extracted from chat.js for modularity.
 *
 * Exposes: window.AppUIChatUI
 */
(function() {
  'use strict';

  const {getMemories,addMemory,deleteMemory,buildMemoryContext,detectRememberCommand,detectAIRememberResponse}=window._AppUIChatMemory;

  // rendered-markdown LRU shared by every chat on the page (IMPROVEMENTS_NEXT #37): bounded by entries + chars
  const _mdLru = new Map();
  let _mdLruChars = 0;
  function _mdLruPut(k, html) {
    if (_mdLru.has(k)) { _mdLruChars -= _mdLru.get(k).length; _mdLru.delete(k); }
    _mdLru.set(k, html); _mdLruChars += html.length;
    while (_mdLru.size > 400 || _mdLruChars > 6000000) {
      const first = _mdLru.keys().next().value;
      _mdLruChars -= (_mdLru.get(first) || '').length; _mdLru.delete(first);
    }
  }

  // --- LLM Status Check ---
  function checkLLMStatus(statusEl) {
    if (!statusEl) return;
    fetch('/api/llm/backends', {signal: AbortSignal.timeout(3000)})
      .then(r => r.json())
      .then(data => {
        if (data._error) { statusEl.textContent = '\ud83d\udd34'; statusEl.title = 'LLM: ' + data._error; return; }
        const backends = data.backends || [];
        const available = backends.filter(b => b.available);
        if (available.length > 0) {
          statusEl.textContent = '\ud83d\udfe2';
          statusEl.title = 'LLM: ' + available.map(b => b.name || b.id).join(', ');
        } else {
          statusEl.textContent = '\ud83d\udfe1';
          statusEl.title = 'LLM: backends will start on first use';
        }
      })
      .catch(() => { statusEl.textContent = '\ud83d\udfe1'; statusEl.title = 'LLM: will connect on first use'; });
  }

  // --- DOM Rendering ---

  /**
   * Render the chat container DOM structure.
   * @param {HTMLElement} container
   * @param {object} opts - {placeholder}
   * @returns {{messagesEl, inputEl, sendBtn, stopBtn}}
   */
  function renderContainer(container, opts) {
    container.innerHTML = `
      <div class="ai-chat-messages" style="flex:1;overflow-y:auto;padding:10px;display:flex;flex-direction:column;gap:8px"></div>
      <div class="ai-chat-input-area" style="padding:8px;border-top:1px solid #333;display:flex;gap:6px;align-items:flex-end">
        <textarea class="ai-chat-input" rows="2" placeholder="${AppUITextUtils.esc(opts.placeholder || 'Ask AI...')}"
          style="flex:1;background:var(--bg-elevated,#1a1a2e);color:var(--text-primary,#eee);border:1px solid var(--border,#444);border-radius:4px;padding:6px 8px;font-size:12px;resize:vertical;font-family:system-ui;min-height:36px;max-height:200px"></textarea>
        <button class="ai-chat-send" style="background:#4caf50;color:#fff;border:none;border-radius:4px;padding:6px 12px;font-size:12px;cursor:pointer;white-space:nowrap">Send</button>
        <button class="ai-chat-stop" style="display:none;background:#f44;color:#fff;border:none;border-radius:4px;padding:6px 10px;font-size:12px;cursor:pointer">\u23f9</button>
      </div>`;
    return {
      messagesEl: container.querySelector('.ai-chat-messages'),
      inputEl: container.querySelector('.ai-chat-input'),
      sendBtn: container.querySelector('.ai-chat-send'),
      stopBtn: container.querySelector('.ai-chat-stop'),
    };
  }

  /**
   * Add a message element to the messages container.
   * @param {HTMLElement} messagesEl
   * @param {string} role - 'user' or 'assistant'
   * @param {string} text
   * @returns {HTMLElement} the created message div
   */
  function addMessage(messagesEl, role, text, extra) {
    if (!messagesEl) return null;
    const div = document.createElement('div');
    div.style.cssText = `font-size:12px;line-height:1.5;padding:8px 10px;border-radius:6px;max-width:90%;word-wrap:break-word;${
      role === 'user' ? 'background:var(--bg-active,#1a3a5c);align-self:flex-end;white-space:pre-wrap;' : 'background:var(--bg-elevated,#2a2a3a);align-self:flex-start;'
    }`;
    div.className = 'ai-chat-msg ai-chat-msg-' + role;
    if (role === 'user') {
      div.textContent = text;
    } else {
      // Rebuild the SAME two-region structure the live turn produced, so a
      // re-render from history (session load/replay/new-chat) KEEPS the precious
      // tool-call rows + reasoning instead of flattening to just the answer.
      const tools = extra && Array.isArray(extra.toolCalls) ? extra.toolCalls : null;
      const reasoning = extra && extra.reasoning ? String(extra.reasoning) : '';
      // AI_ASSISTANT #16: memoize the rendered-markdown HTML on the message
      // object (extra.cacheObj) so a re-render (session load / reopen) reuses it
      // instead of re-running renderMarkdown for every assistant message — the
      // 2-3KB MOC answers were re-parsed on every history render. Keyed by the
      // exact (reasoning+text) source so an edit invalidates it.
      const cacheObj = extra && extra.cacheObj ? extra.cacheObj : null;
      const renderMd = (src, key) => {
        if (cacheObj && cacheObj['_html_' + key + 'Src'] === src && typeof cacheObj['_html_' + key] === 'string') return cacheObj['_html_' + key];
        // IMPROVEMENTS_NEXT #37: a page-wide LRU keyed by the exact source survives a history RE-LOAD (new message
        // objects), so reopening a conversation does not re-run renderMarkdown for every answer
        const lk = key + '\u0000' + (src || '');
        let html = _mdLru.get(lk);
        if (html === undefined) {
          html = AppUICore.renderMarkdown(src || '');
          _mdLruPut(lk, html);
        }
        if (cacheObj) { cacheObj['_html_' + key + 'Src'] = src; cacheObj['_html_' + key] = html; }
        return html;
      };
      if ((tools && tools.length) || reasoning) {
        // Reconstruct the turn in its NATURAL ORDER: the model's REASONING
        // narration first, then the tool-status rows it drove, then the final
        // ANSWER — instead of forcing all tool rows above all text. (The live
        // stream interleaves by true arrival order; a persisted message only
        // stores {reasoning, tool_calls, content} without per-event ordering, so
        // this reason→tools→answer sequence is the faithful reconstruction.)
        if (reasoning) {
          const r = document.createElement('div');
          r.className = 'ai-chat-prose ai-chat-reasoning';
          r.innerHTML = renderMd(reasoning.trim(), 'reason');
          div.appendChild(r);
        }
        if (tools && tools.length) {
          const tbox = document.createElement('div');
          tbox.className = 'ai-chat-tools';
          // AI_ASSISTANT #3: collapse consecutive identical (name,args) tool
          // calls — a retry-happy turn (CgSwitch showed the same call repeated)
          // otherwise renders N near-identical rows. Fold them into one row with
          // an attempt count; keep the LAST call's status/output.
          const collapsed = [];
          tools.forEach(tc => {
            const nm = (tc && (tc.name || tc.tool || tc.id)) || 'tool';
            const a = tc && (tc.args != null ? tc.args : tc.arguments);
            let aKey; try { aKey = typeof a === 'object' ? JSON.stringify(a) : String(a == null ? '' : a); } catch { aKey = ''; }
            const key = nm + '|' + aKey;
            const last = collapsed[collapsed.length - 1];
            if (last && last.key === key) { last.count++; last.tc = tc; }
            else collapsed.push({key, tc, name: nm, args: a, count: 1});
          });
          collapsed.forEach(entry => {
            const tc = entry.tc;
            const label = entry.count > 1 ? (entry.name + ' \u00d7' + entry.count) : entry.name;
            const row = AppUICore.createToolStatus(label, entry.args != null ? (typeof entry.args === 'object' ? JSON.stringify(entry.args, null, 2) : entry.args) : '');
            // replayed rows: the RECORDED duration (tool_calls[].ms), or none — never the replay's own ~0ms
            const ms = (tc && typeof tc.ms === 'number') ? tc.ms : null;
            if (tc && (tc.status === 'ok' || tc.status == null)) AppUICore.markToolDone(row, tc.output, ms);
            else if (tc && tc.status === 'error') { AppUICore.markToolDone(row, tc.output, ms); row.style.borderLeftColor = 'var(--color-error, #d92d3a)'; }
            else AppUICore.markToolDone(row, undefined, ms);
            if (tc && tc.output_truncated) _fullOutputControl(row, tc);
            tbox.appendChild(row);
          });
          div.appendChild(tbox);
        }
        const prose = document.createElement('div');
        prose.className = 'ai-chat-prose';
        prose.innerHTML = renderMd(text || '', 'answer');
        div.appendChild(prose);
      } else {
        div.innerHTML = renderMd(text || '', 'answer');
      }
      // Retrieval visibility footer (#9): reconstruct it from the persisted
      // tool_calls so it survives a session reload / replay, same as tool rows.
      try {
        const rf = tools && tools.length ? buildRetrievalFooter(tools) : null;
        if (rf) div.appendChild(rf);
      } catch (_e) {}
    }
    messagesEl.appendChild(div);
    // Re-attach per-code-block Copy on a history/replay re-render (the live turn
    // gets it via renderFinal; a reloaded assistant message otherwise had none).
    if (role !== 'user') { try { attachCopyButtons(div); } catch (_e) {} }
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
  }

  /**
   * Attach message controls (replay, delete, timestamp) to a message element.
   */
  function attachMessageControls(messageEl, role, message, onReplay, onDelete, onRegenerate, onEdit, onContinue) {
    const scope = AppUILifecycle.createScope();
    const controls = document.createElement('div');
    controls.style.cssText = 'display:flex;gap:4px;margin-top:6px;justify-content:flex-end';
    const button = (label, title, handler) => {
      const item = document.createElement('button');
      item.type = 'button'; item.textContent = label; item.title = title;
      item.style.cssText = 'border:0;background:transparent;color:var(--text-muted,#aaa);font-size:10px;padding:1px 3px;cursor:pointer';
      scope.listen(item, 'click', handler);
      controls.appendChild(item);
    };
    if (role === 'user' && onReplay) button('Replay', 'Start again from this message', onReplay);
    // Edit & resend (user messages): turn the bubble into an editable field with
    // Save/Cancel; Save re-runs the conversation from this point with the edited
    // text (onEdit(newText)). The original text is restored on Cancel.
    if (role === 'user' && onEdit) {
      button('Edit', 'Edit this message and resend', () => {
        if (messageEl.querySelector('.ai-chat-edit-box')) return;   // already editing
        const original = (message && typeof message.content === 'string') ? message.content : (messageEl.textContent || '');
        const box = document.createElement('div');
        box.className = 'ai-chat-edit-box';
        box.style.cssText = 'display:flex;flex-direction:column;gap:4px;margin-top:4px';
        const ta = document.createElement('textarea');
        ta.value = original;
        // #3: cap the height + scroll so editing a LONG user message doesn't push
        // the Save/Cancel controls offscreen (was min-height only + resize:vertical,
        // so a big prompt expanded the box unbounded). max-height + overflow-y keeps
        // the controls reachable; auto-size to content up to the cap on open/input.
        ta.style.cssText = 'width:100%;min-height:48px;max-height:40vh;overflow-y:auto;font:inherit;font-size:12px;resize:vertical;background:var(--bg-elevated,#1a1a2e);color:var(--text-primary,#eee);border:1px solid var(--border,#444);border-radius:4px;padding:4px 6px;box-sizing:border-box';
        const _autosize = () => {
          // grow to fit content but never beyond the CSS max-height (then scroll).
          ta.style.height = 'auto';
          const max = Math.round(window.innerHeight * 0.4);
          ta.style.height = Math.min(ta.scrollHeight, max) + 'px';
        };
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:6px;justify-content:flex-end';
        const mk = (label, primary, fn) => {
          const b = document.createElement('button'); b.type = 'button'; b.textContent = label;
          b.style.cssText = 'border:1px solid var(--border,#444);border-radius:4px;padding:2px 10px;font-size:11px;cursor:pointer;'
            + (primary ? 'background:var(--color-info,#4caf50);color:#fff;border-color:transparent' : 'background:transparent;color:var(--text-muted,#aaa)');
          scope.listen(b, 'click', fn); return b;
        };
        const restore = () => { try { box.remove(); } catch (_e) {} };
        row.appendChild(mk('Cancel', false, restore));
        row.appendChild(mk('Save & resend', true, () => {
          const next = ta.value.trim();
          restore();
          if (next) onEdit(next);
        }));
        box.appendChild(ta); box.appendChild(row);
        messageEl.appendChild(box);
        // #3: auto-size to content (capped) on open + as the user types/edits.
        scope.listen(ta, 'input', _autosize);
        // Ctrl/Cmd+Enter in the edit box = Save; Esc = Cancel.
        scope.listen(ta, 'keydown', (e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); const n = ta.value.trim(); restore(); if (n) onEdit(n); }
          else if (e.key === 'Escape') { e.preventDefault(); restore(); }
        });
        ta.focus();
        _autosize();   // size to the existing content now that it's in the DOM
      });
    }
    if (role === 'assistant' && onRegenerate) button('\u21bb Regenerate', 'Re-run the prompt for a fresh answer', onRegenerate);
    // Continue a stopped/cut turn (only when the message carries a stopped flag).
    if (role === 'assistant' && onContinue && message && message.stopped) {
      button('\u25b6 Continue', 'Resume this answer from where it stopped', onContinue);
    }
    // Per-message plain Copy — copies the message's rendered text to the
    // clipboard (reuses the shared AppUICore.copyText). Always available on both
    // roles; shows a brief "✔" confirmation.
    button('Copy', 'Copy this message to the clipboard', (ev) => {
      let text = '';
      try { text = (message && typeof message.content === 'string') ? message.content : (messageEl.innerText || ''); } catch (_e) { text = messageEl.innerText || ''; }
      try { AppUICore.copyText(text); } catch (_e) {}
      try { const b = ev && ev.currentTarget; if (b) { const p = b.textContent; b.textContent = '\u2714'; setTimeout(() => { b.textContent = p; }, 1200); } } catch (_e) {}
    });
    if (onDelete) button('Delete', 'Delete this message and later messages', onDelete);
    if (message?.timestamp) {
      const timestamp = document.createElement('time');
      timestamp.dateTime = message.timestamp;
      timestamp.textContent = new Date(message.timestamp).toLocaleString();
      timestamp.style.cssText = 'margin-right:auto;color:var(--text-muted,#aaa);font-size:9px';
      controls.prepend(timestamp);
    }
    messageEl.appendChild(controls);
    scope.add(() => controls.remove());
    return scope;
  }

  /**
   * Attach "Apply" buttons to code blocks in a message.
   */
  // A restored tool row whose output was TRUNCATED when the conversation was saved (IMPROVEMENTS_NEXT #6): a
  // "Show full output" control that asks the HOST for it with a bubbling 'appui:chat-tool-full' event
  // {ref, chars, tool, done(text|null, note)} - the host that stores the conversation answers (the Workspace keeps
  // full outputs in its side store); with no host listener the row says it was truncated when saved.
  function _fullOutputControl(row, tc) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tt-ctl ai-tool-full';
    b.style.cssText = 'margin:2px 0 0;font-size:10px';
    b.textContent = 'Show full output' + (tc.output_chars ? ' (' + tc.output_chars + ' chars)' : '');
    b.title = 'The output was shortened when this conversation was saved';
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const detail = {ref: tc.output_ref || null, chars: tc.output_chars || null, tool: tc.name || tc.tool || '',
                      handled: false,
                      done: (text, note) => {
                        if (text) { AppUICore.markToolDone(row, text, null); b.remove(); }
                        else { b.disabled = true; b.textContent = note || 'Full output not kept - truncated when saved'; }
                      }};
      b.disabled = true; b.textContent = 'Loading full output…';
      row.dispatchEvent(new CustomEvent('appui:chat-tool-full', {bubbles: true, detail}));
      if (!detail.handled) detail.done(null, detail.ref ? 'Full output not available here' :
                                      'Full output not kept - truncated when saved');
    });
    row.appendChild(b);
  }

  function attachApplyButtons(messageEl, onApplyCode) {
    if (!messageEl || !onApplyCode) return;
    messageEl.querySelectorAll('pre').forEach(pre => {
      const code = pre.querySelector('code') || pre;
      const btn = document.createElement('button');
      btn.textContent = '\ud83d\udccb Apply';
      btn.title = 'Apply this code to the current file';
      btn.style.cssText = 'position:absolute;top:2px;right:2px;border:1px solid var(--border);background:var(--bg-elevated);color:var(--text-muted);padding:1px 6px;border-radius:3px;font-size:9px;cursor:pointer;opacity:0.7';
      btn.addEventListener('mouseenter', () => { btn.style.opacity = '1'; });
      btn.addEventListener('mouseleave', () => { btn.style.opacity = '0.7'; });
      btn.addEventListener('click', () => { onApplyCode(code.textContent); });
      pre.style.position = 'relative';
      pre.appendChild(btn);
    });
  }

  /**
   * Attach a "📋 Copy" button to every code block in a message (plain copy to
   * clipboard — always available, independent of the host's Apply wiring). When
   * an Apply button is also present it sits to its LEFT so they don't overlap.
   * Idempotent: a block already carrying a copy button is skipped (safe to call
   * from both the live renderFinal and a history re-render).
   */
  function attachCopyButtons(messageEl) {
    if (!messageEl) return;
    messageEl.querySelectorAll('pre').forEach(pre => {
      if (pre.querySelector('.ai-chat-copy-code')) return;   // already attached
      const code = pre.querySelector('code') || pre;
      const btn = document.createElement('button');
      btn.className = 'ai-chat-copy-code';
      btn.textContent = '\ud83d\udccb Copy';
      btn.title = 'Copy this code block';
      // offset further right when an Apply button shares the corner
      const hasApply = !!pre.querySelector('button[title="Apply this code to the current file"]');
      btn.style.cssText = 'position:absolute;top:2px;right:' + (hasApply ? '60px' : '2px')
        + ';border:1px solid var(--border);background:var(--bg-elevated);color:var(--text-muted);padding:1px 6px;border-radius:3px;font-size:9px;cursor:pointer;opacity:0.7;z-index:1';
      btn.addEventListener('mouseenter', () => { btn.style.opacity = '1'; });
      btn.addEventListener('mouseleave', () => { btn.style.opacity = '0.7'; });
      btn.addEventListener('click', () => {
        try { AppUICore.copyText(code.textContent); } catch (_e) {}
        const prev = btn.textContent; btn.textContent = '\u2714 Copied';
        setTimeout(() => { btn.textContent = prev; }, 1200);
      });
      pre.style.position = 'relative';
      pre.appendChild(btn);
    });
  }

  // --- Retrieval visibility footer (RAG #16 / session #9) -----------------
  // A RAG tool (workspace_rag.ask / .context, kb.* …) returns a `retrieval`
  // block summarizing what was searched. Surface it as a collapsible per-answer
  // footer so the user can see the namespaces hit, which legs ran, per-leg
  // latency, and any "source skipped" note — WITHOUT expanding the raw tool row.
  // Pure + defensive: returns null when no tool output carried a retrieval block.
  function _extractRetrievals(toolCalls) {
    if (!Array.isArray(toolCalls) || !toolCalls.length) return [];
    const out = [];
    toolCalls.forEach(tc => {
      // #30: a transport may carry the retrieval block DIRECTLY on the tool
      // record ({retrieval, citations}) — e.g. the workspace EricAI chat, whose
      // `output` is a capped (often truncated) text summary.
      if (tc && tc.retrieval && typeof tc.retrieval === 'object') {
        const cites = (Array.isArray(tc.citations) ? tc.citations : [])
          .filter(p => p && (p.file || p.uri || p.path));
        out.push({tool: (tc.name || tc.tool || tc.toolName || 'tool'), r: tc.retrieval, cites});
        return;
      }
      let o = tc && (tc.output != null ? tc.output : tc.result);
      if (o == null) return;
      if (typeof o === 'string') { try { o = JSON.parse(o); } catch { return; } }
      if (o && typeof o === 'object' && o.retrieval && typeof o.retrieval === 'object') {
        // NEXT5 #12: also carry the turn's CITATIONS (passages → sources) so the
        // footer can offer per-citation open-at-line links.
        const cites = (Array.isArray(o.passages) && o.passages.length ? o.passages
                       : (Array.isArray(o.sources) ? o.sources : []))
          .filter(p => p && (p.file || p.uri || p.path));
        out.push({tool: (tc.name || tc.tool || tc.toolName || 'tool'), r: o.retrieval, cites});
      }
    });
    return out;
  }

  // NEXT5 #12: a `skipped` entry is an OBJECT {leg, reason, repos|providers|
  // targets} — render it as "leg (reason)" (it used to print [object Object]).
  function _skipLabel(s) {
    if (s == null) return '';
    if (typeof s !== 'object') return String(s);
    const who = s.repos || s.providers || s.targets;
    return (s.leg || 'leg') + (Array.isArray(who) && who.length ? ' [' + who.join(', ') + ']' : '')
      + (s.reason ? ' \u2014 ' + s.reason : '');
  }

  // NEXT5 #12: citation links. Each is an <a class="ai-chat-cite"> carrying
  // data-rel/data-path/data-line/data-uri; a click dispatches a BUBBLING
  // 'appui:chat-cite' CustomEvent {rel,path,line,uri,title} so the HOST page
  // opens it its own way (the shared runtime never calls page code). With no
  // host listener the click is a no-op beyond the event.
  function _citeLinks(cites, esc) {
    if (!cites || !cites.length) return '';
    const seen = new Set();
    const parts = [];
    cites.forEach((c, i) => {
      const rel = c.file || '';
      const key = (c.uri || rel || c.path || '') + '#' + (c.line || '');
      if (seen.has(key) || parts.length >= 8) return;
      seen.add(key);
      const n = c.n || (i + 1);
      const label = (rel || c.uri || c.path || '') + (c.line ? ':' + c.line : '');
      parts.push('<a href="#" class="ai-chat-cite" title="' + esc(c.title || label) + '"'
        + ' data-rel="' + esc(rel) + '" data-path="' + esc(c.path || '') + '"'
        + ' data-uri="' + esc(c.uri || '') + '"' + (c.line ? ' data-line="' + esc(String(c.line)) + '"' : '')
        + ' style="color:var(--accent,#4c8bf5);text-decoration:none">[' + esc(String(n)) + '] '
        + esc(label) + '</a>');
    });
    return parts.length ? '<span class="rtv-cites">sources: ' + parts.join(' \u00b7 ') + '</span>' : '';
  }

  function _wireCites(root) {
    root.querySelectorAll('a.ai-chat-cite').forEach(a => {
      a.addEventListener('click', ev => {
        ev.preventDefault();
        const d = {rel: a.getAttribute('data-rel') || '', path: a.getAttribute('data-path') || '',
                   uri: a.getAttribute('data-uri') || '', line: a.getAttribute('data-line') || '',
                   title: a.getAttribute('title') || ''};
        try { a.dispatchEvent(new CustomEvent('appui:chat-cite', {detail: d, bubbles: true})); } catch (_e) {}
      });
    });
  }

  function buildRetrievalFooter(toolCalls) {
    const rets = _extractRetrievals(toolCalls);
    if (!rets.length) return null;
    const esc = AppUICore.escHtml;
    const det = document.createElement('details');
    det.className = 'ai-chat-retrieval';
    det.style.cssText = 'margin:4px 0 0;font-size:10px;color:var(--text-muted,#888)';
    const sum = document.createElement('summary');
    sum.style.cssText = 'cursor:pointer;color:var(--text-muted,#888);user-select:none';
    // Compact one-line summary: total passages + namespaces searched.
    const totalPassages = rets.reduce((n, x) => n + (Number(x.r.passages) || 0), 0);
    const allNs = [];
    rets.forEach(x => (x.r.namespaces || []).forEach(n => { if (allNs.indexOf(n) < 0) allNs.push(n); }));
    const nsLabel = allNs.length ? allNs.slice(0, 3).join(', ') + (allNs.length > 3 ? ' +' + (allNs.length - 3) : '') : '(none)';
    sum.textContent = '\u2609 retrieval \u00b7 ' + totalPassages + ' passage' + (totalPassages === 1 ? '' : 's') + ' \u00b7 ' + nsLabel;
    det.appendChild(sum);
    const body = document.createElement('div');
    body.className = 'ai-chat-retrieval-body';
    body.style.cssText = 'margin:3px 0 0 8px;padding-left:8px;border-left:2px solid var(--border,#444);line-height:1.5';
    rets.forEach(({tool, r, cites}) => {
      const rows = [];
      if (tool) rows.push('<b>' + esc(tool) + '</b>' + (r.mode ? ' <span class="rtv-mode">' + esc(String(r.mode)) + '</span>' : ''));
      if (r.namespaces && r.namespaces.length) rows.push('searched: ' + esc(r.namespaces.join(', ')));
      if (r.code_route) rows.push('code route: ' + esc(typeof r.code_route === 'object'
        ? ((r.code_route.code ? 'on' : 'off') + (r.code_route.reason ? ' (' + r.code_route.reason + ')' : ''))
        : String(r.code_route)));
      // NEXT5 #12: the provider + mkdoc legs (what else was consulted).
      if (Array.isArray(r.providers) && r.providers.length) {
        rows.push('<span class="rtv-providers">providers: ' + esc(r.providers.join(', '))
          + (r.provider_hits != null ? ' (' + r.provider_hits + ' hit' + (r.provider_hits === 1 ? '' : 's') + ')' : '') + '</span>');
      }
      if (Array.isArray(r.mkdoc_targets) && r.mkdoc_targets.length) {
        rows.push('<span class="rtv-mkdoc">mkdoc: ' + esc(r.mkdoc_targets.join(', '))
          + (r.mkdoc_hits != null ? ' (' + r.mkdoc_hits + ' ref' + (r.mkdoc_hits === 1 ? '' : 's') + ')' : '') + '</span>');
      }
      if (r.remote_code_links) rows.push('remote code links: ' + esc(String(r.remote_code_links)));
      const legs = [];
      if (r.passages != null) legs.push(r.passages + ' passage' + (r.passages === 1 ? '' : 's'));
      if (r.structural_sources) legs.push(r.structural_sources + ' structural');
      if (r.code_spans) legs.push(r.code_spans + ' code span' + (r.code_spans === 1 ? '' : 's'));
      if (r.multi_query === false) legs.push('single-query');
      if (legs.length) rows.push(legs.join(' \u00b7 '));
      const t = r.timings_ms;
      if (t && typeof t === 'object') {
        const parts = Object.keys(t).filter(k => (Number(t[k]) || 0) > 0).map(k => esc(k) + ' ' + Math.round(Number(t[k])) + 'ms');
        if (parts.length) rows.push('<span class="rtv-timings">' + parts.join(' \u00b7 ') + '</span>');
      }
      // "source skipped" notes — a leg explicitly reported as not run.
      if (Array.isArray(r.skipped) && r.skipped.length) {
        rows.push('<span class="rtv-skipped">skipped: ' + esc(r.skipped.map(_skipLabel).join('; ')) + '</span>');
      }
      const cl = _citeLinks(cites, esc);
      if (cl) rows.push(cl);
      const blk = document.createElement('div');
      blk.className = 'ai-chat-retrieval-item';
      blk.style.cssText = 'margin:0 0 4px';
      blk.innerHTML = rows.join('<br>');
      body.appendChild(blk);
    });
    det.appendChild(body);
    _wireCites(det);
    return det;
  }

  window.AppUIChatUI = {
    // Memory
    getMemories,
    addMemory,
    deleteMemory,
    buildMemoryContext,
    detectRememberCommand,
    detectAIRememberResponse,
    // LLM status
    checkLLMStatus,
    // DOM
    renderContainer,
    addMessage,
    buildRetrievalFooter,
    attachMessageControls,
    attachApplyButtons,
    attachCopyButtons,
  };
})();
