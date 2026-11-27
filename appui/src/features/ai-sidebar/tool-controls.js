/* Shared toolbar presentation for AI capability selection. */
window._AISidebarToolControls=(function(){
  function create({container,actions,onFilter,isCurrent=()=>true}){
    const owner=AppUILifecycle.createViewScope({host:container});
    const ready=AppUI.load('toolbar').then(()=>{
      if(!owner.current())return;
      const toolbar=AppUI.components.Toolbar.create({container,label:'AI tool selection',signal:owner.signal});
      owner.add(()=>toolbar.destroy());
      const filter=toolbar.append({type:'search',ariaLabel:'Filter tool tree',placeholder:'Filter tool tree',
        onInput:value=>{if(owner.current()&&isCurrent())onFilter(value);}});
      filter.dataset.toolFilter='true';
      for(const [key,label,title] of [
        ['selectAll','Select all',''],['suggested','Suggested',''],['deselectAll','Deselect all',''],
        ['reset','Reset','Clear all overrides and restore page defaults']
      ]){
        const button=toolbar.append({label,title,action:()=>{if(owner.current()&&isCurrent())actions[key]();}});
        const attributes={selectAll:'selectAll',suggested:'defaultGroups',deselectAll:'disableTools',reset:'resetTools'};
        button.dataset[attributes[key]]='true';
      }
    }).catch(error=>{if(owner.current())container.textContent='Unable to load tool controls: '+(error.message||String(error));});
    return {ready,destroy:()=>owner.destroy()};
  }
  return {create};
})();
