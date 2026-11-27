/* Selected page text collector using the shared context menu. */
window._AISidebarSelectionMenu=(function(){
  function create({container,onCollect}){
    const owner=AppUILifecycle.createViewScope({host:container});
    let menu=null,version=0;
    const close=()=>{if(menu?.isConnected)AppUI.components.ContextMenu.close();menu=null;};
    owner.listen(document,'contextmenu',event=>{
      const request=++version;
      close();
      const text=window.getSelection()?.toString().trim()||'';
      if(!owner.current()||text.length<3||container.contains(event.target))return;
      event.preventDefault();
      const position={x:event.clientX,y:event.clientY};
      AppUI.load('contextMenu').then(()=>{
        if(!owner.current()||request!==version)return;
        menu=AppUI.components.ContextMenu.show(position,[{
          label:'[send] Send to AI ('+(text.length>40?text.slice(0,40)+'\u2026':text.length+' chars')+')',
          action:()=>{
            if(!owner.current()||request!==version)return;
            version++;
            const label=(text.length>60?text.slice(0,60)+'\u2026':text).replace(/\n/g,' ');
            onCollect(label,text);
          }
        }],{signal:owner.signal});
      }).catch(()=>{});
    });
    return {destroy:()=>owner.destroy()};
  }
  return {create};
})();
