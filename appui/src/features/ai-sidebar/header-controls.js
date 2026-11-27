/* Shared toolbar for sidebar-wide AI actions. */
window._AISidebarHeaderControls=(function(){
  function create({container,onExplain,onContext,onClear}){
    const owner=AppUILifecycle.createViewScope({host:container});
    const ready=AppUI.load('toolbar').then(()=>{
      if(!owner.current())return;
      const toolbar=AppUI.components.Toolbar.create({container,label:'AI sidebar actions',signal:owner.signal});
      owner.add(()=>toolbar.destroy());
      for(const [key,label,title,action]of [
        ['aiExplain','?','Explain this page',onExplain],
        ['aiFullContext','Context','Show the full context for the next prompt',onContext],
        ['aiClear','\u2716','Clear chat',onClear]
      ]){
        const button=toolbar.append({label,title,action:()=>{if(owner.current())action();}});
        button.dataset[key]='true';
      }
    }).catch(error=>{if(owner.current())container.textContent='Unable to load AI actions: '+(error.message||String(error));});
    return {ready,destroy:()=>owner.destroy()};
  }
  return {create};
})();
