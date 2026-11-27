/* Namespaced query and hash route helpers. */
var AppUIRouter = (function() {
  // Optional SHORT ALIASES: map a verbose router param (appui.<id>.<key>) to a
  // short query param (e.g. ?wpath=). When registered via AppUIRouter.alias(),
  // get() reads EITHER form and set() writes the SHORT one — so the address bar
  // stays short with no verbose↔short flicker. Parity with the AppForge shim.
  const _aliases = {};
  const _aliasKey = (appId, key) => `${appId || 'page'}.${key}`;
  function create(appId, onRoute) {
    const scope=AppUILifecycle.createScope();
    const bindings=window._AppUIRouterBindings.create({get:key=>api.get(key),set:(...args)=>api.set(...args)});
    scope.add(bindings);
    const prefix = `appui.${appId || 'page'}.`;
    const hashRoutes = () => new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const notify = () => onRoute?.();
    const hashListener = () => notify();
    const popstateListener = () => { api.restore(); notify(); };
    scope.listen(window,'popstate',popstateListener);
    scope.listen(window,'hashchange',hashListener);

    const api = {
      get(key) {
        const q = new URLSearchParams(window.location.search);
        const v = q.get(prefix + key);
        if (v != null) return v;
        const sh = _aliases[_aliasKey(appId, key)];
        return sh ? q.get(sh) : null;
      },
      set(key, value, {replace = false, silent = false} = {}) {
        const url = new URL(window.location.href);
        const sh = _aliases[_aliasKey(appId, key)];
        const name = sh || (prefix + key);   // write the SHORT alias when registered
        url.searchParams.delete(prefix + key);
        if (sh) url.searchParams.delete(sh);
        if (value === undefined || value === null || value === '') { /* cleared */ }
        else url.searchParams.set(name, String(value));
        history[replace ? 'replaceState' : 'pushState'](history.state, '', url);
        if (!silent) notify();
      },
      getHash(key) { return hashRoutes().get(key); },
      setHash(values, {replace = false, reset = false, silent = false} = {}) {
        const params = reset ? new URLSearchParams() : hashRoutes();
        Object.entries(values || {}).forEach(([key, value]) => {
          if (value === undefined || value === null || value === '') params.delete(key);
          else params.set(key, String(value));
        });
        const url = new URL(window.location.href); url.hash = params.toString();
        history[replace ? 'replaceState' : 'pushState'](history.state, '', url);
        if (!silent) notify();
      },

      /**
       * Declaratively bind elements to URL params.
       * 
       * Usage:
       *   router.bind(container)  — scans for [data-url-param] elements
       *   router.bind(element, 'paramName')  — bind a single element
       * 
       * Supported elements:
       *   <select data-url-param="db">  — syncs selected value ↔ URL
       *   <input data-url-param="search">  — syncs input value ↔ URL
       *   <div data-url-param="table" data-url-value="nodes">  — click sets URL
       * 
       * On page load: reads URL → sets element state.
       * On interaction: updates URL from element.
       * On popstate: restores element state from URL.
       */
      bind(elOrContainer, paramName) { bindings.bind(elOrContainer,paramName); },

      /** Restore all bound elements from current URL. Call after DOM updates. */
      restore(container) { bindings.restore(container); },

      destroy() { scope.destroy(); },
    };

    return api;
  }
  function alias(appId, key, shortName) { _aliases[_aliasKey(appId, key)] = shortName; }
  return {create, alias};
})();
window.AppUIRouter = AppUIRouter;
