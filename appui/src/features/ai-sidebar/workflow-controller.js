/* Workflow catalog, selection and lazy presentation for one AI sidebar. */
window._AISidebarWorkflowController = {
  create({catalog,getSetting,setSetting,defaults,getContainer,getChat,isActive,isCurrent}) {
    let workflows=[],loaded=false,view,destroyed=false;
    const current=()=>!destroyed&&isCurrent();
    const selection=window._AISidebarWorkflowSelection.create({getWorkflows:()=>workflows,getSetting,setSetting,defaults});
    async function load() {
      if(!current())return;
      return catalog.loadWorkflows({
        onReady:items=>{if(!current())return;workflows=items;loaded=true;if(isActive())render();},
        onError:()=>{if(!current())return;loaded=false;if(isActive())render();},
      });
    }
    function render() {
      if(!current())return;
      view ||= window._AISidebarWorkflowView.create({
        container:getContainer(),getWorkflows:()=>loaded?workflows:[],getEnabled:selection.enabled,isCurrent:isActive,
        onChange:(name,checked)=>{
          if(!current())return;
          selection.setEnabled(name,checked);
          getChat().setWorkflows?.(selection.enabled());render();
        },
      });
      return view.render();
    }
    return {load,render,items:()=>workflows,enabled:selection.enabled,context:selection.context,
      destroy(){if(destroyed)return;destroyed=true;view?.destroy();},
    };
  },
};
