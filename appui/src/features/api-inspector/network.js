/* Private fetch monitoring; API Inspector core owns history and presentation. */
window._AppUIApiInspectorNetwork = (() => {
  function create({onEntry, onUpdate}) {
    let _originalFetch = null;
    // --- Fetch interceptor ---

    function _hookFetch() {
      if (_originalFetch) return;
      _originalFetch = window.fetch;
      window.fetch = async function(input, init) {
        const url = typeof input === 'string' ? input : (input?.url || '');
        const isApi = url.includes('/api/') || url.includes('/servers') || url.includes('/events');
        if (!isApi) return _originalFetch.apply(this, arguments);

        const method = init?.method || 'GET';
        const t0 = performance.now();
        const entry = { url: _shortenUrl(url), fullUrl: url, method, startMs: Date.now(), durationMs: 0, size: 0, status: 0, caller: _getCaller() };

        try {
          const resp = await _originalFetch.apply(this, arguments);
          entry.durationMs = Math.round(performance.now() - t0);
          entry.status = resp.status;
          // Clone to read size without consuming body
          const clone = resp.clone();
          clone.text().then(txt => { entry.size = txt.length; onUpdate(); }).catch(() => {});
          onEntry(entry);
          return resp;
        } catch (err) {
          entry.durationMs = Math.round(performance.now() - t0);
          entry.status = 0;
          entry.error = err.message;
          onEntry(entry);
          throw err;
        }
      };
    }

    function _unhookFetch() {
      if (_originalFetch) {
        window.fetch = _originalFetch;
        _originalFetch = null;
      }
    }

    function _shortenUrl(url) {
      try {
        const u = new URL(url, location.origin);
        return u.pathname + (u.search ? '?' + u.search.substring(1, 30) : '');
      } catch { return url.substring(0, 60); }
    }

    function _getCaller() {
      try {
        const stack = new Error().stack || '';
        const lines = stack.split('\n').filter(l => l.includes('http') && !l.includes('api-inspector'));
        return lines[2]?.trim()?.replace(/.*\//, '')?.substring(0, 40) || '';
      } catch { return ''; }
    }

    return {enable:_hookFetch, disable:_unhookFetch};
  }
  return {create};
})();
