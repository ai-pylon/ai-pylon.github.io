/**
 * Content/PanelApp — the "page ⇄ sidebar" duality helper.
 *
 * MOTIVATION: a simple app's UI is just "render some controls into a host
 * element". Whether that host is the PAGE content area or a SIDEBAR panel should
 * not force a fork — but an app should be ABLE to diverge the two surfaces when
 * it genuinely needs to, and re-unify later with one deletion. This helper gives
 * both: a single `mount` for the unified case, and optional per-surface
 * overrides (`mountPage` / `mountSidebar`) for the diverged case.
 *
 * RESOLUTION (per surface): mountPage  ?? mount   for the page,
 *                           mountSidebar ?? mount  for a sidebar.
 * So:
 *   - UNIFIED app  → provide only `mount`. Page and sidebar render identically.
 *   - DIVERGED app → provide `mountPage` and/or `mountSidebar` (optionally plus
 *                    a shared `mount` fallback). Each surface renders its own.
 *   - RE-UNIFY     → delete the override(s); both fall back to `mount` again.
 * Every renderer has the SAME signature `(host, ctx) -> cleanup`, so moving code
 * between the shared `mount` and a per-surface override is copy/paste.
 *
 * An app definition:
 *   {
 *     id:    'documents/feedback',           // app id (page id / config key)
 *     title: 'Feedback',
 *     mount:        function(host, ctx){…},  // shared renderer (fallback)
 *     mountPage:    function(host, ctx){…},  // optional — PAGE-only renderer
 *     mountSidebar: function(host, ctx){…},  // optional — SIDEBAR-only renderer
 *     sidebarType:  'feedback',              // optional shell type id
 *   }
 *   ctx = { mode:'page'|'sidebar', config, setStatus(t), scope }
 *   Each renderer returns an optional cleanup() called on dispose.
 *
 * PAGE usage:     AppUIPanelApp.page(def);
 * SIDEBAR type:   AppUIPanelApp.registerSidebarType(def);   // then rightSidebar:
 *                   { tabs:[{ type:def.sidebarType, config:{…} }] }
 * Ad-hoc mount:   AppUIPanelApp.mountInto(def, el, {mode:'sidebar', config});
 *
 * Exposes: window.AppUIPanelApp
 */
window.AppUIPanelApp = (function() {
  'use strict';

  function _status(mode) {
    return function(t) {
      try {
        if (window.AIApp && window.AIApp.setStatus) return window.AIApp.setStatus(t);
        if (window.AppUI && window.AppUI.setStatus) return window.AppUI.setStatus(t);
      } catch (_e) { /* best-effort */ }
    };
  }

  // Pick the renderer for a surface: the per-surface override wins, else the
  // shared `mount`. Returns null if the app provides neither for this surface.
  function rendererFor(def, mode) {
    if (!def) return null;
    if (mode === 'sidebar') return def.mountSidebar || def.mount || null;
    return def.mountPage || def.mount || null;
  }

  // Does this def diverge the two surfaces? (purely informational — useful for
  // tooling/debug: "unified" vs "diverged".)
  function isDiverged(def) {
    return !!(def && (def.mountPage || def.mountSidebar)
      && (def.mountPage || def.mount) !== (def.mountSidebar || def.mount));
  }

  // Mount an app def into ANY host element. Returns a dispose() function.
  // ``opts`` = { mode:'page'|'sidebar', config, scope, setStatus }.
  function mountInto(def, host, opts) {
    opts = opts || {};
    if (!host) throw new Error('AppUIPanelApp: host element required');
    const mode = opts.mode || 'page';
    const render = rendererFor(def, mode);
    if (typeof render !== 'function') {
      throw new Error('AppUIPanelApp: no renderer for mode "' + mode
        + '" — provide mount, or mount' + (mode === 'sidebar' ? 'Sidebar' : 'Page'));
    }
    const ctx = {
      mode,
      config: opts.config || {},
      scope: opts.scope || null,
      setStatus: typeof opts.setStatus === 'function' ? opts.setStatus : _status(mode),
    };
    let disposed = false;
    let cleanup = null;
    try { cleanup = render(host, ctx); } catch (e) {
      host.innerHTML = '<div style="padding:12px;color:#c33;font-size:12px">'
        + (def.title || def.id || 'app') + ' failed to mount: '
        + (e && e.message ? e.message : e) + '</div>';
    }
    return function dispose() {
      if (disposed) return; disposed = true;
      try { if (typeof cleanup === 'function') cleanup(); } catch (_e) {}
      try { host.replaceChildren(); } catch (_e) { host.innerHTML = ''; }
    };
  }

  // Wire the def as an AppUI PAGE: creates the app and renders the PAGE surface
  // into the content body. Returns the AppUI app handle.
  function page(def, appOpts) {
    if (!window.AppUI || !window.AppUI.createApp) throw new Error('AppUIPanelApp.page: AppUI.createApp unavailable');
    let app = null;
    app = window.AppUI.createApp(Object.assign({
      id: def.id,
      title: def.title || def.id,
      content: {render: function(el) {
        mountInto(def, el, {mode: 'page', config: def.config || {},
          setStatus: function(t) { try { app && app.setStatus && app.setStatus(t); } catch (_e) {} }});
      }},
      statusBar: {left: def.statusLeft || 'Ready'},
    }, appOpts || {}));
    return app;
  }

  // Register the def as a shell SIDEBAR TYPE, so any page can declare
  //   rightSidebar: { tabs:[{ type:def.sidebarType, config:{...} }] }
  // and get the SIDEBAR surface. Idempotent.
  const _registered = Object.create(null);
  const _defs = Object.create(null);   // type -> def, for direct embedding (no shell)
  function registerSidebarType(def) {
    const type = def.sidebarType || def.id;
    if (!type) throw new Error('AppUIPanelApp.registerSidebarType: def.sidebarType/id required');
    _defs[type] = def;   // remember the def so embedSidebar can mount it directly
    const Renderer = window.AppUIShellSidebarRenderer;
    if (!Renderer || !Renderer.registerType) return false;   // shell not loaded yet
    if (_registered[type]) return true;
    _registered[type] = true;
    Renderer.registerType(type, function(spec, container) {
      const config = (spec && spec.config) || spec || {};
      return mountInto(def, container, {mode: 'sidebar', config});
    });
    return true;
  }

  // --- SIDEBAR GALLERY (manifest-driven discovery) ------------------------
  // Fetch every app that declares a `sidebar` in its manifest (GET /v1/sidebars).
  // A consumer page uses this to build a gallery and embed any sidebar by type.
  const {listSidebars, listChatProfiles, ensureSidebarAssets} = window._AppUIPanelDiscovery;
  const {embedSidebar, _embedIntoRight, mountChat} = window._AppUIPanelEmbedding.create({
    _defs, mountInto, ensureSidebarAssets});
  const {openGallery} = window._AppUIPanelGallery.create({
    listSidebars, listChatProfiles, _embedIntoRight});
  const {mountDeclaredSidebars} = window._AppUIPanelDeclared.create({listSidebars, embedSidebar});

  return {mountInto, page, registerSidebarType, rendererFor, isDiverged,
          listSidebars, listChatProfiles, ensureSidebarAssets, embedSidebar,
          openGallery, mountDeclaredSidebars, mountChat};
})();
