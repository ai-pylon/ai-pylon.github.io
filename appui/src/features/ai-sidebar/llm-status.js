/* Private polling and status presentation for AI service discovery. */
window._AISidebarLLMStatus = {
  create({owner,activeService,getBackend,statusOutput}) {
    let llmPoller, statusGeneration = 0;
    const setCheckStatus = (message, state = '') => {
      if(!owner.current())return;
      statusOutput.textContent = message;
      statusOutput.dataset.state = state;
    };
    // Auto-poll backend status
    const pollStatus = async () => {
      const version=++statusGeneration;
      try {
        const service = activeService();
        const backend = getBackend();
        if (!backend) return;
        const resp = await fetch(service.url + (service.discovery === 'openai' ? '/health' : '/backends'), {signal: AbortSignal.any([owner.signal,AbortSignal.timeout(3000)])});
        const status = await resp.json();
        if(!owner.current()||version!==statusGeneration)return;
        const info = service.discovery === 'openai' ? {available: status.ok, state: status.ok ? 'ready' : 'offline'} : (status.backends || []).find(item => item.id === backend);
        if (!info) { setCheckStatus('Provider unavailable', 'error'); return; }
        const available = info.available === true;
        if (available) setCheckStatus(`✔ ${backend} ready`, 'ok');
        else setCheckStatus(`○ ${backend} on demand — starts when you send a message`, 'idle');
      } catch (e) { if(owner.current()&&version===statusGeneration)setCheckStatus('Status unavailable', 'error'); }
    };
    const startPoll = () => {
      llmPoller?.destroy();
      llmPoller=AppUI.utils.polling.create(pollStatus,5000,{pauseOnHidden:false});
      llmPoller.start();llmPoller.refresh();
    };
    owner.add(()=>llmPoller?.destroy());
    return {set:setCheckStatus,refresh:pollStatus,start:startPoll,invalidate:()=>{statusGeneration++;}};
  }
};
