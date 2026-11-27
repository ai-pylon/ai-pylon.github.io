/* Local configuration with namespace-owned, versioned server saves. */
var AppUIConfigStore = window.AppUIConfigStore || (() => {
  const DEBOUNCE_MS = 10000, RETRY_LIMIT = 5;
  const entries = new Map(), listeners = new Set(), loadErrors = new Map();
  const JOURNAL_PREFIX = 'appui.config.pending.v1:';
  let journalError = null;
  let namespace = '', generation = 0, loadController = null;
  const id = (space, key) => JSON.stringify([space, key]);
  const prefix = (space, key) => 'cfg:' + space + '.' + key;
  function getStatus(space = namespace) {
    const owned = [...entries.values()].filter(entry => entry.namespace === space);
    const pending = owned.filter(entry => entry.dirty).length;
    const saving = owned.some(entry => entry.inFlight);
    const error = owned.find(entry => entry.error)?.error || loadErrors.get(space) || journalError;
    return {namespace: space, state: saving ? 'saving' : error ? 'error' : pending ? 'pending' : 'saved', pending, error};
  }
  function notify() {
    const status = getStatus();
    for (const listener of [...listeners]) {try {listener(status);} catch (_) {}}
  }
  function onStatus(listener) {listeners.add(listener); listener(getStatus()); return () => listeners.delete(listener);}
  function persist(entry, force = false) {
    const key = JOURNAL_PREFIX + encodeURIComponent(id(entry.namespace, entry.key));
    let previous;
    try {previous = JSON.parse(AppUIStorage.get(key) || 'null');} catch (_) {}
    // An acknowledgment from this page must not remove another tab's edit.
    if (!force && previous && previous.token !== entry.token) return;
    const success = entry.dirty
      ? AppUIStorage.setJSON(key, {namespace: entry.namespace, key: entry.key, value: entry.value, removed: entry.removed, token: entry.token})
      : AppUIStorage.remove(key);
    journalError = success === false ? 'Pending changes could not be saved to browser storage' : null;
  }
  async function init(space) {
    namespace = String(space);
    const version = ++generation, owned = namespace;
    loadController?.abort();
    const controller = new AbortController(); loadController = controller;
    const timer = setTimeout(() => controller.abort(), 10000);
    for (const entry of entries.values()) {
      if (entry.namespace === owned && entry.dirty && !entry.inFlight && entry.timer === null) {
        entry.attempts = 0;
        schedule(entry, 1000);
      }
    }
    notify();
    try {
      const response = await fetch('/api/config.get', {method: 'POST', signal: controller.signal,
        headers: {'Content-Type': 'application/json'}, body: JSON.stringify({key: owned})});
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const data = await response.json();
      if (version !== generation || controller.signal.aborted) return false;
      if (!data || data._error || data.error || data.ok === false) throw new Error(data?.error || data?._error || 'Invalid configuration response');
      loadErrors.delete(owned);
      if (data.value !== null) {
        const object = data.value !== undefined ? {value: data.value} : data;
        for (const [key, value] of Object.entries(object)) {
          if (key.startsWith('_') || entries.has(id(owned, key))) continue;
          const storageKey = prefix(owned, key);
          if (AppUIStorage.get(storageKey) === null) AppUIStorage.setJSON(storageKey, value);
        }
      }
      return true;
    } catch (error) {
      if (version === generation) loadErrors.set(owned, error.message);
      return false;
    } finally {clearTimeout(timer); if (version === generation) notify();}
  }
  function get(key, fallback) {
    const entry = entries.get(id(namespace, key));
    if (entry) return entry.removed ? fallback : JSON.parse(JSON.stringify(entry.value));
    const raw = AppUIStorage.get(prefix(namespace, key));
    if (raw === null) return fallback;
    try {return JSON.parse(raw);} catch (_) {return raw;}
  }
  function schedule(entry, milliseconds) {
    if (entry.timer !== null) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {entry.timer = null; void save(entry);}, milliseconds);
  }
  function change(key, value, removed) {
    const snapshot = removed ? null : JSON.parse(JSON.stringify(value));
    const token = id(namespace, key);
    let entry = entries.get(token);
    if (!entry) {
      entry = {namespace, key, version: 0, timer: null, inFlight: null};
      entries.set(token, entry);
    }
    Object.assign(entry, {token: window.crypto?.randomUUID?.() || Date.now() + ':' + Math.random(), value: snapshot, removed, version: entry.version + 1, dirty: true, attempts: 0, error: null});
    if (removed) AppUIStorage.remove(prefix(namespace, key));
    else AppUIStorage.setJSON(prefix(namespace, key), snapshot);
    persist(entry, true); schedule(entry, DEBOUNCE_MS); notify();
  }
  function set(key, value) {change(key, value, false);}
  function remove(key) {change(key, null, true);}
  async function save(entry, keepalive = false) {
    if (entry.timer !== null) {clearTimeout(entry.timer); entry.timer = null;}
    if (entry.inFlight) {
      const wanted = entry.version, sending = entry.sendingVersion;
      await entry.inFlight;
      return entry.dirty && wanted !== sending ? save(entry, keepalive) : !entry.dirty;
    }
    if (!entry.dirty) return true;
    const version = entry.version, value = entry.value;
    entry.sendingVersion = version;
    entry.inFlight = (async () => {
      // Start on a microtask so inFlight is installed even for a synchronous throw.
      await Promise.resolve();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch('/api/config.set', {method: 'POST', keepalive, signal: controller.signal,
          headers: {'Content-Type': 'application/json'}, body: JSON.stringify({key: entry.namespace + '.' + entry.key, value})});
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const data = response.status === 204 ? null : await response.json();
        if (data && (data.ok === false || data.error || data._error)) throw new Error(data.error || data._error || 'Configuration save failed');
        if (entry.version === version) {entry.dirty = false; entry.error = null; entry.attempts = 0;}
        return true;
      } catch (error) {
        if (entry.version === version) {entry.error = error.message; entry.attempts++;}
        return false;
      } finally {
        clearTimeout(timer); entry.inFlight = null;
        if (entry.dirty) {
          if (entry.version !== version) schedule(entry, DEBOUNCE_MS);
          else if (entry.attempts <= RETRY_LIMIT) schedule(entry, Math.min(1000 * 2 ** (entry.attempts - 1), 30000));
        }
        persist(entry); notify();
      }
    })();
    notify();
    return entry.inFlight;
  }
  function flush({keepalive = false} = {}) {
    return Promise.all([...entries.values()].filter(entry => entry.dirty || entry.inFlight).map(entry => save(entry, keepalive)));
  }
  function getAll() {
    const result = Object.create(null), start = prefix(namespace, '');
    for (const storageKey of AppUIStorage.keys(start)) {
      const key = storageKey.slice(start.length); result[key] = get(key);
    }
    for (const entry of entries.values()) {
      if (entry.namespace !== namespace) continue;
      if (entry.removed) delete result[entry.key]; else result[entry.key] = get(entry.key);
    }
    return result;
  }
  // Restore unacknowledged edits, including deletion tombstones. They are
  // retried when their namespace initializes or when the caller flushes.
  try {
    for (const journalKey of AppUIStorage.keys(JOURNAL_PREFIX)) {
      let record;
      try {record = JSON.parse(AppUIStorage.get(journalKey));} catch (_) {continue;}
      if (!record || typeof record.namespace !== 'string' || typeof record.key !== 'string' || typeof record.token !== 'string' ||
          typeof record.removed !== 'boolean' || (!record.removed && record.value === undefined)) continue;
      entries.set(id(record.namespace, record.key), {...record, version: 1, dirty: true, attempts: 0,
        error: null, timer: null, inFlight: null});
    }
  } catch (_) { /* Keep browser-storage failure isolated from the runtime. */ }
  window.addEventListener('beforeunload', () => {void flush({keepalive: true});});
  return {init, get, set, remove, flush, getAll, getStatus, onStatus};
})();
window.AppUIConfigStore = AppUIConfigStore;
