/** Internal per-explorer listing cache, with backend-scoped session persistence. */
const AppUIFileExplorerListingCache = (() => {
  function create({ backendFor, defaultBackend }) {
    let _fileLsCache = {};
    const requests = new Map();
    const CACHE_TTL = 3000;
    function cacheKey(path, backend) {
      const be = backend || backendFor(path);
      const id = (be && be.__id) || (be === defaultBackend ? 'default' : (be && be.caps ? JSON.stringify(be.caps) : 'be'));
      return id + '|' + path;
    }
    function cachedFileLs(path, backend) {
      const be = backend || backendFor(path);
      // Backend-aware cache key: two collection members can share a relative
      // path (e.g. "") but have different backends — keep their listings apart.
      const key = cacheKey(path, be);
      // A backend may opt OUT of the persistent (sessionStorage) listing cache
      // — e.g. a cheap pod-local scope (guest/common) that changes via
      // upload/sync/write, where a 60s stale listing hides just-added files.
      // Such backends keep only the short in-memory TTL.
      const noPersist = !!(be && be.noPersistCache);
      const cached = _fileLsCache[key];
      if (cached && Date.now() - cached.ts < CACHE_TTL) return Promise.resolve(cached.data);
      // Check sessionStorage for persistent cache across refresh
      const ssKey = 'fe_ls_' + key;
      if (!noPersist) {
        try {
          const stored = sessionStorage.getItem(ssKey);
          if (stored) {
            const parsed = JSON.parse(stored);
            if (parsed && Date.now() - parsed.ts < 60000) {
              _fileLsCache[key] = parsed;
              return Promise.resolve(parsed.data);
            }
          }
        } catch (_) {}
      }
      const ticket = {};
      requests.set(key, ticket);
      let response;
      try { response = be.list(path); }
      catch (error) { requests.delete(key); throw error; }
      return Promise.resolve(response).then(result => {
        // A refresh or newer read owns the cache now; return this result only
        // to its original caller without repopulating invalidated cache state.
        if (requests.get(key) !== ticket) return result;
        // Do NOT cache a result that came back from an UNAVAILABLE backend
        // (file-storage base not resolved yet on first load). Caching it
        // would persist an empty listing and hide the real files until a
        // manual refresh — the "no files on initial load" bug. Return it so
        // the tree renders empty for now; the next expand re-fetches fresh.
        if (result && result.unavailable) return result;
        const entry = { data: result, ts: Date.now() };
        _fileLsCache[key] = entry;
        if (!noPersist) {
          try { _pruneSessionCache(); sessionStorage.setItem(ssKey, JSON.stringify(entry)); } catch (_) {}
        }
        return result;
      }).finally(() => {
        if (requests.get(key) === ticket) requests.delete(key);
      });
    }

    // Keep the persistent fe_ls_* listing cache bounded: drop entries past the
    // 60s TTL, then if still over the cap evict the OLDEST (by ts) down to the
    // cap. Called before each write so the cache can't grow unboundedly over a
    // long session (and so a QuotaExceededError doesn't silently disable it).
    const _SS_MAX_ENTRIES = 120;
    function _pruneSessionCache() {
      try {
        const entries = [];
        for (let i = 0; i < sessionStorage.length; i++) {
          const k = sessionStorage.key(i);
          if (!k || k.indexOf('fe_ls_') !== 0) continue;
          let ts = 0;
          try { ts = (JSON.parse(sessionStorage.getItem(k)) || {}).ts || 0; } catch (_) {}
          entries.push({ k: k, ts: ts });
        }
        const now = Date.now();
        // 1) expired
        entries.filter(e => now - e.ts >= 60000).forEach(e => { sessionStorage.removeItem(e.k); });
        // 2) over cap → evict oldest (list is ascending by ts, so front = oldest)
        const live = entries.filter(e => now - e.ts < 60000).sort((a, b) => a.ts - b.ts);
        const over = live.length - _SS_MAX_ENTRIES;
        for (let i = 0; i < over; i++) { sessionStorage.removeItem(live[i].k); }
      } catch (_) {}
    }

    function invalidateCache(path) {
      for (const key of requests.keys()) {
        if (!path || key === path || key.indexOf('|' + path) >= 0) requests.delete(key);
      }
      // Scoped clear: when `path` is given, drop ONLY the cache entries for that
      // directory (so the OTHER open folders keep their 60s-cached listings and
      // don't re-fetch on the subsequent refresh). Cache keys are
      // "<beId>|<path>" (in-memory) / "fe_ls_<beId>|<path>" (sessionStorage), so
      // match on the "|<path>" suffix — NOT a bare `delete _fileLsCache[path]`,
      // which never matched the prefixed key (latent bug when a path was passed).
      if (path) {
        Object.keys(_fileLsCache).forEach((k) => {
          if (k === path || k.indexOf('|' + path) >= 0) delete _fileLsCache[k];
        });
      } else {
        _fileLsCache = {};
      }
      // Also drop the PERSISTENT sessionStorage listing cache (fe_ls_*). The
      // in-memory clear alone wasn't enough: cachedFileLs falls back to
      // sessionStorage (60s TTL), so after a save/create the re-expand served
      // the STALE listing and the just-written file never appeared in the tree.
      // Clear all fe_ls_* entries (or just those for `path`) so the next listing
      // re-fetches from the backend.
      try {
        const keys = [];
        for (let i = 0; i < sessionStorage.length; i++) {
          const k = sessionStorage.key(i);
          if (!k || k.indexOf('fe_ls_') !== 0) continue;
          // key format: fe_ls_<beId>|<path> — match the suffix when a path is given.
          if (!path || k.indexOf('|' + path) >= 0 || k === 'fe_ls_' + path) keys.push(k);
        }
        keys.forEach(k => sessionStorage.removeItem(k));
      } catch (_) { /* sessionStorage may be unavailable */ }
    }
    return { cachedFileLs, invalidateCache, cacheKey };
  }
  return { create };
})();
