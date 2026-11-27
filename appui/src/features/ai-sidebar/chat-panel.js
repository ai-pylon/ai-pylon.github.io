/**
 * AppUIChatPanel  --  a turnkey AI chat panel (placement-neutral).
 *
 * ONE call mounts the shared AppUIChatSurface (via the aiSidebar `surface:true`
 * path) into any host element and wires the page's `context()`, a `system`
 * prompt, lifecycle/teardown, AND a STRUCTURED-ACTION contract so the chat can
 * DO things on the page -- not just return prose. The host element can live in
 * ANY sidebar tab (left/right/bottom) or inline pane -- the panel does not
 * assume a right-sidebar placement (the sidebar type `ai-sidebar` carries a
 * free-form `position`, so the TYPE, not this wrapper, decides where a tab goes).
 *
 *   const panel = AppUIChatPanel.mount(hostEl, {
 *     system:   '...system prompt...',       // optional
 *     context:  () => currentPageSnapshot(),  // optional, re-read per turn
 *     onAction: (type, payload, raw) => {...},// optional structured-action sink
 *     onResponse: (text) => {...},            // optional raw prose hook
 *     placeholder, title, configKey, backend, // optional passthrough
 *     applyActions: [{ label, icon?, apply(text, ctx) }], // #10 apply buttons
 *   });
 *   // later
 *   panel.destroy();
 *
 * This extracts the boilerplate that pages (sysdoc_converter's
 * sidebar-right-ai.js) previously copy-pasted: the aiSidebar feature check, the
 * surface options, and teardown. It is PURELY ADDITIVE -- it reads the existing
 * public API (AppUI.features.aiSidebar.create) and does not modify it.
 *
 * ---- The structured-ACTION contract (opt-in) --------------------------------
 * When `onAction` is supplied, the panel scans each assistant reply for fenced
 * action blocks and dispatches them to the host:
 *
 *     ```action
 *     {"type":"chain.set","steps":[{"tool":"office.outlook.mail.search","params":{...}}]}
 *     ```
 *
 * Multiple blocks per reply are allowed; each is parsed as JSON and passed as
 * `onAction(obj.type, obj, rawJsonString)`. Parsing is tolerant: a bad block is
 * skipped (reported via console.warn) and never throws into the chat.
 *
 * Actions only POPULATE the page (e.g. load a chain into the builder) -- the
 * panel NEVER auto-runs a write op. The host decides what each action type does;
 * destructive-ish intent (replacing a non-empty chain) is the host's to confirm.
 *
 * Back-compat: also exposed as window.AppUIRightChat (the former name) so any
 * early consumer keeps working; prefer AppUIChatPanel in new code.
 */
