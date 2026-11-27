/* Message rendering and control ownership for one Chat instance. */
window._AppUIChatHistoryView = {
  create({getMessages, getHistory, isDestroyed, onReplay, onDelete, onRegenerate, onEdit, onContinue, onDetails}) {
    const controls = AppUILifecycle.createKeyedScopes({
      pagehide: false,
      isCurrent: () => !isDestroyed(),
    });
    let _renderSig = null;   // AI_ASSISTANT #15: last-rendered transcript signature

    function attach(element, role, index) {
      if (!controls.current()) return;
      const owner = controls.begin(element), message = getHistory()[index];
      const current = () => owner.current() && getHistory()[index] === message;
      // Regenerate only on the LAST assistant message (re-running a mid-history
      // turn would drop later turns — that's Replay's job). onRegenerate is
      // optional (host may not provide it).
      const hist = getHistory();
      const isLastAssistant = role === 'assistant' && index === hist.length - 1;
      owner.add(AppUIChatUI.attachMessageControls(element, role, message,
        role === 'user' ? () => {if (current()) onReplay(index);} : null,
        () => {if (current()) onDelete(index);},
        (isLastAssistant && typeof onRegenerate === 'function') ? () => {if (current()) onRegenerate();} : null,
        (role === 'user' && typeof onEdit === 'function') ? (newText) => {if (current()) onEdit(index, newText);} : null,
        (isLastAssistant && typeof onContinue === 'function') ? () => {if (current()) onContinue();} : null));
    }

    function add(role, text, historyIndex = null, extra = null, into = null) {
      if (!controls.current()) return null;
      const element = AppUIChatUI.addMessage(into || getMessages(), role, text, extra);
      if (element && historyIndex !== null) attach(element, role, historyIndex);
      // the turn's stats footer, as the live turn rendered it (chat.js stores elapsed_ms / tool_count / usage)
      const m = historyIndex !== null ? getHistory()[historyIndex] : null;
      if (element && m && role === 'assistant' && typeof m.elapsed_ms === 'number') {
        const statsEl = document.createElement('div');
        statsEl.style.cssText = 'font-size:10px;color:var(--text-muted,#666);padding:4px 0;text-align:right;';
        const secs = (m.elapsed_ms / 1000).toFixed(0);
        statsEl.textContent = secs + 's' + (m.tool_count ? ' | ' + m.tool_count + ' tools' : '')
          + (window._AppUIChatStreamView ? window._AppUIChatStreamView.formatStats(
            {elapsedMs: m.elapsed_ms, replyChars: (m.content || '').length, usage: m.usage || null}) : '');
        statsEl.title = 'Token count is ESTIMATED (~chars/4) unless the backend reports real usage';
        if (typeof onDetails === 'function') {
          statsEl.appendChild(document.createTextNode(' \u00b7 '));
          const link = document.createElement('a');
          link.href = '#'; link.textContent = 'details'; link.className = 'ui-chat-details';
          link.style.cssText = 'color:var(--text-muted,#666);text-decoration:underline;cursor:pointer';
          link.addEventListener('click', e => {
            e.preventDefault();
            try { onDetails({elapsed: secs, toolCount: m.tool_count || 0, element, message: m}); } catch (_e) {}
          });
          statsEl.appendChild(link);
        }
        element.appendChild(statsEl);
      }
      return element;
    }

    function clear() {
      if (!controls.current()) return;
      controls.destroyAll();
      getMessages()?.replaceChildren();
      _renderSig = null;   // #15: force the next render() to rebuild
      _shownFrom = 0;
      if (_io) { try { _io.disconnect(); } catch (_e) {} _io = null; }
    }

    // IMPROVEMENTS_NEXT #37: a LONG conversation renders its newest TAIL messages; the older ones render in
    // CHUNK-sized steps when the user scrolls up to the top (or clicks the 'earlier messages' bar)
    const TAIL = 30, CHUNK = 30;
    let _shownFrom = 0, _io = null;
    // MORE_IMPROVEMENTS #19: legacy saved chats have tool_calls with no saved output/result —
    // show a subtle hint instead of a blank result box.
    const _normTools = tcs => Array.isArray(tcs) ? tcs.map(t => (
      t && typeof t === 'object' && t.output == null && t.result == null && !t.error && !t.output_ref
        ? Object.assign({}, t, {output: '(saved before results were kept)'}) : t
    )) : tcs;
    const _extraOf = m => (m.tool_calls || m.reasoning)
      ? {toolCalls: _normTools(m.tool_calls), reasoning: m.reasoning, cacheObj: m} : {cacheObj: m};

    function _moreBar(host) {
      const bar = document.createElement('button');
      bar.type = 'button';
      bar.className = 'tt-ctl ai-chat-more';
      bar.style.cssText = 'align-self:center;font-size:11px;margin:4px 0';
      const paint = () => { bar.textContent = '\u2191 ' + _shownFrom + ' earlier message' + (_shownFrom === 1 ? '' : 's'); };
      paint();
      bar.addEventListener('click', () => _showEarlier(host, bar, paint));
      if ('IntersectionObserver' in window) {
        _io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) _showEarlier(host, bar, paint); },
                                       {root: host, rootMargin: '200px 0px 0px 0px'});
        _io.observe(bar);
      }
      // IMPROVEMENTS_NEXT #17: the browser's find (Ctrl+F / Cmd+F) only searches rendered text - render the
      // whole conversation first (synchronously, before the find bar searches); the key is NOT swallowed
      const onFind = e => {
        if (!bar.isConnected) { document.removeEventListener('keydown', onFind, true); return; }
        if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'f' || e.key === 'F')) {
          while (_shownFrom > 0 && bar.isConnected) _showEarlier(host, bar, paint, true);
          document.removeEventListener('keydown', onFind, true);
        }
      };
      document.addEventListener('keydown', onFind, true);
      _barRef = {bar, paint};
      return bar;
    }

    let _barRef = null;
    /** Render every earlier message now (a search over the transcript needs them in the DOM). */
    function showAll() {
      const host = getMessages();
      if (host && _barRef && _barRef.bar.isConnected) _showEarlier(host, _barRef.bar, _barRef.paint, true);
    }

    function _showEarlier(host, bar, paint, all) {
      if (!controls.current() || _shownFrom <= 0 || !bar.isConnected) return;
      const hist = getHistory();
      const from = all ? 0 : Math.max(0, _shownFrom - CHUNK);
      const tmp = document.createElement('div');
      for (let i = from; i < _shownFrom; i++) add(hist[i].role, hist[i].content, i, _extraOf(hist[i]), tmp);
      const before = host.scrollHeight, top = host.scrollTop;
      const anchor = bar.nextSibling;
      while (tmp.firstChild) host.insertBefore(tmp.firstChild, anchor);
      _shownFrom = from;
      host.scrollTop = top + (host.scrollHeight - before);   // keep the reading position
      if (_shownFrom <= 0) { if (_io) { _io.disconnect(); _io = null; } bar.remove(); } else paint();
    }

    function render() {
      if (!controls.current() || !getMessages()) return;
      // AI_ASSISTANT #15: skip the full clear()+rebuild when the transcript is
      // unchanged since the last render — a cheap signature gate (message count
      // + the last message's role/content length) avoids O(N) DOM teardown +
      // rebuild on a re-render that changed nothing (tab switch, focus, replay
      // of the same history). A real change (add/edit/delete) bumps the
      // signature and falls through to the rebuild. Combined with the #16
      // per-message markdown cache, an actual rebuild also reuses rendered HTML.
      const hist = getHistory();
      let sig = hist.length + '';
      const lastMsg = hist[hist.length - 1];
      if (lastMsg) sig += ':' + lastMsg.role + ':' + ((lastMsg.content || '').length) + ':' + ((lastMsg.reasoning || '').length);
      const host = getMessages();
      const rendered = host.querySelectorAll(':scope > .ai-chat-msg').length;
      if (_renderSig === sig && rendered === hist.length - _shownFrom) return;
      clear();
      const from = hist.length > TAIL + 10 ? hist.length - TAIL : 0;
      if (from > 0) { _shownFrom = from; host.appendChild(_moreBar(host)); }
      for (let i = from; i < hist.length; i++) add(hist[i].role, hist[i].content, i, _extraOf(hist[i]));
      _renderSig = sig;
    }

    return {add, attach, render, clear, showAll, destroy: () => controls.destroy()};
  },
};
