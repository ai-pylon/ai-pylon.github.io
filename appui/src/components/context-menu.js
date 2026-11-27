/**
 * AppUIContextMenu -- shared mouse/right-click menu.
 *
 * AppUIContextMenu.show(event, [{label:'New folder', action(){}}], {onCommand});
 * Coordinates are also accepted: show({x: 24, y: 48}, items).
 * Item fields: label, action, command, params, disabled, danger, separator, submenu (array of items).
 * Optional anchor keeps clicks inside the trigger available to its toggle handler.
 */
const AppUIContextMenu = (() => {
  const view=window._AppUIContextMenuView;
  let menu = null;
  let submenuEl = null;
  let bindTimer = null;
  let returnFocus = null;
  let ownerCleanup = null;
  let anchor = null;
  function hideSubmenu() {
    if(submenuEl){submenuEl._appuiMenuKeys?.destroy();submenuEl.remove();submenuEl=null;}
  }
  function close() {
    ownerCleanup?.();ownerCleanup=null;
    if (bindTimer !== null) { clearTimeout(bindTimer); bindTimer = null; }
    hideSubmenu();
    if (menu) { menu._appuiMenuKeys?.destroy();menu.remove(); menu = null; }
    returnFocus=null;
    anchor=null;
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
  }
  function onOutside(event) { if (menu && !menu.contains(event.target) && (!submenuEl || !submenuEl.contains(event.target)) && !anchor?.contains(event.target)) close(); }
  function dismiss() {
    const previous=returnFocus;
    close();
    if(previous?.isConnected!==false)previous?.focus?.();
  }
  function onKey(event) {
    if(!menu||event.isComposing)return;
    if(event.key==='Escape') {
      event.preventDefault?.();event.stopPropagation?.();dismiss();
    } else if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
      (submenuEl||menu)._appuiMenuKeys?.handle(event);
    }
  }
  function bindKeys(host,isCurrent) {
    host._appuiMenuKeys=window._AppUIMenuNavigation.bind({container:host,isCurrent,onClose:dismiss,
      getItems:()=>[...host.querySelectorAll('button')].filter(button=>!button.disabled),
      afterActivate:()=>submenuEl?._appuiMenuKeys?.focusFirst(),
    });
  }
  function _runItem(item, onCommand) {
    if (item.command && onCommand) onCommand(item.command, item.params || {}, {type: 'context-menu', item});
    else item.action?.();
  }
  function _appendItems(host,items,onCommand,isCurrent,submenus){
    for(const item of items){
      if(item.separator){host.appendChild(view.separator());continue;}
      const button=view.row(item,submenus);
      if(item.submenu&&submenus){
        const open=()=>{if(isCurrent()&&!button.disabled)_showSubmenu(button,item.submenu,onCommand);};
        button.addEventListener('mouseenter',open);
        button.addEventListener('click',event=>{event.stopPropagation();open();});
      }else{
        if(submenus)button.addEventListener('mouseenter',()=>{
          if(isCurrent())hideSubmenu();
        });
        button.addEventListener('click',()=>{
          if(button.disabled||!isCurrent())return;
          close();_runItem(item,onCommand);
        });
      }
      host.appendChild(button);
    }
  }
  function _showSubmenu(parentBtn, items, onCommand) {
    hideSubmenu();
    submenuEl = view.menu();
    const ownedSubmenu=submenuEl,ownedMenu=menu;
    _appendItems(ownedSubmenu,items,onCommand,()=>submenuEl===ownedSubmenu&&menu===ownedMenu&&ownedMenu.isConnected!==false&&ownedSubmenu.isConnected!==false,false);
    bindKeys(ownedSubmenu,()=>submenuEl===ownedSubmenu&&menu===ownedMenu&&ownedMenu.isConnected!==false&&ownedSubmenu.isConnected!==false);
    document.body.appendChild(submenuEl);
    const rect = parentBtn.getBoundingClientRect();
    view.positionSubmenu(submenuEl,rect);
  }
  function show(event, items = [], {onCommand,signal,anchor:trigger} = {}) {
    if(signal?.aborted)return null;
    event?.preventDefault?.();
    const ownsFocus=menu?.contains(document.activeElement)||submenuEl?.contains(document.activeElement);
    const previous=ownsFocus?returnFocus:document.activeElement;
    close();
    anchor=trigger || null;
    returnFocus=previous;
    view.injectStyles();
    menu = view.menu();
    const ownedMenu=menu;
    _appendItems(ownedMenu,items,onCommand,()=>menu===ownedMenu&&ownedMenu.isConnected!==false,true);
    bindKeys(ownedMenu,()=>menu===ownedMenu);
    document.body.appendChild(menu);
    view.position(menu,event?.clientX??event?.x??0,event?.clientY??event?.y??0);
    bindTimer = setTimeout(() => {
      if(menu!==ownedMenu)return;
      bindTimer = null;
      document.addEventListener('pointerdown', onOutside, true);
      document.addEventListener('keydown', onKey, true);
    });
    if(signal) {
      const cancel=()=>{if(menu===ownedMenu)close();};
      ownerCleanup=()=>signal.removeEventListener('abort',cancel);
      signal.addEventListener('abort',cancel,{once:true});
      if(signal.aborted)cancel();
    }
    return menu===ownedMenu?ownedMenu:null;
  }
  return {show, close};
})();
window.AppUIContextMenu = AppUIContextMenu;
