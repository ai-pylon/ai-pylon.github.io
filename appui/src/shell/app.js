/**
 * AppUI shell  --  application layout framework for studio pages.
 *
 * Layout:
 *   +--------------- Menu Bar (ai-menu.js) ------------------+
 *   +--------+------------------------------+----------------+
 *   | Left   |                              | Right Sidebar  |
 *   |Sidebar |      Content Area            | (ai-sidebar)   |
 *   |(nav/   |                              |                |
 *   | panels)|  (editor/preview/etc.)       |  AI chat +     |
 *   |        |                              |  tool context   |
 *   +--------+------------------------------+----------------+
 *   |                    Status Bar                           |
 *   +--------------------------------------------------------+
 *
 * Left sidebar: page-specific navigation (chapters, file tree, macros, etc.)
 * Right sidebar: AI assistant (ai-sidebar.js)  --  always the same component
 * Content: the main working area  --  editor, preview, split pane, etc.
 * ai-float: optional floating overlay (independent of layout)
 *
 * Usage:
 *   <script src="/appui/manifest.js"></script>
 *   <script>AppUIAssets.loadCss();</script>
 *   <script>window.AppUIReady = AppUIAssets.load('foundation', 'shell', 'aiSidebar');</script>
 *   <script>
 *     AppUI.init({
 *       id: 'mum_studio',
 *       title: 'MUM Studio',
 *       pipeline: 'mum_studio',         // loads menu + tool_groups from pipeline
 *       leftSidebar: {                   // page-specific navigation
 *         width: 250,
 *         render: (el) => { el.innerHTML = '<h3>Macros</h3>...'; }
 *       },
 *       rightSidebar: {                  // AI chat (always ai-sidebar)
 *         type: 'ai-sidebar', width: 350,
 *         config: { title: 'MUM AI', context: () => getEditorContent() }
 *       },
 *       statusBar: {},                    // default: AppUIStatusBar with history log
 *       // statusBar: { render: (el) => { ... } },  // custom render overrides default
 *       content: { render: (el) => { ... } },
 *       onAction: (menu, id, params) => { ... },
 *       onReady: () => { ... },
 *     });
 *
 *     // Layout control:
 *     AppUI.setStatus('Processing…');     // updates status bar + logs to history
 *     AppUI.toggleLeftSidebar();
 *     AppUI.toggleRightSidebar();
 *     AppUI.setTitle('MUM Studio  --  diagram.puml');
 *   </script>
 */
// Allow pages to register sidebar tab plugins before init
if (!window.__appui_sidebar_plugins) window.__appui_sidebar_plugins = [];

// Page lifecycle: onDestroy callbacks invoked on beforeunload/navigation
(function() {
    const _destroyCallbacks = [];
    if (!window.AppUI) window.AppUI = {};
    window.AppUI.onDestroy = function(fn) { _destroyCallbacks.push(fn); };
    window.addEventListener('beforeunload', function() {
        _destroyCallbacks.forEach(fn => { try { fn(); } catch(e) {} });
    });
})();

