/* Component diagnostics presented by the shared Tree widget. */
window._AppUIApiInspectorComponentTree=(function(){
  function nodes(snapshot){
    const group=(id,name,children)=>({path:id,name,hasChildren:children.length>0,
      children:children.map((name,index)=>({path:id+':'+index,name:String(name),hasChildren:false}))});
    const result=[group('page','Page: '+snapshot.page,['Theme: '+snapshot.theme])];
    if(snapshot.left!==null)result.push(group('left','Left Sidebar ('+snapshot.left.length+' tabs)',snapshot.left));
    if(snapshot.right!==null)result.push(group('right','Right Sidebar ('+snapshot.right.length+' tabs)',snapshot.right));
    result.push(group('features','Features ('+snapshot.features.length+')',snapshot.features));
    result.push(group('dom','DOM',['Elements: '+snapshot.elements,'Scripts: '+snapshot.scripts]));
    return result;
  }
  function capture(){
    const sidebar=id=>{
      const host=document.getElementById(id);
      return host?[...host.querySelectorAll('[data-tab-id]')].map(tab=>tab.dataset.tabId||'?'):null;
    };
    const features=[
      ['AppUIAISidebar','AI Sidebar'],['AppUIApiInspector','API Inspector'],['AppUITheme','Theme'],
      ['AppUITree','Tree'],['AppUIChat','AI Chat'],['AppUIEventBus','AppUIEventBus'],
      ['DeepLink','DeepLink'],['AppUIConfigStore','AppUIConfigStore']
    ].filter(([key])=>window[key]).map(([,name])=>name);
    return {page:(location.pathname.match(/\/pages\/([^/]+)/)||[])[1]||'unknown',
      theme:window.AppUITheme?AppUITheme.get():'unknown',left:sidebar('app-left'),right:sidebar('app-right'),
      features,elements:document.querySelectorAll('*').length,scripts:document.querySelectorAll('script').length};
  }
  function create({container}){
    const lifetime=AppUILifecycle.createKeyedScopes({host:container});
    function render(){
      lifetime.destroy('render');if(!lifetime.current())return Promise.resolve();
      const roots=nodes(capture()),root=document.createElement('div');container.replaceChildren(root);
      const owner=lifetime.begin('render',{host:root});root.textContent='Loading components...';
      return AppUI.load('workspaceComponents').then(()=>{
        if(!owner.current())return;root.replaceChildren();
        const heading=document.createElement('div');heading.textContent='Component Tree';heading.style.cssText='padding:4px 8px;color:var(--accent)';
        const treeHost=document.createElement('div');root.append(heading,treeHost);
        const tree=AppUI.components.Tree.create({container:treeHost,storageKey:false,indent:12,
          onExpand:(node,done)=>{if(owner.current())done(node.children||[]);}});
        owner.add(()=>tree.destroy());
        tree.setExpanded(Object.fromEntries(roots.map(node=>[node.path,true])));
        tree.setRoots(roots);
      }).catch(error=>{if(owner.current())root.textContent='Unable to load components: '+(error.message||String(error));});
    }
    return {render,destroy(){lifetime.destroy();}};
  }
  return {create,nodes};
})();
