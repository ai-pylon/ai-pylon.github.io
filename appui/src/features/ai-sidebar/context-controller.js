/* Dynamic and collected context orchestration for one AI sidebar. */
window._AISidebarContextController = {
  create({getContainer,getContext,isActive,isCurrent,onChange}) {
    const collection=window._AISidebarCollectedContext.createCollection();
    let contextView,collectedView,destroyed=false;
    const current=()=>!destroyed&&isCurrent();
    function renderContext() {
      if(!current())return;
      contextView ||= window._AISidebarContextDisplay.create({container:getContainer(),getContext,isCurrent:isActive});
      return contextView.render();
    }
    function renderCollected() {
      if(!current())return;
      collectedView ||= window._AISidebarCollectedContext.create({
        container:getContainer(),getItems:collection.list,isCurrent:isActive,
        onRemove:item=>{if(current()&&isActive())remove(collection.indexOf(item));},
        onClear:()=>{if(!current()||!isActive())return;collection.clear();refreshCollected();},
      });
      return collectedView.render();
    }
    function refreshCollected() {if(current()){renderCollected();onChange();}}
    function add(label,content) {if(collection.add(label,content))refreshCollected();}
    function remove(index) {if(collection.remove(index))refreshCollected();}
    return {renderContext,renderCollected,add,remove,text:collection.text,list:collection.list,
      destroy(){
        if(destroyed)return;destroyed=true;
        const teardown=AppUILifecycle.createScope();teardown.add(collectedView);teardown.add(contextView);teardown.destroy();
      },
    };
  },
};
