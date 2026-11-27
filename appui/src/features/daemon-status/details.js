/* Service-status details use a disposable shared table and literal snapshots. */
window._AppUIDaemonStatusDetails = (() => {
  function records(statuses) {
    return statuses.map(status => ({label:status.label,state:status.state,
      endpoint:status.url || status.error,
      checked:status.checkedAt ? status.checkedAt.toLocaleTimeString() : 'Not checked'}));
  }
  function show({statuses,label,parent}) {
    const details = statuses.map(status => `${status.label}\n${JSON.stringify(status.data || {error:status.error},null,2)}`).join('\n\n');
    if (typeof AppUIDialog === 'undefined') {window.alert(details);return;}
    const root=document.createElement('div'),tableHost=document.createElement('div'),pre=document.createElement('pre');
    root.className='appui-daemon-dialog';pre.textContent=details;root.append(tableHost,pre);
    const rows=records(statuses),scope=AppUILifecycle.createViewScope({host:root,parent,pagehide:false});
    const dialog=AppUIDialog.show({title:`${label || 'Service'} status`,body:root,width:'720px',signal:scope.signal,onClose:()=>scope.destroy()});
    if (!dialog) {scope.destroy();return;}
    AppUI.load('dataTable').then(()=>{
      if (!scope.current()) return;
      scope.add(AppUI.components.DataTable.create({container:tableHost,items:rows,signal:scope.signal,
        columns:[{id:'label',label:'Service'},{id:'state',label:'Status',render(row){
          const span=document.createElement('span');span.textContent=row.state;
          span.className=row.state==='online'?'appui-daemon-online':'appui-daemon-offline';return span;
        }},{id:'endpoint',label:'Endpoint / error'},{id:'checked',label:'Checked'}]}));
    }).catch(error=>{if(scope.current())tableHost.textContent='Unable to load service details: '+(error.message || error);});
    return dialog;
  }
  return {records,show};
})();
