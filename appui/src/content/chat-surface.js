/**
 * Content/ChatSurface — the reusable, capability-driven chat SURFACE.
 *
 * ONE component that both the standalone llm PAGE and any HOST (e.g. the
 * workspace sidebar) mount. It wraps the shared AppUIChat engine with:
 *   - a button bar (Backend · Tools · Config · Prompts · Attach · Context ·
 *     History · Jobs · Run-in-bg · Export · Path* · Link* · New)
 *   - the catalog/scope TOOL model (tri-state tree, flatten, progressive,
 *     config-driven mandatory tools, live system-prompt preview)
 *   - the systemLlm SSE transport (GET stream to <streamBase>/chat/stream)
 *   - server-persisted history, background jobs, attachments, mid-turn steering
 *
 * EVERY button is gated on a declarative `capabilities` object, so a host that
 * doesn't provide a capability simply doesn't get that button. The three
 * workspace-only capabilities are HOST-PROVIDED functions:
 *   currentLocation() -> {file,folder,root}|null   (📍 — else hidden)
 *   saveLink(transcript) -> Promise                (🔗 — else hidden)
 *   turnScope() -> [pattern]                       (tools added to THIS turn's extra_scope, e.g. the shown viewer's ops)
 *   contextChips: true | {live}                    (➕ add an app's exposed context / 📌 pins as chips sent every turn;
 *                                                   live = label of the host page's own live view chip)
 *   openInContent(markdown) -> void                (↗ — else Export to a tab)
 *
 * Usage:
 *   const surface = AppUIChatSurface.create({
 *     container, appBase:'/v1/apps/ai/llm_server', catalogBase:'/v1/apps/platform/tool_catalog',
 *     streamBase:'/apps/ai/llm_server/v1',
 *     capabilities:{config,serverHistory,jobs,steer,attachments,export,
 *                   currentLocation,saveLink,openInContent,
 *                   transport,              // host transport factory (own stream)
 *                   serverHistoryProvider}, // host {save,list,load,delete}
 *     setStatus:(t)=>{}, dialog: AppUI.components.Dialog,
 *   });
 *
 * Exposes: window.AppUIChatSurface
 * Requires: chat.js (AppUIChat), chat-stream.js (transports.systemLlm),
 *           chat-prompt-store.js, runtime/markdown.js, components/dialog.js
 */
