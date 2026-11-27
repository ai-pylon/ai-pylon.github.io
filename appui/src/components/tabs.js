/**
 * AppUITabs  --  generic tab bar component
 * 
 * Usage:
 *   const tabs = AppUITabs.create({
 *     container: document.getElementById('tabBar'),
 *     onSwitch: (tab) => { console.log('switched to', tab.id); },
 *     onClose: (tab) => { console.log('closed', tab.id); },
 *     onContextMenu: (ev, tab, actions) => { ... }
 *   });
 *   tabs.add({id: 'tab1', title: 'File.txt', icon: '📄', pinned: false, data: {}});
 *   tabs.switch('tab1');
 *   tabs.close('tab1');
 *
 * Tab object: {id, title, icon, pinned, data}
 *   - id: unique string or numeric identifier (including zero)
 *   - title: display text
 *   - icon: emoji or HTML string for tab icon
 *   - pinned: boolean, pinned tabs cannot be closed
 *   - data: any page-specific state attached to the tab
 *
 * Options:
 *   - container: DOM element to render the tab bar in
 *   - onSwitch(tab): called when a tab is activated
 *   - onClose(tab): called when a tab is closed
 *   - onContextMenu(ev, tab, defaultActions): custom context menu handler
 *   - newTabButton: boolean (default true)  --  show a "+" button
 *   - onNewTab(): called when "+" is clicked
 *   - draggable: boolean (default true)  --  allow tab reorder via drag
 *   - contextMenu: boolean (default true)  --  enable right-click context menu
 *   - escapeHtml: function (optional)  --  HTML escaper, defaults to built-in
 * Generated bars provide tab roles, selected state, arrow/Home/End navigation,
 * Enter/Space activation and Delete to close unpinned tabs.
 */
