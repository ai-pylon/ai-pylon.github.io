/* Prompt library presentation; persistence and prompt application stay with the sidebar. */
window._AISidebarPromptLibrary=(function(){
  function create({container,getPrompts,getActive,onSelect,onDelete,onSave,isCurrent=()=>true}){
    const lifetime=AppUILifecycle.createKeyedScopes({host:container});
    function render(){
      lifetime.destroy('render');if(!lifetime.current())return Promise.resolve();
      container.replaceChildren();
      const root=document.createElement('div');container.append(root);
      const owner=lifetime.begin('render',{host:root});
      return AppUI.load('toolbar','collections').then(()=>{
        if(!owner.current())return;
        const prompts=getPrompts().map(prompt=>({...prompt})),active=getActive();
        const controls=document.createElement('div'),collection=document.createElement('div');root.append(controls,collection);
        const current=()=>owner.current()&&isCurrent();
        const toolbar=AppUI.components.Toolbar.create({container:controls,label:'Prompt library actions',title:'[lib] Prompts',signal:owner.signal});
        owner.add(()=>toolbar.destroy());
        const save=toolbar.append({label:'Save current as\u2026',action:()=>{if(current())onSave();}});
        save.dataset.savePrompt='true';
        const grid=AppUI.components.GridView.create({container:collection,columns:1,viewMode:'grid',persistKey:false,selectable:false,signal:owner.signal,
          renderItem(prompt,itemScope){
            const card=document.createElement('div');card.className='ui-ai-prompt-item';
            const actions=AppUI.components.Toolbar.create({container:card,label:'Prompt actions',signal:itemScope.signal});
            itemScope.add(()=>actions.destroy());
            const select=actions.append({label:prompt.name,title:String(prompt.prompt??'').slice(0,80),action:()=>{if(current()&&itemScope.current())onSelect(prompt.id);}});
            select.classList.add('ui-ai-prompt-select');select.dataset.selectPrompt=String(prompt.id);
            select.setAttribute('aria-pressed',String(prompt.id===active));
            if(!prompt.builtin){
              const remove=actions.append({label:'Delete',title:'Delete '+String(prompt.name),action:()=>{if(current()&&itemScope.current())onDelete(prompt.id);}});
              remove.dataset.deletePrompt=String(prompt.id);
            }
            return card;
          }
        });
        grid.setItems(prompts);owner.add(()=>grid.destroy());
      }).catch(error=>{if(owner.current())root.textContent='Unable to load prompts: '+(error.message||String(error));});
    }
    return {render,destroy(){lifetime.destroy();}};
  }
  return {create};
})();
