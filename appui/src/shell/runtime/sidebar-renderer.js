/* Sidebar rendering with pluggable type registry.
 *
 * Supported tab/sidebar types:
 *   render: (el) => {}        — custom render callback (default)
 *   type: 'ai-sidebar'        — AI chat assistant panel
 *   type: 'file-explorer'     — file tree with roots, watch, select
 *   type: 'sections'          — collapsible sections with hash routing
 *   type: 'toolbar'           — toolbar component
 *
 * Pages can register custom types:
 *   AppUIShellSidebarRenderer.registerType('my-type', (spec, container) => { ... });
 */
window.AppUIShellSidebarRenderer = (() => {
  const _types = Object.create(null);

  function registerType(name, handler) {
    _types[name] = handler;
  }

  // Every optional sidebar panel follows the same load/mount/dispose path.
  function mountLazy({container,bundle,loaded,createPanel,onMount,loading,unavailable}) {
    const owner=window.AppUILifecycle.createScope();
    let destroyed=false;
    function mount() {
      if(destroyed)return;
      const panel=createPanel();
      owner.add(panel);
      if(destroyed)return;
      try {owner.add(onMount?.(panel));}
      catch(error){owner.destroy();throw error;}
    }
    if(loaded())mount();
    else {
      container.textContent=loading;
      window.AppUI.load(bundle).then(mount).catch(error=>{
        if(!destroyed)container.textContent=unavailable+error.message;
      });
    }
    return()=>{
      if(destroyed)return;destroyed=true;
      owner.destroy();
    };
  }

  registerType('ai-sidebar',(spec,container,ctx)=>mountLazy({
    container,bundle:'aiSidebar',loaded:()=>window.AppUIAISidebarFeature,
    createPanel:()=>ctx.initAISidebar(container,spec),
    loading:'Loading assistant...',unavailable:'Assistant unavailable: ',
  }));

  registerType('file-explorer',(spec,container)=>mountLazy({
    container,bundle:'fileExplorer',loaded:()=>window.AppUIFileExplorer,onMount:panel=>spec.onMount?.(panel),
    loading:'Loading files...',unavailable:'File browser unavailable: ',
    createPanel(){
      const Explorer=window.AppUIFileExplorer;
      if(!Explorer)throw new Error('FileExplorer not loaded');
      const config=spec.config||spec;
      container.replaceChildren();
      return Explorer.create({...config,container,roots:config.roots||[],
        watchPaths:config.watchPaths||config.watch||[],storageKey:config.storageKey||'file-explorer'});
    },
  }));

  registerType('chat',(spec,container)=>mountLazy({
    container,bundle:'aiSidebar',loaded:()=>window.AppUIChat,onMount:panel=>spec.onMount?.(panel),
    loading:'Loading chat...',unavailable:'Chat unavailable: ',
    createPanel(){
      const Chat=window.AppUIChat;
      if(!Chat)throw new Error('Chat not loaded');
      container.replaceChildren();
      return Chat.create({...spec.config,container});
    },
  }));

  // Built-in type: sections
  registerType('sections', (spec, container) => {
    const Sections = window.AppUISidebarSections;
    if (!Sections) { container.textContent = 'SidebarSections not loaded'; return; }
    const config = spec.config || spec;
    const sections = Sections.create({
      container,
      storageKey: config.storageKey || '',
      sections: config.sections || [],
      hashRouting: config.hashRouting !== false,
      onNavigate: config.onNavigate,
    });
    return () => sections.destroy();
  });

  // Built-in type: toolbar
  registerType('toolbar', (spec, container) => {
    const Toolbar = window.AppUIToolbar;
    if (!Toolbar) { container.textContent = 'Toolbar not loaded'; return; }
    const config = spec.config || spec;
    const toolbar = Toolbar.create({
      container,
      title: config.title,
      subtitle: config.subtitle,
      items: config.items || [],
      right: config.right || [],
      onCommand: config.onCommand,
    });
    return () => toolbar.destroy();
  });

  function renderPanel(spec, container, ctx) {
    if (spec.type && _types[spec.type]) {
      return _types[spec.type](spec, container, ctx);
    }
    return ctx.renderSlot(spec, container);
  }

  function render({sidebar, container, position, el, renderSlot, initAISidebar, discoverPlugins, layout, writeLayout, setTabs}) {
    const ctx = {renderSlot, initAISidebar};

    // No tabs — render single panel directly
    if (!Array.isArray(sidebar.tabs) || !sidebar.tabs.length) {
      return renderPanel(sidebar, container, ctx);
    }
    if (sidebar.tabs.length === 1 && !discoverPlugins(position).length) {
      return renderPanel(sidebar.tabs[0], container, ctx);
    }

    // Build tab list: page config + discovered plugins
    const tabs = sidebar.tabs.map((tab, index) => Object.assign({id: 'tab-' + index}, tab));
    discoverPlugins(position).forEach(plugin => {
      if (!tabs.some(tab => tab.id === plugin.id)) tabs.push(plugin);
    });

    // Create the unified tab host
    const tabHost = window.AppUISidebarTabs.create({
      container,
      storageKey: 'appui-sidebar-' + position,
      tabs,
      initialActiveId: layout[position + 'Tab'],
      onRender: (tab, panel) => renderPanel(tab, panel, ctx),
      onTabChange: (id) => {
        layout[position + 'Tab'] = id;
        writeLayout();
      },
    });

    // Expose to shell for programmatic tab activation
    setTabs({
      tabs,
      activate: tab => tabHost.switchTo(tab.id),
      active: () => tabHost.getActiveId(),
    });

    // Register as pane controller for View menu toggles
    if (window.AppUIShellCommands?.registerPaneController) {
      window.AppUIShellCommands.registerPaneController(position, tabHost);
    }
    return () => tabHost.destroy();
  }

  return {render, registerType};
})();
