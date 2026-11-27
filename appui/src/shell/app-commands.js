/**
 * AppUI Shell Commands  --  command registration, keyboard shortcuts, view menu.
 * Extracted from shell/app.js for modularity.
 *
 * Exposes: window.AppUIShellCommands
 */
(function() {
  'use strict';

  function normalizeShortcut(shortcut) {
    return AppUIShortcuts.normalize(shortcut);
  }

  /**
   * Build view menu items for the layout.
   * @param {object} config - app config
   * @returns {Array} view menu item definitions
   */
  function buildViewMenuItems(config) {
    const viewItems = [];
    if (config.leftSidebar) viewItems.push({ id: 'view.toggle_left', label: 'Toggle Left Sidebar', shortcut: 'Ctrl+Shift+L' });
    if (config.rightSidebar) viewItems.push({ id: 'view.toggle_right', label: 'Toggle Right Sidebar', shortcut: 'Ctrl+Shift+R' });
    if (config.leftSidebar) viewItems.push({ id: 'view.float_left', label: 'Float Left Sidebar' });
    if (config.rightSidebar) viewItems.push({ id: 'view.float_right', label: 'Float Right Sidebar' });
    if (config.statusBar || config.statusbar) viewItems.push({ id: 'view.toggle_statusbar', label: 'Toggle Status Bar' });
    viewItems.push({ id: 'view.sidebar_gallery', label: 'Sidebar Gallery…' });
    viewItems.push({ id: 'view.api_inspector', label: 'API Inspector', shortcut: 'Ctrl+Shift+I' });
    viewItems.push({ id: 'view.appui_diagnostics', label: 'AppUI Diagnostics' });
    const panes = collectPaneIds(config);
    ['left', 'right', 'content'].forEach(region => {
      const regionPanes = panes.filter(pane => pane.region === region);
      if (!regionPanes.length) return;
      const labels = {left: 'Left Sidebar', right: 'Right Sidebar', content: 'Content'};
      viewItems.push({ separator: true });
      viewItems.push({id: '_sub_' + region, label: labels[region], submenu: regionPanes.map(pane => ({
        id: `view.pane.${region}.${pane.id}`, label: pane.label || pane.id,
        checked: () => isPaneVisible(region, pane.id),
      }))});
    });
    return viewItems;
  }

  function collectPaneIds(config) {
    const panes = [];
    // Content body tabs/accordion
    const body = config.content?.body || config.content;
    if (body?.type === 'tabs' && body.tabs) {
      body.tabs.forEach(t => panes.push({ id: t.id, label: t.label || t.id, region: 'content' }));
    }
    if (body?.type === 'accordion' && body.sections) {
      body.sections.forEach(s => panes.push({ id: s.id, label: s.label || s.id, region: 'content' }));
    }
    // Left sidebar tabs
    if (config.leftSidebar?.tabs) {
      config.leftSidebar.tabs.forEach(t => panes.push({ id: t.id, label: t.label || t.id, region: 'left' }));
    }
    // Right sidebar tabs
    if (config.rightSidebar?.tabs) {
      config.rightSidebar.tabs.forEach(t => panes.push({ id: t.id, label: t.label || t.id, region: 'right' }));
    }
    return panes;
  }

  // Pane visibility state — set by the shell after content/sidebars render
  let _paneControllers = {};
  function registerPaneController(region, controller) { _paneControllers[region] = controller; }
  function isPaneVisible(region, id) {
    const c = _paneControllers[region];
    return c?.isPaneVisible ? c.isPaneVisible(id) : true;
  }
  function togglePane(region, id) {
    const c = _paneControllers[region];
    if (c?.togglePane) c.togglePane(id);
  }

  /**
   * Create built-in view command handlers.
   * @param {object} opts - {toggleLeftSidebar, toggleRightSidebar}
   * @returns {Array} command definitions
   */
  function buildViewCommands(opts) {
    const cmds = [
      { id: 'view.toggle_left', run: () => opts.toggleLeftSidebar() },
      { id: 'view.toggle_right', run: () => opts.toggleRightSidebar() },
      { id: 'view.float_left', run: () => { const f = window.AppUISidebarDockFeature; f?.toggleLeft?.(); } },
      { id: 'view.float_right', run: () => { const f = window.AppUISidebarDockFeature; f?.toggleRight?.(); } },
      { id: 'view.toggle_statusbar', run: () => { const sb = document.getElementById('app-statusbar'); if (sb) sb.hidden = !sb.hidden; } },
      { id: 'view.sidebar_gallery', run: () => openSidebarGallery(opts) },
      { id: 'view.api_inspector', run: () => {
        const toggle = () => window.AppUIApiInspector?.toggle();
        if (window.AppUIApiInspector) toggle();
        else window.AppUIAssets?.load?.('apiInspector').then(toggle);
      } },
      { id: 'view.appui_diagnostics', run: () => window.AppUI?.diagnostics?.open?.() },
    ];
    // Add pane toggle commands
    const panes = collectPaneIds(opts.config || {});
    panes.forEach(p => {
      cmds.push({ id: `view.pane.${p.region}.${p.id}`, run: () => togglePane(p.region, p.id) });
    });
    return cmds;
  }

  /**
   * Check if shortcuts are enabled for the given app.
   * @param {string} appId
   * @param {object} config
   * @returns {boolean}
   */
  function areShortcutsEnabled(appId, config) {
    const stored = AppUIStorage.get(`pylon/appui/shortcuts-enabled/${appId || 'global'}`);
    return stored === null ? config.shortcuts !== false : stored === 'true';
  }

  function setShortcutsEnabled(appId, enabled) {
    AppUIStorage.set(`pylon/appui/shortcuts-enabled/${appId || 'global'}`, !!enabled);
  }

  /**
   * Load custom shortcuts from localStorage.
   * @param {string} appId
   * @returns {object} mapping of commandId -> shortcut
   */
  function loadCustomShortcuts(appId) {
    return AppUIStorage.getJSON(`pylon/appui/keybindings/${appId || 'global'}`, {}) || {};
  }

  /**
   * Save a custom shortcut.
   * @param {string} appId
   * @param {string} commandId
   * @param {string} shortcut
   */
  function saveCustomShortcut(appId, commandId, shortcut) {
    const key = `pylon/appui/keybindings/${appId || 'global'}`;
    const stored = Object.assign(Object.create(null),AppUIStorage.getJSON(key,{})||{});
    if (shortcut) stored[commandId] = shortcut;
    else delete stored[commandId];
    AppUIStorage.setJSON(key, stored);
  }

  /**
   * Reset all custom shortcuts for an app.
   * @param {string} appId
   */
  function resetCustomShortcuts(appId) {
    AppUIStorage.remove(`pylon/appui/keybindings/${appId || 'global'}`);
  }

  // --- Sidebar Gallery (View menu) ---------------------------------------
  // A manifest-driven gallery of every app that advertises a `sidebar` block
  // (GET /v1/sidebars). Pick one → it's embedded into this page's RIGHT sidebar
  // region. The gallery helpers live in AppUIPanelApp (panel-app.js, shipped in
  // the 'feedback' bundle); lazy-load it on demand so the shell stays lean.
  async function _ensurePanelApp() {
    if (window.AppUIPanelApp) return window.AppUIPanelApp;
    try { await window.AppUIAssets?.load?.('feedback'); } catch (_e) {}
    return window.AppUIPanelApp || null;
  }

  async function openSidebarGallery(opts) {
    const PA = await _ensurePanelApp();
    if (!PA || !PA.openGallery) { window.AppUIToast?.error?.('Sidebar gallery unavailable'); return; }
    const hostApp = (opts.config && opts.config.id) || null;
    return PA.openGallery({
      toggleRightSidebar: opts.toggleRightSidebar,
      hostApp,
      // ADD the picked sidebar as a CLOSABLE TAB in the right sidebar (parity
      // with the workspace shim): go through the registered pane controller's
      // addTab so it gets the shared closable + right-click-close behavior,
      // rather than a one-off sub-panel. Falls back to the panel-app default
      // embed if no right pane controller is registered.
      addSidebar: function (spec, cfg) {
        let ctrl = _paneControllers.right;
        const rEl0 = document.getElementById('app-right');
        // a page without a configured right sidebar (no pane controller yet):
        // create the tab host there ON DEMAND, so ANY page can add a sidebar
        if ((!ctrl || !ctrl.addTab) && rEl0 && window.AppUISidebarTabs && window.AppUISidebarTabs.create) {
          rEl0.classList.remove('ai-app-hidden');
          if (rEl0.getBoundingClientRect().width < 120) rEl0.style.width = ((spec && spec.width) || 380) + 'px';
          // the page's own (declared) sidebar already in the region becomes the
          // FIRST tab — its nodes are MOVED (a live chat keeps its state) — so
          // the gallery pick sits beside it instead of under it
          const kept = Array.from(rEl0.childNodes).filter(n => n.nodeType === 1 || (n.textContent || '').trim());
          const first = [];
          if (kept.length) {
            const name = rEl0.getAttribute('data-declared-sidebar')
              || (rEl0.querySelector('[data-declared-sidebar]') || {getAttribute: () => ''}).getAttribute('data-declared-sidebar')
              || 'Sidebar';
            kept.forEach(n => n.remove());
            first.push({id: 'page-sidebar', label: name, closable: false, render: function (host) {
              host.style.cssText += ';display:flex;flex-direction:column;min-height:0;height:100%';
              kept.forEach(n => host.appendChild(n));
            }});
          }
          ctrl = window.AppUISidebarTabs.create({container: rEl0, storageKey: 'appui-sidebar-right-added', tabs: first,
                                                 initialActiveId: first.length ? 'page-sidebar' : ''});
          registerPaneController('right', ctrl);
        }
        if (!ctrl || !ctrl.addTab) return false;
        const id = 'gal-' + (spec.app_id ? spec.app_id.replace(/\//g, '-') + '-' : '') + spec.type;
        ctrl.addTab({
          id: id,
          label: (spec.icon ? spec.icon + ' ' : '') + (spec.label || spec.type),
          closable: true,
          render: function (host) {
            if (typeof spec.embed === 'function') { try { spec.embed(host); } catch (_e) {} return; }
            // a chat: its profile / the page agent + the page's own hooks
            Promise.resolve(PA.mountChat ? PA.mountChat(spec, host, Object.assign({hostApp}, cfg || {})) : false)
              .then(done => { if (!done) PA.embedSidebar(spec, host, { hostApp }); })
              .catch((e) => {
                try { (window.AppUILogger?.console('appui/sidebar-gallery') || console).warn('chat mount failed', spec && (spec.profile || spec.type), e); } catch (_e) {}
                PA.embedSidebar(spec, host, { hostApp });
              });
          },
        });
        try { if (ctrl.switchTo) ctrl.switchTo(id); } catch (_e) {}
        try { if (typeof opts.toggleRightSidebar === 'function') {
          const rEl = document.getElementById('app-right');
          if (rEl && rEl.classList.contains('ai-app-hidden')) opts.toggleRightSidebar();
        } } catch (_e) {}
        return true;
      },
    });
  }

  window.AppUIShellCommands = {
    normalizeShortcut,
    buildViewMenuItems,
    buildViewCommands,
    areShortcutsEnabled,
    setShortcutsEnabled,
    loadCustomShortcuts,
    saveCustomShortcut,
    resetCustomShortcuts,
    registerPaneController,
    togglePane,
    isPaneVisible,
  };
})();
