/* TTL data cache shared by AppUI pages. */
window.AppUIShellDataCache = {
  create(request, limit = 50) {
    const cache = new Map();
    return {
      async get(toolPath, params, options = {}) {
        const key = `${toolPath}|${JSON.stringify(params || {})}`, ttl = options.ttl || 30000, cached = cache.get(key);
        if (cached && Date.now() - cached.ts < ttl) return cached.data;
        const data = await request(`/api/${toolPath.replace(/\./g, '/')}`, params);
        cache.set(key, {data, ts: Date.now()});
        if (cache.size > limit) { const [oldest] = [...cache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0] || []; if (oldest) cache.delete(oldest); }
        return data;
      },
      invalidate(toolPath) { [...cache.keys()].filter(key => key.startsWith(toolPath)).forEach(key => cache.delete(key)); },
    };
  },
};
