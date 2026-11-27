
var APP="file/gdrive";
var FOLDER='application/vnd.google-apps.folder';
var stack=[{id:'root',name:'My Drive'}];
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
async function api(op,body){var r=await fetch("/v1/apps/"+APP+"/"+op,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body||{})});return await r.json();}
function kb(n){n=parseInt(n||0,10);if(!n)return'';if(n<1024)return n+' B';if(n<1048576)return (n/1024).toFixed(1)+' KB';if(n<1073741824)return (n/1048576).toFixed(1)+' MB';return (n/1073741824).toFixed(2)+' GB';}
function msg(id,t,k){document.getElementById(id).innerHTML=t?('<div class="msg '+(k||'ok')+'">'+esc(t)+'</div>'):'';}

function dot(ok,warn){return '<span class="dot '+(ok?'on':(warn?'warn':'off'))+'"></span>';}
async function loadStatus(){
  var box=document.getElementById('status');box.innerHTML='<span class="muted">Checking…</span>';
  var r=await api('status',{});
  if(!r.ok){msg('statusMsg',r._error||'status failed','err');box.innerHTML='';return;}
  box.innerHTML=
    '<div><b>Libraries</b>'+dot(r.libraries_installed)+(r.libraries_installed?'installed':'missing')+'</div>'+
    '<div><b>Credentials</b>'+dot(r.credentials_configured)+(r.credentials_configured?('configured ('+esc(r.credentials_source||'')+')'):'not set')+'</div>'+
    '<div><b>Auth mode</b>'+esc(r.auth_mode||'oauth')+'</div>'+
    '<div><b>Authenticated</b>'+dot(r.authenticated,!r.authenticated&&r.credentials_configured)+(r.authenticated?'yes':'no')+'</div>';
  document.getElementById('sub').textContent=r.authenticated?'connected':'not connected';
  var authBtn=document.getElementById('authBtn');
  // offer authenticate when libs+creds are present but we're not authed yet
  authBtn.style.display=(r.libraries_installed&&r.credentials_configured&&!r.authenticated)?'':'none';
  if(r.auth_error&&!r.authenticated)msg('statusMsg',r.auth_error,r.credentials_configured?'err':'ok');
  else if(!r.credentials_configured)msg('statusMsg','No OAuth client-secrets found — paste your client_secrets.json below to set it up in-app. (A config.json credentials_path also works.)','ok');
  else msg('statusMsg','');
  // show the paste-to-setup card only while credentials are not yet configured
  document.getElementById('setupCard').style.display=r.credentials_configured?'none':'';
  if(r.authenticated){stack=[{id:'root',name:'My Drive'}];openFolder();}
  else document.getElementById('filesCard').style.display='none';
}
document.getElementById('autoSetupBtn').onclick=async function(){
  this.disabled=true;this.textContent='Searching…';msg('setupMsg','');
  var r=await api('auto_setup',{confirm:true});
  this.disabled=false;this.textContent='Set up automatically';
  if(r.ok){msg('setupMsg','Found a '+esc(r.kind)+' credential ('+esc(r.source_path||'')+'). '+esc(r.next||''),'ok');loadStatus();}
  else msg('setupMsg',r._error||'auto-setup failed','err');
};
document.getElementById('saveSecretsBtn').onclick=async function(){
  var box=document.getElementById('secretsBox');var txt=(box.value||'').trim();
  if(!txt){msg('setupMsg','Paste your client_secrets.json contents first.','err');return;}
  this.disabled=true;this.textContent='Saving…';msg('setupMsg','');
  var r=await api('set_client_secrets',{client_secrets:txt,confirm:true});
  this.disabled=false;this.textContent='Save client secret';
  if(r.ok){box.value='';msg('setupMsg','Client secret stored in the vault.','ok');loadStatus();}
  else msg('setupMsg',r._error||'save failed','err');
};
document.getElementById('authBtn').onclick=async function(){
  this.disabled=true;this.textContent='Opening consent…';msg('statusMsg','A Google consent tab will open — approve it and this completes automatically (no paste).','ok');
  var r=await api('authenticate',{confirm:true});
  if(!r.ok){this.disabled=false;this.textContent='Authenticate';
    // fall back to the manual paste flow if the automated capture can't start
    var u=await api('auth_url',{});
    if(u.ok){var link=document.getElementById('consentLink');link.href=u.auth_url;document.getElementById('authFlow').style.display='';try{window.open(u.auth_url,'_blank','noopener');}catch(e){}msg('statusMsg','Auto-consent unavailable; use the manual steps below.','ok');}
    else msg('statusMsg',r._error||u._error||'authenticate failed','err');
    return;}
  // poll until the background loopback capture finishes
  var self=this;var tries=0;
  var poll=setInterval(async function(){
    tries++;var s=await api('auth_status',{});
    if(s.status==='authenticated'){clearInterval(poll);self.disabled=false;self.textContent='Authenticate (in-app)';msg('statusMsg','Authenticated.','ok');loadStatus();}
    else if(s.status==='error'){clearInterval(poll);self.disabled=false;self.textContent='Authenticate (in-app)';msg('statusMsg',s.error||'consent failed','err');}
    else if(tries>150){clearInterval(poll);self.disabled=false;self.textContent='Authenticate (in-app)';msg('statusMsg','Timed out waiting for consent.','err');}
  },2000);
};
document.getElementById('completeAuthBtn').onclick=async function(){
  var code=(document.getElementById('codeBox').value||'').trim();
  if(!code){msg('statusMsg','Paste the redirected URL (or the code) first.','err');return;}
  this.disabled=true;this.textContent='Completing…';
  var r=await api('auth_exchange',{code:code,confirm:true});
  this.disabled=false;this.textContent='3. Complete sign-in';
  if(r.ok){document.getElementById('authFlow').style.display='none';document.getElementById('codeBox').value='';msg('statusMsg','Authenticated.','ok');loadStatus();}
  else msg('statusMsg',r._error||'sign-in failed','err');
};
function crumbs(){
  var c=document.getElementById('crumbs');c.innerHTML='';
  stack.forEach(function(f,i){
    if(i)c.insertAdjacentHTML('beforeend','<span> / </span>');
    if(i<stack.length-1)c.insertAdjacentHTML('beforeend','<a data-i="'+i+'">'+esc(f.name)+'</a>');
    else c.insertAdjacentHTML('beforeend','<span style="color:var(--text)">'+esc(f.name)+'</span>');
  });
  c.querySelectorAll('a').forEach(function(a){a.onclick=function(){stack=stack.slice(0,+a.dataset.i+1);openFolder();};});
}
async function openFolder(){
  document.getElementById('filesCard').style.display='';
  crumbs();msg('filesMsg','');
  var tb=document.querySelector('#files tbody');tb.innerHTML='';
  document.getElementById('filesSub').textContent='loading…';
  var cur=stack[stack.length-1];
  var r=await api('list',{folder:cur.id,page_size:200});
  if(!r.ok){msg('filesMsg',r._error||'list failed','err');document.getElementById('filesSub').textContent='';return;}
  var files=(r.files||[]).slice().sort(function(a,b){
    var af=a.mimeType===FOLDER,bf=b.mimeType===FOLDER;
    if(af!==bf)return af?-1:1;return (a.name||'').localeCompare(b.name||'');});
  document.getElementById('filesSub').textContent=files.length+' item'+(files.length===1?'':'s');
  if(!files.length)msg('filesMsg','(empty)','ok');
  files.forEach(function(f){
    var isF=f.mimeType===FOLDER;
    var tr=document.createElement('tr');
    var nameHtml=isF?'<span class="ic">📁</span><span class="folder">'+esc(f.name)+'</span>':'<span class="ic">📄</span>'+esc(f.name);
    tr.innerHTML='<td class="name">'+nameHtml+'</td>'+
      '<td class="muted">'+esc(isF?'folder':(f.mimeType||'').split('.').pop())+'</td>'+
      '<td class="sz">'+(isF?'':kb(f.size))+'</td>';
    if(isF){tr.querySelector('.folder').onclick=function(){stack.push({id:f.id,name:f.name});openFolder();};}
    tb.appendChild(tr);
  });
}
document.getElementById('refreshStatus').onclick=loadStatus;
loadStatus();

