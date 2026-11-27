/* Private provider/model discovery controller for the AI sidebar composer. */
window._AISidebarLLMDiscovery = (() => {
  function create({owner,config,chat,activeService,backendSelect,modelSelect,status,onDiscovery}) {
    let providerGeneration=0,modelGeneration=0;
    const setCheckStatus=status.set,pollStatus=status.refresh;
    const fillModels = async backend => {
        if (!owner.current()) return;
      const version=++modelGeneration;
      modelSelect.replaceChildren();
      try {
        const service = activeService();
        const response = await fetch(service.discovery === 'openai' ? `${service.url}/v1/models` : `${service.url}/models?backend=${encodeURIComponent(backend)}`, {signal:owner.signal});
        const data = await response.json();
        if(!owner.current()||version!==modelGeneration)return;
        const selectedModel=window._AISidebarLLMModels.fill({select:modelSelect,data,backend,
          requested:chat.getModel?.() || ''});
        chat.setModel?.(selectedModel);
      } catch (error) {
        if(!owner.current()||version!==modelGeneration)return;
        modelSelect.innerHTML = '<option value="" disabled selected>No available model</option>';
        chat.setModel?.('');
        setCheckStatus(`Model discovery failed: ${error.message || error}`, 'error');
      }
    };
    const fillProviders = async () => {
        if (!owner.current()) return;
      const version=++providerGeneration;modelGeneration++;status.invalidate();
      try {
      let service = activeService();
      if (!service.url) throw new Error('Enter an LLM server and port');
      chat.setLlmUrl?.(service.url);
      backendSelect.replaceChildren();
      let backends;
      if (service.discovery === 'auto') {
        try {
          const response = await fetch(service.url + '/backends', {signal:owner.signal});
          const data = await response.json();
        if(!owner.current()||version!==providerGeneration)return;
          if (!response.ok || !Array.isArray(data.backends)) throw new Error('Not a pylon endpoint');
          onDiscovery('pylon'); service = activeService(); backends = data.backends;
        } catch (_) {
          if(!owner.current()||version!==providerGeneration)return;
          const response = await fetch(service.url + '/v1/models', {signal:owner.signal});
          if(!owner.current()||version!==providerGeneration)return;
          if (!response.ok) throw new Error('Endpoint supports neither /backends nor /v1/models');
          onDiscovery('openai'); service = activeService();
        }
      }
      if (service.discovery === 'openai') backends = [{id: 'kiro', name: 'Kiro CLI', available: true}];
      else if (!backends) {
        const response = await fetch(service.url + '/backends', {signal:owner.signal});
        const data = await response.json();
        if(!owner.current()||version!==providerGeneration)return;
        backends = data.backends || [];
      }
      backends.forEach(backend => {
        const option = document.createElement('option');
        option.value = backend.id; option.textContent = `${backend.name || backend.id}${backend.available ? '' : ' (on demand)'}`;
        option.selected = backend.id === (chat.getBackend?.() || config.backend || 'kiro');
        backendSelect.appendChild(option);
      });
      if (!backendSelect.options.length) backendSelect.innerHTML = '<option value="kiro">Kiro</option>';
      chat.setBackend?.(backendSelect.value);
      await fillModels(backendSelect.value);
      if(owner.current()&&version===providerGeneration)pollStatus();
      } catch(error) {
        if(owner.current()&&version===providerGeneration)throw error;
      }
    };
    return {fillModels,fillProviders};
  }
  return {create};
})();
