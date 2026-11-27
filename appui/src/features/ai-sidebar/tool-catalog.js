/* Private tool-catalog state and chat synchronization; transport/view are separate. */
window._AISidebarToolCatalog = (() => {
  function create({config,recommendedTools,catalog,getChat,getPages,isCurrent,catalogRequired,enabledTools,enabledGroups,onRender}) {
    let catalogTools = config.toolCatalogOptions?.length ? [] : recommendedTools.slice();
    let catalogLoaded = false;
    let toolCatalogValue = config.toolCatalogValue || config.toolCatalogOptions?.[0]?.value || '';
    let toolCatalogUrl = config.toolCatalogUrl || '';
    async function load() {
      if (!isCurrent() || config.toolCatalog === false) return;
      const selectedCatalog = config.toolCatalogOptions?.find(option => option.value === toolCatalogValue);
      const catalogUrl = AppUIAISidebarConnections.normalizeCatalogUrl(toolCatalogValue === 'custom' ? toolCatalogUrl : selectedCatalog?.url);
      const catalogView = window._AISidebarLLMView.catalogStatus({container:getPages().llm,context:getPages().context});
      if (catalogRequired() && !catalogUrl) {
        catalogLoaded = false; catalogTools = [];
        getChat().setTools?.([]); getChat().setToolGroups?.([]);
        catalogView.disabled();
        onRender();
        catalog.cancelTools();
        return;
      }
      catalogView.pending();
      return catalog.loadTools(catalogUrl,{
        onReady:tools=>{
          if(!isCurrent())return;
          catalogTools=tools;
          catalogLoaded = true;
          catalogView.connected(catalogTools.length);
          getChat().setTools?.(enabledTools());
          getChat().setToolGroups?.(enabledGroups());
          catalogView.tools(enabledTools,enabledGroups);
          onRender();
        },
        onError:error=>{
          if(!isCurrent())return;
          catalogLoaded = false;
          catalogTools = [];
          getChat().setTools?.([]); getChat().setToolGroups?.([]);
          catalogView.unavailable(error);
          onRender();
        }
      });
    }
    return {load,tools:()=>catalogTools,loaded:()=>catalogLoaded,
      value:()=>toolCatalogValue,url:()=>toolCatalogUrl,
      select(value,url){toolCatalogValue=value;toolCatalogUrl=url;}};
  }
  return {create};
})();
