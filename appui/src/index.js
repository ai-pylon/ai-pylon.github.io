/* Public AppUI entry point. It is provided by the foundation and shell bundles. */
const AppUI = (function() {
  const VERSION = '2.81.0';
  let activeFacade = null;
  function load(...bundleNames) {
    const assets = window.AppUIAssets;
    if (!assets?.load) return Promise.reject(new Error('AppUI manifest is missing. Load pylon/appui/manifest.js before the core bundle.'));
    return bundleNames.reduce((ready, name) => ready.then(() => assets.load(name)), Promise.resolve());
  }
  function requireGlobal(name) {
    const value = window[name];
    if (!value) throw new Error(`AppUI requires ${name}; load its bundle before using this API.`);
    return value;
  }
  // Recognized top-level createApp config keys. A typo (e.g. `left`/`right`/
  // `statusbar` casing, or `rightsidebar`) silently renders nothing, which is a
  // frequent and hard-to-spot page-authoring bug — so warn at mount time.
  const KNOWN_CONFIG_KEYS = new Set([
    'id', 'title', 'content',
    'sidebar', 'leftSidebar', 'rightSidebar',
    'statusBar', 'statusbar',            // statusbar is a tolerated alias
    'menu', 'menubar', 'palette',
    'commands', 'actions', 'onAction',
    'pipeline', 'theme', 'notifications',
    'onReady', 'onRoute', 'events', 'shortcuts',
  ]);
  function _warnUnknownConfigKeys(config) {
    if (!config || typeof config !== 'object') return;
    const unknown = Object.keys(config).filter(k => !KNOWN_CONFIG_KEYS.has(k));
    if (!unknown.length) return;
    // Suggest the closest known key for common casing typos.
    const suggest = {left: 'leftSidebar', right: 'rightSidebar', rightsidebar: 'rightSidebar',
      leftsidebar: 'leftSidebar', status: 'statusBar', statusBar: 'statusBar',
      statusbar: 'statusBar', header: 'menubar', footer: 'statusBar'};
    unknown.forEach(k => {
      const hint = suggest[k.toLowerCase()] ? ` — did you mean "${suggest[k.toLowerCase()]}"?` : '';
      console.warn(`[AppUI.createApp] unknown config key "${k}"${hint} (this region will not render). Known keys: ${[...KNOWN_CONFIG_KEYS].join(', ')}`);
    });
  }
  // AppUIEmbed — a page shown INLINE by another app (?embed=1, e.g. an app's
  // own viewer hosted in the Workspace preview pane) tells its host what it is
  // showing right now, so the host can ground its chat in the live view:
  //   AppUIEmbed.post({src, table, sql, where, view, rows, columns, …})
  // posts {type:"appui:view-state", state} to the parent (same origin only).
  // A no-op when the page isn't embedded.
  if (!window.AppUIEmbed) {
    window.AppUIEmbed = {
      embedded() {
        try { return window.parent !== window && new URLSearchParams(location.search).get('embed') === '1'; }
        catch (_e) { return false; }
      },
      post(state) {
        if (!this.embedded()) return;
        try { window.parent.postMessage({type: 'appui:view-state', state: state || {}}, location.origin); } catch (_e) {}
      },
      // the HOST drives the view (e.g. its chat fills the SQL box):
      // parent posts {type:"appui:view-command", command:{…}} → fn(command).
      // Same origin + from the parent only. The page decides what it supports
      // (it lists that in its state as `accepts`).
      onCommand(fn) {
        if (!this.embedded() || typeof fn !== 'function') return () => {};
        const listener = (e) => {
          const d = e && e.data;
          if (!d || d.type !== 'appui:view-command' || e.origin !== location.origin || e.source !== window.parent) return;
          try { fn(d.command || {}); } catch (_e) {}
        };
        window.addEventListener('message', listener);
        return () => window.removeEventListener('message', listener);
      }
    };
  }
  function createApp(config = {}) {
    _warnUnknownConfigKeys(config);
    // EMBED MODE: a page loaded with ?embed=1 (another app showing it inline —
    // e.g. the Workspace preview pane hosting an app's own viewer) drops its
    // window chrome: the menubar and the status bar (shell/styles.css). The
    // page's own content and sidebars render as usual.
    try {
      if (new URLSearchParams(location.search).get('embed') === '1') document.documentElement.classList.add('appui-embed');
    } catch (_e) { /* no location (tests) */ }
    const app = requireGlobal('AppUIShell');
    app.init(config);
    let lifetime = app.getLifetime?.();
    const current = () => !lifetime || lifetime.current();
    const owned=(callback,fallback)=>(...args)=>current()?callback(...args):fallback;
    // If config declares event channels AND AppUIEventBus is available, create SSE-connected bus.
    // Otherwise fall back to page-local AppUIEvents.
    let events = null;
    const eventConfig = config.events;
    if (eventConfig && eventConfig.channels && typeof AppUIEventBus !== 'undefined') {
      events = window.AppUIEvents.createConnected(eventConfig,AppUIEventBus);
    } else {
      events = window.AppUIEvents?.create?.() || null;
    }
    let released = false;
    const releaseEvents = () => { if (released) return; released = true; events?.destroy(); };
    let refreshing = false;
    const ownEvents = () => app.own?.(() => { if (!refreshing) releaseEvents(); });
    ownEvents();
    const refresh = () => {
      if (!current()) return;
      refreshing = true;
      try {
        const result = app.refresh();
        lifetime = app.getLifetime?.();
        ownEvents();
        return result;
      } catch (error) { releaseEvents(); throw error; }
      finally { refreshing = false; }
    };
    const facade = {
      destroy: () => {
        releaseEvents();
        if (current()) app.destroy();
      },
      refresh,
      setStatus: owned((...args)=>app.setStatus(...args)),
      setTitle: owned(title=>app.setTitle(title)),
      notify: owned((...args)=>app.notify(...args)),
      toggleLeftSidebar: owned(()=>app.toggleLeftSidebar()),
      toggleRightSidebar: owned(()=>app.toggleRightSidebar()),
      renderAll: refresh,
      events,
      regions: {
        get: owned(name=>app.getElement(name),null),
        controller: owned(name=>app.getRegion(name),null),
        content: {
          mount: owned(config=>app.getRegion('content')?.mount(config)),
          get: owned(()=>app.getContent(),null),
        },
      },
      commands: {
        run: owned((...args)=>app.runCommand(...args),false),
        register: owned(command=>app.registerCommand(command)),
        setEnabled: owned((...args)=>app.setCommandEnabled(...args),false),
      },
      shortcuts: {
        get: () => current()?app.getShortcuts():[],
        set: owned((...args)=>app.setShortcut(...args),false),
        reset: owned(()=>app.resetShortcuts()),
        enabled: owned(()=>app.areShortcutsEnabled(),false),
        setEnabled: owned(value=>app.setShortcutsEnabled(value)),
      },
      router: {
        get: owned(key=>app.getRoute(key),null),
        set: owned((...args)=>app.setRoute(...args)),
        getHash: owned(key=>app.getHashRoute(key),null),
        setHash: owned((key,value,options)=>app.setHashRoute(key,value,options)),
        setHashRoutes: owned((...args)=>app.setHashRoutes(...args)),
      },
      sidebars: {
        activate: owned((position,id)=>app.activateSidebarTab(position,id),false),
        toggleLeft: owned(()=>app.toggleLeftSidebar()),
        toggleRight: owned(()=>app.toggleRightSidebar()),
      },
    };
    activeFacade = facade;
    return facade;
  }
  function shell() { return requireGlobal('AppUIShell'); }
  return {
    VERSION,
    version: VERSION,
    templateVersion: window.AppUITemplate?.VERSION || null,
    createApp,
    init(config) { createApp(config); return this; },
    destroy() { return activeFacade ? activeFacade.destroy() : shell().destroy(); },
    refresh() { return activeFacade ? activeFacade.refresh() : shell().refresh(); },
    setStatus(...args) { return shell().setStatus(...args); },
    setTitle(title) { return shell().setTitle(title); },
    notify(...args) { return shell().notify(...args); },
    toggleLeftSidebar() { return shell().toggleLeftSidebar(); },
    toggleRightSidebar() { return shell().toggleRightSidebar(); },
    registerCommand(command) { return shell().registerCommand(command); },
    get state() { return shell().state; },
    template: window.AppUITemplate,
    services: {get dataBind() { return window.AppUIDataBind || null; }, get EventBus() { return window.AppUIEventBus || null; }, api: window.AppUIApi, commands: window.AppUICommands, events: window.AppUIEvents, lifecycle: window.AppUILifecycle, layoutState: window.AppUILayoutState, router: window.AppUIRouter, shortcuts: window.AppUIShortcuts, theme: window.AppUITheme, get ToolSocket() { return window.AppUIToolSocket || null; }, get streamEvents() { return window.AppUIStreamEvents || null; }, get urlFields() { return window.AppUIUrlFields || null; }},
    utils: {get documentStyles() { return window.AppUIDocumentStyles || null; }, get scripts() { return window.AppUIScriptLoader || null; }, get asyncCache() { return window.AppUIAsyncCache || null; }, get files() { return window.AppUIFileUtils || null; }, core: window.AppUICore, storage: window.AppUIStorage, text: window.AppUITextUtils, polling: window.AppUIPollRefresh, get pointer() { return window.AppUIPointerGesture || null; }, get diff() { return window.AppUITextDiff || null; }},
    diagnostics: {
      snapshot() { return window.AppUIAssets?.diagnostics?.() || {}; },
      clearCacheAndReload() { return window.AppUIAssets?.clearCacheAndReload?.(); },
      open() {
        const snapshot = window.AppUIAssets?.diagnostics?.() || {};
        const body = '<pre style="white-space:pre-wrap;max-height:55vh;overflow:auto">' +
          AppUITextUtils.esc(JSON.stringify(snapshot, null, 2)) + '</pre>';
        return AppUIDialog.show({
          title: 'AppUI diagnostics', body, width: '720px',
          buttons: [
            {text: 'Close'},
            {text: 'Clear cache and reload', action: () => window.AppUIAssets?.clearCacheAndReload?.()},
          ],
        });
      },
    },
    // Shared debug capture + one-call issue reporting for any app. See
    // src/services/debug.js. AppUI.debug.log(...) leaves a breadcrumb;
    // AppUI.debug.reportIssue() opens a prefilled report with the full
    // auto-captured context (log + errors + diagnostics) and files it to
    // the issue_report tracker.
    get debug() { return window.AppUIDebug || null; },
    load,
    components: {
      get LogView() { return window.AppUILogView || null; },
      get GraphNode() { return window.AppUIGraphNode || null; },
      get GraphDrag() { return window.AppUIGraphDrag || null; },
      get Disclosure() { return window.AppUIDisclosure || null; },
      get Feedback() { return window.AppUIFeedback || null; },
      get SidebarSections() { return window.AppUISidebarSections || null; },
      get Breadcrumbs() { return window.AppUIBreadcrumbs || null; },
      get ContextMenu() { return window.AppUIContextMenu || null; },
      get Menu() { return window.AppUIMenu || null; },
      get Palette() { return window.AppUIPalette || null; },
      get StatusBar() { return window.AppUIStatusBar || null; },
      get Toolbar() { return window.AppUIToolbar || null; },
      get Pagination() { return window.AppUIPagination || null; },
      get Header() { return window.AppUIHeader || null; },
      get RecentRuns() { return window.AppUIRecentRuns || null; },
      get Splitter() { return window.AppUISplit || null; },
      get DataView() { return window.AppUIDataView || null; },
      get Dialog() { return window.AppUIDialog || null; },
      get TabbedDialog() { return window.AppUITabbedDialog || null; },
      get FileDialog() { return window.AppUIFileDialog || null; },
      get Toast() { return window.AppUIToast || null; },
      get Chat() { return window.AppUIChat || null; },
      get ChatView() { return window.AppUIChatView || null; },
      get Suggestions() { return window.AppUISuggestions || null; },
      get DnD() { return window.AppUIDnD || null; },
      get Resizer() { return window.AppUIResizer || null; },
      get Selection() { return window.AppUISelection || null; },
      get VirtualScroll() { return window.AppUIVirtualScroll || null; },
      get Tree() { return window.AppUITree || null; },
      get ChapterTree() { return window.ChapterTree || null; },
      get Tabs() { return window.AppUITabs || null; },
      get NavigationLink() { return window.AppUINavigationLink || null; },
      get TabNavigation() { return window.AppUITabNavigation || null; },
      get SidebarTabs() { return window.AppUISidebarTabs || null; },
      get FloatingPanel() { return window.AppUIFloatingPanel || null; },
      get JsonEditor() { return window.AppUIJsonEditor || null; },
      get JsonForm() { return window.AppUIJsonForm || null; },
      get MultiSplit() { return window.AppUIMultiSplit || null; },
      get DataTable() { return window.AppUIDataTable || null; },
      get Watcher() { return window.AppUIWatcher || null; },
      get GridView() { return window.AppUIGridView || null; },
      get StatCards() { return window.AppUIStatCards || null; },
      get Workspace() { return window.AppUIWorkspace || null; },
      get LiveEditPane() { return window.AppUILiveEditPane || null; },
    },
    features: {
      get PylonProcessors() { return window.AppUIPylonProcessors || null; },
      get ContentTabs() { return window.AppUIContentTabs || null; },
      get aiSidebar() { return window.AppUIAISidebarFeature || null; },
      get DaemonStatus() { return window.AppUIDaemonStatus || null; },
      get ServiceStatus() { return window.AppUIDaemonStatus || null; },
      get FileExplorer() { return window.AppUIFileExplorer || null; },
      get FileBackend() { return window.AppUIFileBackend || null; },
      get Notifications() { return window.AppUINotificationsFeature || null; },
      get SidebarDock() { return window.AppUISidebarDockFeature || null; },
    },
    get breadcrumb() { return window.AppUIShellBreadcrumb || null; },
  };
})();
window.AppUI = AppUI;
