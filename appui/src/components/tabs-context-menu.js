/* Lazy shared context menu owned by a tab collection. */
window._AppUITabsContextMenu = (() => {
  function create({isCurrent}) {
    let generation=0,destroyed=false,menu=null;
    function cancel() {
      generation++;
      if(menu?.isConnected)window.AppUIContextMenu.close();
      menu=null;
    }
    async function show(event,tab,actions) {
      cancel();
      if(destroyed||!isCurrent(tab))return;
      const request=generation,point={x:event.clientX,y:event.clientY};
      const current=()=>!destroyed&&generation===request&&isCurrent(tab);
      try {
        if(!window.AppUIContextMenu) {
          if(window.AppUIAssets?.load)await window.AppUIAssets.load('contextMenu');
          else await window.AppUI.load('contextMenu');
        }
        if(!current())return;
        const action=callback=>()=>{if(current()){generation++;callback();}};
        menu=window.AppUIContextMenu.show(point,[
          {label:tab.pinned?'Unpin':'Pin',action:action(actions.pin)},
          {separator:true},{label:'Close',action:action(actions.close)},
          {label:'Close Others',action:action(actions.closeOthers)},
          {label:'Close All',action:action(actions.closeAll)},
          {separator:true},{label:'Duplicate',action:action(actions.duplicate)},
        ]);
      } catch { /* An optional menu must not interrupt the tab collection. */ }
    }
    return {show,cancel,destroy(){if(destroyed)return;destroyed=true;cancel();}};
  }
  return {create};
})();
