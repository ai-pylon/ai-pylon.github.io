/* Shared chat payload decoding; AppUIStreamEvents owns incremental SSE framing. */
window._AppUICoreStream = (() => {
  const parsers = new WeakMap();
  function json(payload, fallback) {
    try { return JSON.parse(payload); } catch (_) { return fallback; }
  }
  function dispatch({event, data: payload}, callbacks) {
    if (payload === '[DONE]' || event === 'done') {
      callbacks.onDone?.(payload === '[DONE]' ? {} : json(payload, {}));
    } else if (event === 'meta') callbacks.onMeta?.(json(payload, {}));
    else if (event === 'tool_call') callbacks.onToolCall?.(json(payload, {name: payload}));
    else if (event === 'tool_result') callbacks.onToolResult?.(json(payload, {result: payload}));
    else if (event === 'error') callbacks.onError?.(payload);
    else {
      const data = json(payload, payload);
      if (typeof data === 'string') callbacks.onText?.(data);
      else if (data && typeof data === 'object') {
        const token = data.token || data.content || data.text || data.delta?.content || '';
        if (token) callbacks.onText?.(token);
      }
    }
  }
  // Calls can contain arbitrary partial lines. Dispatch only complete SSE frames;
  // finish(callbacks) flushes a final unterminated frame at end of input.
  function parseSSE(chunk, callbacks) {
    let parser = parsers.get(callbacks);
    if (!parser) {
      parser = window.AppUIStreamEvents.create(frame => dispatch(frame, callbacks));
      parsers.set(callbacks, parser);
    }
    parser.push(chunk);
  }
  parseSSE.finish = callbacks => {
    const parser = parsers.get(callbacks);
    parsers.delete(callbacks);
    parser?.finish();
  };

  /** POST chat; callbacks keep their existing signatures. Exactly one terminal
   * notification is emitted. Failures reject, and all owned readers are released.
   * EOF without a terminal event remains a successful legacy stream completion. */
  async function streamChat(opts) {
    const url = opts.url || `/api/llm/${opts.backend || 'kiro'}/chat/stream`;
    const body = {prompt: opts.prompt, system: opts.system || '', model: opts.model || '', backend: opts.backend || ''};
    if (opts.session_id) body.session_id = opts.session_id;
    let fullText = '', sessionId = opts.session_id || null, state = 'open';
    let reader, reachedEof = false, cancellation;
    const result = () => ({text: fullText, session_id: sessionId});
    const checkAbort = () => {
      if (!opts.signal?.aborted) return;
      const error = new Error('Request cancelled');
      error.name = 'AbortError';
      throw error;
    };
    function complete(data = {}) {
      if (state !== 'open') return;
      checkAbort();
      if (data?.session_id) sessionId = data.session_id;
      state = 'done';
      opts.onDone?.({...result(), ...(data?.total_ms !== undefined ? {total_ms: data.total_ms} : {})});
    }
    function fail(error) {
      if (state !== 'open') return;
      state = 'error';
      opts.onError?.(error?.message || String(error));
    }
    function cancelReader() {
      if (!reader || cancellation) return cancellation;
      try { cancellation = Promise.resolve(reader.cancel()).catch(() => {}); }
      catch (_) { cancellation = Promise.resolve(); }
      return cancellation;
    }
    const onAbort = () => { cancelReader(); };
    const callbacks = {
      onText(token) {
        if (state !== 'open') return;
        checkAbort();
        fullText += token;
        opts.onText?.(token, fullText);
      },
      onToolCall(data) { if (state === 'open') { checkAbort(); opts.onToolCall?.(data); } },
      onToolResult(data) { if (state === 'open') { checkAbort(); opts.onToolResult?.(data); } },
      onMeta(data) {
        if (state !== 'open') return;
        checkAbort();
        if (data?.session_id) sessionId = data.session_id;
        opts.onMeta?.(data);
      },
      onDone: complete,
      onError(message) {
        if (state !== 'open') return;
        const error = new Error(message);
        fail(error);
        throw error;
      },
    };
    try {
      checkAbort();
      const response = await fetch(url, {method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(body), ...(opts.signal ? {signal: opts.signal} : {})});
      checkAbort();
      if (!response.ok) {
        let message = 'HTTP ' + response.status;
        try {
          const data = await response.json();
          const detail = data?.error || data?._error || data?.message;
          if (typeof detail === 'string') message = detail;
        } catch (_) { /* retain the HTTP status for non-JSON errors */ }
        const error = new Error(message);
        error.status = response.status;
        throw error;
      }
      if (!(response.headers.get('content-type') || '').toLowerCase().includes('text/event-stream')) {
        const data = await response.json();
        checkAbort();
        if (data?.ok === false || data?._error || data?.error) throw new Error(data.error || data._error || 'Chat request failed');
        fullText = data?.response || data?.content || data?.text || JSON.stringify(data);
        if (data?.session_id) sessionId = data.session_id;
        opts.onText?.(fullText, fullText);
        complete();
        return result();
      }
      if (!response.body) throw new Error('Chat stream has no response body');
      reader = response.body.getReader();
      opts.signal?.addEventListener('abort', onAbort, {once: true});
      checkAbort();
      const decoder = new TextDecoder();
      while (state === 'open') {
        const {done, value} = await reader.read();
        checkAbort();
        if (done) { reachedEof = true; break; }
        parseSSE(decoder.decode(value, {stream: true}), callbacks);
      }
      if (state === 'open') {
        parseSSE(decoder.decode(), callbacks);
        parseSSE.finish(callbacks);
        complete();
      }
      return result();
    } catch (error) {
      fail(error);
      throw error;
    } finally {
      opts.signal?.removeEventListener('abort', onAbort);
      parsers.delete(callbacks);
      if (reader) {
        try { if (!reachedEof) await cancelReader(); }
        finally { reader.releaseLock(); }
      }
    }
  }
  return {parseSSE, streamChat};
})();
