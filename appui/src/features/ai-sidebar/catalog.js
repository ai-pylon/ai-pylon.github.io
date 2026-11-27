/* Catalog transport and normalized records; sidebar core owns UI and chat state. */
window._AISidebarCatalog=(function(){
  function tools(records,suggested){
    const recommendations=new Map(suggested.map(tool=>[tool.name,tool])),byName=new Map();
    records.forEach(tool=>byName.set(tool.name,Object.assign({},recommendations.get(tool.name),tool)));
    return [...byName.values()].sort((a,b)=>a.name.localeCompare(b.name));
  }
  function workflows(records){
    return records.map(workflow=>({
      name:workflow.name,description:workflow.description||'',category:workflow.category||workflow.folder||'',
      trigger:workflow.trigger||'',steps:(workflow.steps||[]).length,enabled:workflow.enabled!==false,
      quick_action:workflow.quick_action||false
    }));
  }
  function create({container,suggested=[]}){
    const reads=AppUILifecycle.createKeyedScopes();
    async function loadTools(url,{onReady,onError}){
      const owner=reads.begin('tools',{host:container});if(!owner.current())return;
      try{
        const response=await fetch(url||'/tools',{signal:owner.signal});
        const data=await response.json();if(!owner.current())return;
        if(!response.ok||!Array.isArray(data.tools))throw new Error(data._error||'Tool registry unavailable');
        onReady(tools(data.tools,suggested));
      }catch(error){if(owner.current())onError(error);}
      finally{owner.destroy();}
    }
    async function loadWorkflows({onReady,onError}){
      const owner=reads.begin('workflows',{host:container});if(!owner.current())return;
      try{
        const response=await fetch('/api/workflows/list',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:owner.signal});
        if(!response.ok)return;
        const data=await response.json();if(!owner.current())return;
        onReady(workflows(data.workflows||[]));
      }catch(error){if(owner.current())onError(error);}
      finally{owner.destroy();}
    }
    return {loadTools,loadWorkflows,cancelTools:()=>reads.destroy('tools'),destroy:()=>reads.destroy()};
  }
  return {create,tools,workflows};
})();
