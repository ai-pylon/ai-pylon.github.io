/* Unified sidebar tab host for AppUI sidebars.
 *
 * Used by both the shell sidebar renderer and standalone pages.
 * Supports: lazy panel rendering, activate/deactivate lifecycle, keyboard
 * navigation, drag-to-reorder, localStorage persistence, ARIA roles,
 * and custom render interception (for ai-sidebar type).
 */
const AppUISidebarTabs = (() => {
  // A render that APPENDS to the panel (instead of replacing its content) left the "Loading..." placeholder
  // above its content forever. Drop it once the panel has real content - now, or when it first arrives.
  function _dropPlaceholder(panel) {
    const ph = panel.querySelector(':scope > .ai-app-tab-loading');
    if (!ph) return;
    if (panel.children.length > 1) { ph.remove(); return; }
    if (typeof MutationObserver !== 'function') return;
    const mo = new MutationObserver(function() {
      if (!ph.isConnected) { mo.disconnect(); return; }
      if (panel.children.length > 1) { ph.remove(); mo.disconnect(); }
    });
    mo.observe(panel, { childList: true });
  }
  function create({container, storageKey = '', tabs = [], onTabChange, onRender, onTabClose, initialActiveId} = {}) {
    if (!container) throw new Error('AppUISidebarTabs: container required');

    const definitions = [...tabs];
    const panels = Object.create(null);
    const cleanups = Object.create(null);
    const scope = AppUILifecycle.createScope();
    let destroyed = false;
    const buttonScopes=AppUILifecycle.createKeyedScopes({pagehide:false});
    scope.add(buttonScopes);
    let activeTab = null, tabBinding = null;
    const activation=AppUILifecycle.generation();
    scope.add(()=>tabBinding?.destroy());
    let activeId = initialActiveId === 0 ? 0 : (initialActiveId || _load() || '');

    function _load() {
      return storageKey ? AppUIStorage.get(storageKey + ':active', '') : '';
    }
    function _save() {
      if (storageKey) AppUIStorage.set(storageKey + ':active', activeId);
    }

    // Build DOM
    const {tabBar, panelHost} = window._AppUISidebarTabView.frame();
    const overflow = _AppUISidebarTabOverflow.create(tabBar);
    scope.add(overflow);
    const tabRow = overflow.element, _scheduleNav = overflow.schedule;
    container.append(tabRow, panelHost);
    if (definitions.length <= 1) tabRow.hidden = true;

    function activate(tab) {
      if (destroyed || !definitions.includes(tab)) return;
      const version=activation.next();
      tabBinding?.switch(String(tab.id),false);
      if (activeTab && activeTab.id !== tab.id) activeTab.deactivate?.(panels[activeTab.id]);
      if(destroyed||!activation.isCurrent(version)||!definitions.includes(tab))return;
      tabBar.querySelectorAll('.ai-app-sidebar-tab').forEach(function(button) {
        button.classList.toggle('active', String(button.dataset.tabId) === String(tab.id));
        button.setAttribute('aria-selected', String(String(button.dataset.tabId) === String(tab.id)));
        button.tabIndex = String(button.dataset.tabId) === String(tab.id) ? 0 : -1;
        if (String(button.dataset.tabId) === String(tab.id)) {
          // Keep the active tab visible when the strip overflows + is scrolled.
          try { button.scrollIntoView({ inline: 'nearest', block: 'nearest' }); } catch (e) {}
        }
      });
      Object.values(panels).forEach(function(p) { p.style.display = 'none'; });
      if (!panels[tab.id]) {
        var tabPanel = window._AppUISidebarTabView.panel(tab);
        panelHost.appendChild(tabPanel);
        const owner=AppUILifecycle.createScope();
        cleanups[tab.id]=()=>owner.destroy();
        panels[tab.id] = tabPanel;
        owner.add(onRender ? onRender(tab, tabPanel) : tab.render?.(tabPanel));
        _dropPlaceholder(tabPanel);
      }
      if(destroyed||!activation.isCurrent(version)||!definitions.includes(tab)||!panels[tab.id])return;
      panels[tab.id].style.display = '';
      activeTab = tab;
      activeId = tab.id;
      tab.activate?.(panels[tab.id]);
      if(destroyed||!activation.isCurrent(version)||!definitions.includes(tab))return;
      _save();
      if (onTabChange) onTabChange(tab.id, panels[tab.id]);
      if(destroyed||!activation.isCurrent(version)||!definitions.includes(tab))return;
      container.dispatchEvent(new CustomEvent('appui:sidebar-tab-change', {
        detail: {id: tab.id, panel: panels[tab.id]},
      }));
    }

    // Render tab buttons
    function appendButton(tab) {
      const owner=buttonScopes.begin(tab);
      var button = window._AppUISidebarTabView.button(tab, definitions.indexOf(tab));
      // CLOSE via RIGHT-CLICK context menu (no × button) for a closable tab —
      // the shared tab engine's close affordance (lifted from the workspace
      // shim per TODO.sidebar-chat #99 so every app page gets it). Built-in
      // (non-closable) tabs let the native menu through.
      owner.listen(button, 'contextmenu', function (event) {
        var items = [];
        if (tab.closable) {
          items.push({ label: 'Close', action: function () { publicApi.removeTab(tab.id); } });
          var others = definitions.filter(function (t) { return t.closable && t.id !== tab.id; });
          if (others.length) {
            items.push({ label: 'Close others', action: function () {
              others.slice().forEach(function (t) { publicApi.removeTab(t.id); }); } });
          }
        }
        if (!items.length) return;
        event.preventDefault(); event.stopPropagation();
        if (window.AppUIContextMenu && window.AppUIContextMenu.show) {
          window.AppUIContextMenu.show(event, items);
        } else if (window.AppUIAssets && window.AppUIAssets.load) {
          window.AppUIAssets.load('contextMenu').then(function () {
            window.AppUIContextMenu && window.AppUIContextMenu.show(event, items);
          }).catch(function () {});
        }
      });
      window._AppUITabsBinding.bindDrag({element:button,listen:owner.listen.bind(owner),
        isCurrent:()=>!destroyed&&!owner.destroyed&&definitions.includes(tab),draggingClass:'ai-tab-dragging',
        onStart:event=>event.dataTransfer.setData('text/plain',String(definitions.indexOf(tab))),
        onDrop:event=>{
          var fromIndex=Number.parseInt(event.dataTransfer.getData('text/plain'),10);
          var index=definitions.indexOf(tab);
          if(index<0||fromIndex===index||!definitions[fromIndex])return;
          var buttons=Array.from(tabBar.children);
          tabBar.insertBefore(buttons[fromIndex],fromIndex<index?buttons[index].nextSibling:buttons[index]);
          var moved=definitions.splice(fromIndex,1)[0];definitions.splice(index,0,moved);
          bindButtons();
        },
      });
      tabBar.appendChild(button);
    }
    function findButton(id) { return Array.from(tabBar.children).find(function(button) { return String(button.dataset.tabId) === String(id); }); }
    function bindButtons() {
      if(destroyed)return;
      tabBinding?.destroy();
      tabBinding=window.AppUITabNavigation.bind({container:tabBar,selector:'[data-tab-id]',
        getId:button=>String(button.dataset.tabId),
        onSwitch:({id})=>{const tab=definitions.find(def=>String(def.id)===id);if(tab)activate(tab);},
      });
      if(activeTab)tabBinding.switch(String(activeTab.id),false);
    }
    definitions.forEach(appendButton);
    bindButtons();

    // Activate initial tab
    var initial = (activeId !== '' && activeId != null && definitions.find(function(t) { return String(t.id) === String(activeId); }))
      || definitions.find(function(t) { return t.active; })
      || definitions[0];
    if (initial) activate(initial);

    var publicApi = {
      switchTo: function(id) {
        var tab = definitions.find(function(t) { return t.id === id; });
        if (tab) activate(tab);
      },
      addTab: function(def) {
        if (destroyed) return;
        if (definitions.some(function(t) { return t.id === def.id; })) return;
        definitions.push(def);
        tabRow.hidden = definitions.length <= 1;
        appendButton(def);
        bindButtons();
        _scheduleNav();
        if (!activeTab) activate(def);
      },
      removeTab: function(id) {
        if (destroyed) return;
        var idx = definitions.findIndex(function(t) { return t.id === id; });
        if (idx === -1) return;
        if (activeId === id) {
          const previous=activeTab;activeTab=null;activeId='';
          previous?.deactivate?.(panels[id]);
          if(destroyed)return;
          idx=definitions.findIndex(t=>t.id===id);if(idx<0)return;
        }
        const removed=definitions[idx],button=findButton(id),cleanup=cleanups[id],panel=panels[id];
        definitions.splice(idx,1);delete cleanups[id];delete panels[id];
        buttonScopes.destroy(removed);
        button?.remove();panel?.remove();cleanup?.();
        try { if (onTabClose) onTabClose(id); } catch (e) {}
        if(destroyed)return;
        tabRow.hidden = definitions.length <= 1;
        bindButtons();
        _scheduleNav();
        if (!activeTab && definitions.length) activate(definitions[0]);
      },
      getActiveId: function() { return activeId; },
      getTabs: function() { return definitions.map(function(t) { return {id: t.id, label: t.label}; }); },
      getPanel: function(id) { return panels[id] || null; },
      showPane: function(id) {
        if (destroyed) return;
        var btn = findButton(id);
        if (btn) btn.hidden = false;
        tabRow.hidden = Array.from(tabBar.children).filter(function(b) { return !b.hidden; }).length <= 1;
        _scheduleNav();
      },
      hidePane: function(id) {
        if (destroyed) return;
        var btn = findButton(id);
        if (btn) btn.hidden = true;
        if (panels[id]) panels[id].style.display = 'none';
        tabRow.hidden = Array.from(tabBar.children).filter(function(b) { return !b.hidden; }).length <= 1;
        _scheduleNav();
        if (activeId === id) {
          var visible = definitions.find(function(d) { var b = findButton(d.id); return b && !b.hidden; });
          if (visible) activate(visible);
        }
      },
      togglePane: function(id) {
        var btn = findButton(id);
        if (btn && btn.hidden) this.showPane(id);
        else this.hidePane(id);
      },
      isPaneVisible: function(id) {
        var btn = findButton(id);
        return btn ? !btn.hidden : false;
      },
      getPaneIds: function() { return definitions.map(function(d) { return d.id; }); },
      destroy: function() {
        if (destroyed) return;
        destroyed = true;
        const teardown=AppUILifecycle.createScope(),previous=activeTab,previousPanel=panels[activeId];
        teardown.add(()=>{
          for (const id in panels) delete panels[id];
          container.replaceChildren();definitions.length=0;activeTab=null;
        });
        Object.keys(cleanups).reverse().forEach(id=>{
          teardown.add(cleanups[id]);delete cleanups[id];
        });
        teardown.add(()=>{try {previous?.deactivate?.(previousPanel);} finally {activeId='';}});
        teardown.add(scope);
        teardown.destroy();
      },
    };
    return publicApi;
  }
  return {create: create};
})();
window.AppUISidebarTabs = AppUISidebarTabs;
