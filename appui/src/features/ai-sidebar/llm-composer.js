/* LLM service/provider/model discovery and status presentation for the AI sidebar. */
window._AISidebarLLMComposer=(function(){
  function create({container,config,chat,toolCatalogValue,toolCatalogUrl,onCatalogRequest,loadToolCatalog}){
    const pages={llm:container};
    const owner=AppUILifecycle.createViewScope({host:container});
      // LLM tab: backend + model + live status
      window._AISidebarLLMView.layout(pages.llm);
      let serviceSelect = null;
      let serviceEndpoint = null;
      let transportUrl = config.transportUrl || '';
      let customDiscovery = 'auto';
      if (Array.isArray(config.transportOptions) && config.transportOptions.length) {
        const {label, select, endpoint, connect, row} = window._AISidebarLLMView.connection({
          options: config.transportOptions, labelText: 'Service', selectLabel: 'AI backend',
          endpointLabel: 'LLM server URL', placeholder: '127.0.0.1:8130',
          value: config.transportValue || config.transportOptions[0].value, className: 'ui-ai-transport',
        });
        serviceSelect = select; serviceEndpoint = endpoint;
        const selectedServiceUrl = () => config.transportOptions.find(option => option.value === serviceSelect.value)?.url || transportUrl;
        serviceEndpoint.value = selectedServiceUrl();
        const connection = pages.llm.querySelector('.ui-ai-llm-connection');
        connection?.append(label, row);
        serviceSelect.onchange = () => {
          if (!owner.current()) return;
          serviceEndpoint.value = selectedServiceUrl();
          transportUrl = serviceEndpoint.value.trim();
          customDiscovery = config.transportOptions.find(option => option.value === serviceSelect.value)?.discovery || 'auto';
          if (config.onTransportChange) config.onTransportChange(serviceSelect.value, transportUrl);
          else {
            AppUIAISidebarConnections.saveService(serviceSelect.value, transportUrl);
          }
          fillProviders().catch(error => setCheckStatus(`Discovery failed: ${error.message || error}`, 'error'));
        };
        const connectService = () => {
          if (!owner.current()) return;
          if (!serviceEndpoint.value.trim()) return;
          serviceSelect.value = 'custom'; transportUrl = serviceEndpoint.value.trim(); customDiscovery = 'auto';
          if (config.onTransportChange) config.onTransportChange('custom', transportUrl);
          else {
            AppUIAISidebarConnections.saveService('custom', transportUrl);
          }
          fillProviders().catch(error => setCheckStatus(`Discovery failed: ${error.message || error}`, 'error'));
        };
        connect.onclick = connectService;
        serviceEndpoint.onkeydown = event => { if (event.key === 'Enter') connectService(); };
      }
      if (Array.isArray(config.toolCatalogOptions) && config.toolCatalogOptions.length) {
        const {label, select, endpoint, connect, row} = window._AISidebarLLMView.connection({
          options: config.toolCatalogOptions, labelText: 'Catalog service', selectLabel: 'Tools catalog',
          endpointLabel: 'Tools catalog URL', placeholder: '127.0.0.1:9091', value: toolCatalogValue,
        });
        const selectedUrl = () => config.toolCatalogOptions.find(option => option.value === select.value)?.url || toolCatalogUrl;
        endpoint.value = selectedUrl();
        const applyCatalog = forceCustom => {
          if (!owner.current()) return;
          if (forceCustom && endpoint.value.trim()) select.value = 'custom';
          toolCatalogValue = select.value;
          toolCatalogUrl = endpoint.value.trim();
          if (config.onToolCatalogChange) config.onToolCatalogChange(toolCatalogValue, toolCatalogUrl);
          else {
            AppUIAISidebarConnections.saveCatalog(toolCatalogValue, toolCatalogUrl);
          }
          onCatalogRequest(toolCatalogValue,toolCatalogUrl);
          loadToolCatalog();
        };
        select.onchange = () => { endpoint.value = selectedUrl(); applyCatalog(false); };
        connect.onclick = () => applyCatalog(true);
        endpoint.onkeydown = event => { if (event.key === 'Enter') applyCatalog(true); };
        const section = pages.llm.querySelector('.ui-ai-tool-catalog');
        section?.insertBefore(label, section.querySelector('[data-ai-tool-catalog-status]'));
        section?.insertBefore(row, section.querySelector('[data-ai-tool-catalog-status]'));
      }
      const backendSelect = pages.llm.querySelector('[data-ai-backend]');
      const modelSelect = pages.llm.querySelector('[data-ai-model]');
      const statusOutput = pages.llm.querySelector('[data-ai-llm-status]');
      const activeService = () => {
        const option = config.transportOptions?.find(item => item.value === serviceSelect?.value);
        if (option?.value === 'custom') return {url: AppUIAISidebarConnections.normalizeBaseUrl(transportUrl), discovery: customDiscovery};
        return option || {url: config.llmUrl || window.AI_LLM_URL || '/api/llm', discovery: 'pylon'};
      };
      const status=window._AISidebarLLMStatus.create({owner,activeService,
        getBackend:()=>backendSelect.value,statusOutput});
      const setCheckStatus=status.set,pollStatus=status.refresh,startPoll=status.start;
      const {fillModels,fillProviders}=window._AISidebarLLMDiscovery.create({
        owner,config,chat,activeService,backendSelect,modelSelect,status,
        onDiscovery:value=>{customDiscovery=value;},
      });
      fillProviders().catch(error => setCheckStatus(`Discovery failed: ${error.message || error}`, 'error'));
      loadToolCatalog();
      backendSelect.onchange = () => {
          if (!owner.current()) return;
        chat.setBackend?.(backendSelect.value);
        fillModels(backendSelect.value);
        pollStatus();
      };
      modelSelect.onchange = () => {
          if (!owner.current()) return;
        chat.setModel?.(modelSelect.value);
      };
      startPoll();

    owner.add(()=>{
      container.querySelectorAll('button,input,select').forEach(control=>{
        control.onclick=null;control.onchange=null;control.onkeydown=null;
      });
    });
    return {destroy:()=>owner.destroy()};
  }
  return {create};
})();