window.AppUIChatPanel = (function () {
  const {parseActions, stripActions, registerActionTypes} = window._AppUIChatPanelActions;
  const {wrapContext, docContext} = window._AppUIChatPanelContext;
  const {rememberDock, _appendShotThumb, _renderStarterChips} = window._AppUIChatPanelView;
  const {mountProfile, invalidateProfiles} = window._AppUIChatPanelProfiles.create({mount, _appendShotThumb});

  function mount(hostEl, opts) {
    opts = opts || {};
    if (!hostEl) throw new Error('AppUIChatPanel.mount: host element required');

    const aiSidebar = (window.AppUI && window.AppUI.features && window.AppUI.features.aiSidebar)
      || window.AppUIAISidebarFeature;
    if (!aiSidebar || typeof aiSidebar.create !== 'function') {
      hostEl.innerHTML = '<div style="padding:12px;color:var(--text-muted,#888);font-size:12px">'
        + 'AI assistant requires the aiSidebar bundle (AppUIAssets.load(\'aiSidebar\')).</div>';
      return { destroy() { try { hostEl.replaceChildren(); } catch (_e) { hostEl.innerHTML = ''; } } };
    }

    // the profile's / caller's declared action types (e.g. charts.plot) parse too
    if (Array.isArray(opts.actions) && registerActionTypes) registerActionTypes(opts.actions);
    const hasAction = typeof opts.onAction === 'function';
    const hasResponse = typeof opts.onResponse === 'function';
    // Optional gate (#7): confirmAction(type, payload) → falsy to apply
    // silently, or a REASON string to require an inline confirm first (e.g.
    // "Replace the current 3-step chain?"). Mirrors the per-op confirm ethos:
    // only POPULATE after the user okays a destructive-ish replace.
    const confirmAction = typeof opts.confirmAction === 'function' ? opts.confirmAction : null;
    // #6 — the shared page.focus → AppUISelectionBus convention is on by default
    // (so any profile can focus a page element); a host can disable via
    // opts.pageFocus === false.
    const pageFocusEnabled = opts.pageFocus !== false && !!window.AppUISelectionBus;

    function askConfirm(reason) {
      const Dialog = (window.AppUI && window.AppUI.components && window.AppUI.components.Dialog)
        || (window.AppUIDialog && window.AppUIDialog.show ? window.AppUIDialog : null);
      if (Dialog && typeof Dialog.confirm === 'function') return Dialog.confirm(reason);
      return Promise.resolve(typeof window.confirm === 'function' ? window.confirm(reason) : true);
    }

    // #6 — shared "citation → page focus" convention. A reply may emit a generic
    // page.focus action: {"type":"page.focus","scope":"<app>","kind":"...",
    // "id":"...","label":"..."}. The panel publishes it to AppUISelectionBus so
    // ANY page view subscribed to that scope focuses/highlights the element —
    // without each app defining its own focus action. Returns true if handled
    // here (so it isn't ALSO sent to a host onAction that doesn't know it).
    function dispatchPageFocus(a) {
      if (!a || a.type !== 'page.focus') return false;
      try {
        const p = a.payload || {};
        const scopeName = p.scope || p.app || opts.profileId || opts.configKey || 'default';
        if (window.AppUISelectionBus && p.id != null) {
          window.AppUISelectionBus.scope(String(scopeName)).set({
            kind: p.kind || 'node', id: String(p.id),
            label: p.label != null ? String(p.label) : undefined,
            data: p.data,
          });
          return true;
        }
      } catch (_e) { /* best-effort */ }
      return false;
    }

    async function dispatchActions(reply) {
      const actions = parseActions(reply);
      for (const a of actions) {
        try {
          // #6 — page.focus is handled by the shared selection bus (works even
          // with no host onAction); still ALSO forward to onAction if present so
          // a host that wants richer handling gets it.
          const focused = dispatchPageFocus(a);
          if (confirmAction) {
            const reason = confirmAction(a.type, a.payload);
            if (reason) { const ok = await askConfirm(String(reason)); if (!ok) continue; }
          }
          if (hasAction) opts.onAction(a.type, a.payload, a.raw);
          else if (!focused) { /* no sink for this action; ignore quietly */ }
        } catch (e) { try { console.warn('AppUIChatPanel onAction(' + a.type + ') threw:', e); } catch (_e) {} }
      }
    }

    // Compose a single onResponse that (a) fires the host's prose hook and
    // (b) dispatches any structured actions (optionally confirm-gated). page.focus
    // works via the shared bus even with no host onAction, so dispatch runs
    // whenever actions are possible — not only when onAction is supplied.
    const onResponse = (hasAction || hasResponse)
      ? function (reply) {
          if (hasResponse) {
            try { opts.onResponse(reply); } catch (e) { try { console.warn('AppUIChatPanel onResponse hook threw:', e); } catch (_e) {} }
          }
          if (hasAction || pageFocusEnabled) { dispatchActions(reply); }
        }
      : (pageFocusEnabled ? function (reply) { dispatchActions(reply); } : null);

    // #10 — generalized "apply" affordances. A host passes opts.applyActions:
    // an array of { icon?, label, title?, apply(text, ctx) } that operate on the
    // LATEST assistant reply (the generalization of sysdoc's bespoke
    // _insertGeneratedContent → insertText/replaceSelection/applyAction). Each
    // becomes a surface hostActions bar button whose run() pulls the last
    // assistant message and hands its text to apply(). Opt-in; no-op if absent.
    const applyActions = Array.isArray(opts.applyActions) ? opts.applyActions : [];
    const hostActions = applyActions
      .filter((a) => a && typeof a.apply === 'function' && a.label)
      .map((a) => ({
        icon: a.icon || '⬇', label: a.label, title: a.title || a.label,
        run: (ctx) => {
          const hist = (ctx && ctx.getHistory && ctx.getHistory()) || [];
          let text = '';
          for (let i = hist.length - 1; i >= 0; i--) {
            const m = hist[i]; if (m && (m.role === 'assistant' || m.role === 'ai') && m.content) { text = String(m.content); break; }
          }
          if (!text) { ctx && ctx.setStatus && ctx.setStatus('No assistant reply to apply yet.'); return; }
          try { a.apply(text, ctx); } catch (e) { ctx && ctx.setStatus && ctx.setStatus('Apply failed: ' + (e && e.message || e)); }
        },
      }));
    const mergedCaps = hostActions.length
      ? Object.assign({}, opts.capabilities, { hostActions: (opts.capabilities && opts.capabilities.hostActions || []).concat(hostActions) })
      : (opts.capabilities || null);

    const sidebar = aiSidebar.create({
      surface: true,                 // use the unified AppUIChatSurface
      container: hostEl,
      system: opts.system || '',
      scope: Array.isArray(opts.scope) ? opts.scope : undefined,
      // Pass the host's backend choice THROUGH (no 'kiro' fallback here): an
      // explicit choice (e.g. a chat_profile's backend) now wins over the server
      // default in the surface, but "no choice" must stay empty so the server
      // default applies — don't force kiro.
      backend: opts.backend || '',
      // #1/#174 — forward the mounted profile id as the stable pool key.
      profileId: opts.profileId || '',
      model: opts.model || '',
      placeholder: opts.placeholder || 'Ask AI…',
      title: opts.title || 'AI Assistant',
      hideHeader: opts.hideHeader !== undefined ? opts.hideHeader : true,
      configKey: opts.configKey || 'pages/chat-panel',
      context: wrapContext(opts.context, opts.contextMaxChars),
      // #5 — promote the STRUCTURED current-view hook to a first-class panel
      // option. When a host supplies currentLocation() -> {file,folder,root,
      // files?}, the surface injects the labeled WORKSPACE-VIEW block + shows the
      // 📍 "share current view" button + change-nudge — on ANY page, not just
      // the workspace. (The surface reads config.currentLocation.)
      currentLocation: (typeof opts.currentLocation === 'function') ? opts.currentLocation : null,
      // the page sees each tool call the model makes (e.g. it draws the chart a
      // charts tool computed) — host hook onToolCall(name, args)
      onToolCall: (typeof opts.onToolCall === 'function') ? opts.onToolCall : undefined,
      onResponse,
      // Allow advanced passthrough without re-declaring every option.
      capabilities: mergedCaps,
      appBase: opts.appBase || null,
      catalogBase: opts.catalogBase || null,
      streamBase: opts.streamBase || null,
    });

    // #12 — starter-prompt chips. When the host passes opts.examplePrompts (the
    // profile's example_prompts), render a one-tap chip row so an EMPTY chat is
    // self-documenting. A click prefills the composer (.ai-chat-input — a stable
    // surface DOM contract) and focuses it; the user presses Enter. The row
    // hides itself once the conversation has any message, and is removed on
    // destroy. Purely additive — no dependency on churned surface internals.
    const chipCtl = _renderStarterChips(hostEl, opts.examplePrompts, opts.promptVars);

    let destroyed = false;
    return {
      /** The underlying aiSidebar handle (getChat/setSystem/exportChat/surface…). */
      sidebar,
      /** Update the system prompt live. */
      setSystem(value) { try { sidebar.setSystem && sidebar.setSystem(value); } catch (_e) {} },
      /** The chat instance, if the host needs direct access. */
      getChat() { return sidebar.getChat ? sidebar.getChat() : null; },
      /** Parse action blocks from arbitrary text (exposed for host use/tests). */
      parseActions,
      /** Strip recognized action blocks from reply text (host use/tests). */
      stripActions,
      /** Apply the structured actions in a reply text through the SAME composed
       * dispatch path a real turn uses (confirm-gate + page.focus + the host
       * onAction). Returns a Promise. A host can replay/apply an action
       * programmatically; a deterministic e2e uses it to assert the page applies
       * a KNOWN action (removing model format non-determinism from the test). */
      dispatch(replyText) { return dispatchActions(String(replyText == null ? '' : replyText)); },
      /** The auto-wired page agent {introspect, actions} when opts.pageAgent (or
       * the profile's page_agent) turned it on — so a host/test can read the
       * introspect snapshot (.context()) or reset()/setSeen() it. null otherwise. */
      pageAgent: opts._pageAgent || null,
      destroy() {
        if (destroyed) return;
        destroyed = true;
        try { chipCtl && chipCtl.stop(); } catch (_e) {}
        try { sidebar.destroy && sidebar.destroy(); } catch (_e) {}
        try { hostEl.replaceChildren(); } catch (_e) { try { hostEl.innerHTML = ''; } catch (_e2) {} }
      },
    };
  }

  return { mount, mountProfile, parseActions, stripActions, wrapContext, rememberDock, invalidateProfiles, docContext };
})();
// Back-compat alias for the former (placement-biased) name.
window.AppUIRightChat = window.AppUIChatPanel;
