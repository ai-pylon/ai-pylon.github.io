/* Config/pipeline menu discovery, independent of menu DOM rendering. */
window._AppUIMenuSource = (() => {
  function create() {
    const requests=AppUILifecycle.createKeyedScopes({pagehide:false,observeRemoval:false});
    async function load(options,onReady) {
      const owner=requests.begin('definition');
      if(!owner.current())return;
      const accept=definition=>{if(owner.current()&&definition.menu)onReady(definition);};
      const pipeline=async()=>{
        if(!owner.current())return;
        const response=await fetch('/api/pipeline.get',{
          method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({id:options.pipeline}),signal:owner.signal,
        });
        accept(await response.json());
      };
      try {
        const response=await fetch('/configs',{signal:owner.signal});
        const data=await response.json();
        if(!owner.current())return;
        const name=options.menu||options.pipeline;
        const entry=(data.configs||[]).find(config=>config.name===`pages/${name}/menu.json`);
        if(entry?.data?.menu)accept(entry.data);
        else if(!options.menu)await pipeline();
      } catch {
        // Pipeline discovery retains the original final API fallback.
        if(!options.menu&&owner.current()) {
          try {await pipeline();} catch {}
        }
      } finally {owner.destroy();}
    }
    return {load,destroy:()=>requests.destroy()};
  }
  return {create};
})();
