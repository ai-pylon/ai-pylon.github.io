/* AppUI tabbed AI sidebar: chat, context, tool selection, and LLM settings. */
window.AppUIAISidebar = (function() {
  const _loadProjectContext=window._AISidebarProjectContext.load;

  function create(opts) {
    if (!opts?.container) throw new Error('AppUIAISidebar: container required');
    const config = window.AppUIAISidebarConnections.configure(opts);

    // --- SURFACE MODE (Phase-2 convergence) -------------------------------
    // When the host opts in with config.surface (or uiMode:'surface'), the
    // sidebar EMBEDS the shared AppUIChatSurface — the SAME button-UI component
    // the llm page mounts — instead of the legacy 5-tab layout. This is the
    // "universalize" path: one component, host-provided capabilities, the
    // catalog/scope tool model + systemLlm transport. Consumers that DON'T set
    // config.surface keep the exact 5-tab behavior (zero risk). Returns an
    // API-compatible object so a host that only uses destroy/getChat/setSystem/
    // exportChat keeps working.
    if ((config.surface || config.uiMode === 'surface') && window.AppUIChatSurface) {
      const caps = Object.assign({
        config: true, serverHistory: true, jobs: true, steer: true,
        attachments: true, export: true,
        currentLocation: config.currentLocation || null,
        saveLink: config.saveLink || null,
        openInContent: config.openInContent || null,
        hostActions: config.hostActions || null,
        onToolCall: config.onToolCall || null,   // host-performed UI tools (e.g. ui_open_tab)
        turnScope: config.turnScope || null,     // host: extra tool patterns for the current turn
        turnBind: config.turnBind || null,       // host: tool args bound onto the model's calls this turn
        projectDocs: config.projectDocs || null,
        projectDocsRoot: config.projectDocsRoot || null,
        // ➕ context chips (other apps' exposed context + pins); the fixed "📍 this page" chip names the
        // hosting page whose live view this sidebar sends every turn
        contextChips: (config.contextChips === false) ? false : Object.assign({
          live: (typeof config.context === 'function' || typeof config.currentLocation === 'function')
            ? (config.title || config.label || 'this page') : '',
          // the hosting app: its OWN auto context chip is not added (its live view already goes every turn)
          hostApp: config.appId || String(config.profileId || config.profile || '').replace(/\.[^./]*$/, ''),
        }, (config.contextChips && typeof config.contextChips === 'object') ? config.contextChips : {}),
      }, config.capabilities || {});
      const surface = window.AppUIChatSurface.create({
        container: opts.container,
        mode: config.mode || 'sidebar',   // ai-sidebar embeds → sidebar (icon-only bar)
        appBase: config.appBase || '/v1/apps/ai/llm_server',
        catalogBase: config.catalogBase || '/v1/apps/platform/tool_catalog',
        streamBase: config.streamBase || '/apps/ai/llm_server/v1',
        // Pass the host backend choice through; empty = let the surface use the
        // server default (don't force kiro here — an explicit profile backend
        // must win, and "none" must fall through to the server default).
        backend: config.backend || '',
        // #1/#174 — the stable per-chat pool key (the mounted profile id); the
        // surface pins it onto each request so kiro gives this chat its own
        // driver (no cross-page prompt leak via the shared pool).
        profileId: config.profileId || '',
        system: config.system || '',
        scope: Array.isArray(config.scope) ? config.scope : undefined,
        placeholder: config.placeholder,
        context: typeof config.context === 'function' ? config.context : null,
        onResponse: typeof config.onResponse === 'function' ? config.onResponse : null,
        dialog: (window.AppUI && window.AppUI.components && window.AppUI.components.Dialog)
          || (window.AppUIDialog && window.AppUIDialog.show ? window.AppUIDialog : null),
        setStatus: config.setStatus || (t => { try { window.AIApp?.setStatus?.(t); } catch (_e) {} }),
        capabilities: caps,
      });
      const chatProxy = () => surface.chat;
      return {
        destroy: surface.destroy,
        getChat: () => surface.chat,
        switchTab: () => {},
        setContext: fn => { /* host context is a function passed at create */ },
        setSystem: value => { surface.chat?.setSystem?.(value); },
        refreshContext: () => {},
        addContext: () => {}, removeContext: () => {},
        getCollectedContext: () => [],
        exportChat: () => (surface.chat?.exportChat?.() || ''),
        surface,
      };
    }

    const lifecycle = window.AppUILifecycle?.createScope();
    const key = config.configKey || 'pages/shared-ai';
    if (window.AppUIConfigStore) AppUIConfigStore.init(key);
    let active = 'chat';
    let destroyed=false;
    let chat;
    const recommendedTools = Array.isArray(config.suggestedTools) ? config.suggestedTools : (Array.isArray(config.tools) ? config.tools : []);
    const catalog=window._AISidebarCatalog.create({container:opts.container,suggested:recommendedTools});
    const suggestedPrefixes = new Set(Array.isArray(config.suggestedToolPrefixes) ? config.suggestedToolPrefixes : []);
    const configuredGroups = Array.isArray(config.toolGroups) ? config.toolGroups : [];
    const toolsCatalog=window._AISidebarToolCatalog.create({
      config,recommendedTools,catalog,getChat:()=>chat,getPages:()=>pages,isCurrent:()=>!destroyed,
      catalogRequired:()=>catalogRequired(),enabledTools:()=>enabledTools(),enabledGroups:()=>enabledGroups(),
      onRender:()=>{if(active==='tools')renderHierarchyToolTree();},
    });
    // Collected and dynamic page context.
    const contextController=window._AISidebarContextController.create({
      getContainer:()=>pages.context,getContext:()=>typeof config.context==='function'?config.context():config.context,
      isActive:()=>active==='context',isCurrent:()=>!destroyed,onChange:()=>refreshPreview(),
    });
    const {renderContext,renderCollected:renderCollectedContext,add:addContext,remove:removeContext,text:getCollectedContextText}=contextController;
    const {getSetting,setSetting,removeSetting,promptOptions,system}=window._AISidebarPrompts.createSettings({config});
    const toolList=()=>toolsCatalog.tools();
    const {
      _pageToolDefaults,_pageGroupDefaults,_pageWorkflowDefaults,
      _isToolEnabled,_isGroupEnabled,catalogRequired,enabledTools,
      groupPrefixes,enabledGroups
    }=window._AISidebarToolSelection.create({
      config,recommendedTools,suggestedPrefixes,configuredGroups,getSetting,toolList,
      isCatalogLoaded:()=>toolsCatalog.loaded()
    });
    const workflowController=window._AISidebarWorkflowController.create({
      catalog,getSetting,setSetting,defaults:_pageWorkflowDefaults,
      getContainer:()=>pages.tools,getChat:()=>chat,isActive:()=>active==='tools',isCurrent:()=>!destroyed,
    });
    const {load:loadWorkflows,enabled:enabledWorkflows,render:renderWorkflowSection,context:getWorkflowContext}=workflowController;
    const {pages,headerHost,tabsHost}=window._AISidebarTabs.createLayout({container:opts.container,config});
    injectStyle();
    const chatActions = window._AISidebarChatActions.create({
      isCurrent:()=>!destroyed,getChat:()=>chat,enabledTools,enabledGroups,enabledWorkflows,
      applyRecommendations:_applyRecommendations,onSwitch:switchTab
    });
    chat = AppUIChat.create({container:pages.chat, system:system(), uiPrompt:'', promptOptions:promptOptions(), backend:config.backend || 'kiro', model:config.model || '', context: async (q) => { const base = config.context ? (typeof config.context === 'function' ? await config.context(q) : config.context) : ''; const collected = getCollectedContextText(); const projectCtx = await _loadProjectContext(); const wfCtx = getWorkflowContext(); return [projectCtx, base, wfCtx, collected].filter(Boolean).join('\n\n'); }, tools:enabledTools, placeholder:config.placeholder || 'Ask AI…',
      onToolCall: chatActions.onToolCall,
      onDone: chatActions.onDone
    });
    chatActions.attach();

    const contextPreview=window._AISidebarContextDisplay.createPreview({
      container:opts.container,getContext:()=>chat.getFullContext?.(),isCurrent:()=>!destroyed
    });
    const headerControls=headerHost?window._AISidebarHeaderControls.create({
      container:headerHost,onExplain:chatActions.explainPage,onContext:contextPreview.show,
      onClear:()=>{chat.clear();if(active==='history')renderHistory();}
    }):null;
    const navigation=window._AISidebarTabs.create({
      container:tabsHost,getActive:()=>active,onSwitch:switchTab
    });
    chat.setTools?.(enabledTools());
    chat.setToolGroups?.(enabledGroups());
    chat.setPromptOptions?.(promptOptions());
    // Lazy: defer /tools fetch until first AI interaction (tab click or chat focus)
    let _catalogRequested = false;
    function _ensureCatalog() { if (!_catalogRequested) { _catalogRequested = true; loadToolCatalog(); loadWorkflows(); _restorePageTools(); } }

    function switchTab(name) {
      if(destroyed)return;
      active = name;
      navigation.activate(name);
      if (name === 'tools' || name === 'chat') _ensureCatalog();
      Object.entries(pages).forEach(([id, page]) => { page.hidden = id !== name; });
      opts.container.querySelectorAll('[data-ai-tab]').forEach(button => button.classList.toggle('active', button.dataset.aiTab === name));
      if (name === 'history') renderHistory();
      if (name === 'context') { contextSettings.renderLibrary(); renderContext(); renderCollectedContext(); }
      if (name === 'tools') { renderHierarchyToolTree(); renderWorkflowSection(); }
      if (name === 'llm' && !pages.llm.querySelector('.ui-ai-llm-layout')) renderLLMComposer();
    }
    let historyView;
    function renderHistory(){
      if(destroyed)return;
      historyView ||= window._AISidebarHistory.create({
        container:pages.history,chat,onSwitch:switchTab,isCurrent:()=>active==='history'
      });
      return historyView.render();
    }
    function loadToolCatalog() {return toolsCatalog.load();}
    const selectionState=window._AISidebarSelectionState.create({
      container:opts.container,getSetting,setSetting,_pageToolDefaults,_pageGroupDefaults,_pageWorkflowDefaults,
      onRestore:()=>{
        chat.setTools?.(enabledTools());chat.setToolGroups?.(enabledGroups());
        const toolsTab=opts.container.querySelector('[data-ai-tab="tools"]');
        const count=enabledTools().length+enabledGroups().length;
        if(toolsTab&&count)toolsTab.textContent='Tools ('+count+')';
      },
      onChanged:()=>{
        chat.setTools?.(enabledTools());chat.setToolGroups?.(enabledGroups());
        if(active==='tools'){renderHierarchyToolTree();renderWorkflowSection();}
      }
    });
    selectionState.migrate();
    function _restorePageTools(){selectionState.restore();}
    function _applyRecommendations(args){return selectionState.recommend(args);}

    let toolHierarchy;
    function renderHierarchyToolTree() {
      if(destroyed)return;
      toolHierarchy ||= window._AISidebarToolHierarchy.create({
        container:pages.tools,toolList,enabledTools,enabledGroups,_isToolEnabled,_isGroupEnabled,groupPrefixes,
        configuredGroups,getSetting,setSetting,
        removeSetting,
        getWorkflows:workflowController.items,restorePageTools:_restorePageTools,
        apply:()=>{chat.setTools?.(enabledTools());chat.setToolGroups?.(enabledGroups());},
        onRenderWorkflows:renderWorkflowSection,isCatalogLoaded:()=>toolsCatalog.loaded(),isCurrent:()=>active==='tools'
      });
      return toolHierarchy.render();
    }

    let llmComposer;
    function renderLLMComposer() {
      llmComposer?.destroy();
      llmComposer=window._AISidebarLLMComposer.create({
        container:pages.llm,config,chat,toolCatalogValue:toolsCatalog.value(),toolCatalogUrl:toolsCatalog.url(),loadToolCatalog,
        onCatalogRequest:(value,url)=>{toolsCatalog.select(value,url);_catalogRequested=true;}
      });
    }
    const contextSettings=window._AISidebarContextSettings.create({
      container:pages.context,config,chat,system,promptOptions,enabledTools,enabledGroups,getSetting,setSetting,
      isActive:()=>active==='context',onChange:()=>{renderCollectedContext();if(active==='context')renderContext();},
      getGenerationSettings:()=>({
        backend:pages.llm.querySelector('[data-ai-backend]')?.value,
        model:pages.llm.querySelector('[data-ai-model]')?.value
      })
    });
    const refreshPreview=()=>contextSettings.refreshPreview();
    contextSettings.render();
    renderCollectedContext();
    switchTab('chat');
    // If contextState is configured, watch AppUI.state for automatic context updates
    if (config.contextState && window.AppUI && window.AppUI.state) {
      const stateKeys = Array.isArray(config.contextState) ? config.contextState : [config.contextState];
      stateKeys.forEach(key => {
        lifecycle?.add(window.AppUI.state.watch(key, () => { if (active === 'context') renderContext(); }));
      });
    }
    // Listen for external context update events (e.g. "Ask AI" buttons)
    const handleContextUpdate = () => { renderContext(); renderCollectedContext(); };
    if (lifecycle) lifecycle.listen(window, 'ai-context-updated', handleContextUpdate);
    else window.addEventListener('ai-context-updated', handleContextUpdate);
    const selectionMenu=window._AISidebarSelectionMenu.create({container:opts.container,onCollect:addContext});
    const destroy = () => {
      if(destroyed)return;destroyed=true;
      const teardown=AppUILifecycle.createScope();
      teardown.add(()=>opts.container.replaceChildren());
      teardown.add(()=>{
        lifecycle?.destroy();
        if (!lifecycle) window.removeEventListener('ai-context-updated',handleContextUpdate);
      });
      teardown.add(typeof chat.destroy==='function'?chat:()=>chat.cancel?.());
      [catalog,navigation,historyView,contextController,toolHierarchy,selectionState,
        workflowController,contextPreview,headerControls,llmComposer,contextSettings,selectionMenu]
        .reverse().forEach(resource=>teardown.add(resource));
      teardown.destroy();
    };
    return {destroy, getChat:() => chat, switchTab, setContext:fn => { config.context=fn; if (active === 'context') renderContext(); }, setSystem:value => { config.system=value; chat.setSystem?.(value); }, refreshContext:renderContext, addContext, removeContext, getCollectedContext:contextController.list, exportChat: () => { const h = chat.getHistory?.() || []; return h.map(m => `## ${m.role} (${m.timestamp || ''})\n\n${m.content}\n`).join('\n---\n\n'); }};
  }
  function injectStyle() { window._AISidebarStyles.inject(); }
  return {create};
})();
