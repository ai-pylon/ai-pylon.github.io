(function () {
  'use strict';
  let router, tree, table, form, toolbar, detailToolbar, poller, jobPoller, notice, details, localItems=[], remoteItems=[], jobId='', disposed=false, selection=0, treeFingerprint=null;
  const base='/v1/apps/personal/web-youtube/';
  const node=(tag,text)=>{const el=document.createElement(tag);if(text)el.textContent=text;return el;};
  async function request(url,args={}) {const result=await AppUIApi.request(url,args);if(!result.ok)throw new Error(result._error||result.error||'Request failed');return result;}
  const api=(op,args)=>request(base+op,args);
  function message(text) {if(!disposed)notice.textContent=text;}
  function localNode(row) {return {name:row.title,path:row.video_id,hasChildren:true,data:row,badge:row.state};}
  function refreshTree() {if(!tree)return;const fingerprint=JSON.stringify(localItems.map(row=>[row.video_id,row.sha256]));if(fingerprint===treeFingerprint)return;treeFingerprint=fingerprint;tree.setRoots([{name:'Local YouTube library',path:'',hasChildren:true,badge:String(localItems.length),children:localItems.map(localNode)}]);if(router?.get('path'))tree.revealPath(router.get('path'),{getChildren:async parent=>(await api('vis_children',{path:parent})).children.map(treeNode)}).catch(error=>message(error.message));}
  async function refresh() {
    const results=await Promise.allSettled([api('status'),api('remote_list')]);
    if(disposed)return;
    if(results[0].status==='fulfilled') {localItems=results[0].value.items||[];refreshTree();}
    if(results[1].status==='fulfilled') {remoteItems=results[1].value.items||[];table.setItems(remoteItems);}
    const failed=results.find(result=>result.status==='rejected');if(failed)message(failed.reason.message);
  }
  function navigate(path) {
    if(router.get("path")===path)openNode(path);else router.set("path",path);
  }
  const treeNode=child=>({name:child.title,path:child.path,hasChildren:child.has_children,data:child,badge:child.badge});
  async function openNode(path) {
    const current=++selection;tree?.setActive(path);
    details.replaceChildren(node("p","Loading selected item..."));
    try {
      const item=await api('vis_node',{path});if(disposed||current!==selection)return;
      detailToolbar?.destroy();details.replaceChildren(node('h3',item.title),node('p',item.description));
      const controls=node('div');details.append(controls,node('p','vis://youtube/'+path),node('pre',item.content||''),node('pre',JSON.stringify(item.attributes||{},null,2)));
      details.scrollIntoView({block:'start'});
      detailToolbar=AppUIToolbar.create({container:controls,label:'Selected YouTube node controls',items:[
        {label:'Copy VIS link',action:event=>AppUICopyButton.copy(event.currentTarget,()=> 'vis://youtube/'+path)},
        ...(item.attributes.source_url?[...(item.attributes.source_url ? [{label:'Open original YouTube',action:()=>window.open(item.attributes.source_url,'_blank','noopener')}] : [])]:[])
      ]});
      await tree?.revealPath(path,{getChildren:async parent=>(await api('vis_children',{path:parent})).children.map(treeNode)});
    }catch(error){if(current===selection){details.replaceChildren(node('p',error.message));message(error.message);}}
  }
  async function fetchLocal(row) {
    if(jobId){message('Wait for the current local fetch.');return;}
    try {
      const result=await request('/v1/apps/platform/work_runner/submit',{kind:'op',app:'personal/web-youtube',op:'fetch',args:{video_id:row.video_id,confirm:true},timeout:600,label:'Fetch YouTube '+row.video_id,confirm:true});
      jobId=result.job?.id||result.job_id;message('Local fetch queued: '+jobId);
    }catch(error){message(error.message);}
  }
  async function tickJob() {
    if(!jobId||disposed)return;
    try {
      const result=await request('/v1/apps/platform/work_runner/wait',{job_id:jobId,timeout_s:20});const job=result.job||result;
      if(job.status==='done') {const value=job.op_result;if(!value?.ok)throw new Error(value?._error||value?.error||'Local fetch failed');message('Available locally at '+value.uri);jobId='';await refresh();tree.expandAll();}
      else if(['error','failed','cancelled'].includes(job.status))throw new Error(job.error||job.status);
    }catch(error){jobId='';message(error.message);}
  }
  function mountTree(host) {
    treeFingerprint=null;const box=node('div');host.append(node('p','Local videos, transcripts and comments'),box);
    tree=AppUITree.create({container:box,searchable:true,searchPlaceholder:'Search saved videos...',storageKey:'web-youtube.tree',
      onSelect:item=>navigate(item.path),onExpand:(item,done)=>api('vis_children',{path:item.path}).then(result=>done(result.children.map(treeNode))).catch(error=>{message(error.message);done([]);})});
    refreshTree();
    return ()=>tree?.destroy();
  }
  window.AppUIReady.then(()=>AppUI.createApp({id:'personal-web-youtube',title:'YouTube Library',leftSidebar:{width:320,tabs:[{id:'library',label:'YouTube',active:true,render:mountTree}]},content:{render(el){
    const fields=node('div'),controls=node('div'),inventory=node('div');details=node('section');notice=node('p');notice.setAttribute('role','status');
    el.append(node('h2','YouTube Library'),node('p','Capture YouTube information on Google VM, fetch a local copy, and browse it through vis://youtube. Captures report partial or unavailable transcripts/comments explicitly.'),details,fields,controls,notice,node('h3','VM captures'),inventory);
    form=AppUIJsonForm.create({container:fields,value:{url:'',backend:'auto',max_comments:100}});
    toolbar=AppUIToolbar.create({container:controls,label:'YouTube library controls',items:[
      {label:'Capture on VM',primary:true,action:async()=>{try{const result=await api('capture',{...form.getValue(),confirm:true});message('VM capture queued: '+result.job_id+' | '+result.video_id);await refresh();}catch(error){message(error.message);}}},
      {label:'Refresh',action:refresh}
    ]});
    table=AppUIDataTable.create({container:inventory,items:[],getId:row=>row.video_id,columns:[
      {id:'title',label:'Video',sortable:true},{id:'channel',label:'Channel',sortable:true},{id:'state',label:'VM status',sortable:true},
      {id:'caption_tracks',label:'Transcripts',sortable:true},{id:'comment_count',label:'Comments',sortable:true},
      {id:'local',label:'Local copy',render:row=>row.local ? row.local_sha256===row.sha256 ? 'Up to date' : 'Update available' : 'Not fetched'},
      {id:'warnings',label:'Capture notes',render:row=>(row.warnings||[]).join(' | ')},
      {id:'actions',label:'Actions',actions:row=>[
        ...(['complete','partial'].includes(row.state)?[{label:'Fetch locally',action:()=>fetchLocal(row)}]:[]),
        ...(row.local?[{label:'Read local copy',action:()=>navigate(row.video_id)}]:[])
      ]}
    ],empty:'No captures on the VM yet. Enter a YouTube URL above or share one with the connected MCP client.'});
    AppUIRouter.alias('personal-web-youtube','path','path');
    router=AppUIRouter.create('personal-web-youtube',()=>openNode(router.get('path')||''));
    openNode(router.get('path')||'');
    poller=AppUIPollRefresh.create(refresh,15000,{refreshOnVisible:true});poller.start();
    jobPoller=AppUIPollRefresh.create(tickJob,2500,{refreshOnVisible:true});jobPoller.start();refresh();
  }}}));
  window.addEventListener('pagehide',()=>{disposed=true;selection++;router?.destroy();poller?.stop();jobPoller?.stop();tree?.destroy();table?.destroy();form?.destroy();toolbar?.destroy();detailToolbar?.destroy();});
})();
