/* Concurrency admission for same-origin API requests. Streams bypass admission;
 * ordinary slots end at response headers, without changing native Response bodies. */
(function() {
  'use strict';
  if (window._apiQueue?.fetch === window.fetch) return;
  function limit(value) {
    if (!Number.isInteger(value) || value < 1) throw new RangeError('API queue concurrency must be a positive integer');
    return value;
  }
  let maximum = limit(window.API_QUEUE_MAX ?? 4), active = 0;
  const queue = [];
  const delegate = window.fetch;
  if (!window._originalFetch) window._originalFetch = delegate;
  function abortError() { const error = new Error('Queued request cancelled'); error.name = 'AbortError'; return error; }
  function policy(input, init) {
    if (init?.appuiQueue === 'bypass' || init?.appuiQueue === 'stream') return 'bypass';
    try {
      const url = new URL(input?.url || input, document.baseURI || location.href);
      if (url.origin !== location.origin || !/^\/(?:api\/|v1\/apps\/|run(?:\/|$))/.test(url.pathname)) return 'bypass';
      const headers = new Headers(init?.headers !== undefined ? init.headers : input?.headers);
      if (init?.appuiQueue !== 'default' && (headers.get('accept')?.includes('text/event-stream') || /\/(?:stream|subscribe)(?:\/|$)/.test(url.pathname))) return 'bypass';
      return 'queue';
    } catch (_) { return 'bypass'; }
  }
  function pump() {
    while (queue.length && active < maximum) {
      const item = queue.shift();
      item.signal?.removeEventListener('abort', item.abort);
      if (item.signal?.aborted) {item.reject(abortError()); continue;}
      active++;
      Promise.resolve().then(() => delegate.call(window, item.input, item.init)).then(item.resolve, item.reject)
        .finally(() => {active--; pump();});
    }
  }
  function fetchQueued(input, init) {
    if (policy(input, init) === 'bypass') return delegate.call(window, input, init);
    const signal = init?.signal !== undefined ? init.signal : input?.signal;
    if (signal?.aborted) return Promise.reject(abortError());
    return new Promise((resolve, reject) => {
      const item = {input, init, signal, resolve, reject};
      item.abort = () => {
        const index = queue.indexOf(item);
        if (index < 0) return;
        queue.splice(index, 1);
        signal.removeEventListener('abort', item.abort);
        reject(abortError());
      };
      queue.push(item);
      signal?.addEventListener('abort', item.abort, {once: true});
      pump();
    });
  }
  window.fetch = fetchQueued;
  window._apiQueue = {
    fetch: fetchQueued, policy,
    get pending() {return queue.length;}, get active() {return active;},
    get max() {return maximum;}, set max(value) {maximum = limit(value); pump();},
    flush() {
      for (const item of queue.splice(0)) {
        item.signal?.removeEventListener('abort', item.abort);
        item.reject(abortError());
      }
    },
  };
})();
