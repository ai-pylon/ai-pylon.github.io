/* Transcript and composer for pages with their own conversation transport. */
const AppUIChatView = (() => {
  const bindings = new WeakMap();
  const esc = value => AppUITextUtils.esc(value ?? '');

  function inactive(options = {}) {
    return {
      input: options.input ?? null,
      messagesElement: options.messagesElement ?? null,
      sendButton: options.sendButton ?? null,
      composerElement: options.composerElement ?? null,
      send() {}, setMessages() {}, setBusy() {}, setDisabled() {}, destroy() {},
    };
  }

  function renderMessages(messages = [], {assistantLabel = 'Assistant', emptyText = 'Start a conversation…', markdown = false} = {}) {
    if (!messages.length) return '<div class="ui-chat-empty" style="color:var(--text-muted);font-size:10px;padding:8px">' + esc(emptyText) + '</div>';
    return messages.map(message => {
      const content = message.content ?? message.text ?? '';
      const text = markdown && message.role === 'assistant' ? AppUICore.renderMarkdown(String(content)) : esc(content);
      if (message.role === 'user' || message.role === 'assistant') {
        const user = message.role === 'user';
        return '<div class="ui-chat-message ui-chat-message-' + message.role + '" style="margin:6px 0;padding:6px 8px;border-radius:var(--radius-md);background:' + (user ? 'var(--bg-active)' : 'var(--bg-elevated)') + ';border:1px solid var(--border)"><div style="font-size:9px;color:' + (user ? 'var(--accent)' : 'var(--text-muted)') + ';margin-bottom:2px">' + esc(user ? 'You' : assistantLabel) + '</div><div style="font-size:11px;color:var(--text-primary);white-space:' + (!user && markdown ? 'normal' : 'pre-wrap') + ';line-height:1.5">' + text + '</div></div>';
      }
      if (message.role === 'ambiguity') return '<div class="ui-chat-message ui-chat-message-ambiguity" style="margin:4px 0;padding:5px 8px;border:1px solid var(--color-warning);border-radius:var(--radius-sm)"><span class="appui-badge warning" style="font-size:9px;margin-right:4px">⚠ ambiguity</span><span style="font-size:10px;color:var(--text-secondary)">' + text + '</span></div>';
      return '<div class="ui-chat-message ui-chat-message-system" style="margin:4px 0;font-size:10px;color:var(--text-muted);font-style:italic;padding:2px 8px">' + text + '</div>';
    }).join('');
  }

  function bind(options = {}) {
    const {container, messagesElement, input, sendButton} = options;
    if (!container || !input || !sendButton) throw new Error('ChatView requires a container, input and send button');
    if (options.signal?.aborted) return inactive(options);
    bindings.get(container)?.destroy();
    const scope = AppUILifecycle.createScope();
    let busy = false, disabled = !!options.disabled;
    const initialInputDisabled = input.disabled, initialSendDisabled = sendButton.disabled;
    const unavailable = () => scope.destroyed || busy || disabled || !!options.getDisabled?.();
    function syncControls() { input.disabled = busy || disabled; sendButton.disabled = busy || disabled; }

    // --- Shared ArrowUp/ArrowDown recall of previously SENT user messages -----
    // A per-instance ring of what the user actually sent through this composer.
    // ArrowUp (caret at the very start, or while already recalling) walks BACK
    // through history; ArrowDown walks FORWARD. Editing resets the position; a
    // half-typed draft is preserved so ArrowDown past the newest restores it.
    // Opt-in-safe: on by default, disabled with options.recall === false. Enter
    // / Shift+Enter behaviour is untouched.
    const recallEnabled = options.recall !== false;
    const _recall = [];          // oldest -> newest sent messages
    let _recallPos = -1;         // -1 = not recalling (live draft); else index into _recall
    let _recallDraft = null;     // the half-typed message stashed when recall began
    const RECALL_MAX = 200;
    function pushRecall(text) {
      text = String(text ?? '').trim();
      if (!text) return;
      if (_recall[_recall.length - 1] !== text) _recall.push(text);
      if (_recall.length > RECALL_MAX) _recall.splice(0, _recall.length - RECALL_MAX);
      _recallPos = -1; _recallDraft = null;   // a fresh send resets the walk
    }
    function recallReset() { _recallPos = -1; _recallDraft = null; }
    function applyRecall(value) {
      input.value = value;
      // caret to end so the next ArrowUp doesn't immediately step again
      try { const n = value.length; input.setSelectionRange(n, n); } catch (_e) {}
    }
    function recallPrev() {               // ArrowUp -> older
      if (!_recall.length) return false;
      if (_recallPos === -1) { _recallDraft = input.value; _recallPos = _recall.length; }
      if (_recallPos <= 0) { _recallPos = 0; }
      else _recallPos -= 1;
      applyRecall(_recall[_recallPos]);
      return true;
    }
    function recallNext() {               // ArrowDown -> newer
      if (_recallPos === -1) return false;   // not recalling: let the caret move
      if (_recallPos >= _recall.length - 1) {   // past the newest: restore the draft
        _recallPos = -1;
        applyRecall(_recallDraft != null ? _recallDraft : '');
        _recallDraft = null;
      } else {
        _recallPos += 1;
        applyRecall(_recall[_recallPos]);
      }
      return true;
    }

    function send(text = input.value) {
      if (unavailable()) return;
      text = String(text ?? '').trim();
      if (!text) return;
      if (recallEnabled) pushRecall(text);
      if (options.clearOnSend !== false) input.value = '';
      return options.onSend?.(text, api);
    }
    const submit = () => Promise.resolve().then(() => send()).catch(error => {
      if (scope.destroyed) return;
      if (options.onError) options.onError(error);
      else window.AppUIToast?.error?.(error.message || String(error));
    });
    scope.listen(sendButton, 'click', submit);
    scope.listen(input, 'keydown', event => {
      // Recall first (ArrowUp/ArrowDown) — never interferes with Enter.
      if (recallEnabled && !event.shiftKey && !event.isComposing && !unavailable()
          && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        const caretStart = (input.selectionStart === 0 && input.selectionEnd === 0);
        if (event.key === 'ArrowUp') {
          // Walk back only when the caret sits at the very start (or empty /
          // already recalling) so multi-line editing still moves the caret.
          if (_recallPos !== -1 || caretStart || !input.value) {
            if (recallPrev()) { event.preventDefault(); return; }
          }
        } else {   // ArrowDown
          if (_recallPos !== -1) { if (recallNext()) { event.preventDefault(); return; } }
        }
      }
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing || unavailable()) return;
      event.preventDefault(); submit();
    });
    // Typing/clicking while recalling drops us back to live-draft mode so the
    // next ArrowUp starts a fresh walk and editing is never clobbered.
    if (recallEnabled) {
      scope.listen(input, 'input', () => { if (_recallPos !== -1) recallReset(); });
      scope.listen(input, 'keydown', event => {
        if (_recallPos !== -1 && event.key !== 'ArrowUp' && event.key !== 'ArrowDown'
            && event.key !== 'Enter' && event.key !== 'Shift') recallReset();
      });
    }
    if (messagesElement) messagesElement.setAttribute('aria-live', 'polite');
    const api = {
      input, messagesElement, sendButton, send,
      // Let an owner (e.g. AppUIChat) seed the recall ring with a message it
      // sent through another path. Normal sends via send() already populate it.
      pushRecall: text => { if (recallEnabled) pushRecall(text); },
      composerElement: options.composerElement || input.parentElement || container,
      setMessages(messages) {
        if (scope.destroyed || !messagesElement) return;
        messagesElement.innerHTML = renderMessages(messages, options);
        messagesElement.scrollTop = messagesElement.scrollHeight;
      },
      setBusy(value) { if (!scope.destroyed) { busy = !!value; syncControls(); } },
      setDisabled(value) { if (!scope.destroyed) { disabled = !!value; syncControls(); } },
      destroy() { scope.destroy(); },
    };
    bindings.set(container, api);
    scope.add(() => {
      if (bindings.get(container) === api) bindings.delete(container);
      input.disabled = initialInputDisabled; sendButton.disabled = initialSendDisabled;
    });
    syncControls();
    if (options.signal) {
      scope.listen(options.signal, 'abort', () => api.destroy(), {once: true});
      if (options.signal.aborted) api.destroy();
    }
    return api;
  }

  function create(options = {}) {
    const {container} = options;
    if (!container) throw new Error('ChatView requires a container');
    if (options.signal?.aborted) return inactive();
    bindings.get(container)?.destroy();
    const root = document.createElement('div'); root.className = 'ui-chat-view';
    root.style.cssText = 'display:flex;flex-direction:column;height:100%;min-height:0';
    const messages = document.createElement('div'); messages.className = 'ui-chat-messages';
    messages.style.cssText = 'flex:1;min-height:0;overflow:auto;padding:8px';
    const composer = document.createElement('div'); composer.className = 'ui-chat-composer';
    composer.style.cssText = 'padding:8px;border-top:1px solid var(--border)';
    const input = document.createElement('textarea'); input.className = 'ui-chat-input';
    input.rows = options.rows || 2; input.placeholder = options.placeholder || 'Send a message…';
    input.setAttribute('aria-label', options.inputLabel || 'Chat message');
    input.style.cssText = 'width:100%;box-sizing:border-box;padding:6px 8px;background:var(--bg-elevated);color:var(--text-primary);border:1px solid var(--border);border-radius:var(--radius-sm);resize:vertical;font-family:inherit';
    const sendButton = document.createElement('button'); sendButton.type = 'button';
    sendButton.className = 'ui-chat-send'; sendButton.textContent = options.sendLabel || 'Send';
    sendButton.style.cssText = 'margin-top:4px;padding:6px 12px;background:var(--accent);color:var(--text-inverse);border:0;border-radius:var(--radius-sm);cursor:pointer';
    composer.append(input, sendButton); root.append(messages, composer); container.replaceChildren(root);
    const api = bind({...options, container, composerElement:composer, messagesElement:messages, input, sendButton});
    const destroy = api.destroy;
    api.destroy = () => { destroy(); root.remove(); };
    if (options.signal?.aborted) api.destroy();
    api.setMessages(options.messages || []);
    return api;
  }
  return {create, bind, renderMessages};
})();
window.AppUIChatView = AppUIChatView;