const AppUIShell = (function() {
    const VERSION = '2.4.0';
    let _config = {};
    let _sourceConfig = {};
    let _els = {};
    let _lifetime = null;
    let _pipeline = null;
    let _statusBar = null;
    let _content = null;
    let _regions = {};
    let _sidebarTabs = {};
    let _layout = {};
    let _layoutState = null;
    let _responsiveShell = null;
    let _routeListener = null;
    let _routerService = null;
    const _commandRuntime=window.AppUIShellCommandRuntime.create({getConfig:()=>_config,onPaletteChange:_syncPalette,dispatchMenu:_dispatchMenuAction});
    const _cleanupRegistry = window.AppUIShellCleanup.create();
    let _initGeneration = 0;
    const _state = AppUIReactiveState.create();
    let _pipelineController = null;
    const _layoutStorage = window.AppUIShellLayoutStorage.create({getAppId: () => _config.id, getState: () => _layoutState, getLayout: () => _layout});
    const _routes = window.AppUIShellRoutes.create({getAppId: () => _config.id, getRouter: () => _routerService, onRoute: (...args) => _config.onRoute?.(...args)});
    const _shellHelpers = window.AppUIShellHelpers.create({
        getContentTarget: () => _els.contentTop || _els.content,
        getHashRoutes: () => _hashRoutes(),
    });

    function _copyConfig(opts = {}) {
        const menu = Object.fromEntries(Object.entries(opts.menu || {}).map(([name, items]) => [
            name,
            Array.isArray(items) ? [...items] : items,
        ]));
        return Object.assign({}, opts, {menu});
    }

    function init(opts) {
        destroy();
        const generation = ++_initGeneration;
        _sourceConfig = _copyConfig(opts);
        _config = _copyConfig(_sourceConfig);
        // `statusbar: true` is the concise form for the default status bar;
        // `statusbar: false`, `menubar: false`, and `sidebar: false` disable
        // shell regions without requiring a different page framework.
        if (_config.statusbar === true && _config.statusBar === undefined) {
            _config.statusBar = {};
        }
        if (typeof _config.statusbar === 'object' && _config.statusBar === undefined) {
            _config.statusBar = _config.statusbar;
        }
        _layoutState = AppUILayoutState.create(_config.id);
        _commandRuntime.init();
        _routerService = AppUIRouter.create(_config.id, () => _config.onRoute?.(null, null));
        _layout = _readLayout();
        _registerCommands(_config.commands || _config.actions);
        _injectViewMenu();
        _buildShell();
        _bindRoute();
        const lifetime = AppUILifecycle.createViewScope({
            host: _els.main, isCurrent: () => generation === _initGeneration,
        });
        _lifetime = lifetime;
        _trackCleanup(() => lifetime.destroy());
        lifetime.add(() => { if (generation === _initGeneration) destroy(); });
        // Every active page supplies its own shell configuration. Render it
        // immediately; pipeline data is an optional menu enhancement and must
        // not delay first paint or page-owned onReady work.
        _finishInit(generation);
        _loadPipeline(_config.pipeline, generation);
    }

    function _buildShell() {
        AppUITheme.restore();
        _injectStyles();
        _buildShellWithRegions();
    }

    function _buildShellWithRegions() {
        _mountTemplate();
        document.body.classList.add('ai-app-body');
        _regions = window.AppUIShellRegionMounter.create({elements: _els, layout: _layout, persist: _writeLayout});
        window.AppUIShellRegionMounter.mount({regions: _regions, elements: _els, config: _config,
            buildResponsiveRail: _buildResponsiveRail});
        window.addEventListener('unhandledrejection', _onUnhandledError);
        window.addEventListener('error', _onUnhandledError);
    }

    function _mountTemplate() {
        _els = window.AppUIShellTemplateMounter.mount();
    }

    function _loadPipeline(pipelineId, generation) {
        _pipelineController = window.AppUIShellPipelineLoader.load(pipelineId, {
            isCurrent: () => generation === _initGeneration,
            onPipeline: pipeline => {
                _pipeline = pipeline;
                if (_pipeline) _refreshPipelineMenu(generation);
            },
        });
    }

    function _refreshPipelineMenu(generation) {
        if (generation !== _initGeneration) return;
        _regions.menubar.initMenu({component: AppUIMenu, definition: _pipeline, onAction: _dispatchMenuAction});
        _syncPalette();
    }

    function _finishInit(generation) {
        if (generation !== _initGeneration) return;
        // Init menu
        _regions.menubar.initMenu({
            component: AppUIMenu,
            definition: _pipeline || _config,
            onAction: _dispatchMenuAction,
        });
        _bindCommandShortcuts();
        _renderSlot(_getRegionOption('menubar', 'right', 'menuRight'), _els.menuRight);
        _installThemeControl();
        _installNotifications();
        _syncPalette();

        // Render left sidebar
        if (_config.leftSidebar && _els.left) {
            const cleanup = _renderSidebar(_config.leftSidebar, _els.left, 'left');
            if (typeof cleanup === 'function' || typeof cleanup?.destroy === 'function') _trackCleanup(cleanup);
        }

        // Render right sidebar (AI sidebar or custom)
        if (_config.rightSidebar && _els.right) {
            const cleanup = _renderSidebar(_config.rightSidebar, _els.right, 'right');
            if (typeof cleanup === 'function' || typeof cleanup?.destroy === 'function') _trackCleanup(cleanup);
        }

        // Render content
        _content = window.AppUIShellContentMounter.mount({
            config: _config.content, region: _regions.content, runCommand,
        });

        // The optional dock feature shares the shell's layout and lifetime.
        if (window.AppUISidebarDockFeature && (_config.leftSidebar || _config.rightSidebar)) {
            const dock = window.AppUISidebarDockFeature.mount({
                elements: _els, layout: _layout, persist: _writeLayout, config: _config,
            });
            _trackCleanup(() => dock.destroy());
        }

        // Notify ready
        if (_config.onReady) _config.onReady();

        // Render status bar
        if (_config.statusBar && _els.status) {
            _statusBar = window.AppUIShellStatusRenderer.mount({
                config: _config.statusBar, elements: _els, region: _regions.statusbar,
                renderSlot: _renderSlot, trackCleanup: _trackCleanup,
            });
            window.AppUIShellStatusRenderer.mountRight({
                config: _config.statusBar, elements: _els,
                renderSlot: _renderSlot, trackCleanup: _trackCleanup,
                right: _getRegionOption('statusBar', 'right'),
            });
        }
    }

    function _initAISidebar(container, sidebar) {
        return window.AppUIShellAISidebarRenderer.mount({
            container, sidebar, pipeline: _pipeline, appId: _config.id, onClose: toggleRightSidebar,
        });
    }

    function _getRegionOption(region, key, legacyKey) {
        const config = _config[region];
        if (config && typeof config === 'object') return config[key];
        return legacyKey ? _config[legacyKey] : null;
    }


    function _renderSlot(spec, container) {
        if (!spec || !container) return;
        let cleanup;
        if (typeof spec === 'function') cleanup = spec(container);
        else if (spec.mount) cleanup = spec.mount(container);
        else if (spec.render) cleanup = spec.render(container);
        else if (typeof spec === 'string') container.insertAdjacentHTML('beforeend', spec);
        else if (spec instanceof Node) container.appendChild(spec);
        if (typeof cleanup === 'function' || typeof cleanup?.destroy === 'function') cleanup = _trackCleanup(cleanup);
        return cleanup;
    }

    function _renderSidebar(sidebar, container, position) {
        return window.AppUIShellSidebarRenderer.render({
            sidebar, container, position, el: _el, renderSlot: _renderSlot,
            initAISidebar: _initAISidebar, discoverPlugins: discoverSidebarPlugins,
            layout: _layout, writeLayout: _writeLayout,
            setTabs: tabs => { _sidebarTabs[position] = tabs; },
        });
    }

    const _trackCleanup = cleanup => _cleanupRegistry.track(cleanup);

    const _readLayout = () => _layoutStorage.read();
    const _writeLayout = () => _layoutStorage.write();

    function _buildResponsiveRail(main) {
        _responsiveShell?.destroy();
        _responsiveShell = AppUIResponsiveShell.create({
            main,
            left: _els.left,
            right: _els.right,
            hasLeft: !!_config.leftSidebar,
            hasRight: !!_config.rightSidebar,
            layout: _layout,
            onToggleLeft: toggleLeftSidebar,
            onToggleRight: toggleRightSidebar,
        });
        _els.sidebarRail = _responsiveShell.rail;
    }

    function _installThemeControl() {
        const menuConfig = _config.menubar && typeof _config.menubar === 'object' ? _config.menubar : {};
        if (!(menuConfig.theme || _config.theme) || !_els.menuRight) return;
        _regions.menubar.mountTheme({enabled: true, themeService: AppUITheme});
    }

    function _installNotifications() {
        const menuConfig = _config.menubar && typeof _config.menubar === 'object' ? _config.menubar : {};
        const notificationsFeature = window.AppUINotificationsFeature;
        if ((menuConfig.notifications || _config.notifications) && notificationsFeature) {
            const notifications = _regions.menubar?.mountNotifications
                ? _regions.menubar.mountNotifications({enabled: true, feature: notificationsFeature})
                : notificationsFeature.mount(_els.menuRight);
            if (notifications?.destroy) _trackCleanup(() => notifications.destroy());
        }
    }

    function _syncPalette() {
        const paletteComponent = window.AppUIPalette;
        if (_config.palette === false || !paletteComponent) return;
        window.AppUIShellPaletteRenderer.sync({
            palette:paletteComponent,
            definitions:_commandRuntime.raw(),
            available:getCommands(),menuActions:AppUIMenu.getActions(),
            runCommand,triggerMenu:(menu,id)=>AppUIMenu.trigger(menu,id),
        });
    }

    // Hash routes are intentionally page-local and human-readable. Unlike query
    // routes, they are not namespaced because the fragment belongs only to this
    // document. Example: #folder=Mailbox%2FInbox&email=Quarterly+Review
    const getRoute = key => _routes.get(key);
    const setRoute = (...args) => _routes.set(...args);
    const _hashRoutes = () => _routes.hashes();
    const getHashRoute = key => _routes.getHash(key);
    const setHashRoute = (...args) => _routes.setHash(...args);
    const setHashRoutes = (...args) => _routes.setHashes(...args);
    const _bindRoute = () => { _routeListener = _routes.bind(); };

    function _injectViewMenu() {
        if (!_config.menu) _config.menu = {};
        const viewItems = window.AppUIShellCommands.buildViewMenuItems(_config);
        _config.menu.View = [...viewItems, ...(_config.menu.View || [])];
        window.AppUIShellCommands.buildViewCommands({
            config: _config, toggleLeftSidebar, toggleRightSidebar,
        }).forEach(command => {
            try { registerCommand(command); } catch (_) {}
        });
    }

    function _dispatchMenuAction(menu, id, params, item) {
        if (runCommand(id, params, {type: 'menu', menu, item})) return;
        if (_config.onAction) _config.onAction(menu, id, params, item);
    }

    const _registerCommands=definitions=>_commandRuntime.registerAll(definitions);
    const registerCommand=command=>_commandRuntime.register(command);
    function runCommand(id,params,source){return _commandRuntime.run(id,params,source);}
    const getCommands=()=>_commandRuntime.all();
    const setCommandEnabled=(id,enabled)=>_commandRuntime.setEnabled(id,enabled);
    const _bindCommandShortcuts=()=>_commandRuntime.bindShortcuts();
    const setShortcutsEnabled=enabled=>_commandRuntime.setShortcutsEnabled(enabled);
    const areShortcutsEnabled=()=>_commandRuntime.areShortcutsEnabled();
    const setShortcut=(id,shortcut)=>_commandRuntime.setShortcut(id,shortcut);
    const resetShortcuts=()=>_commandRuntime.resetShortcuts();
    const getShortcuts=()=>_commandRuntime.getShortcuts();

    const _history = window.AppUIShellHistory.create();

    const _dirtyState = window.AppUIShellDirtyState.create(() => _config.title);

    const _toolbar = window.AppUIShellToolbar.create({el: _el, runCommand});

    const _onUnhandledError = event => window.AppUIShellDiagnostics.reportUnhandled(event, setStatus);
    const discoverSidebarPlugins = position => window.AppUIShellDiagnostics.discoverSidebarPlugins(position);

    const _dataCache = window.AppUIShellDataCache.create((...args) => _shellHelpers.fetchApi(...args));

    // --- Public API ---

    const _status = window.AppUIShellStatus.create(() => _statusBar);
    const setStatus = (...args) => _status.set(...args);

    const _sidebarControls = window.AppUIShellSidebarControls.create({elements: () => _els, regions: () => _regions, layout: () => _layout, saveLayout: _writeLayout});
    const toggleLeftSidebar = () => _sidebarControls.toggleLeft();
    const toggleRightSidebar = () => _sidebarControls.toggleRight();

    const notify = (...args) => window.AppUIShellNotifications.notify(...args);

    const _publicState = window.AppUIShellPublicState.create({elements: () => _els, regions: () => _regions, pipeline: () => _pipeline, statusBar: () => _statusBar, content: () => _content});

    const _sidebarTabControls = window.AppUIShellSidebarTabs.create(() => _sidebarTabs);

    function refresh() {
        const config = _sourceConfig;
        init(config);
    }

    function destroy() {
        ++_initGeneration;
        _pipelineController?.abort();
        _pipelineController = null;
        _cleanupRegistry.runAll();
        _lifetime = null;
        Object.values(_regions).forEach(region => region.destroy?.());
        _regions = {};
        const paletteComponent = window.AppUIPalette;
        AppUIMenu.destroy();
        paletteComponent?.destroy?.();
        _commandRuntime.destroyShortcuts();
        _responsiveShell?.destroy();
        if (_routeListener) {
            window.removeEventListener('popstate', _routeListener);
            window.removeEventListener('hashchange', _routeListener);
        }
        _routerService?.destroy();
        window.removeEventListener('unhandledrejection', _onUnhandledError);
        window.removeEventListener('error', _onUnhandledError);
        _routeListener = null;
        _routerService = null;
        _responsiveShell = null;
        _statusBar = null;
        _content = null;
        _sidebarTabs = {};
        _layoutState = null;
        _commandRuntime.clear();
        _els = {};
        window.AppUIShellTemplateMounter.reset();
    }

    // --- Helpers ---

    function _el(tag, cls) {
        return _shellHelpers.el(tag, cls);
    }

    function _injectStyles() {
        return window.AppUIShellLayout.injectStyles();
    }

    return {
        VERSION,
        init,
        destroy,
        refresh,
        getLifetime: () => _lifetime,
        own: cleanup => _trackCleanup(cleanup),
        setStatus,
        notify,
        toggleLeftSidebar,
        toggleRightSidebar,
        setTitle: title => _publicState.setTitle(title),
        getElement: slot => _publicState.getElement(slot),
        getRegion: name => _publicState.getRegion(name),
        getPipeline: () => _publicState.getPipeline(),
        getStatusBar: () => _publicState.getStatusBar(),
        getContent: () => _publicState.getContent(),
        getRoute,
        setRoute,
        getHashRoute,
        setHashRoute,
        setHashRoutes,
        activateSidebarTab: (...args) => _sidebarTabControls.activate(...args),
        registerCommand,
        runCommand,
        setCommandEnabled,
        pushUndo: (...args) => _history.pushUndo(...args),
        undo: (...args) => _history.undo(...args),
        redo: (...args) => _history.redo(...args),
        pushRedo: (...args) => _history.pushRedo(...args),
        clearUndoHistory: scope => _history.clear(scope),
        setShortcut,
        resetShortcuts,
        getShortcuts,
        setShortcutsEnabled,
        areShortcutsEnabled,
        fetch: (...args) => _shellHelpers.fetchApi(...args),
        renderBreadcrumb: container => _shellHelpers.renderBreadcrumb(container),
        confirm: (...args) => window.AppUIShellDialogs.confirm(...args),
        markDirty: value => _dirtyState.set(value),
        isDirty: () => _dirtyState.get(),
        renderToolbar: (...args) => _toolbar.render(...args),
        data: (...args) => _dataCache.get(...args),
        invalidateData: toolPath => _dataCache.invalidate(toolPath),
        state: _state,
    };
})();
window.AppUIShell = AppUIShell;
