/* AI capability hierarchy; model defaults and persistence remain sidebar-owned. */
window._AISidebarToolHierarchy=(function(){
  function create({container,toolList,enabledTools,enabledGroups,_isToolEnabled,_isGroupEnabled,groupPrefixes,
    configuredGroups,getSetting,setSetting,removeSetting,getWorkflows,restorePageTools,apply,onRenderWorkflows,isCatalogLoaded,isCurrent}){
    const pages={tools:container};
    const lifetime=AppUILifecycle.createKeyedScopes({host:container,observeRemoval:false});
    function render(){
      lifetime.destroy('render');if(!lifetime.current())return;
      let owner;
      const root = {name: '', children: new Map(), tools: []};
      toolList().forEach(tool => {
        let node = root;
        tool.name.split('.').forEach(part => {
          if (!node.children.has(part)) node.children.set(part, {name: part, children: new Map(), tools: []});
          node = node.children.get(part);
        });
        node.tools.push(tool);
      });
      const leaves = node => [...node.tools, ...[...node.children.values()].flatMap(leaves)];
      const selected = new Set(enabledTools().map(tool => tool.name));
      const selectedGroupCount = enabledGroups().length;
      const description = (prefix, branchLeaves) => {
        const configured = configuredGroups.find(group => group.name === prefix)?.description;
        if (configured) return configured;
        const sample = branchLeaves.map(tool => tool.description).find(Boolean);
        return sample ? `${branchLeaves.length} tools: ${sample}` : `${branchLeaves.length} tools`;
      };
      // Task 1: Get page defaults to detect reject signals
      const pageName = (window.location.pathname.match(/\/pages\/([^/]+)/) || [])[1] || '';
      let pageDefaults = null;
      try {
        const raw = getSetting('ai_page_defaults_' + pageName, null);
        pageDefaults = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
      } catch (e) { pageDefaults = null; }
      const isPageDefault = (type, name) => {
        if (!pageDefaults) return false;
        const list = pageDefaults[type] || [];
        return list.indexOf(name) !== -1;
      };
      function updateSelection(type,name,checked) {
        if(!owner.current()||!isCurrent())return;
        setSetting((type==='groups'?'ai_tool_group_':'ai_tool_')+name,checked);
        if(!checked&&isPageDefault(type,name)) {
          fetch('/api/workflows/recommend/reject', {
            method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({names:[name],page:pageName}),
          }).catch(function(){});
        }
        apply();render();
      }
      pages.tools.replaceChildren();
      const intro = document.createElement('p');
      intro.textContent = isCatalogLoaded() ? `${selected.size} executable tools and ${selectedGroupCount} capability groups selected. Expand a namespace to select only the capabilities the AI needs.` : 'Loading the full tool registry…';
      pages.tools.appendChild(intro);
      owner=lifetime.begin('render',{host:intro});
      const controls = document.createElement('div'); controls.className = 'ui-ai-tool-controls';
      const actions = {};
      pages.tools.appendChild(controls);
      const createBranch=window._AISidebarToolHierarchyView.create({owner,leaves,selected,isGroupEnabled:_isGroupEnabled,description,
        onGroupChange:(name,checked)=>updateSelection('groups',name,checked),
        onToolChange:(name,checked)=>updateSelection('tools',name,checked),
      });
      [...root.children.entries()].sort(([a], [b]) => a.localeCompare(b)).forEach(([name, child]) => pages.tools.appendChild(createBranch(child, name, 0)));
      actions.suggested = () => {
        // Suggested: clear all user overrides, revert to computed defaults
        const _remove=removeSetting;
        toolList().forEach(function(tool) { _remove('ai_tool_' + tool.name); });
        groupPrefixes().forEach(function(name) { _remove('ai_tool_group_' + name); });
        apply(); render();
      };
      actions.selectAll = () => {
        // Select all: only save overrides for tools/groups that aren't already default-enabled
        toolList().forEach(function(tool) {
          if (!_isToolEnabled(tool)) setSetting('ai_tool_' + tool.name, true);
        });
        groupPrefixes().forEach(function(name) {
          if (!_isGroupEnabled(name)) setSetting('ai_tool_group_' + name, true);
        });
        apply(); render();
      };
      actions.deselectAll = () => {
        // Deselect all: only save overrides for tools/groups that are default-enabled
        toolList().forEach(function(tool) {
          if (_isToolEnabled(tool)) setSetting('ai_tool_' + tool.name, false);
        });
        groupPrefixes().forEach(function(name) {
          if (_isGroupEnabled(name)) setSetting('ai_tool_group_' + name, false);
        });
        apply(); render();
      };
      actions.reset = () => {
        // Reset: clear all user overrides and re-apply page defaults
        const _remove=removeSetting;
        toolList().forEach(function(tool) { _remove('ai_tool_' + tool.name); });
        groupPrefixes().forEach(function(name) { _remove('ai_tool_group_' + name); });
        getWorkflows().forEach(function(w) { _remove('ai_workflow_' + w.name); });
        // Re-apply page HTML defaults
        restorePageTools();
        apply(); render(); onRenderWorkflows();
      };
      const toolControls = window._AISidebarToolControls.create({
        container:controls,actions,isCurrent:()=>owner.current()&&isCurrent(),
        onFilter:value=>{
          const query=value.toLowerCase();
          pages.tools.querySelectorAll('.ui-ai-tool-group').forEach(node=>{node.hidden=!!query&&!node.textContent.toLowerCase().includes(query);if(query&&!node.hidden)node.open=true;});
        }
      });
      owner.add(()=>toolControls.destroy());
      onRenderWorkflows();

    }
    return {render,destroy(){lifetime.destroy();}};
  }
  return {create};
})();
