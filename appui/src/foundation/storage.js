/* Safe browser persistence for AppUI services and components. */
var AppUIStorage = window.AppUIStorage || (function() {
  function get(key, fallback = null) {
    try {
      const value = localStorage.getItem(key);
      return value === null ? fallback : value;
    } catch (_) { return fallback; }
  }

  function set(key, value) {
    try { localStorage.setItem(key, String(value)); return true; }
    catch (_) { return false; }
  }

  function remove(key) {
    try { localStorage.removeItem(key); return true; }
    catch (_) { return false; }
  }

  function getJSON(key, fallback = null) {
    const value = get(key, null);
    if (value === null) return fallback;
    try { return JSON.parse(value); }
    catch (_) { return fallback; }
  }

  function setJSON(key, value) {
    try { return set(key, JSON.stringify(value)); }
    catch (_) { return false; }
  }

  function keys(prefix = '') {
    const result = [];
    try {
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index);
        if (key && key.startsWith(prefix)) result.push(key);
      }
    } catch (_) {}
    return result;
  }

  const session = {
    getCached(key, ttl = 60000, fallback = null) {
      try {
        const entry = JSON.parse(sessionStorage.getItem(key));
        if (!entry || !Number.isFinite(entry.ts) || !Number.isFinite(ttl) || ttl < 0
            || Date.now() - entry.ts > ttl || entry.data === undefined) return fallback;
        return entry.data;
      } catch (_) { return fallback; }
    },
    setCached(key, data) {
      try {
        sessionStorage.setItem(key, JSON.stringify({ts: Date.now(), data}));
        return true;
      } catch (_) { return false; }
    },
  };

  return {get, set, remove, getJSON, setJSON, keys, session};
})();
window.AppUIStorage = AppUIStorage;
