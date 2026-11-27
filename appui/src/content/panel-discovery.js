/* Private AppUIPanelApp controller; load through the feedback bundle. */
window._AppUIPanelDiscovery = (function () {
  'use strict';
  async function listSidebars(baseUrl) {
    const url = (baseUrl || '') + '/v1/sidebars';
    try {
      const r = await AppUIApi.requestResponse(url, undefined, {credentials: 'same-origin', timeout: null});
      const j = r.data;
      return (j && j.sidebars) || [];
    } catch (_e) { return []; }
  }

  // #11 — list the manifest-declared CHAT PROFILES as embeddable gallery items.
  // Each profile (git assistant, KB assistant, …) becomes an `ai-sidebar` spec a
  // user can pick on ANY page — turning the fleet of profiles into a cross-page
  // assistant menu, not just the apps that declare a `sidebar` block. Uses the
  // lightweight summary listing (no system prompt shipped). Returns gallery-spec
  // shaped objects tagged with `profile` so _embedIntoRight mounts via
  // AppUIChatPanel.mountProfile.
  async function listChatProfiles(baseUrl) {
    const url = (baseUrl || '') + '/v1/apps/ai/llm_server/profiles';
    try {
      const r = await AppUIApi.requestResponse(url, {summary: true}, {
        method: 'POST', headers: {'content-type': 'application/json'},
        credentials: 'same-origin', timeout: null,
      });
      const j = r.data;
      const profs = (j && (j.profiles || (j.result && j.result.profiles))) || [];
      return profs.map(p => ({
        type: 'ai-sidebar',
        profile: p.id,
        app_id: p.app_id || p.id,
        label: p.label || p.id,
        icon: '\uD83E\uDD16',   // 🤖
        bundle: 'aiSidebar',
        description: (p.description || '')
          + (Array.isArray(p.scope) && p.scope.length
              ? ('  \u00b7 tools: ' + p.scope.slice(0, 4).join(', ')
                 + (p.scope.length > 4 ? '\u2026' : '')) : '')
          + (Array.isArray(p.actions) && p.actions.length
              ? ('  \u00b7 can: ' + p.actions.join(', ')) : ''),
        example_prompts: p.example_prompts || [],
        config: {title: p.label || p.id, profile: p.id},
        _isProfile: true,
      }));
    } catch (_e) { return []; }
  }

  // Load a sidebar spec's assets (bundle + per-app renderer modules), so its
  // `type` becomes available to the shell/registerType. Idempotent-ish (the
  // loader de-dupes). Returns a promise resolving when ready.
  //
  // Perf (#14): the per-app renderer modules in `spec.assets` are independent of
  // each other, so load them in PARALLEL (Promise.all) rather than awaiting each
  // in series. The named `bundle` is loaded FIRST because an asset renderer may
  // depend on a global the bundle exposes. Across tabs/specs the loader already
  // de-dupes by URL (`_modulePromises`/bundle promise map), so two panels that
  // share a bundle or asset fetch it once even when mounted concurrently.
  async function ensureSidebarAssets(spec) {
    if (!spec) return;
    const A = window.AppUIAssets;
    if (!A) return;
    try {
      if (spec.bundle && A.load) await A.load(spec.bundle);
      const assets = spec.assets || [];
      if (assets.length && A.loadModule) {
        await Promise.all(assets.map((a) => A.loadModule(a).catch(() => {})));
      }
    } catch (_e) { /* best-effort */ }
  }

  // Embed a discovered sidebar spec into a host element RIGHT NOW: load its
  // assets, then render its registered type via the shell's panel renderer.
  // Returns dispose(). This is what a "gallery" item's "Open" action calls.
  return {listSidebars, listChatProfiles, ensureSidebarAssets};
})();
