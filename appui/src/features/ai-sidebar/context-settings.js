/* Prompt settings, prompt library integration, and final-context preview. */
window._AISidebarContextSettings=(function(){
  const escapeHtml=window.AppUITextUtils.esc;
  const _loadCustomPrompts=window._AISidebarPrompts.loadCustom;
  const _saveCustomPrompts=window._AISidebarPrompts.saveCustom;
  const _getAllPrompts=window._AISidebarPrompts.getAll;
  function create({container,config,chat,system,promptOptions,enabledTools,enabledGroups,getSetting,setSetting,
    getGenerationSettings,isActive,onChange}){
    const pages={context:container};
    const lifetime=AppUILifecycle.createKeyedScopes({host:container,observeRemoval:false});
    let environmentText = null;
    let finalPrompt = null;
    let previewVersion = 0;
    const currentPromptOptions = () => {
      const boxes = pages.context.querySelectorAll('[data-prompt]');
      return boxes.length ? Object.fromEntries([...boxes].map(box => [box.dataset.prompt, box.checked])) : promptOptions();
    };
    let promptEditorScope;
    const refreshPreview = async () => {
      const owner=promptEditorScope;if(!owner?.current())return;
      const version = ++previewVersion;
      chat.setPromptOptions?.(currentPromptOptions());
      const sysEl = pages.context.querySelector('[data-ai-system]');
      if (sysEl) { const draftSystem = sysEl.value.trim(); chat.setSystem?.(draftSystem || config.system); }
      if (finalPrompt) finalPrompt.value = 'Building final prompt…';
      try {
        const context = await chat.getFullContext?.();
        if (owner.current() && version === previewVersion && finalPrompt) {
          const channels = [];
          const selected = currentPromptOptions();
          if (selected.system && context?.raw) channels.push(`[System]\n${context.raw}`);
          if (selected.tools && context?.toolPrompt) channels.push(`[Tool Prompt]\n${context.toolPrompt}`);
          if (selected.environment && context?.environmentPrompt) channels.push(`[Environment]\n${context.environmentPrompt}`);
          if (selected.user) channels.push('[User Prompt]\nThe next message entered in the Chat tab is sent here.');
          finalPrompt.value = channels.join('\n\n') || 'No prompt channels are enabled.';
          if (environmentText) environmentText.value = context?.environmentPrompt || '';
        }
      } catch (error) {
        if (owner.current() && version === previewVersion && finalPrompt) finalPrompt.value = `Unable to build prompt: ${error.message || error}`;
      }
    };
    let promptLibrary;
    function _renderContextPrompts() {
      if(!lifetime.current())return;
      const options = promptOptions();
      const selectedTools = window._AISidebarPrompts.toolSummary(enabledTools(),enabledGroups());
      lifetime.destroy('editor');
      const editor=lifetime.begin('editor',{host:pages.context,observeRemoval:false});
      promptEditorScope=editor;
      pages.context.innerHTML = '';
      // --- Prompt Library Section ---
      const promptLib = document.createElement('div');
      promptLib.className = 'ui-ai-prompt-library';
      promptLib.textContent='[lib] Prompts';
      pages.context.appendChild(promptLib);
      const refreshPrompts=()=>{_renderContextPrompts();onChange();refreshPreview();};
      promptLibrary=window._AISidebarPromptLibrary.create({
        container:promptLib,getPrompts:()=>_getAllPrompts(getSetting),
        getActive:()=>getSetting('ai_active_prompt_id',''),isCurrent:()=>isActive(),
        onSelect:id=>{
          const found=_getAllPrompts(getSetting).find(prompt=>prompt.id===id);
          if(!found)return;
          setSetting('ai_active_prompt_id',found.id);setSetting('ai_system_prompt',found.prompt);
          chat.setSystem?.(found.prompt);refreshPrompts();
        },
        onDelete:id=>{
          _saveCustomPrompts(setSetting,_loadCustomPrompts(getSetting).filter(prompt=>prompt.id!==id));
          if(getSetting('ai_active_prompt_id','')===id)setSetting('ai_active_prompt_id','');
          refreshPrompts();
        },
        onSave:()=>{
          if (!editor.current() || !isActive()) return;
          const currentPrompt=(pages.context.querySelector('[data-ai-system]')?.value||system()).trim();
          AppUI.components.Dialog.prompt('Save prompt as:', '', name => {
            if (!editor.current() || !name?.trim()) return;
            const custom=_loadCustomPrompts(getSetting),id='custom_'+Date.now();
            custom.push({id,name:name.trim(),builtin:false,prompt:currentPrompt});
            _saveCustomPrompts(setSetting,custom);setSetting('ai_active_prompt_id',id);refreshPrompts();
          }, {signal:editor.signal});
        }
      });
      editor.add(promptLibrary);
      if(isActive())promptLibrary.render();
      // --- End Prompt Library ---
      const fields=window._AISidebarContextSettingsView.mount({container:pages.context,config,options,system,selectedTools,escapeHtml});
      environmentText=fields.environmentText;
      finalPrompt=fields.finalPrompt;
      const {applyHost}=fields;
      pages.context.querySelectorAll('[data-prompt]').forEach(box=>editor.listen(box,'change',refreshPreview));
      editor.listen(pages.context.querySelector('[data-ai-system]'),'input',refreshPreview);
      const applySettings=()=>{
        if(!editor.current()||!isActive())return;
        const next = {};
        pages.context.querySelectorAll('[data-prompt]').forEach(box => { next[box.dataset.prompt] = box.checked; setSetting(`ai_send_${box.dataset.prompt}`, box.checked); });
        chat.setPromptOptions?.(next);
        const generation=getGenerationSettings();
        if(generation.backend!==undefined)chat.setBackend?.(generation.backend);
        if(generation.model!==undefined)chat.setModel?.(generation.model);
        const prompt = pages.context.querySelector('[data-ai-system]').value.trim();
        chat.setSystem?.(prompt || config.system);
        setSetting('ai_system_prompt', prompt);
        refreshPreview();
      };
      AppUI.load('toolbar').then(()=>{
        if(!editor.current())return;
        const toolbar=AppUI.components.Toolbar.create({container:applyHost,label:'Prompt settings actions',signal:editor.signal});
        editor.add(()=>toolbar.destroy());
        const button=toolbar.append({label:'Apply prompt settings',action:applySettings});button.dataset.aiApply='true';
      }).catch(error=>{if(editor.current())applyHost.textContent='Unable to load prompt controls: '+(error.message||String(error));});
      refreshPreview();
    }
    return {
      render:_renderContextPrompts,refreshPreview,
      renderLibrary(){if(lifetime.current())return promptLibrary?.render();},
      destroy(){lifetime.destroy();}
    };
  }
  return {create};
})();
