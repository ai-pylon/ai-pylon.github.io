/* Human-operated workspace, no automation operations or credential APIs. */
(() => {
  'use strict';
  const base='/apps/system/cdp/viewer';
  const post=async(action,body)=>{
    try {
      const r=await fetch(base+'/'+action,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      return await r.json();
    }catch(_){return {ok:false,error:'Viewer request unavailable.'};}
  };
  const node=(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;};
  const button=(text,action)=>{const e=node('button',text);e.type='button';e.addEventListener('click',action);return e;};
  const ask=async(message)=>{
    if(window.AppUIDialog&&typeof AppUIDialog.confirmAsync==='function'){try{return await AppUIDialog.confirmAsync(message);}catch(_){}}
    return window.confirm(message);
  };
  function mount(root) {
    root.classList.add('rb-workspace');
    const title=node('div');title.className='rb-heading';
    title.append(node('h1','Remote Browser'),Object.assign(node('span','Human-operated Chromium workspace'),{className:'rb-muted'}));
    const toolbar=node('div');toolbar.className='rb-toolbar';
    const address=node('div');address.className='rb-toolbar rb-address';
    const endpoint=node('select');endpoint.setAttribute('aria-label','Browser endpoint');
    const profile=node('input');profile.value='temporary';profile.maxLength=64;profile.setAttribute('aria-label','Browser profile');
    const graphical=node('input');graphical.type='checkbox';graphical.checked=true;
    const mode=node('label');mode.append(graphical,document.createTextNode('Graphical'));
    const url=node('input');url.type='text';url.inputMode='url';url.autocomplete='off';url.spellcheck=false;url.value='https://example.com/';url.setAttribute('aria-label','Browser address');
    const notice=node('div');notice.className='rb-notice';notice.setAttribute('role','status');notice.setAttribute('aria-live','polite');
    const viewport=node('div');viewport.className='rb-viewport';
    const navigation=node('div');navigation.className='rb-toolbar';
    const tabs=node('select');tabs.setAttribute('aria-label','Browser tabs');
    const quality=node('select');quality.setAttribute('aria-label','Display quality');
    const size=node('select');size.setAttribute('aria-label','Remote viewport');
    function options(el,items){for(const [value,label] of items){const o=node('option',label);o.value=value;el.append(o);}}
    options(quality,[['auto','Auto quality'],['35','Low quality'],['55','Standard quality'],['75','High quality']]);
    options(size,[['small','960 × 640'],['standard','1200 × 800'],['large','1440 × 900']]);size.value='standard';
    const metrics=node('details');metrics.className='rb-metrics';metrics.append(node('summary','Connection diagnostics'));
    const stats=node('div');stats.className='rb-metrics-values';metrics.append(stats);
    let measure=null;
    function resetMetrics(){measure={input:0,frame:0,count:0,bytes:0,last:performance.now(),fps:0,kbps:0,errors:0,skipped:0,w:0,h:0,capture:0,quality:55};}
    resetMetrics();
    function showMetrics(){
      const m=measure,now=performance.now(),dt=(now-m.last)/1000;
      if(dt>=1){m.fps=m.count/dt;m.kbps=m.bytes*8/1000/dt;m.count=0;m.bytes=0;m.last=now;}
      if(!metrics.open)return;
      stats.textContent='HTTP polling · Input RTT '+(m.input?Math.round(m.input)+' ms':'—')+' · Frame RTT '+(m.frame?Math.round(m.frame)+' ms':'—')+' · Capture '+(m.capture?m.capture+' ms':'—')+' · '+m.fps.toFixed(1)+' FPS · '+Math.round(m.kbps)+' kbps (image payload) · '+(m.w?m.w+' × '+m.h:'—')+' · JPEG '+m.quality+' · Unchanged '+m.skipped+' · Errors '+m.errors;
    }
    const avg=(old,v)=>old?old*.75+v*.25:v;
    let view=null,session=null,busy=false;
    const refresh=button('Refresh endpoints',reload);
    const open=button('Open browser',go);
    const close=button('Close browser',end);
    const resume=button('Resume browser',recover);
    const closeExisting=button('Close existing browser',discard);
    const fullscreen=button('Fullscreen',async()=>{
      try{if(document.fullscreenElement)await document.exitFullscreen();else await root.requestFullscreen();}catch(_){notice.textContent='Fullscreen unavailable.';}
    });
    const back=button('← Back',()=>control('back'));
    const forward=button('Forward →',()=>control('forward'));
    const reloadPage=button('Reload',()=>control('reload'));
    const addTab=button('+ Tab',()=>control('new_tab'));
    const closeTab=button('Close tab',()=>control('close_tab',{tab:tabs.value}));
    const refreshTabs=button('Refresh tabs',()=>control('tabs'));
    function updateTabs(list){
      if(!Array.isArray(list))return;
      tabs.replaceChildren();
      for(const tab of list){const o=node('option',tab.label);o.value=tab.id;o.selected=tab.active===true;tabs.append(o);}
    }
    tabs.addEventListener('change',()=>control('switch_tab',{tab:tabs.value}));
    size.addEventListener('change',()=>control('viewport',{size:size.value}));
    async function control(action,extra={}){
      if(busy||!session)return;
      busy=true;sync();const s=session;
      const replace=['new_tab','switch_tab','close_tab','viewport','back','forward','reload'].includes(action);
      try{
        if(replace&&view){view.destroy();view=null;}
        const r=await post('controls',{session:s,action,...extra});
        if(!r.ok){notice.textContent=r.error||'Browser control failed.';return;}
        updateTabs(r.tabs);notice.textContent=r.boundary?'No more navigation history.':'Browser control completed.';
      }finally{
        if(replace&&session===s&&!view)mountViewer();
        busy=false;sync();
      }
    }
    function sync(){
      for(const e of [endpoint,profile,graphical,refresh])e.disabled=busy||!!session;
      url.disabled=open.disabled=busy;open.textContent=session?'Go':'Open browser';
      close.disabled=busy||!session;
      resume.disabled=closeExisting.disabled=busy||!!session||!endpoint.value;
      for(const el of [back,forward,reloadPage,addTab,refreshTabs,size,quality,tabs,closeTab])el.disabled=busy||!session;
      closeTab.disabled=busy||!session||tabs.options.length<2;
      viewport.style.pointerEvents=busy?'none':'';
    }
    async function reload(){
      if(busy||session)return;busy=true;sync();
      try {
        const selected=endpoint.value,r=await post('endpoints',{});
        if(!r.ok){notice.textContent=r.error||'Endpoint discovery unavailable.';return;}
        endpoint.replaceChildren();
        for(const ep of r.endpoints||[]){
          const o=node('option',ep.id+(ep.graphical?' · graphical capable':''));o.value=ep.id;o.dataset.graphical=String(ep.graphical===true);endpoint.append(o);
        }
        if([...endpoint.options].some(o=>o.value===selected))endpoint.value=selected;
        notice.textContent=endpoint.options.length?'Choose a browser profile and address.':'No interactive Linux browser endpoint connected.';
      }finally{busy=false;sync();}
    }
    function addressTarget(){
      let raw=url.value.trim();
      if(!raw||raw.length>8192||/[\x00-\x20]/.test(raw))throw Error();
      if(!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)&&!/^([a-z][a-z0-9+.-]*:)(?![0-9])/i.test(raw))raw='https://'+raw;
      const target=new URL(raw);
      if(!['http:','https:'].includes(target.protocol)||target.username||target.password)throw Error();
      return target;
    }
    async function go(){
      if(busy)return;
      if(!session)return start();
      let target;
      try{target=addressTarget();}catch(_){notice.textContent='Enter a valid HTTP or HTTPS address without embedded credentials.';return;}
      busy=true;sync();
      try{
        const r=await post('navigate',{session,url:target.href});
        if(!r.ok){notice.textContent=r.error||'Navigation failed.';return;}
        url.value=target.href;
        if(view){view.destroy();view=null;mountViewer();}
        notice.textContent='Navigation requested · '+target.origin;
      }finally{busy=false;sync();}
    }
    function attach(r){
        session=r.session;
        if(r.profile)profile.value=r.profile;
        graphical.checked=r.graphical===true;
        resetMetrics();mountViewer();
        notice.textContent=(r.graphical?'Graphical':'Headless')+' browser connected · '+endpoint.value+' · '+profile.value;
        const s=session;
        post('controls',{session:s,action:'tabs'}).then(x=>{if(session===s&&x.ok){updateTabs(x.tabs);sync();}});
    }
    function mountViewer(){
        const transport={open:()=>Promise.resolve({ok:true,session}),input:async(s,kind,payload)=>{
          const start=performance.now(),r=await post('input',{session:s,kind,payload});
          if(session===s){measure.input=avg(measure.input,performance.now()-start);if(!r.ok)measure.errors++;showMetrics();}
          return r;
        },shot:async(s,etag)=>{
          const start=performance.now();
          const q=quality.value==='auto'?(measure.frame>800?35:55):Number(quality.value);
          const r=await post('shot',{session:s,etag,quality:q});
          if(session===s){
            const m=measure;m.frame=avg(m.frame,performance.now()-start);m.quality=q;
            if(r.img){m.count++;m.bytes+=Math.floor(r.img.length*.75);}
            if(r.unchanged)m.skipped++;
            if(!r.ok)m.errors++;
            if(r.w&&r.h){m.w=r.w;m.h=r.h;}
            if(Number.isFinite(r.capture_ms))m.capture=r.capture_ms;
            showMetrics();
          }
          return r;
        },stop:()=>Promise.resolve({ok:true}),stream:()=>{throw Error('Use private POST polling');}};
        view=AppUIRemoteBrowserViewer.create({container:viewport,session,transport,title:'Remote Browser',why:'Click, drag or type in the browser.',allowHeadful:false,primeShots:0,maxImgVh:0,stopOnClose:false,statefulPointer:true});
        const relay=view.el.querySelector('input');if(relay){relay.autocomplete='off';relay.spellcheck=false;relay.autocapitalize='off';}
    }
    async function recover(){
      if(busy||session||!endpoint.value)return;
      busy=true;sync();
      try{
        if(!await ask('Resume your existing browser on '+endpoint.value+'? Other viewer tabs will disconnect.'))return;
        await AppUIAssets.load('remoteBrowserViewer');
        const r=await post('resume',{endpoint:endpoint.value,confirm:true});
        if(!r.ok||typeof r.session!=='string'){notice.textContent=r.error||'No recoverable browser.';return;}
        attach(r);
      }catch(_){if(view){view.destroy();view=null;}session=null;notice.textContent='Viewer initialization failed. Resume again or close the existing browser.';}
      finally{busy=false;sync();}
    }
    async function discard(){
      if(busy||session||!endpoint.value)return;
      busy=true;sync();
      try{
        if(!await ask('Close your existing browser on '+endpoint.value+'? Temporary browsing data and open tabs will be lost.'))return;
        const r=await post('close_existing',{endpoint:endpoint.value,confirm:true});
        notice.textContent=r.ok?'Existing browser closed.':r.error||'Close failed.';
      }finally{busy=false;sync();}
    }
    async function start(){
      if(busy||session)return;
      let target;
      try{target=addressTarget();}
      catch(_){notice.textContent='Enter an HTTP or HTTPS address without embedded credentials.';return;}
      if(!endpoint.value){notice.textContent='Select a connected endpoint.';return;}
      if(graphical.checked&&endpoint.selectedOptions[0]?.dataset.graphical!=='true'){notice.textContent='This endpoint does not advertise graphical support.';return;}
      const name=profile.value.trim()||'temporary';
      if(!/^[a-z][a-z0-9-]{0,31}$/.test(name)){notice.textContent='Use 1–32 lowercase letters, digits or hyphens, starting with a letter.';return;}
      const req={endpoint:endpoint.value,url:target.href,profile:name,graphical:graphical.checked,confirm:true};
      const label=req.graphical?'graphical':'headless';
      busy=true;sync();
      try{
        if(!await ask('Open '+label+' browser on '+req.endpoint+'? Named profiles retain website sessions on that device.'))return;
        notice.textContent='Opening browser…';
        await AppUIAssets.load('remoteBrowserViewer');
        let r=await post('open',req);
        if(!r.ok&&r.code==='mode_conflict'){
          if(!await ask('Restart the idle browser in '+label+' mode? Existing tabs will close; temporary browsing data will be discarded. Named profile data is retained.')){notice.textContent=r.error;return;}
          r=await post('open',{...req,restart_idle:true});
        }
        if(!r.ok&&r.code==='viewer_active'){
          if(!await ask('A browser is already active. Resume your existing workspace instead? Other viewer tabs will disconnect.')){notice.textContent=r.error;return;}
          r=await post('resume',{endpoint:req.endpoint,confirm:true});
        }
        if(!r.ok||typeof r.session!=='string'){notice.textContent=r.error||'Browser could not open.';return;}
        if(!r.profile)r.profile=name;
        attach(r);
      }catch(_){
        const hadSession=!!session;
        if(view){view.destroy();view=null;}
        session=null;
        notice.textContent=hadSession?'Viewer initialization failed. Use Resume browser or Close existing browser.':'Viewer unavailable.';
      }finally{busy=false;sync();}
    }
    async function end(){
      if(busy||!session)return;
      busy=true;sync();
      try{
        const r=await post('stop',{session});
        if(!r.ok){notice.textContent=r.error||'Close failed; retry.';return;}
        if(view)view.destroy();view=null;session=null;
        tabs.replaceChildren();resetMetrics();showMetrics();notice.textContent='Browser closed.';
      }finally{busy=false;sync();}
    }
    // Detach on refresh; the daemon idle deadline releases abandoned sessions.
    window.addEventListener('pagehide',()=>{if(view){view.destroy();view=null;}});
    endpoint.addEventListener('change',sync);
    url.addEventListener('keydown',e=>{if(e.key==='Enter')go();});
    toolbar.append(endpoint,refresh,node('span','Profile'),profile,mode,resume,closeExisting,close,fullscreen);
    address.append(url,open);
    navigation.append(back,forward,reloadPage,tabs,addTab,closeTab,refreshTabs,size,quality);
    root.append(title,toolbar,navigation,address,notice,metrics,viewport);
    metrics.addEventListener('toggle',showMetrics);sync();reload();
  }
  window.AppUIReady.then(()=>{
    AppUI.createApp({id:'system-remote-browser',title:'Remote Browser',content:{render:mount},statusbar:{}});
  }).catch(()=>{document.getElementById('app-content-body').textContent='AppUI failed to load.';});
})();
