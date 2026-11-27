(function(){
  'use strict';
  const app='personal/web-naverblog',base='/v1/apps/'+app+'/';
  let router,tree,form,toolbar,table,detailToolbar,reader,commentsTable,details,notice,poller,refreshPoller,items=[],fingerprint='',generation=0,disposed=false;
  let jobId=localStorage.getItem('web-naverblog.job')||'';
  const node=(tag,text)=>{const el=document.createElement(tag);if(text!=null)el.textContent=text;return el;};
  const request=async(url,args={})=>{const r=await AppUIApi.request(url,args);if(!r.ok)throw new Error(r._error||r.error||'Request failed');return r;};
  const api=(op,args)=>request(base+op,args);
  const tell=text=>{if(!disposed)notice.textContent=text;};
  const shape=row=>({name:row.title,path:row.path,hasChildren:row.has_children});
  const navigate=path=>{if(router.get('path')===path)open(path);else router.set('path',path);};
  async function reveal(path){if(path){await tree?.revealPath(path,{select:false,getChildren:async parent=>(await api('vis_children',{path:parent,page_size:100})).children.map(shape)});if(router?.get('path')===path)tree?.setActive(path);}}
  function updateTree(){if(!tree)return;const blogs=[...new Set(items.map(row=>row.blog_id))].sort();tree.setRoots([{name:'Saved Naver blogs',path:'',hasChildren:blogs.length>0,children:blogs.map(blog=>({name:blog,path:blog,hasChildren:true,badge:String(items.filter(row=>row.blog_id===blog).length)}))}]);reveal(router?.get('path')).catch(error=>tell(error.message));}
  async function refresh(){const r=await api('status');if(disposed)return;const next=JSON.stringify(r.items);if(next!==fingerprint){fingerprint=next;items=r.items;table?.setItems(items);updateTree();}}
  function destroyDetails(){detailToolbar?.destroy();reader?.destroy();commentsTable?.destroy();detailToolbar=reader=commentsTable=null;}
  async function open(path){
    const current=++generation;destroyDetails();details.replaceChildren(node('p','Loading saved post...'));
    try{
      const selected=await api('vis_node',{path});if(disposed||current!==generation)return;
      const parts=path.split('/'),key=parts.slice(0,2).join('/');let bundle;
      if(parts.length>=2){bundle=(await api('get',{path:key})).item;if(disposed||current!==generation)return;}
      details.replaceChildren(node('h2',selected.title),node('p',selected.description));
      const actions=node('div');details.append(actions);
      detailToolbar=AppUIToolbar.create({container:actions,label:'Saved post actions',items:[
        ...(bundle?['article','comments','images','metadata'].map(section=>({label:{article:'Read article',comments:'Comments',images:'Images',metadata:'Post details'}[section],action:()=>navigate(key+'/'+section)})):[]),
        {label:'Copy VIS link',action:event=>AppUICopyButton.copy(event.currentTarget,()=> 'vis://naverblog/'+path)},
        ...(bundle?[{label:'Open original blog post',action:()=>window.open(bundle.url,'_blank','noopener')}]:[])
      ]});
      if(bundle){
        details.append(node('p',[bundle.article.author||bundle.blog_id,bundle.article.publishedText,bundle.capture_status,'Saved '+bundle.updated].filter(Boolean).join(' · ')));
        if(bundle.warnings.length)details.append(node('p','Capture notes: '+bundle.warnings.join(' | ')));
        if(bundle.retained_comments_from)details.append(node('p','Includes previously saved comments from '+bundle.retained_comments_from));
        const section=parts[2]||'article',host=node('div');details.append(host);
        if(section==='article'){
          const blocks=parts.length===4?[bundle.article.blocks[Number(parts[3])]]:bundle.article.blocks;
          reader=AppUIArticle.create({container:host,blocks,imageUrl:block=>bundle.images.find(image=>image.index===block.imageIndex)?.local_url});
        }else if(section==='comments'&&parts.length===3){
          const count=bundle.comment_capture;host.append(node('p',bundle.comments.length+' comments stored · '+(count.reported==null?'Reported total unknown':count.reported+' reported')+' · Requested '+count.requested));
          commentsTable=AppUIDataTable.create({container:host,items:bundle.comments,getId:row=>row.id,maxRows:1000,columns:[{id:'author',label:'Author',sortable:true},{id:'date',label:'Date',sortable:true},{id:'parentId',label:'Reply to'},{id:'text',label:'Comment'}],detailLabel:row=>row.author||'comment',renderDetails:row=>{const text=node('div',row.text||'Private or empty comment');text.style.whiteSpace='pre-wrap';return text;},empty:'No public comments saved.'});
        }else if(section==='images'){
          const images=parts.length===4?[bundle.images[Number(parts[3])]]:bundle.images;
          reader=AppUIArticle.create({container:host,blocks:images.map(image=>({type:'image',local_url:image.local_url,alt:'Image '+image.index+(image.file?'':' · not saved locally')}))});
        }else host.append(node('pre',selected.content));
      }else details.append(node('p',selected.content));
      await reveal(path);if(current===generation)details.scrollIntoView({block:'nearest'});
    }catch(error){if(current===generation){details.replaceChildren(node('p',error.message));tell(error.message);}}
  }
  function rememberJob(value){jobId=value;if(value)localStorage.setItem('web-naverblog.job',value);else localStorage.removeItem('web-naverblog.job');}
  async function tick(){
    if(!jobId||disposed)return;
    try{const r=await request('/v1/apps/platform/work_runner/wait',{job_id:jobId,timeout_s:20}),job=r.job||r;
      if(job.status==='done'){rememberJob('');const value=job.op_result;if(!value?.ok)throw new Error(value?._error||value?.error||'Capture failed');tell('Saved '+value.item.title+' · '+value.item.capture_status);await refresh();navigate(value.item.path+'/article');}
      else if(['error','failed','cancelled'].includes(job.status))throw new Error(job.error||job.status);else tell('Blog capture '+job.status+' · '+jobId);
    }catch(error){rememberJob('');tell(error.message);}
  }
  function mountTree(host){const box=node('div');host.append(box);tree=AppUITree.create({container:box,searchable:true,storageKey:'web-naverblog.tree',onSelect:row=>navigate(row.path),onExpand:(row,done)=>api('vis_children',{path:row.path,page_size:100}).then(r=>done(r.children.map(shape))).catch(error=>{tell(error.message);done([]);})});updateTree();return()=>tree?.destroy();}
  window.AppUIReady.then(()=>AppUI.createApp({id:'personal-web-naverblog',title:'Naver Blog',leftSidebar:{width:310,tabs:[{id:'posts',label:'Blogs',active:true,render:mountTree}]},content:{render(host){
    const fields=node('div'),controls=node('div'),inventory=node('div');notice=node('p');notice.setAttribute('role','status');details=node('section');
    host.append(node('h1','Naver Blog'),details,node('h2','Fetch a post'),node('p','Paste a full public Naver Blog post URL. Article text and selected images are saved locally; public comments and replies report their capture coverage.'),fields,controls,notice,node('h2','Saved posts'),inventory);
    form=AppUIJsonForm.create({container:fields,value:{url:'',max_comments:100,max_images:30}});
    toolbar=AppUIToolbar.create({container:controls,label:'Blog capture controls',items:[{label:'Fetch post',primary:true,action:async()=>{try{if(jobId){tell('A capture is already running.');return;}const r=await request('/v1/apps/platform/work_runner/submit',{kind:'op',app,op:'capture',args:{...form.getValue(),confirm:true},timeout:600,label:'Fetch Naver Blog post',confirm:true});rememberJob(r.job?.id||r.job_id);tell('Capture queued: '+jobId);}catch(error){tell(error.message);}}},{label:'Refresh',action:()=>refresh().catch(error=>tell(error.message))}]});
    table=AppUIDataTable.create({container:inventory,items,getId:row=>row.path,columns:[{id:'title',label:'Post',sortable:true},{id:'author',label:'Author',sortable:true},{id:'published',label:'Published',sortable:true},{id:'images',label:'Local images',sortable:true},{id:'comments',label:'Saved comments',sortable:true},{id:'capture_status',label:'Status',sortable:true},{id:'actions',label:'Actions',actions:row=>[{label:'Read post',action:()=>navigate(row.path+'/article')}]}],empty:'No posts saved yet.'});
    AppUIRouter.alias('personal-web-naverblog','path','path');router=AppUIRouter.create('personal-web-naverblog',()=>open(router.get('path')||''));open(router.get('path')||'');
    refresh().catch(error=>tell(error.message));poller=AppUIPollRefresh.create(tick,2000,{refreshOnVisible:true});poller.start();refreshPoller=AppUIPollRefresh.create(()=>refresh().catch(error=>tell(error.message)),15000,{refreshOnVisible:true});refreshPoller.start();
  }}}));
  window.addEventListener('pagehide',()=>{disposed=true;generation++;poller?.stop();refreshPoller?.stop();router?.destroy();tree?.destroy();form?.destroy();toolbar?.destroy();table?.destroy();destroyDetails();});
})();
