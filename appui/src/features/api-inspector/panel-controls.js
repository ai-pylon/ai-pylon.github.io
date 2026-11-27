/* Shared controls for the API inspector; capture and report state stay in core. */
window._AppUIApiInspectorControls=(function(){
  function createPanel() {
    const panel = document.createElement('div');
    panel.id = 'appui-api-inspector';
    panel.innerHTML = `
      <div class="api-insp-header">
        <span>DevTools</span>
        <nav class="api-insp-tabs">
          <button class="api-insp-tab active" data-tab="network">Network</button>
          <button class="api-insp-tab" data-tab="events">Events</button>
          <button class="api-insp-tab" data-tab="components">Components</button>
        </nav>
        <span class="api-insp-actions"></span>
      </div>
      <div class="api-insp-body" data-panel="network"></div>
      <div class="api-insp-body" data-panel="events" style="display:none"></div>
      <div class="api-insp-body" data-panel="components" style="display:none"></div>
    `;
    panel.style.cssText = 'position:fixed;bottom:0;right:0;width:480px;max-height:340px;background:var(--bg-primary);border:1px solid var(--border);border-radius:6px 0 0 0;z-index:99999;font-family:monospace;font-size:11px;display:flex;flex-direction:column;box-shadow:0 -2px 12px rgba(0,0,0,0.3);';
    panel.querySelector('.api-insp-header').style.cssText = 'padding:4px 8px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border);font-weight:600;color:var(--text-primary);font-size:11px;gap:8px;';
    panel.querySelector('.api-insp-tabs').style.cssText = 'display:flex;gap:2px;flex:1;';
    panel.querySelectorAll('.api-insp-body').forEach(function(b) { b.style.cssText += 'overflow-y:auto;flex:1;max-height:280px;'; });
    panel.querySelector('.api-insp-actions').style.cssText = 'display:flex;gap:4px;';
    panel.querySelectorAll('.api-insp-tab').forEach(function(tab) {
      tab.style.cssText = 'background:none;border:none;color:var(--text-muted);padding:2px 8px;cursor:pointer;font-size:10px;border-bottom:2px solid transparent;';
    });
    panel.querySelector('.api-insp-tab.active').style.borderBottomColor = 'var(--accent)';
    panel.querySelector('.api-insp-tab.active').style.color = 'var(--text-primary)';

    return panel;
  }

  function create({container,getActive,isCurrent,onSwitch,onClear,onSummary,onClose}){
    const owner=AppUILifecycle.createViewScope({host:container});
    let tabs;
    const current=()=>owner.current()&&isCurrent();
    container.querySelectorAll('[data-tab]').forEach(button=>{
      button.type='button';
      owner.listen(button,'click',()=>{if(current()&&!tabs)onSwitch(button.dataset.tab);});
    });
    const ready=AppUI.load('toolbar').then(()=>{
      if(!owner.current())return;
      tabs=AppUI.components.TabNavigation.bind({container:container.querySelector('.api-insp-tabs'),
        onSwitch:({id})=>{if(current())onSwitch(id);}});
      owner.add(()=>tabs.destroy());
      tabs.switch(getActive(),false);
      const toolbar=AppUI.components.Toolbar.create({container:container.querySelector('.api-insp-actions'),
        label:'API inspector actions',signal:owner.signal});
      owner.add(()=>toolbar.destroy());
      for(const [action,label,title,callback]of [
        ['clear','C','Clear log',onClear],['summary','S','Show summary',onSummary],['close','x','Close',onClose]
      ]){
        const button=toolbar.append({label,title,action:()=>{if(current())callback();}});
        button.dataset.action=action;
      }
    }).catch(()=>{});
    return {ready,activate:id=>{if(owner.current())tabs?.switch(id,false);},destroy:()=>owner.destroy()};
  }
  return {create,createPanel};
})();
