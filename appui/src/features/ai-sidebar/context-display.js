/* Dynamic page context; each refresh owns its result and controls. */
window._AISidebarContextDisplay=(function(){
  function create({container,getContext,isCurrent=()=>true}){
    const lifetime=AppUILifecycle.createKeyedScopes({host:container,observeRemoval:false});
    function render(){
      lifetime.destroy('render');
      if(!lifetime.current())return Promise.resolve();
      let root=container.querySelector('[data-context-display]');
      if(!root){root=document.createElement('div');root.dataset.contextDisplay='true';container.append(root);}
      root.replaceChildren();
      root.style.cssText='margin-top:12px;border-top:1px solid var(--border);padding-top:8px';
      const owner=lifetime.begin('render',{host:root});
      return Promise.resolve().then(()=>getContext()).then(async context=>{
        if(!owner.current())return;
        if(!context||(typeof context==='object'&&!Object.keys(context).length))return;
        const text=typeof context==='string'?context:JSON.stringify(context,null,2);
        await AppUI.load('toolbar');
        if(!owner.current())return;
        const controls=document.createElement('div'),body=document.createElement('pre');
        body.style.cssText='font-size:11px;max-height:200px;overflow:auto';
        body.textContent=text;root.replaceChildren(controls,body);
        const toolbar=AppUI.components.Toolbar.create({container:controls,label:'Dynamic context actions',
          title:'Dynamic Context',signal:owner.signal});
        owner.add(()=>toolbar.destroy());
        const refresh=toolbar.append({label:'Refresh',action:()=>{if(owner.current()&&isCurrent())render();}});
        refresh.dataset.refreshContext='true';
      }).catch(error=>{if(owner.current())root.textContent='Unable to load context: '+(error.message||String(error));});
    }
    return {render,destroy(){lifetime.destroy();}};
  }
  function createPreview({container,getContext,isCurrent=()=>true}) {
    const lifetime=AppUILifecycle.createViewScope({host:container});
    const generation=AppUILifecycle.generation();
    const escapeHtml=value=>window.AppUITextUtils.esc(value||'');
    async function show() {
      if(!lifetime.current() || !isCurrent())return;
      const request=generation.next();
      const current=()=>lifetime.current() && isCurrent() && generation.isCurrent(request);
      const button = container.querySelector('[data-ai-full-context]');
      if (button) { button.disabled = true; button.textContent = 'Loading…'; }
      try {
        const context = await getContext();
        if(!current())return;
        const channels = [
          ['System prompt', context?.raw],
          ['Tool prompt', context?.toolPrompt],
          ['Environment prompt', context?.environmentPrompt],
          ['Request metadata', context?.metadata ? JSON.stringify(context.metadata, null, 2) : ''],
        ].filter(([, value]) => value);
        const body = channels.length
          ? channels.map(([label, value]) => `<section style="margin:0 0 16px"><h3 style="margin:0 0 6px;font-size:13px">${escapeHtml(label)}</h3><pre style="margin:0;white-space:pre-wrap;word-break:break-word;max-height:260px;overflow:auto;background:var(--bg-primary);padding:8px;border:1px solid var(--border);border-radius:4px">${escapeHtml(value)}</pre></section>`).join('')
          : '<p>No context channels are enabled.</p>';
        if (window.AppUIDialog?.show) AppUIDialog.show({title: 'Full context for the next prompt', body, width: '900px',signal:lifetime.signal});
        else window.alert(channels.map(([label, value]) => `[${label}]\n${value}`).join('\n\n'));
      } finally {
        if (button && current() && container.querySelector('[data-ai-full-context]')===button) { button.disabled = false; button.textContent = 'Context'; }
      }
    }
    return {show,destroy(){lifetime.destroy();generation.next();}};
  }
  return {create,createPreview};
})();
