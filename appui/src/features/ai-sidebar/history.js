/* Session history presentation; the chat instance owns session data. */
window._AISidebarHistory=(function(){
  function records(sessions){return (sessions||[]).map(session=>({...session}));}
  function markdown(history){return history.map(message=>'## '+message.role+' ('+(message.timestamp||'')+')\n\n'+message.content+'\n\n---\n').join('\n');}
  function create({container,chat,onSwitch,isCurrent=()=>true}){
    const lifetime=AppUILifecycle.createKeyedScopes({host:container,observeRemoval:false});
    function render(){
      lifetime.destroy('render');
      if(!lifetime.current())return Promise.resolve();
      const root=document.createElement('div');container.replaceChildren(root);
      const owner=lifetime.begin('render',{host:root});
      const current=()=>owner.current()&&isCurrent();
      root.textContent='Loading history...';
      return AppUI.load('toolbar','collections').then(()=>{
        if(!owner.current())return;
        const sessions=records(chat.getSessions?.()||[]);
        const controls=document.createElement('div'),collection=document.createElement('div');
        controls.className='ui-ai-history-controls';root.replaceChildren(controls,collection);
        const toolbar=AppUI.components.Toolbar.create({container:controls,label:'AI history actions',signal:owner.signal,
          title:sessions.length+' session'+(sessions.length===1?'':'s')});
        owner.add(()=>toolbar.destroy());
        toolbar.append({label:'Refresh',action:()=>{if(current())render();}});
        toolbar.append({label:'New chat',action:()=>{if(current()){chat.clear();onSwitch('chat');}}});
        let copying=false,timer=null;
        owner.add(()=>{if(timer!==null)clearTimeout(timer);});
        const exportButton=toolbar.append({label:'Export',action:async()=>{
          if(!current()||copying)return;
          copying=true;exportButton.disabled=true;
          if(timer!==null){clearTimeout(timer);timer=null;}
          try{
            await AppUICore.copyText(markdown(chat.getHistory?.()||[]));
            if(!current())return;
            exportButton.textContent='\u2714 Copied';
            timer=setTimeout(()=>{timer=null;if(current())exportButton.textContent='Export';},2000);
          }catch(error){if(current())exportButton.textContent='Export';}
          finally{copying=false;if(current())exportButton.disabled=false;}
        }});
        toolbar.append({label:'Clear all',action:()=>{if(current()){chat.clearSessions?.();render();}}});
        if(!sessions.length){
          collection.textContent='No saved AI sessions yet.';return;
        }
        const grid=AppUI.components.GridView.create({container:collection,columns:1,viewMode:'grid',persistKey:false,selectable:false,signal:owner.signal,
          renderItem(session,itemScope){
            const entry=document.createElement('button');entry.type='button';
            entry.className='ui-ai-history-entry'+(session.current?' current':'');
            entry.style.cssText='display:block;width:100%;text-align:left;font:inherit;'+(session.current?'border-color:var(--accent);background:var(--bg-hover);':'');
            entry.title='Open this AI session in Chat';
            entry.setAttribute('aria-pressed',String(!!session.current));
            const header=document.createElement('header'),title=document.createElement('b'),time=document.createElement('time'),detail=document.createElement('small');
            title.textContent=String(session.title??'');
            time.dateTime=String(session.updated_at??'');
            time.textContent=session.updated_at!=null&&session.updated_at!==''?new Date(session.updated_at).toLocaleString():'';
            detail.textContent=String(session.message_count??0)+' messages'+(session.current?' \u00b7 current':'');
            header.append(title,time);entry.append(header,detail);
            itemScope.listen(entry,'click',()=>{if(current()&&itemScope.current()&&chat.loadSession?.(session.id))onSwitch('chat');});
            return entry;
          }
        });
        grid.setItems(sessions);owner.add(()=>grid.destroy());
      }).catch(error=>{if(owner.current())root.textContent='Unable to load history: '+(error.message||String(error));});
    }
    return {render,destroy(){lifetime.destroy();}};
  }
  return {create,records,markdown};
})();
