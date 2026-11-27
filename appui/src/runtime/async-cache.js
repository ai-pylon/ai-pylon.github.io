/** In-memory promise coalescing with optional successful-result TTL caching. */
var AppUIAsyncCache = (() => {
  function create({ ttlMs = 0, cacheIf = () => true, maxEntries = 256 } = {}) {
    if (!(ttlMs >= 0) || !(maxEntries === Infinity || Number.isInteger(maxEntries) && maxEntries >= 0))
      throw new RangeError('Cache TTL and capacity must be nonnegative; capacity must be an integer or Infinity');
    const pending = new Map();
    const recent = new Map();

    function prune() {
      const now = Date.now();
      for (const [key, cached] of recent) {
        if (now - cached.time >= ttlMs) recent.delete(key);
      }
      while (recent.size > maxEntries) recent.delete(recent.keys().next().value);
    }

    function get(key, load) {
      prune();
      if (pending.has(key)) return pending.get(key);
      const cached = recent.get(key);
      if (cached) {
        recent.delete(key);
        recent.set(key, cached);
        return Promise.resolve(cached.value);
      }
      const request = Promise.resolve().then(load);
      pending.set(key, request);
      request.then(value => {
        // A cleared/replaced request must not repopulate the cache later.
        if (pending.get(key) !== request) return;
        pending.delete(key);
        try {
          if (ttlMs > 0 && maxEntries > 0 && cacheIf(value)) {
            recent.set(key, { time: Date.now(), value });
            prune();
          }
        } catch (_) { /* A cache-policy failure must not replace the loaded result. */ }
      }, () => {
        if (pending.get(key) === request) pending.delete(key);
      });
      return request;
    }

    function clear(key) {
      if (arguments.length) { pending.delete(key); recent.delete(key); }
      else { pending.clear(); recent.clear(); }
    }

    return { get, clear };
  }
  return { create };
})();
if (typeof window !== 'undefined') window.AppUIAsyncCache = AppUIAsyncCache;
