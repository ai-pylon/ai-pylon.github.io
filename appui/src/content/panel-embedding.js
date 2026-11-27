'use strict';
/* Private AppUIPanelApp controller; load through the feedback bundle. */
window._AppUIPanelEmbedding = {create: function ({_defs, mountInto, ensureSidebarAssets}) {
  async function embedSidebar(spec, host, config) {
    await ensureSidebarAssets(spec);
    const mergedConfig = Object.assign({}, spec && spec.config, config);
    // 1) PREFERRED: a panel-app def registered for this type → mount it DIRECTLY
    //    (no shell renderer, no shell-bundle load). This is what makes embedding
    //    safe on bespoke/shim pages (loading the full shell bundle there can
    //    re-init and wipe the host page).
    const def = _defs[spec.type] || (spec.type === 'feedback' ? window.FeedbackApp : null);
    if (def && typeof (def.mountSidebar || def.mount) === 'function') {
      return mountInto(def, host, {mode: 'sidebar', config: mergedConfig});
    }
    // 2) SHELL TYPES (e.g. 'ai-sidebar'): go through the shell renderer. Only
    //    load the shell bundle if it's genuinely needed and not already present.
    if (!(window.AppUIShellSidebarRenderer && window.AppUIShellSidebarRenderer.render)) {
      try { await window.AppUIAssets?.load?.('shell'); } catch (_e) {}
    }
    try {
      if (window.AppUIShellSidebarRenderer && window.AppUIShellSidebarRenderer.render) {
        return window.AppUIShellSidebarRenderer.render({
          sidebar: {type: spec.type, config: mergedConfig},
          container: host, position: 'right',
          renderSlot: (s, el) => { el.textContent = 'sidebar type "' + spec.type + '" not available'; },
          initAISidebar: (c, s) => {
            return window.AppUIAISidebarFeature && window.AppUIAISidebarFeature.mount
              ? window.AppUIAISidebarFeature.mount({container: c, sidebar: s, appId: spec.app_id})
              : null;
          },
          discoverPlugins: () => [], layout: {}, writeLayout: () => {},
          setTabs: () => {},
        });
      }
    } catch (_e) { /* fall through */ }
    host.textContent = 'Could not embed sidebar "' + (spec.label || spec.type) + '".';
    return function dispose() { try { host.replaceChildren(); } catch (_e) {} };
  }

  // ONE way to mount a gallery-picked CHAT (used by the dock embed below AND the
  // shell's "add as a tab" path): a chat_profile card mounts its profile; the
  // generic AI chat mounts with the PAGE AGENT on (the model sees the page as a
  // tree and can fill / click / select / read its elements). Either way the
  // page's own hooks registered under AppUIHostHooks 'page' (its live context +
  // semantic actions, e.g. a table's page.sql) are merged in and run FIRST.
  // Returns true when it mounted a chat (false: not a chat spec).
  async function mountChat(spec, host, cfg) {
    const isChat = spec && (spec._isProfile || spec.type === 'ai-sidebar');
    if (!isChat || !window.AppUIChatPanel || typeof window.AppUIChatPanel.mountProfile !== 'function') {
      if (isChat && window.AppUIAssets && window.AppUIAssets.load) {
        try { await window.AppUIAssets.load(spec.bundle || 'aiSidebar'); } catch (_e) {}
      }
      if (!isChat || !window.AppUIChatPanel || typeof window.AppUIChatPanel.mountProfile !== 'function') return false;
    }
    const merged = Object.assign({}, spec.config, cfg || {},
      {bundle: spec.bundle || 'aiSidebar', examplePrompts: spec.example_prompts || []});
    const ph = window.AppUIHostHooks && window.AppUIHostHooks.get && window.AppUIHostHooks.get('page');
    if (ph) {
      if (typeof ph.context === 'function' && typeof merged.context !== 'function') merged.context = ph.context;
      if (typeof ph.onAction === 'function' && typeof merged.onAction !== 'function') merged.onAction = ph.onAction;
      if (typeof ph.onToolCall === 'function' && typeof merged.onToolCall !== 'function') merged.onToolCall = ph.onToolCall;
      if (ph.system && !merged.system) merged.system = ph.system;
    }
    // a profile decides its own page_agent; the generic chat gets it on
    if (!spec._isProfile && merged.pageAgent == null) merged.pageAgent = true;
    await window.AppUIChatPanel.mountProfile(host, spec._isProfile ? spec.profile : 'ai/llm_server.chat', merged);
    return true;
  }

  // Open the SIDEBAR GALLERY as a dialog from ANY page (shell OR shim). Fetches
  // /v1/sidebars, shows a card grid, and on pick embeds the chosen sidebar into
  // the page's right <aside> (revealing it). ``opts`` = { toggleRightSidebar?,
  // hostApp?, baseUrl? }. Self-contained so a bespoke page (e.g. the workspace,
  // which doesn't load the shell command layer) can wire it to a menu item.
  async function _embedIntoRight(opts, spec, cfg) {
    const host = document.getElementById('app-right');
    if (!host) return false;
    try { if (host.classList.contains('ai-app-hidden') && typeof opts.toggleRightSidebar === 'function') opts.toggleRightSidebar(); } catch (_e) {}
    host.classList.remove('ai-app-hidden');
    // ADD, don't replace: mount into a dedicated per-type sub-panel appended to
    // the right region. Re-opening the same type reuses/refreshes its panel.
    let panel = host.querySelector('[data-gallery-type="' + spec.type + '"]');
    if (!panel) {
      panel = document.createElement('div');
      panel.setAttribute('data-gallery-type', spec.type);
      panel.style.cssText = 'height:100%;display:flex;flex-direction:column;min-height:0';
      host.appendChild(panel);
    } else {
      panel.replaceChildren();
    }
    const config = Object.assign({hostApp: opts.hostApp || null}, cfg || {});
    try {
      // #11 — a CHAT PROFILE spec: mount via AppUIChatPanel.mountProfile so the
      // picked assistant brings its declared system prompt + tool scope +
      // default backend. The gallery's inline system/context form still wins
      // (merged as opts). #12 — pass the profile's example_prompts so the empty
      // chat can render them as one-tap starter chips.
      // a chat (profile card or the generic AI chat): the action-capable panel
      // with the page's hooks + the page agent (mountChat above)
      if (await mountChat(spec, panel, config)) return true;
      await embedSidebar(spec, panel, config); return true;
    } catch (e) {
      // say WHY (the caller only toasts "Could not open …")
      try { (window.AppUILogger?.console('appui/sidebar-gallery') || console).warn('could not embed sidebar', spec && spec.type, e); } catch (_e2) {}
      return false;
    }
  }

  // --- MANIFEST-DRIVEN sidebar embedding (the DEMAND side) ----------------
  // Mount the sidebars an app's manifest DECLARES via `sidebars_shown`, so a
  // page gets e.g. the AI chat from a manifest edit instead of page code. For
  // each declared {type, position?, config?, host_hooks?}:
  //   1. resolve `type` against the gallery (GET /v1/sidebars),
  //   2. if the provider spec declares `needs_host`, resolve the page's live
  //      hooks registered under `host_hooks` (AppUIHostHooks) and merge the
  //      accepted ones (context/onAction/system/…) into the embed config,
  //   3. embed into the host element for its `position` (default right).
  // Returns dispose() that tears down every mounted sidebar. `opts`:
  //   { appId, baseUrl?, hosts?:{right,left,bottom}, defaultHost? }.
  // Missing REQUIRED host hooks are warned (console) but don't block the mount
  // (the sidebar still embeds without them); OPTIONAL ones are simply omitted.
  return {embedSidebar, _embedIntoRight, mountChat};
}};
