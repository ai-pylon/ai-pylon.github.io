/* Collected prompt context model and disposable collection presentation. */
window._AISidebarCollectedContext=(function(){
  function createCollection() {
    const items=[];
    return {
      add(label,content) {
        if (!label || !content) return false;
        items.push({label,content:String(content),time:Date.now()});return true;
      },
      remove(index) {
        if (!(index >= 0 && index < items.length)) return false;
        items.splice(index,1);return true;
      },
      clear() {items.length=0;},
      list:()=>items.slice(),
      indexOf:item=>items.indexOf(item),
      text:()=>items.length?'[Collected Context]\n'+items.map(item=>`--- ${item.label} ---\n${item.content}`).join('\n\n'):'',
    };
  }
  function create({container,getItems,onRemove,onClear,isCurrent=()=>true}){
    const lifetime=AppUILifecycle.createKeyedScopes({host:container,observeRemoval:false});
    function render(){
      lifetime.destroy('render');
      if(!lifetime.current())return Promise.resolve();
      let root=container.querySelector('[data-collected-context]');
      if(!root){root=document.createElement('div');root.dataset.collectedContext='true';container.append(root);}
      root.replaceChildren();
      root.style.cssText='margin-top:12px;border-top:1px solid var(--border);padding-top:8px';
      const owner=lifetime.begin('render',{host:root});
      const items=getItems().map(source=>({source,label:String(source.label),content:String(source.content)}));
      if(!items.length){
        const title=document.createElement('label'),hint=document.createElement('p');
        title.textContent='Collected Context (empty)';title.style.cssText='font-size:11px;font-weight:600;opacity:0.5';
        hint.textContent='Select text and right-click \u2192 "Send to AI", or use the addContext() API.';
        hint.style.cssText='font-size:11px;opacity:0.6;margin:4px 0';root.append(title,hint);
        return Promise.resolve();
      }
      return AppUI.load('toolbar','collections').then(()=>{
        if(!owner.current())return;
        const controls=document.createElement('div'),collection=document.createElement('div');
        root.replaceChildren(controls,collection);
        const current=()=>owner.current()&&isCurrent();
        const toolbar=AppUI.components.Toolbar.create({container:controls,label:'Collected context actions',
          title:'Collected Context ('+items.length+')',signal:owner.signal});
        owner.add(()=>toolbar.destroy());
        const clear=toolbar.append({label:'Clear all',action:()=>{if(current())onClear();}});
        clear.dataset.clearCollected='true';
        const grid=AppUI.components.GridView.create({container:collection,columns:1,viewMode:'grid',persistKey:false,selectable:false,signal:owner.signal,
          renderItem(item,itemScope){
            const card=document.createElement('div'),header=document.createElement('div'),body=document.createElement('pre');
            card.style.cssText='padding:4px 6px;background:var(--surface-alt,var(--bg-secondary));border-radius:4px;font-size:11px';
            body.style.cssText='max-height:80px;overflow:auto;margin:2px 0 0;font-size:10px;white-space:pre-wrap';
            body.textContent=item.content.length>500?item.content.slice(0,500)+'\u2026':item.content;
            card.append(header,body);
            const actions=AppUI.components.Toolbar.create({container:header,label:'Collected item actions',title:item.label,signal:itemScope.signal});
            itemScope.add(()=>actions.destroy());
            actions.append({label:'Remove',action:()=>{if(current()&&itemScope.current())onRemove(item.source);}});
            return card;
          }
        });
        grid.setItems(items);owner.add(()=>grid.destroy());
      }).catch(error=>{if(owner.current())root.textContent='Unable to load collected context: '+(error.message||String(error));});
    }
    return {render,destroy(){lifetime.destroy();}};
  }
  return {create,createCollection};
})();
