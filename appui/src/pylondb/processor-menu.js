/* Processor actions use scoped shared controls; submitted actions outlive their view. */
window._AppUIPylonProcessorMenu = (() => {
  const mounts=new WeakMap();
  function create({PT,fetchActions,runAction,history,results}) {
    function render(container,db,nodeId) {
      mounts.get(container)?.destroy();
      const root=document.createElement('div');root.className='pylon-processor-menu';
      container.replaceChildren(root);
      const owner=AppUILifecycle.createViewScope({host:root});
      let latestResult=0;
      const view={destroy:()=>owner.destroy(),ready:null};
      mounts.set(container,view);
      owner.add(()=>{if(mounts.get(container)===view)mounts.delete(container);root.remove();});
      root.textContent='Loading actions'+String.fromCharCode(0x2026);
      view.ready=Promise.all([fetchActions(db,nodeId,{signal:owner.signal}),window.AppUIAssets.load('toolbar')]).then(([actions])=>{
        if(!owner.current())return;
        if(!actions.length){root.textContent='No actions available';return;}
        const controls=document.createElement('div'),historyControls=document.createElement('div');
        const historyPanel=document.createElement('div');historyPanel.id='pylon-history-panel';
        historyPanel.style.cssText='margin-top:4px;padding:4px;border:1px solid var(--border);border-radius:4px;max-height:120px;overflow:auto';
        historyPanel.innerHTML=history.html();
        const result=document.createElement('div');result.id='action-result';result.style.marginTop='6px';
        root.replaceChildren(controls,historyControls,historyPanel,result);
        const toolbar=AppUIToolbar.create({container:controls,title:'Actions',label:'Processor actions'});
        const historyToolbar=AppUIToolbar.create({container:historyControls,label:'Processor history'});
        owner.add(toolbar);owner.add(historyToolbar);
        const historyButton=historyToolbar.append({label:'History'});historyButton.id='pylon-history-toggle';
        owner.add(AppUIDisclosure.bind({trigger:historyButton,panel:historyPanel,expanded:false,
          onToggle:open=>{if(open&&owner.current())historyPanel.innerHTML=history.html();},
        }));
        const refreshHistory=()=>{if(owner.current()&&!historyPanel.hidden)historyPanel.innerHTML=history.html();};
        const buttons=[];
        actions.forEach((action,index)=>{
          const name=String(action.name);
          const button=toolbar.append({label:(action.icon||'')+' '+(action.label||''),
            title:(action.description||action.label||'')+' ['+(index+1)+']',
            action:async()=>{
              if(!owner.current()||button.disabled)return;
              const ticket=++latestResult;
              result.textContent='Running '+name+String.fromCharCode(0x2026);
              button.disabled=true;
              try {
                const value=await runAction(db,nodeId,name);
                history.push(name,nodeId,value);
                if(!owner.current())return;
                if(ticket===latestResult)results.render(result,name,value,owner);
                refreshHistory();
              } catch(error) {
                history.push(name,nodeId,{error:String(error)});
                if(owner.current()) {
                  if(ticket===latestResult)result.textContent='Error: '+String(error);
                  refreshHistory();
                }
              } finally {if(owner.current())button.disabled=false;}
            },
          });
          button.dataset.action=name;button.dataset.actionIndex=String(index);buttons.push(button);
        });
        container.setAttribute('tabindex','-1');
        owner.listen(container,'keydown',event=>{
          if(!owner.current()||event.isComposing||event.repeat||event.ctrlKey||event.metaKey||event.altKey)return;
          if(event.target?.closest?.('input,textarea,select,[contenteditable]'))return;
          const number=Number.parseInt(event.key,10),target=buttons[number-1];
          if(number>=1&&number<=9&&target&&!target.disabled){event.preventDefault();target.click();}
        });
      }).catch(error=>{if(owner.current())root.textContent='Unable to load actions: '+(error.message||String(error));});
      return view;
    }
    return {render};
  }
  return {create};
})();
