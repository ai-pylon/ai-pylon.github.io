/* Instance-owned tool/group selection defaults and explicit overrides. */
window._AISidebarToolSelection=(function(){
  function create({config,recommendedTools,suggestedPrefixes,configuredGroups,getSetting,toolList,isCatalogLoaded}){
    const recommendedNames = new Set(recommendedTools.map(tool => tool.name));
    const isSuggestedTool = tool => recommendedNames.has(tool.name)
      || [...suggestedPrefixes].some(prefix => tool.name === prefix || tool.name.startsWith(`${prefix}.`));
    const configuredGroupNames = new Set(Array.isArray(config.suggestedToolGroups) ? config.suggestedToolGroups : []);
    const groupName = tool => tool.name.split('.')[0];
    // Suggested leaf tools are ready to call on first use.  A suggested
    // namespace stays a discovery group instead: selecting
    // `com.office.outlook` exposes its catalog without silently enabling every
    // Outlook operation beneath it.
    const defaultEnabled = tool => isSuggestedTool(tool);
    // In-memory defaults from page HTML + recommendations.  These are computed
    // once by _restorePageTools() and never persisted — only explicit user
    // overrides are saved to AppUIConfigStore.
    const _pageToolDefaults = new Set();
    const _pageGroupDefaults = new Set();
    const _pageWorkflowDefaults = new Set();
    const _isToolEnabled = tool => {
      const override = getSetting(`ai_tool_${tool.name}`, null);
      if (override !== null) return override === true;
      return _pageToolDefaults.has(tool.name) || defaultEnabled(tool);
    };
    const _isGroupEnabled = name => {
      const override = getSetting(`ai_tool_group_${name}`, null);
      if (override !== null) return override === true;
      return _pageGroupDefaults.has(name) || suggestedPrefixes.has(name) || configuredGroupNames.has(name);
    };
    const catalogRequired = () => Array.isArray(config.toolCatalogOptions) && config.toolCatalogOptions.length;
    const enabledTools = () => (catalogRequired() && !isCatalogLoaded()) ? [] : toolList().filter(_isToolEnabled);
    const groupPrefixes = () => [...new Set(toolList().flatMap(tool => {
      const parts = tool.name.split('.');
      return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('.'));
    }))];
    const groupDescription = name => {
      const configured = configuredGroups.find(group => group.name === name)?.description;
      if (configured) return configured;
      const tools = toolList().filter(tool => tool.name === name || tool.name.startsWith(`${name}.`));
      const samples = tools.map(tool => tool.description).filter(Boolean).slice(0, 2);
      return samples.length ? `${tools.length} tools: ${samples.join(' ')}` : `${tools.length} tools in the ${name} namespace.`;
    };
    const enabledGroups = () => (catalogRequired() && !isCatalogLoaded()) ? [] : groupPrefixes().filter(_isGroupEnabled).map(name => ({name, description: groupDescription(name)}));
    return {configuredGroupNames,isSuggestedTool,groupName,defaultEnabled,_pageToolDefaults,_pageGroupDefaults,_pageWorkflowDefaults,_isToolEnabled,_isGroupEnabled,catalogRequired,enabledTools,groupPrefixes,groupDescription,enabledGroups};
  }
  return {create};
})();
