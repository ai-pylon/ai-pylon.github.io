/* Private workflow preference and prompt-context policy for the AI sidebar. */
window._AISidebarWorkflowSelection = {
  create({getWorkflows,getSetting,setSetting,defaults}) {
    function enabled() {
      return getWorkflows().filter(function(w) {
        var override = getSetting('ai_workflow_' + w.name, null);
        if (override !== null) return override === true;
        return defaults.has(w.name) || w.quick_action;
      });
    }
    function context() {
      const workflows = enabled();
      if (!workflows.length) return '';
      return '[Available Workflows]\n' + workflows.map(w =>
        `- ${w.name}: ${w.description}${w.trigger ? ' (trigger: ' + w.trigger + ')' : ''} [${w.steps} steps]`
      ).join('\n') + '\n\nYou can suggest running a workflow with: /api/workflows/run (POST {name: "workflow-name", data: {...}})';
    }
    function setEnabled(name,checked) {
      setSetting('ai_workflow_'+name,checked);
      if(!checked){
        const pageName=(window.location.pathname.match(/\/pages\/([^/]+)/)||[])[1]||'';
        let pageDefaults=null;
        try{
          const raw=getSetting('ai_page_defaults_'+pageName,null);
          pageDefaults=raw?(typeof raw==='string'?JSON.parse(raw):raw):null;
        }catch{}
        if(pageDefaults&&(pageDefaults.workflows||[]).indexOf(name)!==-1){
          fetch('/api/workflows/recommend/reject',{
            method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({names:[name],page:pageName})
          }).catch(function(){});
        }
      }
    }
    return {enabled,context,setEnabled};
  }
};
