/* Shared arrow/Home/End and activation binding for menu popups. */
window._AppUIMenuNavigation = (() => {
  function bind({container,getItems,onClose,afterActivate,isCurrent=()=>true}) {
    let destroyed=false;
    const current=()=>!destroyed&&container.isConnected!==false&&isCurrent();
    function focusFirst() {if(current())getItems()[0]?.focus();}
    function handle(event) {
      if(!current()||event.isComposing||!['Escape','Enter',' ','ArrowDown','ArrowUp','Home','End'].includes(event.key))return false;
      event.preventDefault?.();event.stopPropagation?.();
      if(event.key==='Escape'){onClose();return true;}
      const rows=getItems(),index=rows.indexOf(document.activeElement);
      if(!rows.length)return true;
      if(event.key==='Enter'||event.key===' ') {
        rows[index]?.click();
        if(current())afterActivate?.();
      } else if(event.key==='Home'||event.key==='End') {
        rows[event.key==='Home'?0:rows.length-1]?.focus();
      } else {
        const forward=event.key==='ArrowDown';
        const next=index<0?(forward?0:rows.length-1):(index+(forward?1:-1)+rows.length)%rows.length;
        rows[next]?.focus();
      }
      return true;
    }
    container.addEventListener('keydown',handle);
    return {handle,focusFirst,destroy(){if(destroyed)return;destroyed=true;container.removeEventListener('keydown',handle);}};
  }
  return {bind};
})();
