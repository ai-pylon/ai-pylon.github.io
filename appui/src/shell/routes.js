/* Query/hash route behavior, with the shared router used when available. */
window.AppUIShellRoutes = {
  create({getAppId, getRouter, onRoute}) {
    const prefix = () => `appui.${getAppId() || 'page'}.`, hashes = () => new URLSearchParams(location.hash.replace(/^#/, ''));
    const get = key => getRouter()?.get(key) ?? new URLSearchParams(location.search).get(prefix() + key);
    const set = (key, value, silent) => { const router = getRouter(); if (router) { router.set(key, value, {replace: true, silent: true}); if (!silent) onRoute(key, value); return; } const url = new URL(location.href), name = prefix() + key; if (value == null || value === '') url.searchParams.delete(name); else url.searchParams.set(name, value); history.replaceState(history.state, '', url); if (!silent) onRoute(key, value); };
    const getHash = key => getRouter()?.getHash(key) ?? hashes().get(key);
    const setHashes = (routes, options) => { const router = getRouter(); if (router) { router.setHash(routes, Object.assign({replace: false, silent: false, reset: false}, options)); return true; } const settings = Object.assign({replace: false, silent: false, reset: false}, options), params = settings.reset ? new URLSearchParams() : hashes(); Object.entries(routes || {}).forEach(([key, value]) => value == null || value === '' ? params.delete(key) : params.set(key, String(value))); const url = new URL(location.href); url.hash = params.toString() || ''; if (url.href === location.href) return false; history[settings.replace ? 'replaceState' : 'pushState'](history.state, '', url); if (!settings.silent) onRoute(null, null); return true; };
    const bind = () => { if (getRouter()) return null; const listener = () => onRoute(null, null); addEventListener('popstate', listener); addEventListener('hashchange', listener); return listener; };
    return {get, set, hashes, getHash, setHash: (key, value, options) => setHashes({[key]: value}, options), setHashes, bind};
  },
};
