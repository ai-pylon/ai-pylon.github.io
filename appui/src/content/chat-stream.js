/**
 * Content/Chat Stream  --  SSE streaming, response parsing, tool call handling.
 * Extracted from chat.js for modularity.
 *
 * Exposes: window.AppUIChatStream
 */
(function() {
  'use strict';

  // ---- tool-call RECORDS (what the saved chat keeps, so history shows the same tool rows as the live turn) ----
  // A transport reports a call as a RUNNING event and later a completion: the same `tool` event with a terminal
  // status (ai/llm_server: running -> ok|error|completed|failed + output|result), or a separate tool_result frame
  // (the gateway / kiro path). Completions must land on THEIR call: with parallel calls the starts come together
  // and the results in any order, so "the last record" is the wrong one (it left bare name+args rows with no
  // output / duration, and extra rows for the orphaned completions).
  const _asJson = v => { try { return JSON.stringify(v == null ? null : v); } catch (_e) { return String(v); } };
  function _toolInfo(td) {
    const meta = (td && td._meta && td._meta.kiro) || {};
    const s = td && td.status;
    const state = (s === 'ok' || s === 'completed' || s === 'success' || s === 'done') ? 'ok'
      : (s === 'error' || s === 'failed' || s === 'failure' || td && td.ok === false) ? 'error' : 'running';
    const out = td && (td.output != null ? td.output : (td.result != null ? td.result : td.rawOutput));
    return {
      id: (td && (td.id || td.toolCallId)) || meta.toolCallId || '',
      name: (td && (td.name || td.tool || td.toolName)) || meta.toolName || (td && (td.kind || td.title)) || '',
      args: (td && (td.args || td.arguments || td.input || td.rawInput)) || null,
      state, out, ms: td && typeof td.ms === 'number' ? td.ms : null, title: td && td.title || '',
    };
  }
  // the unresolved record a completion belongs to: same id, else same name+args (latest first), else - when the
  // completion names nothing - the oldest still-running one, else the latest with the same name
  function _findOpen(toolCalls, n) {
    const open = [];
    toolCalls.forEach((r, i) => { if (!r.status) open.push(i); });
    if (n.id) { const i = open.find(i => toolCalls[i].id === n.id); if (i != null) return i; }
    if (n.name) {
      const k = _asJson(n.args);
      const same = open.filter(i => toolCalls[i].name === n.name);
      const exact = same.filter(i => _asJson(toolCalls[i].args) === k);
      if (exact.length) return exact[0];            // FIFO among identical calls: results arrive in call order
      if (same.length) return same[0];
      return null;
    }
    return open.length ? open[0] : null;
  }
  function _recordToolEvent(toolCalls, td) {
    if (!td || typeof td !== 'object') return null;
    const n = _toolInfo(td);
    if (n.state === 'running') {
      const rec = {name: n.name, args: n.args};
      if (n.id) rec.id = n.id;
      // #30: a transport may put a RAG tool's retrieval block on the tool event itself - keep it so the
      // retrieval footer can render.
      if (td.retrieval && typeof td.retrieval === 'object') {
        rec.retrieval = td.retrieval;
        if (Array.isArray(td.citations)) rec.citations = td.citations;
      }
      toolCalls.push(rec);
      return rec;
    }
    const i = _findOpen(toolCalls, n);
    const rec = i != null ? toolCalls[i] : {name: n.name, args: n.args};   // completed-only transport (VIS dynamic mode)
    if (i == null) { if (n.id) rec.id = n.id; toolCalls.push(rec); }
    rec.status = n.state; rec.output = n.out;
    if (n.ms != null) rec.ms = n.ms;
    if (n.title) rec.title = n.title;
    if (!rec.name && n.name) rec.name = n.name;
    if (rec.args == null && n.args != null) rec.args = n.args;
    if (td.retrieval && typeof td.retrieval === 'object' && !rec.retrieval) {
      rec.retrieval = td.retrieval;
      if (Array.isArray(td.citations)) rec.citations = td.citations;
    }
    return rec;
  }
  // a separate tool_result frame ({id?, name?, result|output|error, ms?}) -> the call it answers
  function _recordToolResult(toolCalls, payload) {
    let d = payload;
    if (typeof payload === 'string') { try { d = JSON.parse(payload); } catch (_e) { d = {result: payload}; } }
    if (!d || typeof d !== 'object') d = {result: d};
    const n = _toolInfo(d);
    const i = _findOpen(toolCalls, n);
    if (i == null) return null;
    const rec = toolCalls[i];
    rec.status = (n.state === 'error' || d.error) ? 'error' : 'ok';
    rec.output = d.result != null ? d.result : (d.output != null ? d.output : (d.error != null ? d.error : d));
    if (n.ms != null) rec.ms = n.ms;
    return rec;
  }

  /**
   * Stream an LLM response via SSE.
   * @param {object} opts - {llmUrl, reqBody, abortSignal, onToken, onToolCall, onToolResult, onMeta, onDone, onError, onRetryWait}
   * @returns {Promise<{reply: string, sessionId: string|null}>}
   */
  async function streamResponse(opts) {
    const {llmUrl, reqBody, abortSignal, onToken, onToolCall, onToolResult, onMeta, onDone, onError, onRetryWait} = opts;
    let reply = '';
    let sessionId = null;
    // Capture, for the Message-details view: the tool calls the turn made, and
    // the model's REASONING prose (the 'I'll fetch X…' narration that streamed
    // BEFORE the final answer). The ai/llm_server 'done' event overrides `reply`
    // with just the final answer, so we snapshot the pre-done streamed text as
    // the reasoning and keep the tool-call payloads here.
    const toolCalls = [];
    let streamedText = '';   // everything streamed via token events (reasoning + answer)
    let _reasoning = '';     // the narration before the final answer (details view)
    let _usage = null;       // #18: backend-reported token usage from the done frame
    let _roundTrace = null;  // server per-round diagnostics (done frame)
    let _finishReason = '';

    // TRANSPORT ADAPTER: by default the shared engine POSTs the request body to
    // `${llmUrl}/${backend}/chat/stream` (the generic LLM gateway) and parses
    // token/tool_call/tool_result/done events. A caller can pass a ``transport``
    // object to target a DIFFERENT server protocol without the sidebar path
    // changing at all. The ai/llm_server app uses a GET EventSource-style SSE
    // (query params) emitting delta/tool/done/error — provided by
    // AppUIChatTransports.systemLlm. ``transport`` shape:
    //   { buildRequest(llmUrl, reqBody) -> {url, method, body?} ,
    //     events: { token?, toolCall?, toolResult?, done?, error? } }  // event-name map
    const transport = opts.transport || null;
    const _req = transport && transport.buildRequest
      ? transport.buildRequest(llmUrl, reqBody)
      : {url: `${llmUrl}/${reqBody.backend || 'kiro'}/chat/stream`,
         method: 'POST',
         body: JSON.stringify(reqBody),
         headers: {'Content-Type': 'application/json'}};
    // event-name → canonical handler. Default map matches the gateway schema;
    // the adapter can remap (e.g. ai/llm_server's "delta" → token, "tool" → tool_call).
    const EV = Object.assign(
      {token: null, toolCall: 'tool_call', toolResult: 'tool_result', done: 'done',
       meta: 'meta', error: 'error', reason: 'reason', confirm: 'confirm'},
      (transport && transport.events) || {});

    // Retry logic for dependency activation / worker warmup
    let resp;
    for (let _attempt = 0; _attempt < 7; _attempt++) {
      resp = await fetch(_req.url, {
        method: _req.method || 'POST',
        headers: _req.headers || {'Content-Type': 'application/json'},
        body: _req.method === 'GET' ? undefined : (_req.body != null ? _req.body : JSON.stringify(reqBody)),
        signal: abortSignal,
      });
      const ct = resp.headers.get('content-type') || '';
      if (ct.includes('text/event-stream') || resp.ok) break;
      // Check if it's a retryable error
      const peek = await resp.clone().json().catch(() => null);
      if (peek && (peek._error || '').includes('activation failed')) {
        if (onRetryWait) onRetryWait(_attempt);
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }
      break;
    }

    const contentType = resp.headers.get('content-type') || '';
    if (!contentType.includes('text/event-stream')) {
      // Non-streaming response (error or simple reply)
      const data = await resp.json();
      if (data._error) {
        reply = '\u26a0\ufe0f ' + data._error;
        if (onError) onError(data._error);
      } else {
        reply = data.response || data.content || data.text || JSON.stringify(data);
      }
      if (data.session_id) sessionId = data.session_id;
      return {reply, sessionId};
    }

    // SSE streaming
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let streamComplete = false;
    const parser = AppUIStreamEvents.create(({event:eventType,data:payload}) => {
      if (streamComplete) return;
      if (payload === '[DONE]') return;

      if (eventType === EV.done) {
        try {
          const d = JSON.parse(payload);
          if (d.session_id) sessionId = d.session_id;
          if (d.session) sessionId = d.session;
          // A custom transport's 'done' may carry the authoritative full
          // content (ai/llm_server does). Only honour it for an adapter — never
          // override the gateway/sidebar's token-accumulated reply.
          if (transport && typeof d.content === 'string' && d.content) {
            // Before replacing reply with the final answer, capture the
            // REASONING that streamed before it. The server may send an
            // AUTHORITATIVE `reasoning` (ai/llm_server now returns the model's
            // pre-directive narration captured server-side — reliable even when
            // the reasoning arrived inline with the tool directive and never
            // streamed as a token). Prefer it; else fall back to subtracting the
            // final content from the streamed text.
            const fin = d.content;
            if (typeof d.reasoning === 'string' && d.reasoning.trim()) {
              _reasoning = d.reasoning.trim();
            } else if (streamedText && streamedText.indexOf(fin) === -1) {
              _reasoning = streamedText.trim();   // final answer came only in `done`
            } else if (streamedText) {
              _reasoning = streamedText.replace(fin, '').trim();
            }
            reply = fin;
          }
          // the transport may also hand us the authoritative tool_calls list
          if (Array.isArray(d.tool_calls) && d.tool_calls.length && !toolCalls.length) {
            d.tool_calls.forEach(tc => toolCalls.push(tc));
          }
          // #18: capture the backend's REAL token usage so the footer shows an
          // exact count (formatStats prefers usage.completion_tokens).
          if (d.usage && typeof d.usage === 'object') _usage = d.usage;
          // per-round diagnostics from the server (finish_reason, tool calls per round)
          if (Array.isArray(d.round_trace)) _roundTrace = d.round_trace;
          if (d.finish_reason) _finishReason = d.finish_reason;
        } catch {}
        streamComplete = true;
        if (onDone) onDone(sessionId);
        return;
      }

      if (eventType === EV.meta) {
        try { const d = JSON.parse(payload); if (d.session_id) sessionId = d.session_id; } catch {}
        if (onMeta) onMeta(payload);
        return;
      }

      if (eventType === EV.error) {
        let em = payload;
        try { const d = JSON.parse(payload); em = d.error || payload; } catch {}
        reply += '\n\n\u26a0\ufe0f ' + em;
        if (onError) onError(em);
        return;
      }

      if (eventType === EV.toolCall) {
        if (onToolCall) onToolCall(payload);
        try { _recordToolEvent(toolCalls, JSON.parse(payload)); }
        catch { /* keep going */ }
        if (reply && !reply.endsWith('\n')) reply += '\n\n';
        return;
      }

      if (eventType === EV.toolResult) {
        if (onToolResult) onToolResult(payload);
        try { _recordToolResult(toolCalls, payload); } catch { /* keep going */ }
        return;
      }

      // Per-invoke CONFIRM gate frame (ai/llm_server emits `event: confirm
      // {invoke_id,id,args}` when confirm_writes is on and the model wants to run
      // a safety=confirm write). The consumer renders an approve/deny row and
      // POSTs its decision to <streamBase>/chat/confirm.
      if (eventType === EV.confirm) {
        try { const d = JSON.parse(payload); if (opts.onConfirm) opts.onConfirm(d); } catch {}
        return;
      }

      // Live REASONING frame (ai/llm_server emits `event: reason {text}` as the
      // model narrates its "I'll search X / discard Y" decision before a tool
      // directive). Surface it live via onReason so the "why this tool" trace
      // shows as it happens — the authoritative done.reasoning still backfills.
      if (eventType === EV.reason) {
        let rtext = '', rstream = false;
        try { const d = JSON.parse(payload); rtext = (d && (d.text || d.reason)) || ''; rstream = !!(d && d.stream); } catch { rtext = payload; }
        if (rtext) {
          // stream:true = raw THINKING tokens of a reasoning model → append as-is;
          // otherwise a whole narration sentence → join with a space
          _reasoning = rstream ? (_reasoning + rtext)
            : (_reasoning ? (_reasoning + (/\s$/.test(_reasoning) ? '' : ' ') + rtext) : rtext);
          if (opts.onReason) opts.onReason(rtext, _reasoning);
        }
        return;
      }

      // Text token. The adapter may name the token event (EV.token, e.g.
      // "delta" for ai/llm_server); otherwise ANY unrecognized event is treated as
      // a token (the gateway sends bare token events).
      if (EV.token && eventType !== EV.token) return;   // adapter: only its token event is text
      let token = '';
      try {
        const d = JSON.parse(payload);
        if (typeof d === 'string') token = d;
        else if (d && typeof d === 'object') token = d.token || d.content || d.text || '';
      } catch { token = payload; }
      if (token) {
        reply += token;
        streamedText += token;
        if (onToken) onToken(token, reply);
      }
    });
    try {
      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        parser.push(decoder.decode(value, {stream:true}));
        if (streamComplete) {
          try { await reader.cancel(); } catch {}
          break;
        }
      }
    } catch (err) {
      // #8: preserve partial toolCalls + reasoning collected before Stop/error so
      // the caller can still render partial Sources and persist them in history.
      if (err && typeof err === 'object') {
        err.toolCalls = toolCalls;
        err.reasoning = _reasoning;
      }
      throw err;
    }
    if (!streamComplete) {
      parser.push(decoder.decode());
      parser.finish();
    }

    // streamComplete is only set by a `done` frame: a connection that closed
    // without one was CUT mid-turn — flag it so the caller doesn't present the
    // partial text (e.g. "Found it - let me check ...") as a finished answer.
    return {reply, sessionId, toolCalls, reasoning: _reasoning, usage: _usage,
            roundTrace: _roundTrace, finishReason: _finishReason, truncated: !streamComplete};
  }

  // --- Transport adapters -------------------------------------------------
  // The DEFAULT transport (sidebar / generic gateway) is implicit (no object).
  // A named adapter retargets streamResponse at a different server protocol.
  const Transports = {
    // ai/llm_server app: GET SSE at /apps/ai/llm_server/v1/chat/stream?… emitting
    // delta/tool/done/error. reqBody carries {messages, system, backend, scope,
    // progressive, flatten, reset, refresh_path} which we map to query params.
    systemLlm(baseUrl) {
      const BASE = (baseUrl || '/apps/ai/llm_server/v1').replace(/\/$/, '');
      return {
        events: {token: 'delta', toolCall: 'tool', toolResult: null,
                 done: 'done', meta: null, error: 'error', reason: 'reason', confirm: 'confirm'},
        buildRequest(_llmUrl, reqBody) {
          const p = new URLSearchParams();
          if (reqBody.messages) p.set('messages', JSON.stringify(reqBody.messages));
          else if (reqBody.prompt) p.set('messages', JSON.stringify([{role: 'user', content: reqBody.prompt}]));
          if (reqBody.backend) p.set('backend', reqBody.backend);
          if (reqBody.model) p.set('model', reqBody.model);
          if (reqBody.system) p.set('system', reqBody.system);
          if (reqBody.scope && reqBody.scope.length) p.set('scope', JSON.stringify(reqBody.scope));
          if (reqBody.extra_scope && reqBody.extra_scope.length) p.set('extra_scope', JSON.stringify(reqBody.extra_scope));
          // args the PAGE binds onto model tool calls (e.g. the shown viewer's file as src) - forced server-side
          if (reqBody.tool_bind && typeof reqBody.tool_bind === 'object' && Object.keys(reqBody.tool_bind).length) p.set('tool_bind', JSON.stringify(reqBody.tool_bind));
          if (reqBody.progressive) p.set('progressive', '1');
          if (reqBody.flatten) p.set('flatten', '1');
          if (reqBody.reset) p.set('reset', '1');
          // #174 — a STABLE per-chat key (e.g. the profile id) pins a dedicated
          // kiro driver so each app's chat is isolated (no cross-page system-
          // prompt leak via the shared warm pool). Optional; set by the host via
          // reqBody.pool (see AppUIChatPanel profileId → buildReqBody).
          if (reqBody.pool) p.set('pool', String(reqBody.pool));
          if (reqBody.confirm_writes) p.set('confirm_writes', '1');
          if (reqBody.agent) p.set('agent', String(reqBody.agent));   // a .kiro agent persona (platform/tool_kiro)
          if (reqBody.refresh_path) p.set('refresh_path', '1');
          return {url: BASE + '/chat/stream?' + p.toString(), method: 'GET'};
        },
        confirmUrl() { return BASE + '/chat/confirm'; },
      };
    },
  };

  window.AppUIChatStream = {
    streamResponse,
    transports: Transports,
    detectAndRunTools: (...args) => window._AppUIChatTools.run(...args),
    // pure: how tool events become the saved tool_calls records (guarded by tools/test_chat_tool_records.js)
    toolRecords: {event: _recordToolEvent, result: _recordToolResult},
  };
})();
