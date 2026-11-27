/** Shared classic-script loading with bounded transport and per-caller export checks. */
var AppUIScriptLoader = (() => {
  const requests = new Map();

  function load(url, globalName, {timeout = 10000} = {}) {
    if (globalName && window[globalName] !== undefined) return Promise.resolve(window[globalName]);
    if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 2147483647)
      return Promise.reject(new RangeError('Script timeout must be between 0 and 2147483647 milliseconds, exclusive of 0'));
    let key;
    try {
      const resolved = new URL(url, document.baseURI || window.location.href);
      resolved.hash = '';
      key = resolved.href;
    } catch (error) { return Promise.reject(error); }
    let request = requests.get(key);
    if (!request) {
      let script;
      try {
        script = document.createElement('script');
        script.src = key;
      } catch (error) { return Promise.reject(error); }
      let resolve, reject, settled = false;
      request = new Promise((yes, no) => {resolve = yes; reject = no;});
      requests.set(key, request);
      const timer = setTimeout(() => finish(new Error('Script load timed out: ' + key)), timeout);
      function finish(error) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        script.onload = script.onerror = null;
        if (error) {
          if (requests.get(key) === request) requests.delete(key);
          script.remove();
          reject(error);
        } else resolve(true);
      }
      script.onload = () => finish();
      script.onerror = () => finish(new Error('Failed to load script: ' + key));
      try { document.head.appendChild(script); }
      catch (error) { finish(error); }
    }
    // One URL transport, but each caller validates its own requested export.
    // A missing export does not invalidate another caller's successful load.
    return request.then(() => {
      if (globalName && window[globalName] === undefined)
        throw new Error('Script did not define ' + globalName + ': ' + key);
      return globalName ? window[globalName] : true;
    });
  }

  return { load };
})();
if (typeof window !== 'undefined') window.AppUIScriptLoader = AppUIScriptLoader;
