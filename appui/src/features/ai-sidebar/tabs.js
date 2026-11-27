/* AI sidebar layout and shared tab navigation; core owns panel contents. */
window._AISidebarTabs=(function(){
  function createLayout({container,config={}}) {
    const escapeHtml=value=>window.AppUITextUtils.esc(value||'');
    container.innerHTML = `<section class="ui-ai-sidebar">${config.hideHeader ? '' : `<header class="ui-ai-sidebar-head"><b>• ${escapeHtml(config.title || 'Review')}</b><div data-ai-header-actions></div></header>`}<nav class="ui-ai-tabs"><button data-ai-tab="chat">Chat</button><button data-ai-tab="history">History</button><button data-ai-tab="context">Context</button><button data-ai-tab="tools">Tools</button><button data-ai-tab="llm">LLM</button></nav><div class="ui-ai-pages"><div data-ai-page="chat" class="ui-ai-page"></div><div data-ai-page="history" class="ui-ai-page" hidden></div><div data-ai-page="context" class="ui-ai-page" hidden></div><div data-ai-page="tools" class="ui-ai-page" hidden></div><div data-ai-page="llm" class="ui-ai-page" hidden></div></div></section>`;
    return {
      pages:Object.fromEntries([...container.querySelectorAll('[data-ai-page]')].map(page=>[page.dataset.aiPage,page])),
      headerHost:container.querySelector('[data-ai-header-actions]'),tabsHost:container.querySelector('.ui-ai-tabs')
    };
  }
  function create({container,getActive,onSwitch}){
    const owner=AppUILifecycle.createViewScope({host:container});
    let tabs;
    const buttons=[...container.querySelectorAll('[data-ai-tab]')];
    buttons.forEach(button=>{
      button.type='button';
      button.dataset.tab=button.dataset.aiTab;
      owner.listen(button,'click',()=>{if(owner.current()&&!tabs)onSwitch(button.dataset.aiTab);});
    });
    const ready=Promise.resolve().then(()=>{
      if(!owner.current())return;
      tabs=AppUI.components.TabNavigation.bind({container,onSwitch:({id})=>{if(owner.current())onSwitch(id);}});
      owner.add(()=>tabs.destroy());
      tabs.switch(getActive(),false);
    }).catch(()=>{});
    return {ready,activate:id=>{if(owner.current())tabs?.switch(id,false);},destroy:()=>owner.destroy()};
  }
  return {create,createLayout};
})();
