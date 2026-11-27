/* Workflow capability collection; selection and persistence belong to the sidebar. */
window._AISidebarWorkflowView=(function(){
  function create({container,getWorkflows,getEnabled,onChange,isCurrent=()=>true}){
    const lifetime=AppUILifecycle.createKeyedScopes({host:container,observeRemoval:false});
    function render(){
      lifetime.destroy('render');
      if(!lifetime.current())return Promise.resolve();
      let section=container.querySelector('.ui-ai-workflows-section');
      if(!section){section=document.createElement('div');section.className='ui-ai-workflows-section';
        const first=container.querySelector('.ui-ai-tool-group');
        if(first)container.insertBefore(section,first);else container.append(section);}
      section.replaceChildren();
      const owner=lifetime.begin('render',{host:section});
      const workflows=getWorkflows().map(workflow=>({...workflow}));
      if(!workflows.length)return Promise.resolve();
      const enabled=new Set(getEnabled().map(workflow=>workflow.name));
      return AppUI.load('toolbar','collections').then(()=>{
        if(!owner.current())return;
        const details=document.createElement('details'),summary=document.createElement('summary'),hint=document.createElement('p');
        details.className='ui-ai-workflow-tree';details.open=true;
        summary.textContent='\u26a1 Workflows ('+enabled.size+'/'+workflows.length+' active)';
        hint.textContent='Enable workflows the AI can suggest or trigger.';
        hint.style.cssText='margin:4px 0;font-size:11px;opacity:0.7';details.append(summary,hint);
        section.append(details);
        const categories=[...new Set(workflows.map(workflow=>workflow.category||'Uncategorized'))].sort();
        for(const category of categories){
          const group=document.createElement('details'),title=document.createElement('summary'),collection=document.createElement('div');
          const items=workflows.filter(workflow=>(workflow.category||'Uncategorized')===category);
          group.className='ui-ai-workflow-cat';group.style.marginLeft='8px';
          title.textContent=category+' ('+items.length+')';group.append(title,collection);details.append(group);
          const grid=AppUI.components.GridView.create({container:collection,columns:1,viewMode:'grid',persistKey:false,selectable:false,signal:owner.signal,
            renderItem(workflow,itemScope){
              const card=document.createElement('div'),controls=document.createElement('div'),description=document.createElement('small');
              description.textContent=String(workflow.description||'').slice(0,60);card.append(controls,description);
              const toolbar=AppUI.components.Toolbar.create({container:controls,label:'Workflow selection',signal:itemScope.signal});
              itemScope.add(()=>toolbar.destroy());
              const checkbox=toolbar.append({type:'checkbox',label:workflow.name,checked:enabled.has(workflow.name),
                onChange:checked=>{if(owner.current()&&itemScope.current()&&isCurrent())onChange(workflow.name,checked);}});
              checkbox.dataset.workflow=workflow.name;return card;
            }
          });
          grid.setItems(items);owner.add(()=>grid.destroy());
        }
      }).catch(error=>{if(owner.current())section.textContent='Unable to load workflows: '+(error.message||String(error));});
    }
    return {render,destroy(){lifetime.destroy();}};
  }
  return {create};
})();
