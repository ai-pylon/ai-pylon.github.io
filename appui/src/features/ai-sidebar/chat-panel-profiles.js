/* Manifest profile loading and page-agent composition, with an explicit mount seam. */
window._AppUIChatPanelProfiles = (() => {
  function create({mount, _appendShotThumb}) {
    // Fetch a manifest-declared CHAT PROFILE from the llm app and merge it into
    // mount opts, then mount. The profile carries the STATIC half (system prompt,
    // tool scope, default backend/model, action types); the caller supplies the
    // LIVE half (context/onAction/confirmAction) + any explicit overrides, which
    // WIN over the profile. This is the one-call "mount the chat the way app X
    // declared it" entry — so a page stops hardcoding the system prompt + scope.
    //   AppUIChatPanel.mountProfile(hostEl, 'platform/tool_catalog.chain', {
    //     context, onAction, confirmAction });
    // Returns the same handle as mount() (via a thin async wrapper: the returned
    // object proxies destroy()/setSystem()/getChat() to the real panel once ready).
    // #23 — client-side memo of the fetched CHAT PROFILE (static manifest data).
    // mountProfile ran a POST /profile on EVERY mount, so a page that re-mounts
    // the panel (tab switch, dock toggle) re-fetched unchanged manifest data each
    // time. Cache the resolved profile per id and reuse it; pass
    // opts.refreshProfile:true to force a refetch, or call
    // AppUIChatPanel.invalidateProfiles() on an app-reload signal to clear it.
    const _profileCache = new Map();        // id -> profile object (resolve:false)
    const _profileInflight = new Map();     // id -> Promise (coalesce concurrent)

    async function _fetchProfileCached(appBase, profileId, force) {
      if (!force && _profileCache.has(profileId)) return _profileCache.get(profileId);
      if (!force && _profileInflight.has(profileId)) return _profileInflight.get(profileId);
      const p = (async () => {
        const r = await fetch(appBase + '/profile', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: profileId, resolve: false }),
        });
        const j = await r.json();
        const prof = (j && (j.profile || (j.result && j.result.profile))) || null;
        if (prof) _profileCache.set(profileId, prof);
        return prof;
      })();
      _profileInflight.set(profileId, p);
      try { return await p; } finally { _profileInflight.delete(profileId); }
    }

    // Drop the memoized profile(s) — call on an app reload/discover so a changed
    // manifest is re-fetched. No arg = clear all; a specific id clears just that.
    function invalidateProfiles(profileId) {
      if (profileId) _profileCache.delete(profileId);
      else _profileCache.clear();
    }

    async function mountProfile(hostEl, profileId, opts) {
      opts = opts || {};
      const appBase = opts.appBase || '/v1/apps/ai/llm_server';
      // #15 — the profile fetch and the aiSidebar BUNDLE load are independent, so
      // run them in PARALLEL instead of serially (fetch → then load). A page
      // mounting the chat otherwise paid two sequential round-trips. The bundle
      // name defaults to 'aiSidebar' (the chat feature) and can be overridden via
      // opts.bundle; pass opts.ensureBundle:false to skip (caller already loaded).
      const bundleName = opts.bundle || 'aiSidebar';
      const wantBundle = opts.ensureBundle !== false
        && window.AppUIAssets && typeof window.AppUIAssets.load === 'function';
      const bundleP = wantBundle
        ? Promise.resolve(window.AppUIAssets.load(bundleName)).catch(() => {})
        : Promise.resolve();
      const profileP = _fetchProfileCached(appBase, profileId, opts.refreshProfile)
        .catch(() => null);
      let prof = null;
      try {
        const [p] = await Promise.all([profileP, bundleP]);
        prof = p;
      } catch (_e) { prof = null; }
      // Profile provides DEFAULTS; explicit opts override. Scope + system come
      // from the profile unless the caller set them.
      const merged = Object.assign({}, opts);
      if (prof) {
        if (merged.system == null) merged.system = prof.system || '';
        if (merged.scope == null && Array.isArray(prof.scope)) merged.scope = prof.scope;
        if (merged.backend == null && prof.backend) merged.backend = prof.backend;
        if (merged.model == null && prof.model) merged.model = prof.model;
        if (merged.title == null && prof.title) merged.title = prof.title;
        if (merged.placeholder == null && prof.placeholder) merged.placeholder = prof.placeholder;
        if (merged.actions == null && Array.isArray(prof.actions)) merged.actions = prof.actions;
        if (merged.configKey == null) merged.configKey = 'pages/' + (prof.id || profileId).replace(/[^\w.-]+/g, '_');
        // #12 — carry the profile's example_prompts so the empty chat renders
        // one-tap starter chips (unless the caller supplied their own).
        if (merged.examplePrompts == null && Array.isArray(prof.example_prompts)) {
          merged.examplePrompts = prof.example_prompts;
        }
      }
      merged.profileId = profileId;

      // ONE-FLAG PAGE AGENT (opt-in): when the caller passes opts.pageAgent (bool
      // or a config object), OR the profile declares `page_agent`, auto-wire the
      // shared AppUIPageIntrospect (so the model SEES the page as a hierarchical,
      // on-demand tree) + AppUIPageActions (so it can fill/click/select/check/read
      // the DOM). This gives any chat_profile page introspection + DOM actions
      // without hand-wiring context()/onAction. A host that supplies its OWN
      // context/onAction keeps them (the page agent only fills what's missing, and
      // composes onAction so BOTH run). Config object keys: {root, verbs,
      // quickFields, confirm, guard, intro, nodes, useDom}.
      const _agentCfg = (opts.pageAgent != null) ? opts.pageAgent
        : (prof && prof.page_agent != null ? prof.page_agent : null);
      if (_agentCfg && window.AppUIPageIntrospect && window.AppUIPageActions) {
        const cfg = (typeof _agentCfg === 'object') ? _agentCfg : {};
        const introspect = window.AppUIPageIntrospect.create({
          useDom: cfg.useDom !== false,
          appId: cfg.appId || (prof && prof.app_id) || profileId.replace(/\.[^.]+$/, ''),
          nodes: cfg.nodes, intro: cfg.intro,
          quickFields: cfg.quickFields,
          maxExpanded: cfg.maxExpanded, valueCap: cfg.valueCap,
        });
        const actions = window.AppUIPageActions.create({
          introspect,
          verbs: cfg.verbs,
          root: cfg.root,
          guard: cfg.guard,
          confirm: cfg.confirm,
          onRead: cfg.onRead,
          onSemantic: cfg.onSemantic,
          defaultGuard: cfg.defaultGuard,
          allowClick: cfg.allowClick,
          toast: cfg.toast,
          // #8 — surface the page.see screenshot to the user as a chat thumbnail
          // so they SEE what the vision model saw. Default appends a small <img>
          // into the transcript host; a host can override cfg.onShot (or pass
          // cfg.showShot:false to disable).
          onShot: (cfg.onShot !== undefined) ? cfg.onShot
            : ((cfg.showShot === false) ? null : (url) => _appendShotThumb(hostEl, url)),
        });
        // context(): default to the introspection snapshot; if the host already
        // supplied one, COMPOSE (host text first, then the live page tree).
        const hostCtx = merged.context;
        merged.context = (typeof hostCtx === 'function')
          ? (q) => { let a = ''; try { a = hostCtx(q) || ''; } catch (_e) {} const b = introspect.context(); return a ? (a + '\n\n' + b) : b; }
          : introspect.context;
        // onAction(): the page agent handles page.* ; if the host supplied its own
        // onAction, run it FIRST (it may own a custom action) and fall through to
        // the agent for page.inspect/fill/click/select/check/read.
        const hostAction = merged.onAction;
        merged.onAction = (type, payload, raw) => {
          if (typeof hostAction === 'function') {
            try { const handled = hostAction(type, payload, raw); if (handled === true) return true; } catch (_e) {}
          }
          try { return actions.onAction(type, payload); } catch (_e) { return false; }
        };
        // expose so the caller can reset()/read the agent if needed
        merged._pageAgent = { introspect, actions };

        // #9 — a REUSABLE Record / Save / Replay affordance for ANY page-agent
        // app (not just the pageintrospect demo bar). Opt in with
        // pageAgent.recordBar:true (or an object {autoRecord, idPrefix}); it adds
        // three hostActions-bar buttons bound to the already-wired `actions`
        // recording API. autoRecord:true starts recording immediately so a flow is
        // capturable without clicking Record first.
        const recCfg = cfg.recordBar;
        if (recCfg) {
          const rc = (typeof recCfg === 'object') ? recCfg : {};
          if (rc.autoRecord) { try { actions.startRecording(); } catch (_e) {} }
          const idPrefix = rc.idPrefix || (profileId.replace(/[^\w.-]+/g, '_') + '_flow');
          const recButtons = [
            { icon: '⏺', label: 'Record', title: 'Start/stop recording page actions',
              run: (ctx) => {
                const on = actions.isRecording();
                if (on) { actions.stopRecording(); ctx && ctx.setStatus && ctx.setStatus('Recording stopped (' + (actions.getRecording() || []).length + ' step(s)).'); }
                else { actions.startRecording(); ctx && ctx.setStatus && ctx.setStatus('Recording… perform a flow, then Save.'); }
              } },
            { icon: '💾', label: 'Save flow', title: 'Save the recorded flow as a replayable automation case',
              run: async (ctx) => {
                const steps = (actions.getRecording() || []).length;
                if (!steps) { ctx && ctx.setStatus && ctx.setStatus('Nothing recorded yet — click Record and perform a flow first.'); return; }
                const id = (rc.caseId || (idPrefix + '_' + Date.now()));
                let urlPath = ''; try { urlPath = (typeof location !== 'undefined' && location.pathname) || ''; } catch (_e) {}
                try {
                  const r = await actions.recordAndSave(id, { title: rc.title || (prof && prof.title) || id, url: urlPath });
                  ctx && ctx.setStatus && ctx.setStatus('Saved automation "' + id + '" (' + steps + ' step(s)). Replay re-runs it here with no CDP.');
                } catch (e) { ctx && ctx.setStatus && ctx.setStatus('Save failed: ' + (e && e.message || e)); }
              } },
            { icon: '▶', label: 'Replay', title: 'Replay the last saved flow in this page (no CDP)',
              run: async (ctx) => {
                const id = rc.caseId || actions._lastSavedId;
                if (!id) { ctx && ctx.setStatus && ctx.setStatus('No saved flow to replay yet — Save one first.'); return; }
                try { const r = await actions.replayCaseById(id); ctx && ctx.setStatus && ctx.setStatus('Replayed ' + ((r && r.performed) || 0) + ' step(s) (no CDP).'); }
                catch (e) { ctx && ctx.setStatus && ctx.setStatus('Replay failed: ' + (e && e.message || e)); }
              } },
          ];
          merged.capabilities = Object.assign({}, merged.capabilities, {
            hostActions: ((merged.capabilities && merged.capabilities.hostActions) || []).concat(recButtons),
          });
        }
      }

      return mount(hostEl, merged);
    }

    return {mountProfile, invalidateProfiles};
  }
  return {create};
})();
