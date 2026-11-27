/** Resolve daemon HTTP ports without guessing categorized page paths. */
window.AppUIDaemonPorts = (() => {
  const _cache = {};
  const STORAGE_KEY = 'daemon_ports';
  let _registryPromise = null;
  let _registryLoaded = false;

  try {
    Object.assign(_cache, JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '{}'));
  } catch (_) {}

  function _save() {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(_cache)); } catch (_) {}
  }

  async function _loadRegistry() {
    if (_registryLoaded) return;
    if (!_registryPromise) {
      _registryPromise = fetch('/ports', {signal: AbortSignal.timeout(3000)}).then(async response => {
        if (!response.ok) throw new Error('Port registry returned HTTP ' + response.status);
        const ports = await response.json();
        if (!ports || typeof ports !== 'object' || Array.isArray(ports)) throw new Error('Invalid port registry');
        Object.assign(_cache, ports);
        _registryLoaded = true;
        _save();
      }).finally(() => { _registryPromise = null; });
    }
    return _registryPromise;
  }

  async function resolve(daemonName) {
    if (_cache[daemonName]) return _cache[daemonName];
    try { await _loadRegistry(); } catch (_) {}
    return _cache[daemonName] || null;
  }

  function url(daemonName) {
    const port = _cache[daemonName];
    return port ? `http://127.0.0.1:${port}` : null;
  }

  async function urlAsync(daemonName) {
    const port = _cache[daemonName] || await resolve(daemonName);
    return port ? `http://127.0.0.1:${port}` : null;
  }

  function set(daemonName, port) {
    _cache[daemonName] = port;
    _save();
  }

  function get(daemonName) {
    return _cache[daemonName] || null;
  }

  return {resolve, url, urlAsync, set, get};
})();