window.AppUIChatSurface = (function() {
  'use strict';

  // Pure /command → canonical action resolver (module-level so it's unit-
  // testable without mounting a surface). Returns one of
  // 'tools'|'model'|'new'|'export'|'prompts'|'context'|'help' or null.
  function _slashActionPure(line) {
    const m = String(line || '').trim().match(/^\/(\w+)/);
    if (!m) return null;
    switch (m[1].toLowerCase()) {
      case 'tools': case 'scope': return 'tools';
      case 'model': case 'config': case 'backend': return 'model';
      case 'new': case 'clear': return 'new';
      case 'export': case 'copy': return 'export';
      case 'prompts': return 'prompts';
      case 'context': return 'context';
      case 'help': return 'help';
      default: return null;
    }
  }

  const esc = s => (window.AppUITextUtils ? window.AppUITextUtils.esc(s ?? '')
    : String(s ?? '').replace(/[&<>]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;'}[c])));

  function create(opts) {
    opts = opts || {};
    if (window._AppUIChatSurfaceStyles) window._AppUIChatSurfaceStyles.inject();
    const appBase = (opts.appBase || '/v1/apps/ai/llm_server').replace(/\/$/, '');
    const catalogBase = (opts.catalogBase || '/v1/apps/platform/tool_catalog').replace(/\/$/, '');
    const streamBase = (opts.streamBase || '/apps/ai/llm_server/v1').replace(/\/$/, '');
    const container = opts.container;
    if (!container) throw new Error('AppUIChatSurface: container required');
    const Dialog = opts.dialog || (window.AppUI && window.AppUI.components && window.AppUI.components.Dialog)
      || (window.AppUIDialog && window.AppUIDialog.show ? window.AppUIDialog : null);
    const setStatus = typeof opts.setStatus === 'function' ? opts.setStatus : () => {};
    // Optional host hooks:
    //  context()   — extra per-turn context text (string | Promise<string>),
    //                appended to the system prompt (e.g. the editor's current
    //                slide). Re-evaluated each send.
    //  onResponse(reply) — called with the final assistant text each turn (e.g.
    //                to auto-insert generated content into a host editor).
    const hostContext = (typeof opts.context === 'function') ? opts.context : null;
    const onResponse = (typeof opts.onResponse === 'function') ? opts.onResponse : null;
    // Declarative host capabilities. Functions (currentLocation/saveLink/
    // openInContent) are host-provided; booleans gate server-backed features.
    const CAP = Object.assign({
      config: true, serverHistory: true, jobs: true, steer: true,
      attachments: true, export: true,
      currentLocation: null, saveLink: null, openInContent: null,
      projectDocs: null,   // ⭐ host fn: () => Promise<[{name,text}]> | [{name,text}]
                           // e.g. the workspace returns its AGENTS.md / README.md
                           // so the model is grounded in the project's own docs.
      projectDocsRoot: null, // ⭐ turnkey alt: a vfs:// root string; the surface
                           // calls the server `project_docs` op to read
                           // AGENTS.md/README.md under it (no host fn needed).
      // ⭐ transport — a host-provided transport FACTORY (same shape as
      // AppUIChatStream.transports.systemLlm returns). When present the surface
      // streams through the HOST's own endpoint (e.g. the workspace's remote
      // agent /v1/ws/chat/*) instead of the default systemLlm stream — so a host
      // keeps its backend session while using this surface's chrome. Absent →
      // the default systemLlm transport on streamBase (unchanged behavior).
      transport: null,     // () => transport  (or a transport object)
      // ⭐ serverHistoryProvider — a host's own save/list/load/delete for
      // server-persisted conversations ({save,list,load,delete} async fns). When
      // present (and CAP.serverHistory truthy) the History dialog + autosave use
      // it instead of ai/llm_server's chat_save/chat_list/chat_load/chat_delete, so
      // the workspace can persist into its /v1/ws/chat store. Absent → default.
      serverHistoryProvider: null,
    }, opts.capabilities || {});

    const state = {
      backend: opts.backend || '', backends: [],
      // Seed from the host (e.g. a manifest chat_profile's `system` via
      // mountProfile / AppUIAISidebar.create). It used to start '' and drop the
      // host prompt, so no profile's grounding prompt ever reached the model.
      system: (typeof opts.system === 'string' ? opts.system : ''),
      scope: (Array.isArray(opts.scope) ? opts.scope.slice() : []), flatten: false, progressive: false,
      tree: null, mandatory: null, mandatoryPats: null,
      pendingReset: false, lastReq: null,
      model: '', models: {}, temperature: null, activeSessionId: null,
      defaultBackend: '',  // server-preferred default (kiro)
      turnContext: '',     // per-turn host context (resolved on send)
      _lastSentTurnContext: '', // #26: last turnContext actually sent (skip re-send when unchanged)
      locationContext: '', // workspace path context (📍), carried in the prompt
      locationSig: '',     // change memo so 📍 only nudges when the view changed
      profileId: opts.profileId || '', // #1/#174: stable per-chat pool key (the mounted profile id)
      projectDocs: null,   // cached [{name,text}] from CAP.projectDocs()
      projectDocsText: '', // assembled block prepended to the system prompt
      confirmWrites: (opts.capabilities && opts.capabilities.confirmWrites) || false, // gate write invokes
    };
    // The saved conversation's server id (llm_server chat_save) — shown as a
    // copyable "#xxxxxxxx" chip in the bar so the user can refer to a chat
    // ("check conversation 5fbad0bf"). A setter so every place that changes it
    // (first autosave, loading a saved chat, New) repaints the chip.
    {
      let _sid = null;
      Object.defineProperty(state, 'activeSessionId', {
        enumerable: true, configurable: true,
        get() { return _sid; },
        set(v) { _sid = v || null; try { if (typeof state._onSessionId === 'function') state._onSessionId(_sid); } catch (_e) {} },
      });
    }
    let pendingAttachments = [];
    let chat = null, scopeBtn = null, backendSel = null, jobsBtn = null;
    let root = null;   // the surface's own DOM root (for scoped queries)
    let _wsIndicatorEl = null;   // current-workspace label in the bar
    const _compact = (opts.mode === 'sidebar');   // sidebar → icon-only buttons
    const _backendHolder = document.createElement('div');  // off-DOM home for backendSel between dialog opens
    _backendHolder.style.display = 'none';

    async function callApi(base, op, body, timeoutMs) {
      const response = await window.AppUIApi.requestResponse(base + '/' + op, body || {}, {
        method: 'POST', timeout: timeoutMs || 120000, decode: response => response.json()
      });
      return response.data;
    }
    const call = (op, body, ms) => callApi(appBase, op, body, ms);
    const catalog = (op, body, ms) => callApi(catalogBase, op, body, ms);

    // Resolve the chat transport: a host-provided CAP.transport wins (it may be
    // a factory fn or a ready transport object); otherwise the default systemLlm
    // SSE transport on streamBase. Keeps existing hosts byte-for-byte unchanged.
    function _resolveTransport() {
      try {
        if (CAP.transport) {
          const t = (typeof CAP.transport === 'function') ? CAP.transport(streamBase) : CAP.transport;
          if (t) return t;
        }
      } catch (e) { setStatus('transport init failed, using default: ' + (e.message || e)); }
      return window.AppUIChatStream.transports.systemLlm(streamBase);
    }

    const q = sel => (root || container).querySelector(sel);
    const composerInput = () => (chat && chat.input) || q('.ai-chat-input');

    const {persistScope, restoreScopeFor, persistPrefs, restorePrefsFor} = window._AppUIChatSurfacePreferences.create({
      state, getChat: () => chat, refreshScopeBtn
    });

    // ---- backends / bootstrap ----------------------------------------------
    const backendsController = AppUIChatSurfaceBackends.create({
      state, call, getSelect: () => backendSel, getChat: () => chat, getPreferredBackend: () => opts.backend,
      onBackendResolved: (b) => { try { restoreScopeFor(b); } catch (_e) {} try { restorePrefsFor(b); } catch (_e) {} }
    });
    const {loadBackendsBootstrap, paintBackendOptions} = backendsController;

    function scopeLabelText() {
      if (state.scope.length) return 'Tools: ' + state.scope.length;
      if (state.flatten) return 'Tools: all';
      return 'Tools';
    }
    function refreshScopeBtn() {
      if (!scopeBtn) return;
      const label = scopeLabelText();
      scopeBtn.textContent = _compact ? '🧩' : ('🧩 ' + label);
      scopeBtn.title = label + ' — select which tools the model can use';
      // in compact mode show a count badge suffix so selection is still visible
      if (_compact && (state.scope.length || state.flatten)) {
        scopeBtn.textContent = '🧩' + (state.scope.length ? state.scope.length : '∗');
      }
    }

    // Project docs (⭐ host-provided): load the workspace's AGENTS.md / README.md
    // (or any grounding docs the host returns) ONCE and assemble a bounded block
    // that buildReqBody prepends to the system prompt so the model is grounded
    // in the project's own conventions. Re-callable (e.g. on location change).
    // ➕ context chips: other apps' exposed context (manifest chat_context) + pinned files, sent every turn
    const chipsController = window._AppUIChatSurfaceChips
      ? window._AppUIChatSurfaceChips.create({CAP, state, call, Dialog, setStatus, q}) : null;
    const requestController = AppUIChatSurfaceRequest.create({
      CAP, state, call, getAttachments: () => pendingAttachments,
      contextText: () => (chipsController ? chipsController.text() : ''),
      setAttachments: value => { pendingAttachments = value; }, renderAttachChips: () => renderAttachChips()
    });
    const {loadProjectDocs, buildReqBody} = requestController;

    // ---- 📎 Attachments -----------------------------------------------------
    const attachmentsController = AppUIChatSurfaceAttachments.create({
      esc, q, setStatus, call, readBase64: file => AppUIFileUtils.readBase64(file),
      getAttachments: () => pendingAttachments, setAttachments: value => { pendingAttachments = value; }, composerInput
    });
    const {renderAttachChips, openAttach, doAttachVfs} = attachmentsController;

    // Attach the file the host user is CURRENTLY viewing (its vfs ref), resolved
    // server-side. Gated on CAP.currentLocation (the host that provides the 📍
    // view context is the one that knows the selected file's ref).
    function attachCurrentView() {
      let loc = null;
      try { loc = (typeof CAP.currentLocation === 'function') ? CAP.currentLocation() : null; } catch (_e) { loc = null; }
      const ref = loc && (loc.file || loc.path);
      if (!ref) { setStatus('No file open to attach'); return; }
      doAttachVfs(ref);
    }

    const jobsController = AppUIChatSurfaceJobs.create({ call, _compact, Dialog, esc, q, setStatus, composerInput, state, renderAttachChips, getJobsButton: () => jobsBtn, getAttachments: () => pendingAttachments, setAttachments: value => { pendingAttachments = value; } });
    const {refreshJobsBadge, startJobsBadge, openJobs, runInBackground} = jobsController;

    // ---- 🕑 Server history ---------------------------------------------------
    const {autosaveSession, openServerHistory} = AppUIChatSurfaceHistory.create({ CAP, call, state, getChat: () => chat, Dialog, esc, newChat, q, setStatus });
    // IMPROVEMENTS_NEXT #18: a restored tool row's 'Show full output' - with the DEFAULT store (ai/llm_server
    // chat_save, no host history provider) the full text is in llm_server's side store (chat_tool_output). A host
    // that keeps the conversation itself (the Workspace) answers first and marks the event handled.
    if (!(CAP.serverHistoryProvider && typeof CAP.serverHistoryProvider === 'object')) {
      container.addEventListener('appui:chat-tool-full', (ev) => {
        const d = (ev && ev.detail) || {};
        if (d.handled || !d.ref || !state.activeSessionId || typeof d.done !== 'function') return;
        d.handled = true;
        call('chat_tool_output', {id: state.activeSessionId, ref: d.ref}, 20000).then(r => {
          if (r && r.ok && r.output) d.done(r.output);
          else d.done(null, (r && r.error) || 'Full output not kept - truncated when saved');
        }, () => d.done(null, 'Full output could not be loaded'));
      });
    }

    // ---- 📍 current view / 🔗 link (host-provided) --------------------------
    // Workspace path context: workspace/root, cwd (folder), its listing, and the
    // selected file. CAP.currentLocation() returns {file, folder, root, files?}.
    // The formatted block is ALWAYS carried in the system prompt (so "find in the
    // Intent workspace" works from the first turn); the 📍 button re-checks and,
    // if the view CHANGED, refreshes the block + drops a one-line nudge so the
    // model notices the change mid-conversation.
    const locationController = AppUIChatSurfaceLocation.create({ CAP, state, setStatus, getChat: () => chat, getIndicator: () => _wsIndicatorEl });
    const {refreshLocation, renderWsIndicator, sendCurrentLocation} = locationController;

    // ---- new chat + steer ---------------------------------------------------
    function newChat(silent) {
      chat?.cancel(); chat?.clear();
      state.pendingReset = true; state.activeSessionId = null;
      pendingAttachments = []; renderAttachChips();
      if (!silent) { setStatus('New chat'); composerInput()?.focus(); }
    }
    async function steerRunningTurn(message) {
      try {
        await window.AppUIApi.requestResponse(streamBase + '/chat/steer', {message}, {
          method:'POST', timeout:null, decode:()=>null
        });
      } catch (_e) {}
    }

    // ---- build the surface DOM ----------------------------------------------
    // In a SIDEBAR (limited width) show ICON-ONLY buttons (label → tooltip); on
    // a full PAGE show "icon label". _compact is derived from opts.mode above.
    let viewController = null, keyboardController = null;
    function render() {
      viewController = window._AppUIChatSurfaceView.render({container, _compact, CAP, state, setStatus,
        _backendHolder, backendsController, scopeLabelText, getChat: () => chat,
        handlers: {openSettings, openConfig, openPrompts, openAttach, attachCurrentView, openContext,
          openServerHistory, openEngineHistory, openJobs, runInBackground, exportTranscript, sendCurrentLocation, newChat,
          openKiro, kiroLabel: () => (kiroController ? kiroController.label() : 'Kiro'),
          openAddContext: chipsController ? () => chipsController.openAdd() : null}});
      ({root, backendSel, scopeBtn, jobsBtn, wsIndicator: _wsIndicatorEl} = viewController);
      if (chipsController) chipsController.render();
      const viewHost = viewController.viewHost;

      chat = window.AppUIChat.create({
        container: viewHost,
        backend: state.backend || 'kiro',
        transport: _resolveTransport(),
        llmUrl: streamBase,
        confirmUrl: () => { try { const t = _resolveTransport(); return (t && typeof t.confirmUrl === 'function') ? t.confirmUrl() : ((streamBase || '').replace(/\/$/, '') + '/chat/confirm'); } catch (e) { return (streamBase || '').replace(/\/$/, '') + '/chat/confirm'; } },
        buildReqBody,
        system: state.system,
        placeholder: opts.placeholder || ('Type a message…  (Enter to send, Shift+Enter newline, ↑/↓ recall, /help for commands' + (CAP.steer ? ', Enter while streaming = steer)' : ')')),
        onDetails: () => showDetails(),
        // Host UI tools: a tool the SERVER declared but the PAGE performs (e.g.
        // the workspace's ui_open_tab) — the host sees each streamed tool call
        // (name, args) and acts on the ones it owns. May be called more than once
        // per call (running + completed frames); the host de-duplicates.
        onToolCall: (typeof CAP.onToolCall === 'function')
          ? (name, args) => { try { return Promise.resolve(CAP.onToolCall(name, args)); } catch (_e) { return Promise.resolve(); } }
          : undefined,
        onSendStart: (msg) => {
          // keep the workspace-view context fresh each turn (silent)
          try { refreshLocation(false); } catch (_e) {}
          // resolve the host's per-turn context (sync value or a resolved
          // Promise) into state so buildReqBody can append it. Async values
          // that resolve after buildReqBody runs are applied to the NEXT turn —
          // acceptable; the sysdoc editor's context() is synchronous.
          // The host gets the user's message: context(question) may tailor the
          // snapshot to it (e.g. include only the tables / columns it names).
          state.turnContext = '';
          if (hostContext) {
            try {
              const v = hostContext(String(msg || ''));
              if (v && typeof v.then === 'function') v.then(t => { state.turnContext = String(t || ''); }).catch(() => {});
              else state.turnContext = String(v || '');
            } catch (_e) { state.turnContext = ''; }
          }
        },
        onSendEnd: (reply) => { autosaveSession(); if (onResponse) { try { onResponse(reply); } catch (_e) {} } },
        promptOptions: {system: true, tools: false, environment: false, ui: false, user: true},
      });

      keyboardController = window._AppUIChatSurfaceKeyboard.bind({CAP, composerInput, viewHost,
        getChat: () => chat, steerRunningTurn, setStatus, newChat, runSlash});

      loadBackendsBootstrap();
      loadProjectDocs();
      try { refreshLocation(false); renderWsIndicator(); } catch (_e) {}   // share + show workspace view at start
      // Listen for a host 'workspace-changed' signal and refresh the indicator —
      // but ONLY while IDLE (not mid-turn), so a streaming turn isn't disrupted
      // and the displayed workspace matches where the NEXT turn will run.
      locationController.start();
      if (CAP.jobs) startJobsBadge();

      // ---- 📎 drag/drop + paste-image attach (capability-gated) -------------
      // Drop files anywhere on the chat view, or paste an image from the
      // clipboard, to attach them for the next turn (same path as the 📎 button).
      if (CAP.attachments) attachmentsController.bind(viewHost);


    }

    // Resolve a /command line to a canonical action name (pure; testable).
    // Returns 'tools'|'model'|'new'|'export'|'prompts'|'context'|'help' or null
    // when it isn't a recognized command. Delegates to the module-level pure
    // resolver (also exported as AppUIChatSurface.slashAction for unit tests).
    function _slashAction(line) { return _slashActionPure(line); }

    // Map a /command line to a UI action. Returns true if it was a known command
    // (and was handled), false otherwise. Exposed as runSlash on the API.
    function runSlash(line) {
      const action = _slashAction(line);
      if (!action) return false;
      switch (action) {
        case 'tools': openSettings().catch(() => {}); return true;
        case 'model': openConfig(); return true;
        case 'new': newChat(); return true;
        case 'export': exportTranscript(); return true;
        case 'prompts': openPrompts(); return true;
        case 'context': openContext(); return true;
        case 'help': {
          const cmds = '/tools  /model  /new  /export  /prompts  /context  /help';
          setStatus('Commands: ' + cmds);
          if (Dialog) Dialog.show({title: 'Chat commands', body: (function () {
            const d = document.createElement('div'); d.style.cssText = 'font-size:12px;line-height:1.7;min-width:320px';
            d.innerHTML = '<b>Slash commands</b> — type as the whole message, then Enter:<br>'
              + '<code>/tools</code> — choose which tools the model can use<br>'
              + '<code>/model</code> — backend + model + tunables<br>'
              + '<code>/prompts</code> — saved prompt favourites<br>'
              + '<code>/context</code> — view/edit the system prompt<br>'
              + '<code>/export</code> — export the transcript<br>'
              + '<code>/new</code> — start a fresh conversation';
            return d;
          })(), width: '420px', buttons: [{text: 'Close'}]});
          return true;
        }
        default: return false;
      }
    }

    const dialogsController = window._AppUIChatSurfaceDialogs.create({state, Dialog, esc, getChat: () => chat, CAP, setStatus, newChat});
    const {showDetails, exportTranscript, openEngineHistory} = dialogsController;

    const { openSettings } = window._AppUIChatSurfaceTools.create({ state, Dialog, esc, call, catalog, refreshScopeBtn, onApply: () => { try { persistScope(); } catch (_e) {} } });
    const { openPrompts } = window._AppUIChatSurfacePrompts.create({ Dialog, esc, setStatus, composerInput });
    const { openConfig } = window._AppUIChatSurfaceConfig.create({ state, Dialog, esc, call, setStatus, getChat: () => chat, getBackendSel: () => backendSel, _backendHolder, onApply: () => { try { persistPrefs(); } catch (_e) {} } });
    const { openContext } = window._AppUIChatSurfaceContext.create({ state, CAP, Dialog, esc, call, setStatus, getChat: () => chat });
    // 🔌 tool wiring (platform/tool_kiro + the other tool_* apps): agent persona, wired MCP servers / workflows /
    // tools for this chat, skills, marketplace
    const kiroController = window._AppUIChatSurfaceKiro ? window._AppUIChatSurfaceKiro.create({
      state, Dialog, esc, setStatus, kiroBase: opts.kiroBase,
      onChange: () => {
        const b = state._kiroBtn; if (!b) return;
        const lbl = kiroController.label();
        b.textContent = _compact ? '🔌' : ('🔌 ' + lbl);
        b.title = lbl + ' — tool wiring: agent, MCP servers, skills, workflows, marketplace for this chat';
        b.setAttribute('aria-label', lbl);   // compact buttons show only the icon: keep the state readable
        b.classList.toggle('cs-btn-on', !!(state.agent || (state.wiredScope || []).length || (state.wiredWorkflows || []).length));
        state.pendingReset = true;   // a new persona / tool set = a fresh conversation context
      }}) : null;
    const openKiro = kiroController ? kiroController.openKiro : null;

    render();

    return {
      get chat() { return chat; },
      // the conversation's server-history id (set once the history provider saved it) - a host can link it
      get sessionId() { return state.activeSessionId || null; },
      newChat,
      setBackend(b) { state.backend = b; if (backendSel) backendSel.value = b; chat?.setBackend(b); },
      openTools: openSettings, openConfig, openPrompts, openContext, openJobs, exportTranscript,
      runSlash, _slashAction,
      openKiro,
      // ➕ context chips: addContextChip({id|app_id, args} | {uri, name?, kind?}) -> Promise<chip>
      addContextChip: (spec) => (chipsController ? chipsController.add(spec) : Promise.reject(new Error('context chips unavailable'))),
      removeContextChip: (i) => { if (chipsController) chipsController.remove(i); },
      clearContextChips: () => { if (chipsController) chipsController.clear(); },
      get contextChips() { return chipsController ? chipsController.chips : []; },
      openAddContext: () => { if (chipsController) chipsController.openAdd(); },
      destroy() { if (chipsController) chipsController.destroy(); if (kiroController) kiroController.destroy(); dialogsController.destroy(); keyboardController?.destroy(); viewController?.destroy(); requestController.destroy(); backendsController.destroy(); attachmentsController.destroy(); jobsController.destroy(); locationController.destroy(); try { chat?.destroy?.(); } catch (_e) {} container.replaceChildren(); },
    };
  }

  return {create, slashAction: _slashActionPure};
})();
