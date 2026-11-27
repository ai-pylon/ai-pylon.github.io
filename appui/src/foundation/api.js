/* Abortable JSON API client for AppUI features. */
var AppUIApi = window.AppUIApi || (function () {
  function detectBase() {
    if (typeof window === 'undefined') return '';
    if (typeof window.__PYLON_BASE__ === 'string' && window.__PYLON_BASE__) {
      return window.__PYLON_BASE__.replace(/\/+$/, '');
    }
    const p = (window.location && window.location.pathname) || '';
    const m = /^(.+?)\/(?:apps|appui|v1|drive|dependencies)(?:\/|$)/.exec(p);
    return (m && m[1]) ? m[1] : '';
  }

  function resolvePath(path) {
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) return path;
    const base = detectBase();
    if (!base || path === base || path.startsWith(base + '/')) return path;
    return base + path;
  }

  /** Generate a unique trace ID: hex timestamp + random suffix. */
  function generateTraceId() {
    const ts = Date.now().toString(16);
    const rand = Math.floor(Math.random() * 0xffff)
      .toString(16)
      .padStart(4, '0');
    return ts + '-' + rand;
  }

  async function performRequest(
    path,
    body,
    { timeout = 120000, signal, method, headers: suppliedHeaders, credentials, decode } = {},
    responseEnvelope = false
  ) {
    const controller = new AbortController();
    const timer = timeout == null ? null : window.setTimeout(() => controller.abort(), timeout);
    const cancel = () => {
      if (timer !== null) window.clearTimeout(timer);
      controller.abort();
    };
    if (signal?.aborted) cancel();
    else signal?.addEventListener('abort', cancel, { once: true });
    const traceId = generateTraceId();
    let reported = false;
    function reportFailure(status, kind) {
      if (reported || signal?.aborted || !window.AppUILogger) return;
      try {
        const pathname = new URL(path, window.location?.href || 'http://localhost/').pathname;
        if (pathname === '/v1/log') return;
        reported = true;
        const level = status >= 400 && status < 500 ? 'warn' : 'error';
        // app_id + op (an op call's path) and the page key the failure's fingerprint, so a client-side failure groups
        // per op / page and the 'repeats for the same path' triage rule can tell one flaky call from a broken one
        const m = /^\/v1\/apps\/(.+)\/([^/]+)$/.exec(pathname);
        window.AppUILogger[level]('HTTP request failed', {
          path: pathname, method: method || (body == null ? 'GET' : 'POST'),
          status: status || 0, kind, trace_id: traceId,
          page: window.location?.pathname || '',
          ...(m ? { app_id: decodeURIComponent(m[1]), op: decodeURIComponent(m[2]) } : { op: pathname.split('/').map((seg) => (/\d|^[0-9a-f-]{12,}$/i.test(seg) ? '*' : seg)).join('/').slice(0, 120) })
        });
      } catch (_) { /* diagnostics must never change request behavior */ }
    }
    try {
      const headers = { ...suppliedHeaders, 'X-Trace-ID': traceId };
      for (const name of Object.keys(headers)) {
        if (name !== 'X-Trace-ID' && name.toLowerCase() === 'x-trace-id') delete headers[name];
      }
      const verb = method == null ? (body == null ? 'GET' : 'POST') : String(method).toUpperCase();
      const opts = { headers, signal: controller.signal };
      if (method != null || verb !== 'GET') opts.method = verb;
      if (verb !== 'GET' && verb !== 'HEAD' && body !== undefined) {
        if (!Object.keys(headers).some((name) => name.toLowerCase() === 'content-type'))
          headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
      }
      if (credentials !== undefined) opts.credentials = credentials;
      const response = await fetch(resolvePath(path), opts);
      if (!response.ok) reportFailure(response.status, "http");
      if (responseEnvelope) {
        const data = typeof decode === 'function' ? await decode(response)
          : verb === 'HEAD' || response.status === 204 || response.status === 205
            ? null : await response.json();
        return {ok: response.ok, status: response.status, data, traceId};
      }
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        error.status = response.status;
        try {
          error.response = await response.json();
          const detail = error.response?.error || error.response?._error || error.response?.message;
          if (typeof detail === 'string') error.message = detail;
        } catch (_) {}
        throw error;
      }
      const result =
        verb === 'HEAD' || response.status === 204 || response.status === 205
          ? null
          : await response.json();
      if (result && typeof result === 'object') result._trace_id = traceId;
      return result;
    } catch (error) {
      reportFailure(error.status || 0, error.name === "AbortError" ? "timeout" : "request_failed");
      if (responseEnvelope) throw error;
      return {
        ...(error.response !== undefined ? { response: error.response } : {}),
        _error:
          error.name === 'AbortError'
            ? signal?.aborted
              ? 'Request cancelled'
              : 'Request timed out'
            : error.message,
        _trace_id: traceId,
        status: error.status || 0,
        code: error.name === 'AbortError'
            ? signal?.aborted
              ? 'cancelled'
              : 'timeout'
            : 'request_failed'
      };
    } finally {
      if (timer !== null) window.clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
    }
  }

  function request(path, body, options) {
    return performRequest(path, body, options);
  }

  function requestResponse(path, body, options) {
    return performRequest(path, body, options, true);
  }

  function tool(name, params, options) {
    return request('/api/' + String(name).replace(/\./g, '/'), params || {}, options);
  }

  function post(path, body, options) {
    return request(path, body || {}, options);
  }

  function get(path, options) {
    return request(path, null, options);
  }

  /** Call a v2 app operation without throwing across a page's UI handlers.
   * Application failures retain their payload; transport failures use the same
   * {ok:false,error} shape. Options support the existing timeout and signal API.
   */
  async function operation(appId, name, body, options) {
    try {
      const path = String(appId).split('/').map(encodeURIComponent).join('/');
      const response = await requestResponse(
        '/v1/apps/' + path + '/' + encodeURIComponent(name), body || {},
        {...options, method: 'POST'}
      );
      const data = response.data;
      if (!data || typeof data !== 'object' || Array.isArray(data))
        return {ok: false, error: response.ok ? 'Invalid operation response' : 'HTTP ' + response.status};
      if (!response.ok)
        return {...data, ok: false, error: data.error || data._error || 'HTTP ' + response.status};
      if (data._error && !data.error)
        return {...data, ok: false, error: data._error};
      return data;
    } catch (error) {
      const aborted = error.name === 'AbortError';
      return {ok: false, error: aborted
        ? options?.signal?.aborted ? 'Request cancelled' : 'Request timed out'
        : String(error)};
    }
  }

  async function requestOrThrow(path, body, options) {
    const result = await request(path, body, options);
    if (result?._error) {
      const error = new Error(result._error);
      error.status = result.status;
      error.code = result.code;
      error.traceId = result._trace_id;
      throw error;
    }
    return result;
  }

  /** Run an app operation as a platform/work_runner background job and resolve
   * with the operation's own result, like operation() would. A long op (a
   * converter) then survives slow connections and can report progress:
   *   AppUIApi.runJob('analytics/bb', 'convert', {...}, {onProgress: (p, job) => …})
   * p = {fraction|null, done, total, detail, eta_s} (framework.jobprogress), or
   * null while the op has not reported. Falls back to a direct operation() when
   * work_runner explicitly reports it is missing. Options: timeout (seconds,
   * default 3600, covering submit and wait), pollMs (default 1000),
   * idempotencyKey (reuse after an ambiguous submit), signal, label, isolate (run the
   * op in its own Python process — for long CPU-bound converts).
   */
  async function runJob(appId, name, body, options = {}) {
    const timeout = options.timeout ?? 3600, pollMs = options.pollMs ?? 1000;
    if (!Number.isFinite(timeout) || timeout <= 0 || !Number.isFinite(pollMs) || pollMs < 0)
      return {ok: false, error: 'Invalid job timeout or polling interval'};
    const controller = new AbortController();
    const cancel = () => controller.abort();
    const deadline = Date.now() + timeout * 1000;
    let timer;
    const armDeadline = () => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) cancel();
      else timer = setTimeout(armDeadline, Math.min(remaining, 2147483647));
    };
    armDeadline();
    const signal = controller.signal;
    options.signal?.addEventListener('abort', cancel, {once: true});
    if (options.signal?.aborted) cancel();
    let id;
    const stopped = () => signal.aborted || Date.now() >= deadline;
    const stoppedResult = (retrySubmission = true) => ({ok: false, error: options.signal?.aborted ? 'Request cancelled' : 'Request timed out',
      code: options.signal?.aborted ? 'cancelled' : 'timeout', ...(retrySubmission ? {idempotency_key: submissionKey} : {}), ...(id ? {job_id: id} : {})});
    const pause = () => new Promise(resolve => {
      if (stopped()) { resolve(); return; }
      const done = () => { clearTimeout(waitTimer); signal.removeEventListener('abort', done); resolve(); };
      const waitTimer = setTimeout(done, Math.min(pollMs, Math.max(0, deadline - Date.now())));
      signal.addEventListener('abort', done, {once: true});
    });
    const requestOptions = () => ({signal, timeout: Math.max(1, Math.min(60000, deadline - Date.now()))});
    // A caller can reuse this key after an ambiguous submit response. Never
    // execute directly merely because a submission reply was lost.
    const submissionKey = options.idempotencyKey || window.crypto?.randomUUID?.() || generateTraceId();
    try {
      if (stopped()) return stoppedResult();
      const sub = await operation('platform/work_runner', 'submit', {
        kind: 'op', target: 'local', app: appId, op: name, args: body || {}, timeout,
        isolate: !!options.isolate, label: options.label || (appId + '.' + name),
        idempotency_key: submissionKey}, requestOptions());
      id = sub && sub.ok && ((sub.job && (sub.job.id || sub.job.job_id)) || sub.job_id);
      if (stopped()) return stoppedResult();
      if (!id) {
        const error = String(sub?.error || sub?._error || 'Worker returned no job identity');
        const unavailable = /^(?:required )?app ['"]platform\/work_runner['"] (?:is not available|has no op ['"]submit['"])/i.test(error) ||
          /^(?:unknown|missing) (?:app|operation):? (?:platform\/work_runner|submit)$/i.test(error);
        if (unavailable) {
          const result = await operation(appId, name, body, {signal, timeout: Math.max(1, deadline - Date.now())});
          return stopped() ? stoppedResult(false) : result;
        }
        return {...sub, ok: false, error, idempotency_key: submissionKey};
      }
      let useWait = true;
      while (!stopped()) {
        let got;
        if (useWait) {
          got = await operation('platform/work_runner', 'wait',
            {job_id: id, timeout_s: Math.min(options.onProgress ? 3 : 25, Math.max(0.001, (deadline - Date.now()) / 1000))}, requestOptions());
          if (got?.ok === false && /has no op ['"]wait['"]|not found: wait|unknown op:? wait/i.test(String(got.error || got._error || ''))) {
            useWait = false;
            got = null;
          }
        }
        if (stopped()) return stoppedResult();
        if (!got) {
          await pause();
          if (stopped()) return stoppedResult();
          got = await operation('platform/work_runner', 'get', {job_id: id}, requestOptions());
        }
        if (stopped()) return stoppedResult();
        const job = got?.job;
        if (!job) {
          if (/job not found/i.test(String(got?.error || got?._error || '')))
            return {ok: false, error: got.error || got._error, job_id: id};
          await pause();
          continue;
        }
        if (['pending', 'claimed', 'running'].includes(job.status)) {
          try { options.onProgress?.(job.progress || null, job); } catch (_) { /* page hook */ }
          // Avoid a hot loop if a server returns immediately from wait().
          await pause();
          continue;
        }
        const res = job.op_result;
        if (res && typeof res === 'object') return (res._error && !res.error) ? {...res, ok: false, error: res._error} : res;
        return {ok: job.status === 'done', error: job.error || (job.status === 'done' ? '' : 'job ' + job.status), job};
      }
      return stoppedResult();
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', cancel);
      if (id && stopped()) {
        // Best effort: cleanup must neither delay the caller nor reject unhandled.
        operation('platform/work_runner', 'cancel', {job_id: id}, {timeout: 5000}).catch(() => {});
      }
    }
  }

  return { request, requestResponse, requestOrThrow, operation, runJob, tool, get, post, generateTraceId };
})();
window.AppUIApi = AppUIApi;
