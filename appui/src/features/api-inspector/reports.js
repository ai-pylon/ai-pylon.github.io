/* Inspector report snapshots and disposable shared DataTable views. */
window._AppUIApiInspectorReports=(function(){
  function networkRecords(entries){
    return entries.slice(-50).map((entry,id)=>({
      id,status:entry.isEvent?'EVT':(entry.status||'ERR'),duration:entry.durationMs,
      size:entry.size,request:String(entry.method||'')+' '+String(entry.url||''),
      fullUrl:String(entry.fullUrl||''),warning:String(entry.warning||''),
      color:entry.isEvent?'var(--accent)':entry.status>=400?'var(--color-error)':entry.durationMs>1000?'var(--color-warning)':'var(--color-success)'
    }));
  }
  function eventRecords(entries){
    return entries.filter(entry=>entry.isEvent).slice(-50).map((entry,id)=>({
      id,time:new Date(entry.startMs).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'}),
      event:String(entry.url||''),size:entry.size
    }));
  }
  function summaryRecords(entries){
    const groups=new Map();
    for(const entry of entries){
      const url=String(entry.url||'');
      if(!groups.has(url))groups.set(url,{id:url,url,count:0,totalMs:0,totalSize:0,warnings:0});
      const group=groups.get(url);group.count++;group.totalMs+=entry.durationMs;group.totalSize+=entry.size;
      if(entry.warning)group.warnings++;
    }
    return [...groups.values()].sort((a,b)=>b.count-a.count).map(group=>({...group,average:Math.round(group.totalMs/group.count)}));
  }
  function text(value,color,title){
    const node=document.createElement('span');node.textContent=String(value??'');
    if(color)node.style.color=color;if(title)node.title=title;
    return node;
  }
  function create({container}){
    const lifetime=AppUILifecycle.createKeyedScopes({host:container});
    let view,table,displayMode,heading;
    function render(entries,mode='network'){
      if(!lifetime.current())return Promise.resolve();
      const wasAtBottom=container.scrollTop+container.clientHeight>=container.scrollHeight-10;
      const total=entries.length;
      const items=mode==='summary'?summaryRecords(entries):mode==='events'?eventRecords(entries):networkRecords(entries);
      const summaryTitle='Summary ('+total+' calls, '+items.length+' endpoints)';
      if(table&&view?.current()&&displayMode===mode){
        table.setItems(items);if(heading)heading.textContent=summaryTitle;
        if(wasAtBottom)container.scrollTop=container.scrollHeight;
        return Promise.resolve();
      }
      lifetime.destroy('render');heading=null;displayMode=mode;
      const root=document.createElement('div');container.replaceChildren(root);
      const owner=lifetime.begin('render',{host:root});view=owner;
      root.textContent='Loading report...';
      return AppUI.load('dataTable').then(()=>{
        if(!owner.current())return;
        root.replaceChildren();
        if(mode==='summary'){
          heading=document.createElement('div');heading.style.cssText='padding:4px 8px;color:var(--accent)';
          heading.textContent=summaryTitle;root.appendChild(heading);
        }
        const tableHost=document.createElement('div');root.appendChild(tableHost);
        const columns=mode==='summary'?[
          {id:'count',label:'Calls',width:'60px',render:row=>text(row.count+'x',row.count>5?'var(--color-warning)':'')},
          {id:'average',label:'Average',width:'80px',render:row=>row.average+'ms avg'},
          {id:'url',label:'Endpoint'},
          {id:'warnings',label:'Warnings',width:'75px'}
        ]:mode==='events'?[
          {id:'time',label:'Time',width:'90px'},{id:'event',label:'Event'},{id:'size',label:'Bytes',width:'60px'}
        ]:[
          {id:'status',label:'Status',width:'60px',render:row=>text(row.status,row.color)},
          {id:'duration',label:'Time',width:'65px',render:row=>row.duration?row.duration+'ms':'...'},
          {id:'size',label:'Size',width:'60px',render:row=>row.size?(row.size/1024).toFixed(1)+'k':''},
          {id:'request',label:'Request',render:row=>text(row.request,'',row.fullUrl)},
          {id:'warning',label:'Warning',render:row=>text(row.warning,'var(--color-warning)')}
        ];
        table=AppUI.components.DataTable.create({container:tableHost,items,columns,getId:row=>row.id,
          maxRows:Number.MAX_SAFE_INTEGER,virtualScroll:false,signal:owner.signal,
          empty:mode==='events'?'No AppUIEventBus events captured yet.':'No API calls captured yet.'});
        const mountedTable=table;
        owner.add(()=>{mountedTable.destroy();if(table===mountedTable)table=null;});
        if(wasAtBottom)container.scrollTop=container.scrollHeight;
      }).catch(error=>{if(owner.current())root.textContent='Unable to load report: '+(error.message||String(error));});
    }
    return {render,destroy(){lifetime.destroy();}};
  }
  return {create,networkRecords,eventRecords,summaryRecords};
})();
