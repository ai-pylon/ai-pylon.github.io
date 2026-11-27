/* Sidebar tool/workflow defaults and recommendation persistence. */
window._AISidebarSelectionState=(function(){
  function create({container,getSetting,setSetting,_pageToolDefaults,_pageGroupDefaults,_pageWorkflowDefaults,onRestore,onChanged}){
    const scope=AppUILifecycle.createViewScope({host:container});
    function migrate(){
      if(!scope.current())return;
      if (getSetting('ai_tool_storage_v2', false)) return;
      // Old code wrote ai_tool_<name> for every tool in the catalog and
      // ai_workflow_<name> for page defaults.  New code computes defaults
      // in-memory and only saves explicit user overrides.  Since old values
      // are all boolean (true/false), there is no way to distinguish a user
      // override from a bulk-written default — so we clear everything.
      // Users will need to re-select their preferred tools after this
      // one-time migration.
      if (window.AppUIConfigStore && AppUIConfigStore.getAll) {
        var all = AppUIConfigStore.getAll();
        var removed = 0;
        Object.keys(all).forEach(function(k) {
          if (k.indexOf('ai_tool_') === 0 || k.indexOf('ai_workflow_') === 0) {
            AppUIConfigStore.remove(k);
            removed++;
          }
        });
        if (removed) console.log('[AI sidebar] Migrated to v2: cleared ' + removed + ' bulk-written keys');
      }
      // Also clear the old tree version gate
      if (window.AppUIConfigStore) AppUIConfigStore.remove('ai_tool_tree_version');
      setSetting('ai_tool_storage_v2', true);
    }
    function restore(){
      if(!scope.current())return;
      var pageName = (window.location.pathname.match(/\/pages\/([^/]+)/) || [])[1] || '';
      if (!pageName) return;
      // Populate in-memory defaults — never persisted.  enabledTools() and
      // enabledGroups() check these sets as fallback when no user override
      // exists in AppUIConfigStore.
      _pageToolDefaults.clear();
      _pageGroupDefaults.clear();
      _pageWorkflowDefaults.clear();
      // Layer 1: Static defaults from page HTML (data-ai-tools attribute on body)
      // Format: data-ai-tools="groups:git,terminal;workflows:git-commit;tools:git.pull"
      var htmlDefaults = document.body.getAttribute('data-ai-tools');
      if (htmlDefaults) {
        htmlDefaults.split(';').forEach(function(segment) {
          var parts = segment.trim().split(':');
          if (parts.length < 2) return;
          var type = parts[0].trim();
          var names = parts[1].split(',').map(function(n) { return n.trim(); }).filter(Boolean);
          names.forEach(function(n) {
            if (type === 'groups') _pageGroupDefaults.add(n);
            else if (type === 'tools') _pageToolDefaults.add(n);
            else if (type === 'workflows') _pageWorkflowDefaults.add(n);
          });
        });
      }
      // Layer 2: Recommendation system (previously recommended for this page)
      var raw = getSetting('ai_page_defaults_' + pageName, null);
      if (raw) {
        try {
          var data = typeof raw === 'string' ? JSON.parse(raw) : raw;
          if (data) {
            (data.groups || []).forEach(function(g) { _pageGroupDefaults.add(g); });
            (data.tools || []).forEach(function(t) { _pageToolDefaults.add(t); });
            (data.workflows || []).forEach(function(w) { _pageWorkflowDefaults.add(w); });
          }
        } catch (e) {}
      }
      // Layer 3: User preferences in AppUIConfigStore — checked by _isToolEnabled / _isGroupEnabled
      onRestore();
    }
    function recommend(callArgs){
      if (!scope.current()||!callArgs) return Promise.resolve();
      var prompt = callArgs.prompt || '';
      var page = callArgs.page || (window.location.pathname.match(/\/pages\/([^/]+)/) || [])[1] || '';
      return fetch('/api/workflows/recommend', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({prompt: prompt, page: page, top_tools: 8, top_workflows: 5}),
      }).then(function(r) { return r.json(); }).then(function(result) {
        if (!scope.current()||!result||result._error)return;
        var changed = false;
        var newGroups = [], newTools = [], newWorkflows = [];
        (result.groups || result.tool_groups || []).forEach(function(g) {
          var n = g.name || g;
          if (!getSetting('ai_tool_group_' + n, false)) { setSetting('ai_tool_group_' + n, true); changed = true; }
          newGroups.push(n);
        });
        (result.tools || []).forEach(function(t) {
          var n = t.name || t;
          if (!getSetting('ai_tool_' + n, false)) { setSetting('ai_tool_' + n, true); changed = true; }
          newTools.push(n);
        });
        (result.workflows || []).forEach(function(w) {
          var n = w.name || w;
          if (!getSetting('ai_workflow_' + n, false)) { setSetting('ai_workflow_' + n, true); changed = true; }
          newWorkflows.push(n);
        });
        if (changed) {
          onChanged();
        }
        // Show toast explaining what was enabled
        if (changed && typeof AppUIToast !== 'undefined') {
          var summary = [];
          if (newGroups.length) summary.push(newGroups.join(', '));
          if (newTools.length > 3) summary.push(newTools.length + ' tools');
          else if (newTools.length) summary.push(newTools.join(', '));
          AppUIToast.info('AI enabled: ' + summary.join(', '));
        }
        // Persist to AppUIConfigStore for next page visit
        if (page && (newGroups.length || newTools.length || newWorkflows.length)) {
          var raw = getSetting('ai_page_defaults_' + page, null);
          var merged;
          try { merged = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : {}; } catch(e) { merged = {}; }
          if (!merged.groups) merged.groups = [];
          if (!merged.tools) merged.tools = [];
          if (!merged.workflows) merged.workflows = [];
          newGroups.forEach(function(n) { if (merged.groups.indexOf(n) === -1) merged.groups.push(n); });
          newTools.forEach(function(n) { if (merged.tools.indexOf(n) === -1) merged.tools.push(n); });
          newWorkflows.forEach(function(n) { if (merged.workflows.indexOf(n) === -1) merged.workflows.push(n); });
          setSetting('ai_page_defaults_' + page, JSON.stringify(merged));
        }
      }).catch(function(){});
    }
    return {migrate,restore,recommend,destroy:()=>scope.destroy()};
  }
  return {create};
})();
