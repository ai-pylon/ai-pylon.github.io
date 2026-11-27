/* AppUI Workspace  --  multi-document editor layout with tab groups + splits.
 *
 * A workspace contains one or more "groups". Each group is a tabbed pane
 * that holds multiple open documents as tabs. Groups can be split vertically
 * or horizontally to view documents side-by-side.
 *
 * API:
 *   const ws = AppUIWorkspace.create({
 *     container: el,
 *     onTabSwitch: (groupId, tab) => {},
 *     onTabClose: (groupId, tab) => {},
 *     renderPane: (tab, container) => {},  // render tab content into container
 *   });
 *
 *   ws.openTab({id, title, icon, data}, groupId?);  // open in group (or active)
 *   ws.closeTab(tabId, groupId?);
 *   ws.splitGroup(groupId, direction);  // split a group into two
 *   ws.closeGroup(groupId);
 *   ws.setDirection(direction);  // change overall split direction
 *   ws.getActiveTab();
 *   ws.getGroups();
 */
const AppUIWorkspace = (() => {
  let _nextGroupId = 1;

  function create(opts = {}) {
    const container = typeof opts.container === 'string'
      ? document.querySelector(opts.container)
      : opts.container;
    if (!container) throw new Error('AppUIWorkspace: container required');

    const renderPane = opts.renderPane || (() => {});
    const onTabSwitch = opts.onTabSwitch || (() => {});
    const onTabClose = opts.onTabClose || (() => {});
    const onNewTab = opts.onNewTab || null;

    let destroyed=false,layoutScope=AppUILifecycle.createScope();
    let direction = opts.direction || 'horizontal';
    let groups = [];  // [{id, tabs: AppUITabs, activeTab, element, contentEl}]
    let activeGroupId = null;

    const root = window._AppUIWorkspaceView.root();
    container.replaceChildren(root);

    // --- Create a group ---
    function createGroup(initialTabs) {
      if(destroyed)return;
      const groupId = 'grp_' + (_nextGroupId++);
      const {element:groupEl,tabBar:tabBarEl,content:contentEl} = window._AppUIWorkspaceView.group(groupId);

      const tabs = AppUITabs.create({
        container: tabBarEl,
        draggable: true,
        newTabButton: !!onNewTab,
        onNewTab: onNewTab ? () => {if(!destroyed&&_findGroup(groupId))onNewTab(groupId);} : null,
        onSwitch: (tab) => {
          if(destroyed)return;
          const group = _findGroup(groupId);
          if(!group)return;
          activeGroupId = groupId;
          if (group) {
            group.activeTab = tab.id;
            _renderContent(group);
          }
          onTabSwitch(groupId, tab);
        },
        onClose: (tab) => {
          if(destroyed||!_findGroup(groupId))return;
          onTabClose(groupId, tab);
          const group = _findGroup(groupId);
          if (group && tabs.tabs().length === 0) {
            closeGroup(groupId);
          }
        },
      });

      const group = { id: groupId, tabs, activeTab: null, element: groupEl, contentEl };
      groups.push(group);

      // Add initial tabs
      if (initialTabs && initialTabs.length) {
        for (const t of initialTabs) {
          tabs.add(t);
        }
        tabs.switch(initialTabs[0].id);
      }

      if (!activeGroupId) activeGroupId = groupId;
      _rebuildLayout();
      return groupId;
    }

    // --- Render content for active tab ---
    function _renderContent(group) {
      if(destroyed||!groups.includes(group))return;
      group.contentScope?.destroy();
      if(destroyed||!groups.includes(group))return;
      const scope=AppUILifecycle.createScope();group.contentScope=scope;
      group.contentEl.replaceChildren();
      const tab = group.tabs.get(group.activeTab);
      if (tab) scope.add(renderPane(tab, group.contentEl, group.id));
    }

    // --- Open tab in a group ---
    function openTab(tabSpec, groupId) {
      if(destroyed)return;
      groupId = groupId || activeGroupId;
      let group = _findGroup(groupId);
      if (!group) {
        // Create first group if none exist
        groupId = createGroup([tabSpec]);
        return groupId;
      }
      // Check if tab already open
      const existing = group.tabs.get(tabSpec.id);
      if (existing) {
        group.tabs.switch(tabSpec.id);
        return groupId;
      }
      group.tabs.add(tabSpec);
      group.tabs.switch(tabSpec.id);
      return groupId;
    }

    // --- Close tab ---
    function closeTab(tabId, groupId) {
      if(destroyed)return;
      groupId = groupId || activeGroupId;
      const group = _findGroup(groupId);
      if (group) group.tabs.close(tabId);
    }

    // --- Split group ---
    function splitGroup(groupId, dir) {
      if(destroyed)return;
      direction = dir || direction;
      // Create a new empty group
      const newGroupId = createGroup([]);
      return newGroupId;
    }

    // --- Close group ---
    function closeGroup(groupId) {
      if(destroyed)return;
      const idx = groups.findIndex(g => g.id === groupId);
      if (idx === -1) return;
      if (groups.length <= 1) return; // Keep at least one group
      const [group]=groups.splice(idx, 1);
      group.contentScope?.destroy();
      group.tabs.destroy?.();
      group.element.remove();
      if (activeGroupId === groupId) {
        activeGroupId = groups[0]?.id || null;
      }
      _rebuildLayout();
    }

    // --- Set split direction ---
    function setDirection(dir) {
      if(destroyed)return;
      direction = dir === 'vertical' ? 'vertical' : 'horizontal';
      _rebuildLayout();
    }

    // --- Layout ---
    function _rebuildLayout() {
      if(destroyed)return;
      layoutScope.destroy();layoutScope=AppUILifecycle.createScope();
      root.replaceChildren();
      root.className = `appui-workspace ${direction}`;
      for (let i = 0; i < groups.length; i++) {
        root.appendChild(groups[i].element);
        if (i < groups.length - 1) {
          const handle = window._AppUIWorkspaceView.handle();
          _setupResize(handle, i);
          root.appendChild(handle);
        }
      }
    }

    // --- Resize between groups ---
    function _setupResize(handle,leftIdx){
      let dragState;
      const binding=AppUISplit.bind(handle,{cursor:direction==='horizontal'?'col-resize':'row-resize',shouldStart:()=>!destroyed&&!!groups[leftIdx]&&!!groups[leftIdx+1],onStart:event=>{
        const left=groups[leftIdx].element,right=groups[leftIdx+1].element,axis=direction==='horizontal'?'width':'height';
        dragState={left,right,start:event[direction==='horizontal'?'clientX':'clientY'],client:direction==='horizontal'?'clientX':'clientY',leftSize:left.getBoundingClientRect()[axis],rightSize:right.getBoundingClientRect()[axis]};
      },onMove:event=>{
        if(!dragState)return;const delta=event[dragState.client]-dragState.start;
        dragState.left.style.flex=`0 0 ${Math.max(100,dragState.leftSize+delta)}px`;dragState.right.style.flex=`0 0 ${Math.max(100,dragState.rightSize-delta)}px`;
      },onEnd:()=>{dragState=null;}});layoutScope.add(()=>binding.destroy());
    }

    // --- Helpers ---
    function _findGroup(id) { return groups.find(g => g.id === id); }

    function getActiveTab() {
      const group = _findGroup(activeGroupId);
      return group ? group.tabs.get(group.activeTab) : null;
    }

    function getGroups() {
      return groups.map(g => ({
        id: g.id,
        tabs: g.tabs.tabs(),
        activeTab: g.activeTab,
      }));
    }

    // Initialize with one empty group
    if (opts.initialTabs) {
      createGroup(opts.initialTabs);
    } else {
      createGroup([]);
    }

    return {
      element: root,
      openTab,
      closeTab,
      createGroup,
      splitGroup,
      closeGroup,
      setDirection,
      getActiveTab,
      getGroups,
      get activeGroupId() { return activeGroupId; },
      get direction() { return direction; },
      destroy() {
        if(destroyed)return;destroyed=true;
        const teardown=AppUILifecycle.createScope();
        teardown.add(()=>root.remove());
        groups.splice(0).reverse().forEach(group=>{
          teardown.add(()=>group.tabs.destroy?.());
          teardown.add(()=>group.contentScope?.destroy());
        });
        teardown.add(layoutScope);
        teardown.destroy();
      },
    };
  }

  return { create };
})();
window.AppUIWorkspace = AppUIWorkspace;