// Saved pairs reuse AppUI's structured form and the platform background runner.
(async function setupSync() {
  var select=document.getElementById('syncProfiles'), form, pairs=[], current=null;
  var job=null, polling=false, directions={'Local → Drive':'upload','Drive → local':'download','Two-way':'two_way'};
  var defaults='';
  var busy=false;
  function message(t,bad){msg('syncMsg',t,bad?'err':'ok');}
  function setBusy(value){busy=value;['syncRun','syncSave','syncPreview','syncProfiles'].forEach(function(id){document.getElementById(id).disabled=value;});document.getElementById('syncStop').disabled=!value;}
  function show(pair){
    current=pair||null;
    var mode=Object.keys(directions).find(function(k){return directions[k]===(pair?pair.mode:'upload');});
    form.setValue({'Name':pair?pair.name:'pylon-server','Local project folder':pair?pair.local_path:defaults,
      'Drive folder ID (blank to create)':pair?pair.drive_folder_id:'',
      'New Drive folder name':pair?pair.folder_name:'pylon-server','Direction':mode});
    document.getElementById('syncDetails').textContent='';
    var link=document.getElementById('syncDriveLink');link.hidden=!(pair&&pair.drive_folder_id);
    if(!link.hidden)link.href='https://drive.google.com/drive/folders/'+encodeURIComponent(pair.drive_folder_id);
  }
  async function refresh(id){
    var r=await api('sync.profiles',{});if(!r.ok)throw Error(r._error||'Could not load saved pairs');
    defaults=r.default_local_path;pairs=r.profiles||[];
    select.innerHTML='<option value="">New pair</option>'+pairs.map(function(p){return '<option value="'+esc(p.id)+'">'+esc(p.name)+' — '+esc(p.mode)+'</option>';}).join('');
    select.value=id||'';show(pairs.find(function(p){return p.id===id;}));
  }
  async function savePair(){
    var v=form.getValue();var r=await api('sync.save',{id:current?current.id:'',name:v.Name,
      local_path:v['Local project folder'],drive_folder_id:v['Drive folder ID (blank to create)'],
      folder_name:v['New Drive folder name'],mode:directions[v.Direction],confirm:true});
    if(!r.ok)throw Error(r._error||'Save failed');await refresh(r.profile.id);return r.profile;
  }
  async function poll(){
    if(polling||!current)return;polling=true;
    try{
      // ROUND3 #9: long-poll the job first (wait returns at completion or after
      // 2 s), then read the sync status so the counters shown are fresh.
      var j=null;
      if(job){j=await fetch('/v1/apps/platform/work_runner/wait',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({job_id:job,timeout_s:2})}).then(function(x){return x.json();});
        if(!j.ok)throw Error(j._error||'Job status failed');}
      var r=await api('sync.status',{profile_id:current.id});if(!r.ok)throw Error(r._error||'Status failed');
      var active=r.running;
      if(j){
        active=active||['queued','pending','running'].indexOf(j.job.status)>=0;
        if(!active&&j.job.status==='error'&&['done','stopped','error'].indexOf(r.phase)<0)throw Error(j.job.stderr||j.job.error||'Sync job failed');}
      setBusy(active);
      message((active?'Syncing':r.phase)+' · '+(r.completed||0)+' / '+(r.total||0)+' transfers · '+(r.uploaded||0)+' uploaded · '+(r.downloaded||0)+' downloaded · '+(r.skipped||0)+' skipped · '+(r.conflicts||[]).length+' conflicts',r.phase==='error'||r.sync_ok===false);
      document.getElementById('syncDetails').textContent=[r._error||'',r.current||''].concat((r.conflicts||[]).slice(0,30).map(function(c){return 'Conflict: '+c.path+' — '+c.reason;}),(r.errors||[]).slice(0,30).map(function(e){return e.path+' — '+e.error;}),(r.vanished||[]).slice(0,30).map(function(p){return 'Skipped removed source: '+p;})).filter(Boolean).join('\n');
      if(r.folder_id){var link=document.getElementById('syncDriveLink');link.href='https://drive.google.com/drive/folders/'+encodeURIComponent(r.folder_id);link.hidden=false;}
      if(active)setTimeout(poll,j&&['done','error','cancelled'].indexOf(j.job.status)<0?100:1500);else {job=null;if(r.phase==='done'){var details=document.getElementById('syncDetails').textContent;await refresh(current.id);document.getElementById('syncDetails').textContent=details;}}
    }catch(e){message(e.message,true);setBusy(false);}finally{polling=false;}
  }
  try{
    await AppUIAssets.load('previewEditors');
    form=AppUIJsonForm.create({container:document.getElementById('syncForm'),value:{},schema:{properties:{Direction:{enum:Object.keys(directions)}}}});
    await refresh();
    select.onchange=async function(){job=null;show(pairs.find(function(p){return p.id===select.value;}));if(current)await poll();};
    document.getElementById('syncSave').onclick=async function(){try{await savePair();message('Saved.');}catch(e){message(e.message,true);}};
    document.getElementById('syncPreview').onclick=async function(){try{var p=await savePair();var r=await api('sync.preview',{profile_id:p.id});if(!r.ok)throw Error(r._error);message(r.files+' local files · '+kb(r.bytes)+' · .gitignore applied · no deletions');}catch(e){message(e.message,true);}};
    document.getElementById('syncRun').onclick=async function(){if(busy)return;try{var p=await savePair();setBusy(true);
      var r=await fetch('/v1/apps/platform/work_runner/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'op',app:APP,op:'sync.run',args:{profile_id:p.id,confirm:true},timeout:14400,confirm:true,label:'Drive sync: '+p.name})}).then(function(x){return x.json();});
      if(!r.ok)throw Error(r._error||'Could not start sync');job=r.job.id;await poll();
    }catch(e){message(e.message,true);setBusy(false);}};
    document.getElementById('syncStop').onclick=async function(){try{var r=await api('sync.stop',{profile_id:current.id,confirm:true});if(!r.ok)throw Error(r._error);
      if(!r.stopping&&job){var c=await fetch('/v1/apps/platform/work_runner/cancel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({job_id:job,confirm:true})}).then(function(x){return x.json();});if(!c.ok)throw Error(c._error||'Could not cancel queued sync');}
      message('Stopping after in-flight transfers finish…');}catch(e){message(e.message,true);}};
    // Restore progress after page reload without submitting a duplicate job.
    var queue=await fetch('/v1/apps/platform/work_runner/status',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(function(x){return x.json();});
    var pending=queue.pending_or_running||[];
    for(var p of pairs){var s=await api('sync.status',{profile_id:p.id});var queued=pending.find(function(j){return j.app===APP&&j.op==='sync.run'&&j.args&&j.args.profile_id===p.id;});if(s.running||queued){job=queued?queued.id:null;select.value=p.id;show(p);await poll();break;}}
  }catch(e){message('Sync controls unavailable: '+e.message,true);}
})();

// --- AI assistant dock (CHAT_SIDEBAR #8) — additive, lazy, non-invasive ------
// Loads the AppUI aiSidebar bundle ON FIRST OPEN only and mounts the declared
// file/gdrive.assistant chat_profile (its system prompt + tool scope come from
// the manifest). Supplies a context() so the model knows the current Drive
// folder. The existing OAuth/file-browser logic above is untouched; if the
// bundle fails to load, mountProfile degrades gracefully in the host element.
(function(){
  var dock=document.getElementById('gd-ai-dock');
  var toggle=document.getElementById('gd-ai-toggle');
  var closeBtn=document.getElementById('gd-ai-close');
  var host=document.getElementById('gd-ai-host');
  var mounted=false, panel=null;
  function driveContext(){
    try{
      var cur=stack[stack.length-1]||{};
      var path=stack.map(function(f){return f.name;}).join(' / ');
      return 'Google Drive view\\nCurrent folder: '+(cur.name||'My Drive')
        +' (id '+(cur.id||'root')+')\\nPath: '+path;
    }catch(e){return '';}
  }
  async function ensureMounted(){
    if(mounted) return;
    mounted=true;
    try{
      if(window.AppUIAssets&&window.AppUIAssets.load){ await window.AppUIAssets.load('foundation','aiSidebar'); }
      if(window.AppUIChatPanel&&window.AppUIChatPanel.mountProfile){
        panel=await window.AppUIChatPanel.mountProfile(host,'file/gdrive.assistant',{
          context:driveContext, hideHeader:true, ensureBundle:false,
        });
      } else {
        host.innerHTML='<div style="padding:12px;color:var(--muted);font-size:12px">AI assistant unavailable (aiSidebar bundle did not load).</div>';
      }
    }catch(e){
      mounted=false;
      host.innerHTML='<div style="padding:12px;color:var(--bad);font-size:12px">Could not load the assistant.</div>';
    }
  }
  function open(){ dock.classList.add('open'); ensureMounted(); }
  function close(){ dock.classList.remove('open'); }
  toggle.onclick=function(){ dock.classList.contains('open')?close():open(); };
  closeBtn.onclick=close;
})();
