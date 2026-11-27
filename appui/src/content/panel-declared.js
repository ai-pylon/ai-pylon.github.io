'use strict';
/* Private AppUIPanelApp controller; load through the feedback bundle. */
window._AppUIPanelDeclared = {create: function ({listSidebars, embedSidebar}) {
  async function mountDeclaredSidebars(opts) {
    opts = opts || {};
    const appId = opts.appId;
    if (!appId) return function dispose() {};
    const base = opts.baseUrl || '';
    let declared = [];
    try {
      const r = await AppUIApi.requestResponse(base + '/v1/apps', undefined,
        { credentials: 'same-origin', timeout: null });
      const j = r.data;
      const app = ((j && j.apps) || []).find((x) => x && x.app_id === appId);
      declared = (app && app.sidebars_shown) || [];
    } catch (_e) { declared = []; }
    if (!declared.length) return function dispose() {};
    const specs = await listSidebars(base);
    const byType = Object.create(null);
    for (const s of specs) byType[s.type] = s;
    const Hooks = window.AppUIHostHooks;
    const disposers = [];
    for (const entry of declared) {
      const spec = byType[entry.type];
      if (!spec) { try { console.warn('sidebars_shown: no gallery provider for type "' + entry.type + '"'); } catch (_e) {} continue; }
      const position = entry.position || spec.position || 'right';
      const host = (opts.hosts && opts.hosts[position]) || opts.defaultHost
        || document.getElementById('app-' + position) || document.getElementById('app-right');
      if (!host) { try { console.warn('sidebars_shown: no host element for position "' + position + '"'); } catch (_e) {} continue; }
      // Resolve page host hooks (context/onAction/system/…) against needs_host.
      let hostHooks = {};
      if (spec.needs_host && Hooks && entry.host_hooks) {
        const { host: resolved, missing } = Hooks.resolve(spec.needs_host, entry.host_hooks);
        hostHooks = resolved;
        if (missing.length) { try { console.warn('sidebars_shown: "' + entry.type + '" missing required host hooks: ' + missing.join(', ')); } catch (_e) {} }
      }
      const config = Object.assign({}, entry.config, hostHooks);
      // a SIDE region the page didn't size takes the provider's declared width:
      // otherwise it grows to its content (a chat's starter-prompt chips are one
      // long row) and squeezes the page's content to a sliver
      const shellRegion = !(opts.hosts && opts.hosts[position]) && !opts.defaultHost
        && host && (host.id === 'app-right' || host.id === 'app-left');
      if (shellRegion && (position === 'right' || position === 'left') && !host.style.width) {
        const w = Number((entry.config && entry.config.width) || entry.width || spec.width) || 380;
        host.style.width = w + 'px'; host.style.maxWidth = '60vw'; host.style.overflowX = 'hidden';
      }
      // name what is mounted here, so a later gallery "add" can keep it as the
      // region's first TAB (shell addSidebar adopts a declared sidebar)
      try { host.setAttribute('data-declared-sidebar', (spec.icon ? spec.icon + ' ' : '') + ((entry.config && entry.config.title) || spec.label || entry.type)); } catch (_e) {}
      try {
        // For the AI chat type, prefer the turnkey AppUIChatPanel so the
        // structured-action contract (onAction) + context cap/change-gate apply
        // — the shell's ai-sidebar renderer doesn't wire onAction. Fall back to
        // the generic gallery embed for every other type (or if the panel
        // helper isn't loaded).
        if (spec.type === 'ai-sidebar' && window.AppUIChatPanel
            && (entry.profile || config.onAction || config.context || config.system)) {
          if (spec.bundle && window.AppUIAssets && window.AppUIAssets.load) { try { await window.AppUIAssets.load(spec.bundle); } catch (_e) {} }
          // When the entry names a manifest CHAT PROFILE, mount via mountProfile
          // so the system prompt + tool scope come from the profile (server-side,
          // single source) and the page only supplies the live hooks in config.
          const panel = (entry.profile && window.AppUIChatPanel.mountProfile)
            ? await window.AppUIChatPanel.mountProfile(host, String(entry.profile), config)
            : window.AppUIChatPanel.mount(host, config);
          if (panel && typeof panel.destroy === 'function') disposers.push(() => panel.destroy());
        } else {
          const dispose = await embedSidebar(spec, host, config);
          if (typeof dispose === 'function') disposers.push(dispose);
        }
      } catch (_e) { /* best-effort per sidebar */ }
    }
    return function dispose() { for (const d of disposers.splice(0)) { try { d(); } catch (_e) {} } };
  }

  return {mountDeclaredSidebars};
}};
