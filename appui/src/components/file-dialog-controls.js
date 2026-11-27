/* File picker navigation and selection use disposable shared toolbars. */
window._AppUIFileDialogControls = (() => {
  function create({container, onCancel, onBack, onUp, onNavigate, onSelect}) {
    const scope = AppUILifecycle.createScope();
    const navigation = document.createElement('div'); navigation.className = 'fd-toolbar';
    const list = document.createElement('div'); list.className = 'fd-list';
    list.style.cssText = 'flex:1;overflow-y:auto;padding:4px 0';
    const footer = document.createElement('div'); footer.className = 'fd-footer';
    container.append(navigation, list, footer);
    const nav = AppUIToolbar.create({container:navigation,label:'File navigation'});
    const selection = AppUIToolbar.create({container:footer,label:'File selection'});
    scope.add(nav); scope.add(selection);
    const source = nav.append({type:'select',className:'fd-source',ariaLabel:'File source',options:[{value:'',label:'📁 Local'}],onChange:value=>{
      const hints = {local:'C:/Users',ssh:'~',gitlab:'',gerrit:''};
      if (!path.value || path.value === 'C:/Users' || path.value === '~') path.value = Object.hasOwn(hints,value) ? hints[value] : '';
    }});
    nav.append({className:'fd-back',label:'<-',title:'Back',action:onBack});
    nav.append({className:'fd-up',label:'↑',title:'Up',action:onUp});
    const path = nav.append({type:'input',className:'fd-path',ariaLabel:'Directory path'});
    const navigate = () => onNavigate(path.value.trim());
    nav.append({className:'fd-go',label:'Go',action:navigate});
    const filename = selection.append({type:'input',className:'fd-filename',ariaLabel:'File name',placeholder:'File name...'});
    selection.append({className:'fd-select',label:'Open',primary:true,action:onSelect});
    selection.append({className:'fd-cancel',label:'Cancel',action:onCancel});
    for (const [input, action] of [[path,navigate],[filename,onSelect]]) {
      scope.listen(input,'keydown',event=>{
        if (scope.destroyed || event.key !== 'Enter' || event.isComposing) return;
        event.preventDefault(); action();
      });
    }
    return {source,path,filename,destroy:()=>scope.destroy()};
  }
  return {create};
})();
