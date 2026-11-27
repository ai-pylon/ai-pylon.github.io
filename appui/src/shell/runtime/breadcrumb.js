/* Breadcrumb navigation bar for AppUI shell.
 * API: AppUI.breadcrumb.set(['Platform', 'Page', 'Section'])
 */
window.AppUIShellBreadcrumb = (function() {
  let _el = null, _segs = [];
  let _router = null, _routerConfig = null;
  let _initialized = false;
  let _readyHandler = null;
  const initFrame = AppUILifecycle.createFrameTask(init);

  function el() {
    if (_el && _el.isConnected) return _el;
    const top = document.getElementById('app-content-top');
    if (!top) return null;
    _el = top.querySelector('.breadcrumb-bar');
    if (!_el) { _el = document.createElement('nav'); _el.className = 'breadcrumb-bar'; _el.setAttribute('aria-label', 'Breadcrumb'); top.insertBefore(_el, top.firstChild); }
    return _el;
  }

  function render() {
    const c = el(); if (!c) return;
    const ol = document.createElement('ol'); ol.className = 'breadcrumb-list';
    for (let i = 0; i < _segs.length; i++) {
      const li = document.createElement('li'); li.className = 'breadcrumb-item';
      if (i === _segs.length - 1) { li.innerHTML = `<span class="breadcrumb-current" aria-current="page">${esc(_segs[i])}</span>`; }
      else { li.innerHTML = `<a class="breadcrumb-link" href="#">${esc(_segs[i])}</a><span class="breadcrumb-sep" aria-hidden="true">›</span>`; li.querySelector('a').onclick = e => { e.preventDefault(); nav(i); }; }
      ol.appendChild(li);
    }
    c.innerHTML = ''; c.appendChild(ol);
  }

  function nav(i) {
    if (i === 0) { window.location.href = '/pages/framework/manager/'; return; }
    _segs = _segs.slice(0, i + 1); render();
    if (i === 1 && location.hash) history.pushState(null, '', location.pathname);
  }

  function esc(s) { const d = document.createElement('span'); d.textContent = s; return d.innerHTML; }

  /** Build breadcrumb segments from router hash params using the mapping config. */
  function buildRouterSegments() {
    const t = document.body.getAttribute('data-page-title') || document.title || 'Page';
    const base = ['Platform', t];
    if (!_router || !_routerConfig || !_routerConfig.mapping) return base;
    const mapped = [];
    for (let i = 0; i < _routerConfig.mapping.length; i++) {
      const m = _routerConfig.mapping[i];
      const val = _router.getHash(m.param);
      if (val === null || val === '') continue;
      let display;
      if (typeof m.label === 'function') { display = m.label(val); }
      else if (typeof m.format === 'function') { display = m.format(val); }
      else if (typeof m.label === 'string') { display = m.label; }
      else { display = val; }
      if (display) mapped.push(String(display));
    }
    return base.concat(mapped);
  }

  /** Handle hash/route change — uses router mapping if connected, raw hash otherwise. */
  function onHashChange() {
    if (_router && _routerConfig) {
      _segs = buildRouterSegments(); render();
    } else {
      const h = location.hash.replace(/^#\/?/, '');
      if (h) { const t2 = document.body.getAttribute('data-page-title') || document.title || 'Page'; _segs = ['Platform', t2, decodeURIComponent(h).replace(/[/_-]/g, ' ')]; render(); }
    }
  }

  function init() {
    if (_initialized) return;
    _initialized = true;
    const t = document.body.getAttribute('data-page-title') || document.title || 'Page';
    _segs = ['Platform', t]; render();
    window.addEventListener('hashchange', onHashChange);
    window.addEventListener('popstate', onHashChange);
  }

  function destroy() {
    if (_readyHandler) document.removeEventListener('DOMContentLoaded', _readyHandler);
    initFrame.cancel();
    window.removeEventListener('hashchange', onHashChange);
    window.removeEventListener('popstate', onHashChange);
    _el?.remove();
    _el = null; _router = null; _routerConfig = null;
    _readyHandler = null; _initialized = false;
  }

  const scheduleInit = () => initFrame.schedule();
  if (document.readyState === 'loading') {
    _readyHandler = () => { _readyHandler = null; scheduleInit(); };
    document.addEventListener('DOMContentLoaded', _readyHandler, {once: true});
  } else scheduleInit();

  return {
    set(segs) { if (Array.isArray(segs) && segs.length) { _segs = segs.map(String); render(); } },
    push(s) { _segs.push(String(s)); render(); },
    pop() { if (_segs.length > 1) { _segs.pop(); render(); } },
    get() { return [..._segs]; },
    init,
    destroy,

    /**
     * Connect an AppUIRouter instance so breadcrumbs auto-update from hash params.
     * @param {object} router - AppUIRouter.create() instance with getHash() method
     * @param {object} config - { mapping: [{param, label?, format?}] }
     *   - param: hash param key to read from the router
     *   - label: string for static display, or function(value) => display text
     *   - format: function(value) => display text (used when label is not a function)
     */
    connectRouter(router, config) {
      if (!router || typeof router.getHash !== 'function') return;
      _router = router; _routerConfig = config || {};
      // Immediately rebuild from current hash state
      _segs = buildRouterSegments(); render();
    },

    /** Disconnect router integration; reverts to raw-hash breadcrumb behaviour. */
    disconnectRouter() { _router = null; _routerConfig = null; },
  };
})();