const AppUITabs = (function() {
  'use strict';

  let _idCounter = 0;

  function _defaultEscape(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  // Bind existing markup through the common keyboard/lifecycle adapter.
  const bind = options => window.AppUITabNavigation.bind(options);

  function create(opts) {
    opts = opts || {};
    const container = opts.container;
    if (!container) throw new Error('AppUITabs: container is required');

    const escapeHtml = opts.escapeHtml || _defaultEscape;
    const showNewTab = opts.newTabButton !== false;
    const draggable = opts.draggable !== false;
    const enableContextMenu = opts.contextMenu !== false;

    let tabs = [];
    let activeId = null;
    let destroyed = false, renderEpoch = 0;
    let rowNodes = [];
    let controls = AppUILifecycle.createScope();
    let contextMenuController=null;
    container.setAttribute('role', 'tablist');
    function listen(target, type, handler) {
      const epoch = renderEpoch;
      const guarded = event => {if (!destroyed && epoch === renderEpoch) handler(event);};
      controls.listen(target, type, guarded);
    }
    const drag = window._AppUITabsBinding.dragReorder({listen, reorder: _reorder});
    function clearControls() {
      contextMenuController?.cancel();
      renderEpoch++;
      drag.reset();
      controls?.destroy();
      controls = destroyed ? null : AppUILifecycle.createScope();
      rowNodes = [];
    }
    const onKeyDown = event => {
      if (destroyed || event.defaultPrevented || event.isComposing || event.target.closest?.('.tab-close')) return;
      const element = event.target.closest?.('.tab-item');
      const index = rowNodes.findIndex(row => row.element === element);
      if (index < 0) return;
      const current = rowNodes[index].tab;
      if (event.key === 'Delete') {event.preventDefault(); close(current.id); return;}
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', ' '].includes(event.key)) return;
      event.preventDefault();
      const next = window._AppUITabsBinding.nextIndex(event.key,index,rowNodes.length);
      const id = rowNodes[next].tab.id;
      switchTo(id);
      rowNodes.find(row => row.tab.id === id)?.element.focus();
    };
    container.addEventListener('keydown', onKeyDown);

    // Ensure container has the "+" button
    let newBtn = container.querySelector('.tab-new');
    let createdNewButton = false;
    const onNewTab = () => {if (!destroyed) opts.onNewTab?.();};
    if (!newBtn && showNewTab) {
      createdNewButton = true;
      newBtn = window._AppUITabView.newButton();
      container.appendChild(newBtn);
      newBtn.addEventListener('click', onNewTab);
    }

    function _generateId() {
      return 'uitab_' + (++_idCounter);
    }

    function add(tabDef) {
      if (destroyed) return null;
      const tab = {
        id: tabDef.id===0?0:(tabDef.id || _generateId()),
        title: tabDef.title || 'New Tab',
        icon: tabDef.icon || '',
        pinned: !!tabDef.pinned,
        data: tabDef.data || {}
      };
      tabs.push(tab);
      renderBar();
      return tab;
    }

    function close(id) {
      if (destroyed) return;
      const idx = tabs.findIndex(t => t.id === id);
      if (idx < 0) return;
      if (tabs[idx].pinned) return;
      const closedTab = tabs[idx];
      tabs.splice(idx, 1);
      if (opts.onClose) opts.onClose(closedTab);
      if (destroyed) return;
      if (tabs.length === 0) {
        // Let the consumer handle empty state
        activeId = null;
        renderBar();
        return;
      }
      if (activeId === id) {
        const newIdx = Math.min(idx, tabs.length - 1);
        switchTo(tabs[newIdx].id);
      } else {
        renderBar();
      }
    }

    function switchTo(id) {
      if (destroyed) return;
      const tab = tabs.find(t => t.id === id);
      if (!tab) return;
      const restoreFocus = container.contains?.(document.activeElement);
      activeId = id;
      renderBar();
      if (restoreFocus) rowNodes.find(row => row.tab.id === id)?.element.focus();
      if (opts.onSwitch) opts.onSwitch(tab);
    }

    function active() {
      return tabs.find(t => t.id === activeId) || null;
    }

    function getAll() {
      return [...tabs];
    }

    function get(id) {
      return tabs.find(t => t.id === id) || null;
    }

    function update(id, props) {
      if (destroyed) return;
      const tab = tabs.find(t => t.id === id);
      if (!tab) return;
      if (props.title !== undefined) tab.title = props.title;
      if (props.icon !== undefined) tab.icon = props.icon;
      if (props.pinned !== undefined) tab.pinned = props.pinned;
      if (props.data !== undefined) tab.data = props.data;
      renderBar();
    }

    function remove(id) {
      if (destroyed) return;
      // Force remove (bypasses pinned check)
      const idx = tabs.findIndex(t => t.id === id);
      if (idx < 0) return;
      tabs.splice(idx, 1);
      if (activeId === id) {
        if (tabs.length > 0) {
          const newIdx = Math.min(idx, tabs.length - 1);
          activeId = tabs[newIdx].id;
        } else {
          activeId = null;
        }
      }
      renderBar();
    }

    function renderBar() {
      if (destroyed) return;
      clearControls();
      // Remove old tab items
      container.querySelectorAll('.tab-item').forEach(el => el.remove());

      // Sort: pinned first, then unpinned in order
      const sorted = [...tabs.filter(t => t.pinned), ...tabs.filter(t => !t.pinned)];

      sorted.forEach((tab, index) => {
        const {element:el,closeButton}=window._AppUITabView.create({tab,activeId,index,escapeHtml});
        rowNodes.push({element:el,tab});
        window._AppUITabView.bindRow({element:el,closeButton,tab,listen,
          onClose:close,onSwitch:switchTo,
          onContextMenu:enableContextMenu?_showContextMenu:null,
          drag:draggable?drag:null,
        });

        if (newBtn) {
          container.insertBefore(el, newBtn);
        } else {
          container.appendChild(el);
        }
      });
    }

    function _reorder(fromId, toId) {
      const fromIdx = tabs.findIndex(t => t.id === fromId);
      const toIdx = tabs.findIndex(t => t.id === toId);
      if (fromIdx < 0 || toIdx < 0) return;
      const [moved] = tabs.splice(fromIdx, 1);
      tabs.splice(toIdx, 0, moved);
      renderBar();
    }

    function _showContextMenu(ev, tab) {
      const action=callback=>()=>{if(!destroyed&&tabs.includes(tab))return callback();};
      const defaultActions = {
        pin: action(() => { tab.pinned = !tab.pinned; renderBar(); }),
        close: action(() => close(tab.id)),
        closeOthers: action(() => { tabs.filter(t => t.id !== tab.id && !t.pinned).forEach(t => close(t.id)); }),
        closeAll: action(() => { const toClose = tabs.filter(t => !t.pinned).map(t => t.id); toClose.forEach(id => close(id)); }),
        duplicate: action(() => { const dup = add({title: tab.title, icon: tab.icon, data: JSON.parse(JSON.stringify(tab.data))}); switchTo(dup.id); })
      };

      if (opts.onContextMenu) {
        opts.onContextMenu(ev, tab, defaultActions);
        return;
      }

      contextMenuController ||= window._AppUITabsContextMenu.create({
        isCurrent:target=>!destroyed&&tabs.includes(target),
      });
      contextMenuController.show(ev,tab,defaultActions);
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      contextMenuController?.destroy();
      clearControls();
      container.removeEventListener('keydown', onKeyDown);
      container.querySelectorAll('.tab-item').forEach(el => el.remove());
      if (createdNewButton) {
        newBtn.removeEventListener('click', onNewTab);
        newBtn.remove();
      }
      tabs = [];
      activeId = null;
      drag.reset();
    }

    return {
      add,
      close,
      switch: switchTo,
      active,
      tabs: getAll,
      get,
      update,
      remove,
      renderBar,
      destroy,
    };
  }

  return { create, bind };
})();
window.AppUITabs = AppUITabs;
