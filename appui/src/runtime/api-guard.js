/**
 * AppUI API Guard — intercepts 503 "Service is starting up" responses.
 * Shows a toast notification and auto-retries after the specified delay.
 *
 * Usage: Include this script in any AppUI page. It monkey-patches fetch()
 * to automatically handle service startup responses.
 *
 * Behavior:
 *   - On 503 with status:"loading" → shows toast, waits retry_after seconds, retries
 *   - Max 10 retries before giving up
 *   - Toast updates with retry count
 *   - When service becomes available → shows success toast
 */
(function() {
  'use strict';

  var MAX_RETRIES = 10;
  // Delegate to the CURRENT window.fetch (whatever is already installed — e.g.
  // the api-queue concurrency wrapper, which loads first), so this guard COMPOSES
  // over it (guard → queue → native) rather than bypassing it. Do NOT change this
  // to window._originalFetch: that would skip the concurrency queue for API calls.
  var _delegateFetch = window.fetch;
  // Publish the TRUE native fetch (idempotently) for tooling/later wrappers. Only
  // the first patcher wins; if api-queue already ran it set this to native.
  if (!window._originalFetch) window._originalFetch = window.fetch;
  const _activeRetries = new Map();
  function aborted(signal) {
    if (!signal?.aborted) return;
    const error = new Error('Request cancelled'); error.name = 'AbortError'; throw error;
  }
  function delay(milliseconds, signal) {
    return new Promise((resolve, reject) => {
      try { aborted(signal); } catch (error) {reject(error); return;}
      const finish = () => {signal?.removeEventListener('abort', cancel); resolve();};
      const timer = setTimeout(finish, milliseconds);
      const cancel = () => {
        clearTimeout(timer); signal.removeEventListener('abort', cancel);
        const error = new Error('Request cancelled'); error.name = 'AbortError'; reject(error);
      };
      signal?.addEventListener('abort', cancel, {once: true});
    });
  }
  window.fetch = async function(input, init) {
    const signal = init?.signal !== undefined ? init.signal : input?.signal;
    const url = String(input?.url || input);
    const service = url.split('/api/')[1] || url.split('/').pop() || 'service';
    let template, retried = false, succeeded = false;
    const streamingBody = typeof ReadableStream !== 'undefined' && init?.body instanceof ReadableStream;
    const requestInput = typeof Request !== 'undefined' && input instanceof Request;
    if (requestInput && !streamingBody) {
      try {template = input.clone();} catch (_) { /* native fetch reports consumed input */ }
    }
    try {
      for (let attempt = 0; ; attempt++) {
        aborted(signal);
        const request = attempt && template ? template.clone() : input;
        const response = await _delegateFetch.call(window, request, init);
        aborted(signal);
        if (response.status !== 503) {
          if (retried && response.ok) {succeeded = true; _showReadyToast(url);}
          return response;
        }
        let body;
        try {body = await response.clone().json();}
        catch (_) {aborted(signal); return response;}
        aborted(signal);
        if (body?.status !== 'loading' || attempt >= MAX_RETRIES || streamingBody || (requestInput && !template)) return response;
        const seconds = Number(body.retry_after ?? 1);
        const wait = Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds * 1000, 30000) : 1000;
        if (!retried) {
          retried = true;
          const count = _activeRetries.get(url) || 0;
          _activeRetries.set(url, count + 1);
          if (!count) _showStartupToast(service, attempt + 1);
        } else _updateStartupToast(service, attempt + 1);
        await delay(wait, signal);
      }
    } finally {
      try {template?.body?.cancel().catch(() => {});} catch (_) {}
      if (retried) {
        const remaining = (_activeRetries.get(url) || 1) - 1;
        if (remaining) _activeRetries.set(url, remaining);
        else {
          _activeRetries.delete(url);
          if (_toastEl && !succeeded) _toastEl.style.display = 'none';
        }
      }
    }
  };

  var _toastEl = null;

  function _showStartupToast(service, attempt) {
    if (window.Toast) {
      window.Toast.info('⏳ ' + service + ' is starting up... (retry ' + attempt + '/' + MAX_RETRIES + ')', { duration: 0, id: 'startup-' + service });
    } else {
      _ensureToastEl();
      _toastEl.textContent = '⏳ ' + service + ' is starting up... (retry ' + attempt + ')';
      _toastEl.style.display = 'block';
    }
  }

  function _updateStartupToast(service, attempt) {
    if (window.Toast) {
      window.Toast.info('⏳ ' + service + ' is starting up... (retry ' + attempt + '/' + MAX_RETRIES + ')', { duration: 0, id: 'startup-' + service });
    } else if (_toastEl) {
      _toastEl.textContent = '⏳ ' + service + ' starting up... (retry ' + attempt + ')';
    }
  }

  function _showReadyToast(url) {
    var service = url.split('/api/')[1] || url.split('/').pop() || 'Service';
    if (window.Toast) {
      window.Toast.success('✓ ' + service + ' is ready');
    } else if (_toastEl) {
      _toastEl.textContent = '✓ Service ready';
      _toastEl.style.background = 'var(--bg-elevated)';
      _toastEl.style.borderColor = 'var(--color-success)';
      setTimeout(function() { _toastEl.style.display = 'none'; }, 3000);
    }
  }

  function _ensureToastEl() {
    if (_toastEl) return;
    _toastEl = document.createElement('div');
    _toastEl.style.cssText = 'display:none;position:fixed;bottom:12px;right:12px;z-index:99999;'
      + 'padding:8px 14px;background:var(--bg-elevated);color:var(--accent);border:1px solid var(--border);'
      + 'border-radius:6px;font-size:12px;box-shadow:0 4px 12px rgba(0,0,0,0.4);'
      + 'font-family:system-ui,sans-serif;transition:opacity 0.3s;';
    document.body.appendChild(_toastEl);
  }

})();
