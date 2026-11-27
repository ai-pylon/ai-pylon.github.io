/**
 * Content/Chat  --  LLM conversation engine (main orchestrator).
 * Session management, public API, prompt building.
 * Delegates streaming to AppUIChatStream and UI to AppUIChatUI.
 *
 * Requires: runtime/core.js (AppUICore), chat-stream.js, chat-ui.js, chat-view.js, chat-prompts.js, chat-records.js, chat-storage.js, chat-sessions.js, chat-stream-view.js, chat-history-view.js
 *
 * Usage:
 *   const chat = AppUIChat.create({
 *     container: document.getElementById('chat-area'),
 *     system: 'You are a helpful assistant for ...',
 *     backend: 'kiro',
 *     llmUrl: '/api/llm',
 *     context: () => 'Current state: ...',
 *     tools: [{name:'tool.name', description:'...'}],
 *     onSendStart: () => {},
 *     onSendEnd: (reply) => {},
 *   });
 *   chat.send('Hello');
 *   chat.clear();
 *   chat.getHistory();
 *   chat.setContext(fn);
 */
const AppUIChat = (function() {

  const {mergeDefaultTools:_mergeDefaultTools}=window._AppUIChatPrompts;

  const {messageId:_messageId,message:_historyMessage}=window._AppUIChatRecords;

  // #7: Tab/header running indicator across active top-level turns.
  let _activeTurns = 0;
  const _RUN_PREFIX = '\u23f3 ';
  function _incActiveTurn(container) {
    _activeTurns += 1;
    try {
      if (container && container.classList) container.classList.add('ai-chat-running');
      if (typeof document !== 'undefined' && typeof document.title === 'string'
          && !document.title.startsWith(_RUN_PREFIX)) {
        document.title = _RUN_PREFIX + document.title;
      }
    } catch (_e) {}
  }
  function _decActiveTurn(container) {
    _activeTurns = Math.max(0, _activeTurns - 1);
    try {
      if (container && container.classList) container.classList.remove('ai-chat-running');
      if (_activeTurns === 0 && typeof document !== 'undefined'
          && typeof document.title === 'string' && document.title.startsWith(_RUN_PREFIX)) {
        document.title = document.title.slice(_RUN_PREFIX.length);
      }
    } catch (_e) {}
  }

  // ==========================================================================
  // Main factory: create a chat instance
  // ==========================================================================
  function create(opts) {
    opts = Object.assign({
      llmUrl: window.AI_LLM_URL || '/llm',
      backend: 'kiro',
      model: '',
      system: 'You are a helpful AI assistant.',
      context: null,
      tools: null,
      clipboard: false,
      container: null,
      placeholder: 'Ask AI...',
      onSendStart: null,
      onSendEnd: null,
      onDone: null,
      onSessionChange: null,
    }, opts);

    if (opts.tools) opts.tools = _mergeDefaultTools(opts.tools);

    // State
    let _destroyed = false;
    const _renderTimers = new Set();
    const _conversationVersion = AppUILifecycle.generation();
    let _history = [];
    let _sessionId = null;
    let _conversationId = null;
    let _abortController = null;
    let _container = opts.container;
    let _messagesEl = null;
    let _inputEl = null;
    let _sendBtn = null;
    let _stopBtn = null;
    let _composer = null;
    let _toolDiscoverySteps = 0;
    let _replayContext = null;
    let _isSending = false;
    let _pendingReplayOf = null;
    let _steeringScope = null;

    // Load saved backend/model preferences
    const savedBackend = AppUIStorage.get('ai-chat-backend');
    if (savedBackend) opts.backend = savedBackend;
    const savedModel = AppUIStorage.get('ai-chat-model');
    if (savedModel) opts.model = savedModel;

    const historyView = window._AppUIChatHistoryView.create({
      getMessages: () => _messagesEl, getHistory: () => _history,
      isDestroyed: () => _destroyed, onReplay: replayHistory, onDelete: deleteHistory,
      onRegenerate: regenerate, onEdit: editResend, onContinue: continueTurn,
      onDetails: (typeof opts.onDetails === 'function') ? opts.onDetails : null,
    });
    const {add: _addMsg, attach: _attachHistoryControls, render: _renderHistory} = historyView;

    // --- Render ---
    function _render() {
      if (!_container) return;
      _composer?.destroy();
      if(_stopBtn)_stopBtn.onclick=null;
      const els = AppUIChatUI.renderContainer(_container, opts);
      _messagesEl = els.messagesEl;
      _inputEl = els.inputEl;
      _sendBtn = els.sendBtn;
      _stopBtn = els.stopBtn;
      _composer=AppUIChatView.bind({
        container:_container,messagesElement:_messagesEl,input:_inputEl,sendButton:_sendBtn,
        getDisabled:()=>_destroyed||_isSending,onSend:message=>send(message)
      });
      _stopBtn.onclick = () => cancel();
    }

    function _truncateHistory(index) {
      _invalidateConversation();
      _replayContext = _history.slice(0, index);
      _history = _history.slice(0, index);
      _sessionId = null;
      _saveToStorage();
      _renderHistory();
    }

    function deleteHistory(index) {
      if (!Number.isInteger(index) || index < 0 || index >= _history.length) return;
      _pendingReplayOf = null;
      _truncateHistory(index);
    }

    function replayHistory(index) {
      const message = _history[index];
      if (!message || message.role !== 'user') return;
      _truncateHistory(index);
      _pendingReplayOf = message.id;
      send(message.content);
    }

    // Regenerate the LAST assistant turn: find the user message that produced it
    // and re-run it fresh (drops the stale assistant reply via truncate, same as
    // replay but anchored at the latest exchange). No-op while streaming or when
    // there's no completed user→assistant pair yet.
    function regenerate() {
      if (_destroyed || _isSending || _abortController) return;
      // walk back to the last user message
      let ui = -1;
      for (let i = _history.length - 1; i >= 0; i--) {
        if (_history[i] && _history[i].role === 'user') { ui = i; break; }
      }
      if (ui < 0) return;
      const message = _history[ui];
      _truncateHistory(ui);
      _pendingReplayOf = message.id;
      send(message.content);
    }

    // Edit & resend a prior USER message: truncate the conversation back to that
    // message (dropping it + everything after, same as replay) and send the
    // EDITED text as a fresh turn. No-op while streaming, for a non-user index,
    // or when the edited text is empty (caller should treat empty as cancel).
    function editResend(index, newText) {
      if (_destroyed || _isSending || _abortController) return;
      const message = _history[index];
      if (!message || message.role !== 'user') return;
      const text = String(newText == null ? '' : newText).trim();
      if (!text) return;
      _truncateHistory(index);
      _pendingReplayOf = message.id;
      send(text);
    }

    // Continue a STOPPED/cut turn: the last assistant message was aborted (or
    // errored) with partial text. Resume by asking the model to continue
    // seamlessly from what it already wrote. Model-agnostic (no server resume
    // state): the partial is folded into a continuation prompt. No-op while
    // streaming or when the last turn wasn't cut.
    function continueTurn() {
      if (_destroyed || _isSending || _abortController) return;
      const last = _history[_history.length - 1];
      if (!last || last.role !== 'assistant' || !last.stopped) return;
      const partial = String(last.partial || last.content || '').trim();
      const prompt = partial
        ? ('Continue your previous answer EXACTLY from where it stopped — do not '
           + 'repeat what you already wrote, just carry on seamlessly. What you '
           + 'wrote so far was:\n\n' + partial)
        : 'Continue your previous answer from where it stopped.';
      send(prompt);
    }

    // --- Send message ---
    async function send(customMsg, internal) {
      const generation=_conversationVersion.current();
      const current=()=>!_destroyed&&_conversationVersion.isCurrent(generation);
      if (!current()) return;
      const msg = customMsg || (_inputEl && _inputEl.value.trim());
      if (!msg) return;
      const isTopLevel = !internal;
      if (isTopLevel && _isSending) return;
      if (isTopLevel) { _isSending = true; _incActiveTurn(_container); }
      if (!internal) _toolDiscoverySteps = 0;
      if (_inputEl) _inputEl.value = '';

      if (_sendBtn) _sendBtn.style.display = 'none';
      if (_stopBtn) _stopBtn.style.display = '';

      if (opts.onSendStart) opts.onSendStart(msg);
      if (!current()) return;

      if (!internal) {
        const userMessage = _historyMessage('user', msg, {
          parent_id: _history.at(-1)?.id ?? null,
          replay_of: _pendingReplayOf,
        });
        _pendingReplayOf = null;
        _history.push(userMessage);
        _addMsg('user', msg, _history.length - 1);
        _saveToStorage();
      } else {
        _addMsg('assistant', 'Tool catalog fetched. Selecting the required child tool\u2026');
      }

      // Detect remember command
      const rememberFact = AppUIChatUI.detectRememberCommand(msg);
      if (rememberFact) AppUIChatUI.addMemory(rememberFact, window.location.pathname);

      let thinkingEl=null,streamView=null,reply='';
      const createStreamView=()=>window._AppUIChatStreamView.create({opts,current,thinkingEl,
        getMessages:()=>_messagesEl,timers:_renderTimers,onReply:value=>{reply=value;}});
      try {
        // Build system prompt
        const promptOptions = Object.assign({system: true, tools: true, environment: true, ui: true, user: true}, opts.promptOptions || {});
        const parts = await window._AppUIChatPrompts.resolveParts(opts, {current, question: internal ? '' : msg, transformSystem: system => {
          if (_replayContext?.length) {
            system += '\n\n[Conversation before this replay]\n'
              + _replayContext.map(message => '[' + message.role + '] ' + message.content).join('\n\n');
            _replayContext = null;
          }
          return system;
        }});
        if (!parts || !current()) return;
        const {system, toolPrompt, environmentPrompt} = parts;
        thinkingEl = _addMsg('assistant', '\u23f3 ...');
        if (_abortController) try { _abortController.abort(); } catch {}
        _abortController = new AbortController();
        const t0 = Date.now();
        streamView = createStreamView();

        const reqBody=window._AppUIChatPrompts.buildRequest(opts,{
          msg,system,toolPrompt,environmentPrompt,sessionId:_sessionId,internal,promptOptions
        });
        // Let a caller reshape the request body for its transport (e.g. the
        // ai/llm_server app wants a messages[] array + scope/progressive flags
        // built from the conversation history). Default: no-op.
        if (typeof opts.buildReqBody === 'function') {
          try { opts.buildReqBody(reqBody, {history: _history, msg, opts}); } catch {}
        }

        const streamResult = await AppUIChatStream.streamResponse({
          llmUrl: opts.llmUrl,
          reqBody,
          transport: opts.transport || null,
          abortSignal: _abortController.signal,
          ...streamView.callbacks,
          onMeta: () => {},
          onReason: (frag, full) => {
            // #2: drive the VIEW's live reasoning strip (collapsed, in-sequence
            // above the tool rows) AND forward to a host-provided onReason. The
            // spread above set streamView.callbacks.onReason; call it explicitly
            // here so this override doesn't clobber the live render.
            try { if (streamView.callbacks.onReason) streamView.callbacks.onReason(frag, full); } catch {}
            if (opts.onReason) { try { opts.onReason(frag, full); } catch {} }
          },
          onConfirm: (payload) => {
            // A write invoke is paused for approval. Delegate to a host-provided
            // confirmer if any; else render the built-in approve/deny row.
            try {
              if (typeof opts.onConfirm === 'function') { opts.onConfirm(payload, thinkingEl); return; }
              streamView.renderConfirm(payload, opts);
            } catch {}
          },
          onDone: (sid) => { if (current() && sid) _sessionId = sid; },
          onError: (err) => { if (current() && window.AppUIToast) AppUIToast.error(err); },
        });

        if (!current()) return;
        streamView.clearPending();
        reply = streamResult.reply || reply;
        if (streamResult.sessionId) _sessionId = streamResult.sessionId;

        // Final render
        if (!reply) reply = '(empty response)';
        // Strip recognized ACTION blocks from what the USER SEES and what's
        // STORED (a bare {"action":"page.inspect",…} or fenced action otherwise
        // leaks into the chat as raw JSON). Actions are still DISPATCHED from the
        // RAW reply via onSendEnd below, so the page still performs them.
        const _strip = (window.AppUIChatPanel && window.AppUIChatPanel.stripActions);
        const displayReply = _strip ? (_strip(reply) || '') : reply;
        const shownReply = displayReply || (streamResult.toolCalls && streamResult.toolCalls.length
          ? '' : reply);   // if stripping emptied an action-only reply, show nothing
        streamView.renderFinal(shownReply || '\u2026');

        // Retrieval visibility footer (#9): if any tool this turn returned a
        // `retrieval` block (workspace_rag.ask/.context, kb.*), surface a
        // collapsible per-answer footer below the answer. History re-render
        // rebuilds it from the persisted tool_calls (see chat-ui.addMessage).
        try {
          if (thinkingEl && streamResult.toolCalls && streamResult.toolCalls.length
              && AppUIChatUI.buildRetrievalFooter) {
            const rf = AppUIChatUI.buildRetrievalFooter(streamResult.toolCalls);
            if (rf) thinkingEl.appendChild(rf);
          }
        } catch (_e) {}

        _history.push(_historyMessage('assistant', shownReply, {
          parent_id: _history.at(-1)?.id ?? null,
          // keep the turn's tool calls + the model's reasoning narration so the
          // Message-details view can show them (not just the final answer).
          tool_calls: streamResult.toolCalls || [],
          reasoning: streamResult.reasoning || '',
          usage: streamResult.usage || null,
          round_trace: streamResult.roundTrace || null,
          finish_reason: streamResult.finishReason || '',
          // the stream closed WITHOUT a done frame: the text is a CUT turn, not
          // an answer — mark it so it's resumable and visible when debugging.
          ...(streamResult.truncated ? {
            stopped: true, partial: reply || '',
            error: 'stream ended without a done event (connection dropped / host restarted?)',
          } : {}),
        }));
        if (thinkingEl) {
          _attachHistoryControls(thinkingEl,'assistant',_history.length-1);
        }
        _saveToStorage();

        // Detect AI memory acknowledgement
        AppUIChatUI.detectAIRememberResponse(reply, msg);

        // Detect tool calls in response text
        const toolRun = opts.tools && thinkingEl ? await AppUIChatStream.detectAndRunTools(reply, thinkingEl, opts.tools) : null;
        if (!current()) return;
        if (toolRun?.toolName === 'tool_catalog.fetch' && _toolDiscoverySteps < 3) {
          _toolDiscoverySteps += 1;
          await send(window._AppUIChatPrompts.buildCatalogContinuation(toolRun.result),true);
        }

        // Stats
        const _elapsedMs = Date.now() - t0;
        const elapsed = (_elapsedMs / 1000).toFixed(0);
        const toolCount = (reply.match(/\ud83d\udd27/g) || []).length;
        // persist the footer's inputs on the turn, so a re-render from history (a reload, a server-saved
        // conversation) shows the SAME "28s · ~1520 tok · 54 tok/s" line as the live turn
        try {
          const _am = _history[_history.length - 1];
          if (_am && _am.role === 'assistant' && _am.elapsed_ms == null) {
            _am.elapsed_ms = _elapsedMs; if (toolCount) _am.tool_count = toolCount; _saveToStorage();
          }
        } catch (_e) {}
        // Pass raw timing + reply size (+ any server-reported token usage) so the
        // footer can show an estimated token count + throughput (tok/s). The
        // estimate is ~chars/4 when the backend doesn't report real usage.
        streamView.renderStats(elapsed, toolCount, {
          elapsedMs: _elapsedMs,
          replyChars: (reply || '').length,
          usage: streamResult.usage || null,
        });

        if (current() && opts.onDone) opts.onDone();
        if (current() && opts.onSendEnd) opts.onSendEnd(reply);

      } catch (e) {
        if (!current()) return;
        _clearRenderTimers();
        if(!streamView){thinkingEl=_addMsg('assistant','');streamView=createStreamView();}
        const isAbort = e.name === 'AbortError';
        streamView.renderError(e,reply,isAbort);
        const partialTools = Array.isArray(e && e.toolCalls) ? e.toolCalls : [];
        const partialReason = (e && typeof e.reasoning === 'string') ? e.reasoning : '';
        // #8: append partial Sources footer on Stop/error when retrieval tools already returned
        try {
          if (thinkingEl && partialTools.length && AppUIChatUI.buildRetrievalFooter) {
            const rf = AppUIChatUI.buildRetrievalFooter(partialTools);
            if (rf) thinkingEl.appendChild(rf);
          }
        } catch (_e) {}
        _history.push(_historyMessage('assistant', reply || (isAbort ? '[stopped]' : '[error: ' + e.message + ']'), {
          parent_id: _history.at(-1)?.id ?? null,
          tool_calls: partialTools,
          reasoning: partialReason,
          // mark a CUT turn (stopped by the user, or errored with partial text)
          // so the UI can offer a "Continue" control to resume from the partial.
          stopped: isAbort || !!reply,
          partial: reply || '',
          // keep WHY the turn was cut (persisted by autosave for debugging)
          aborted: isAbort,
          error: isAbort ? '' : String((e && e.message) || e),
        }));
        if (thinkingEl) {
          _attachHistoryControls(thinkingEl,'assistant',_history.length-1);
        }
        _saveToStorage();
      } finally {
        if (isTopLevel) _decActiveTurn(_container);
      }

      if (!current()) return;
      _abortController = null;
      if (isTopLevel) _isSending = false;
      if (_sendBtn) _sendBtn.style.display = '';
      if (_stopBtn) _stopBtn.style.display = 'none';
      if (_inputEl) _inputEl.focus();
    }

    function _clearRenderTimers() {
      _renderTimers.forEach(clearTimeout); _renderTimers.clear();
    }

    function cancel() {
      _steeringScope?.destroy();_steeringScope=null;
      _clearRenderTimers();
      if (_abortController) { _abortController.abort(); _abortController = null; }
    }

    function _invalidateConversation() {
      _conversationVersion.next();
      cancel();
      _isSending=false;
      if(_sendBtn)_sendBtn.style.display='';
      if(_stopBtn)_stopBtn.style.display='none';
    }

    function steerQueue(message) {
      AppUICore.steer.queue(message,{endpoint:`${opts.llmUrl}/${opts.backend || 'kiro'}/chat/steer`});
    }

    function steerInterrupt(message) {
      cancel();
      const generation=_conversationVersion.current();
      const owner=AppUILifecycle.createScope();_steeringScope=owner;
      const timer=AppUICore.steer.interrupt(null,value=>{
        if(owner.destroyed)return;
        owner.destroy();
        if(!_destroyed&&_conversationVersion.isCurrent(generation))send(value);
      },message);
      owner.add(()=>{clearTimeout(timer);if(_steeringScope===owner)_steeringScope=null;});
    }

    function clear() {
      if (_destroyed) return;
      _persistActiveSession();
      _invalidateConversation();
      _history = [];
      _sessionId = null;
      _conversationId = _messageId();
      _replayContext = null;
      _pendingReplayOf = null;
      historyView.clear();
      _saveToStorage();
    }

    // Session persistence is separate from transport and active conversation ownership.
    const sessions=window._AppUIChatSessions.create({options:opts,
      getState:()=>({history:_history,sessionId:_sessionId,conversationId:_conversationId}),
      setState:(state,resetReplay)=>{_history=state.history;_sessionId=state.sessionId;_conversationId=state.conversationId;
        if(resetReplay){_replayContext=null;_pendingReplayOf=null;}},
      setConversationId:id=>{_conversationId=id;},isDestroyed:()=>_destroyed,
      invalidate:_invalidateConversation,render:_renderHistory,
    });
    const {persist:_persistActiveSession,save:_saveToStorage,restore:_loadFromStorage,
      list:getSessions,load:loadSession,clear:clearSessions}=sessions;

    function getHistory() { return _history.slice(); }
    /** Replace the conversation with `messages` ([{role, content, ...}]) - e.g. a server-saved conversation the
     * host loads: the engine history (sent with every next turn) AND the rendered bubbles (with their
     * per-message controls) come back, not just painted HTML. */
    function setHistory(messages) {
      if (_destroyed) return false;
      _persistActiveSession();
      _invalidateConversation();
      const norm = window._AppUIChatRecords.normalizeHistory
        ? window._AppUIChatRecords.normalizeHistory(messages || [])
        : (messages || []).map(m => Object.assign({id: _messageId()}, m));
      _history = norm.filter(m => m && (m.role === 'user' || m.role === 'assistant'));
      _sessionId = null;
      _conversationId = _messageId();
      _replayContext = null;
      _pendingReplayOf = null;
      historyView.clear();
      _saveToStorage();
      _renderHistory();
      return true;
    }
    function exportChat() {
      return _history.map(m => `[${m.role}] ${m.content}`).join('\n\n');
    }

    function setBackend(backend) {
      opts.backend = backend;
      AppUIStorage.set('ai-chat-backend', backend);
    }
    function setModel(model) {
      opts.model = model;
      if (model) AppUIStorage.set('ai-chat-model', model);
      else AppUIStorage.remove('ai-chat-model');
    }
    function getBackend() { return opts.backend; }
    function getModel() { return opts.model; }
    function setLlmUrl(url) {
      if (!url || url === opts.llmUrl) return;
      opts.llmUrl = url.replace(/\/$/, '');
      _sessionId = null;
    }
    function getLlmUrl() { return opts.llmUrl; }

    function setContext(fn) { opts.context = fn; }
    function setSystem(s) { opts.system = s; }
    function setTools(tools) { opts.tools = tools ? _mergeDefaultTools(tools) : null; }
    function setToolGroups(groups) { opts.toolGroups = groups || []; }
    function setPromptOptions(options) { opts.promptOptions = Object.assign({system: true, tools: true, environment: true, ui: true, user: true}, options || {}); }

    // --- Init ---
    if (_container) {
      _render();
      _loadFromStorage();
    }

    function destroy() {
      if (_destroyed) return;
      _destroyed = true;
      _conversationVersion.next();
      cancel();
      historyView.destroy();
      _composer?.destroy();
      _composer=null;
      if (_stopBtn) _stopBtn.onclick = null;
      _container?.replaceChildren();
    }

    // --- Public API ---
    return {
      destroy,
      send,
      cancel,
      clear,
      regenerate,
      editResend,
      continueTurn,
      steerQueue,
      steerInterrupt,
      getHistory,
      setHistory,
      getSessions,
      loadSession,
      clearSessions,
      exportChat,
      setBackend,
      setModel,
      getBackend,
      getModel,
      setLlmUrl,
      getLlmUrl,
      setContext,
      setSystem,
      setTools,
      setToolGroups,
      setPromptOptions,
      async getFullContext() {
        return window._AppUIChatPrompts.preview(opts,()=>({backend:opts.backend,model:opts.model || 'auto',
          sessionId:_sessionId,historyLength:_history.length}));
      },
      get container() { return _container; },
      get input() { return _inputEl; },
      get sessionId() { return _sessionId; },
      get isStreaming() { return _abortController !== null; },
      mount(newContainer) {
        if (_destroyed) return;
        _invalidateConversation();
        _container = newContainer;
        _render();
        _loadFromStorage();
      },
      memory: {
        list: AppUIChatUI.getMemories,
        add: AppUIChatUI.addMemory,
        delete: AppUIChatUI.deleteMemory,
        buildContext: AppUIChatUI.buildMemoryContext,
      },
      checkStatus: AppUIChatUI.checkLLMStatus,
    };
  }

  return { create };
})();
window.AppUIChat = AppUIChat;
