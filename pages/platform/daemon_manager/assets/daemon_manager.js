(function(){
'use strict';
const BASE='/v1/apps/platform/daemon_manager/';
const REPO='https://github.com/frontjang-gif/pylon-server-daemon';
const RAW='https://raw.githubusercontent.com/frontjang-gif/pylon-server-daemon/main/';
const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
const btn=(text,fn)=>{const e=node('button',text);e.type='button';e.addEventListener('click',fn);return e;};
const link=(text,url)=>{const e=node('a',text);e.href=url;return e;};
async function api(op,args={}){
 const r=await fetch(BASE+op,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(args),cache:'no-store'});
 if(!r.ok)throw Error('Request failed: HTTP '+r.status);
 return await r.json();
}
function mount(el){
 el.classList.add('dm');
 let busy=false,disposed=false,timer=null,rows=[],releaseRows=[],probes=new Map();
 const status=node('p','Loading endpoint registry…','dm-muted');status.setAttribute('role','status');
 const metrics=node('div',undefined,'dm-grid'),fleet=node('div'),jobs=node('div'),toolbar=node('div',undefined,'dm-actions');
 const refreshBtn=btn('Refresh now',refresh);toolbar.append(refreshBtn,link('Work Runner','/apps/platform/work_runner/'),link('Node Sync','/apps/system/node_sync/'),link('Server Connectivity','/apps/system/server_conn/'),link('SSH Client','/apps/system/ssh_client/'),link('Terminal','/apps/system/terminal/'),link('CDP','/apps/system/cdp/'));
 const releases=node('section',undefined,'dm-card');
 const setup=node('section',undefined,'dm-card');
 const os=node('select');os.setAttribute('aria-label','Operating system');
 for(const value of ['Windows','Linux']){const option=node('option',value);option.value=value;os.append(option);}
 const cmd=node('pre','','dm-code'),dependencies=node('pre','','dm-code'),copyNotice=node('p','','dm-muted');
 function commands(){cmd.textContent=os.value==='Windows'?'irm '+RAW+'install.ps1 | iex':'curl -fsSL '+RAW+'install.sh | bash';
 dependencies.textContent=os.value==='Windows'?'py -3 -m pip install websockets\n# Optional CPU / RAM telemetry:\npy -3 -m pip install psutil':'python3 -m pip install -r "$HOME/pylon-server/daemon/daemons/linux/requirements.txt"';}
 os.addEventListener('change',commands);commands();
 const copy=(get)=>btn('Copy',async()=>{try{await navigator.clipboard.writeText(get());copyNotice.textContent='Copied.';}catch(_){copyNotice.textContent='Select the command and copy it manually.';}});
 const setupActions=node('div',undefined,'dm-actions');setupActions.append(os,link('Public repository',REPO));
 setup.append(node('h2','Download and prepare the daemon'),node('p','Review the public installer before running it. It only downloads source.'),setupActions,cmd,copy(()=>cmd.textContent),node('p','Install the required transport dependencies in your chosen Python environment. Optional Windows capabilities require additional packages listed in daemons/windows/manifest.json.'),dependencies,copy(()=>dependencies.textContent),copyNotice);
 // Device enrollment: only the hash is pasted into the owner UI.
 const enrollment=node('section',undefined,'dm-card'),enrollState=node('p','Loading enrollment…','dm-muted'),deviceList=node('div');
 const platform=node('select');platform.setAttribute('aria-label','Device platform');
 for(const val of ['windows','linux']){const o=node('option',val);o.value=val;platform.append(o);}
 const eid=node('input');eid.value='managed-win-my-pc';eid.placeholder='managed-win-my-pc';eid.setAttribute('aria-label','Managed endpoint ID');
 const fingerprint=node('input');fingerprint.spellcheck=false;fingerprint.placeholder='64-character SHA-256 fingerprint';fingerprint.autocomplete='off';fingerprint.setAttribute('aria-label','Credential fingerprint');
 const generate=node('pre','','dm-code'),connect=node('pre','','dm-code');
 let deviceRows=[],enrollmentBusy=false,permissionBusy=false;
 const drafts=new Map();
 const feedback=node('p','','dm-feedback');feedback.setAttribute('role','alert');
 const showFeedback=(message,error=false)=>{feedback.textContent=message;feedback.classList.toggle('dm-error',error);};
 async function confirmAction(message){
  if(window.AppUIDialog&&typeof window.AppUIDialog.confirmAsync==='function'){try{return await window.AppUIDialog.confirmAsync(node('p',message));}catch(_){/* Use explicit native confirmation if the shared dialog fails. */}}
  return window.confirm(message);
 }
 const valid=()=>/^managed-(win|linux)-[a-z0-9][a-z0-9-]{0,47}$/.test(eid.value)&&(platform.value==='windows'?eid.value.startsWith('managed-win-'):eid.value.startsWith('managed-linux-'));
 function updateCommands(){
  // Credential is generated on the local machine, never in the browser/server UI.
  const py="import os,hashlib,secrets; from pathlib import Path; p=Path.home()/'.config/pylon-server/enrolled-agent-token'; p.parent.mkdir(parents=True,exist_ok=True); fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600) if not p.exists() else None; os.write(fd,('pylon-device-v1-'+secrets.token_hex(32)).encode()) if fd is not None else None; os.close(fd) if fd is not None else None; raw=p.read_bytes(); assert len(raw)==len(b'pylon-device-v1-')+64 and raw.startswith(b'pylon-device-v1-') and all(c in b'0123456789abcdef' for c in raw[len(b'pylon-device-v1-'):]), 'Invalid enrolled-agent-token'; print(hashlib.sha256(raw).hexdigest())";
  generate.textContent=(platform.value==='windows'?'py -3':'python3')+' -c "'+py+'"';
  const name=valid()?eid.value:(platform.value==='windows'?'managed-win-my-pc':'managed-linux-my-pc');
  connect.textContent=platform.value==='windows'?'Set-Location "$HOME/pylon-server/daemon"\n$env:PYLON2_DAEMON_MODE = "passive"\n$env:PYLON2_FRAMEWORK_URL = "wss://pylon-server.duckdns.org/agent"\n$env:PYLON2_ENDPOINT_ID = "'+name+'"\n$env:PYLON2_AGENT_TOKEN = (Get-Content "$HOME/.config/pylon-server/enrolled-agent-token" -Raw).Trim()\npy -3 daemons/windows/agent.py':'cd "$HOME/pylon-server/daemon"\nexport PYLON2_DAEMON_MODE=passive\nexport PYLON2_FRAMEWORK_URL=wss://pylon-server.duckdns.org/agent\nexport PYLON2_ENDPOINT_ID='+name+'\nexport PYLON2_AGENT_TOKEN="$(cat "$HOME/.config/pylon-server/enrolled-agent-token")"\npython3 daemons/linux/agent.py';
 }
 async function enrollAPI(action,data={}){
  const r=await fetch('/apps/platform/daemon_manager/enrollment/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),cache:'no-store'});
  let j;try{j=await r.json();}catch(_){throw Error('Enrollment request failed (HTTP '+r.status+'). Refresh or sign in again.');}if(!r.ok||!j.ok)throw Error(j.error||'Enrollment request failed (HTTP '+r.status+')');return j;
 }
 platform.addEventListener('change',()=>{if(!valid())eid.value=platform.value==='windows'?'managed-win-my-pc':'managed-linux-my-pc';eid.placeholder=platform.value==='windows'?'managed-win-my-pc':'managed-linux-my-pc';updateCommands();showFeedback('');});eid.addEventListener('input',updateCommands);
 function renderDevices(){
  deviceList.replaceChildren(node('h3','Enrolled devices'));
  if(!deviceRows.length)deviceList.append(node('p','No managed devices enrolled.'));
  for(const d of deviceRows){
   const c=node('section',undefined,'dm-card'),online=d.connected===true;
   const reported=d.reported_capabilities||[],granted=new Set(d.capabilities||[]);
   c.append(node('strong',d.endpoint),node('p',d.active?(online?'Connected · '+reported.length+' reported capabilities':'Approved identity · offline'):'Revoked'));
   if(d.active){
    if(!reported.length)c.append(node('p','Waiting for the authenticated daemon to report its capabilities. No new permissions are granted.','dm-muted'));
    else {
     c.append(node('p',online?'Select permissions from the daemon’s actual capability report.':'Last reported capabilities (offline; editing disabled).','dm-muted'));
     const group=node('div',undefined,'dm-list');
     let draft=drafts.get(d.endpoint);
     if(!draft||draft.revision!==d.report_revision){draft={revision:d.report_revision,selected:new Set(granted)};drafts.set(d.endpoint,draft);}
     for(const cap of reported){
      const l=node('label'),check=node('input');check.type='checkbox';check.value=cap.name;check.checked=draft.selected.has(cap.name);check.disabled=!online||!cap.permitted_by_policy||permissionBusy;
      check.addEventListener('change',()=>{if(check.checked)draft.selected.add(cap.name);else draft.selected.delete(cap.name);});
      l.append(check,node('span',cap.name+(cap.variant?' · '+cap.variant:'')+(!cap.permitted_by_policy?' (blocked by server policy)':'')));group.append(l);
     }
     c.append(group);
     const save=btn('Apply capability permissions',async()=>{
      if(permissionBusy)return;
      const selected=reported.filter(x=>x.permitted_by_policy&&draft.selected.has(x.name)).map(x=>x.name);
      permissionBusy=true;save.disabled=true;
      try{
       if(!await confirmAction('Apply '+selected.length+' capabilities to '+d.endpoint+'? The daemon will reconnect. Terminal/workload grant remote execution; CDP grants browser control. OCR permits selected document image processing.'))return;
       await enrollAPI('permissions',{endpoint:d.endpoint,revision:d.report_revision,capabilities:selected,confirm:true});drafts.delete(d.endpoint);enrollState.textContent='Permissions saved. Waiting for daemon reconnection.';await loadDevices();
      }catch(e){enrollState.textContent=e.message;}finally{permissionBusy=false;save.disabled=false;}
     });save.disabled=!online||permissionBusy;c.append(save);
    }
    c.append(btn('Revoke',async()=>{try{if(!await confirmAction('Revoke '+d.endpoint+'? This closes the connection; existing local jobs may continue.'))return;await enrollAPI('revoke',{endpoint:d.endpoint,confirm:true});drafts.delete(d.endpoint);await loadDevices();await refresh();}catch(e){enrollState.textContent=e.message;}}));
   }
   deviceList.append(c);
  }
 }
 async function loadDevices(){
  if(enrollmentBusy)return;enrollmentBusy=true;
  try{const r=await enrollAPI('list');deviceRows=r.devices||[];renderDevices();if(enrollState.textContent==='Loading enrollment…')enrollState.textContent='Device identity and reported capabilities are reviewed separately.';}
  catch(e){enrollState.textContent=e.message;}finally{enrollmentBusy=false;}
 }
 const approve=btn('Approve device',async()=>{
  showFeedback('');
  eid.value=eid.value.trim();const hash=fingerprint.value.trim().toLowerCase();
  if(!valid()){showFeedback('Enter a valid managed endpoint ID, for example '+eid.placeholder+'.',true);eid.focus();return;}
  if(!/^[0-9a-f]{64}$/.test(hash)){showFeedback('Paste the 64 hexadecimal characters of your SHA-256 fingerprint (not the device token).',true);fingerprint.focus();return;}
  const request={endpoint:eid.value,platform:platform.value,fingerprint:hash,confirm:true};
  approve.disabled=true;
  try{
   showFeedback('Confirm the device identity in the dialog.');
   if(!await confirmAction('Approve the identity of '+request.endpoint+'? This allows capability discovery only; no remote execution permissions are granted.')){showFeedback('Approval cancelled. No changes made.');return;}
   showFeedback('Submitting approval…');
   await enrollAPI('approve',request);
   fingerprint.value='';await loadDevices();await refresh();
   showFeedback('Device identity approved. Connect the daemon to discover its capabilities.');
  }catch(e){showFeedback(e.message||'Approval failed.',true);}finally{approve.disabled=false;}
 });
 enrollment.append(node('h2','Device enrollment'),node('p','Generate a separate device token locally. Paste only its SHA-256 fingerprint here, never the token. Managed devices are explicitly targeted, not used for implicit workload routing.'),platform,eid,node('p','1. On the target machine, run:'),generate,copy(()=>generate.textContent),node('p','2. Paste the resulting fingerprint and approve the device identity. Capability permissions are selected only after it connects.'),fingerprint,approve,feedback,node('p','3. After approval, run:'),connect,copy(()=>connect.textContent),enrollState,deviceList);
 updateCommands();
 void loadDevices();
 function metric(label,value){const box=node('section',undefined,'dm-card');box.append(node('div',label,'dm-muted'),node('div',String(value),'dm-metric'));return box;}
 function fmt(v){return typeof v==='number'?Math.round(v)+' s':'Unavailable';}
 function renderReleases(){
  releases.replaceChildren(node('h2','Passive daemon release candidates'),node('p','These are immutable VM-built source packages, not automatic updates. Review the source and verify the SHA-256 before staging in a new directory. Do not overwrite a running daemon. Existing configuration and credentials are excluded.','dm-muted'));
  if(!releaseRows.length){releases.append(node('p','No candidate available.'));return;}
  for(const r of releaseRows){
   const box=node('section',undefined,'dm-card');
   box.append(node('strong',r.platform+' · '+r.source_sha256.slice(0,12)),node('p',r.file_count+' source files · '+Math.round(r.bytes/1024)+' KiB · candidate'),node('p','ZIP SHA-256: '+r.archive_sha256,'dm-code'));
   const url='/_pylon/daemon-release/'+r.platform+'/'+r.archive_sha256+'.zip';
   box.append(link('Download verified candidate',url));
   const filename='pylon-daemon-'+r.platform+'-'+r.archive_sha256.slice(0,12)+'.zip';
   const target='pylon-daemon-'+r.source_sha256.slice(0,12);
   const commands=r.platform==='windows'?
    '$zip = "'+filename+'"\nif ((Get-FileHash $zip -Algorithm SHA256).Hash.ToLower() -ne "'+r.archive_sha256+'") { throw "Hash mismatch" }\n$dest = "'+target+'"\nif (Test-Path $dest) { throw "Choose a new directory" }\nExpand-Archive -LiteralPath $zip -DestinationPath $dest':
    'zip="'+filename+'"\nprintf "%s  %s\\n" "'+r.archive_sha256+'" "$zip" | sha256sum -c - && mkdir "'+target+'" && unzip "$zip" -d "'+target+'"';
   box.append(node('pre',commands,'dm-code'),copy(()=>commands),node('p','Stage only. Keep the old directory and its launch configuration for rollback. Stop the old daemon and explicitly launch the new passive daemon only after review; never run both under the same endpoint ID.','dm-muted'));
   releases.append(box);
  }
 }
 function renderEndpoints(){
  const live=rows.filter(x=>x.status==='online');
  metrics.replaceChildren(metric('Online',live.length),metric('Windows online',live.filter(x=>x.platform==='windows').length),metric('Capabilities',new Set(live.flatMap(x=>x.capabilities.map(c=>c.name))).size),metric('Unhealthy',rows.length-live.length));
  fleet.replaceChildren(node('h2','Connected endpoints'));
  if(!rows.length)fleet.append(node('p','No currently registered endpoints.'));
  if(!rows.some(x=>x.platform==='windows'))fleet.append(node('p','No Windows endpoint is currently registered.','dm-muted'));
  for(const e of rows){
   const card=node('section',undefined,'dm-card');card.append(node('h3',e.id),node('p',e.platform+' · '+e.status.toUpperCase(),'dm-state'),node('p','Heartbeat '+fmt(e.heartbeat_age_seconds)+' ago · Connected '+fmt(e.connected_seconds)+' · Reconnects '+(e.reconnects??'Unavailable'),'dm-muted'));
   const candidate=releaseRows.find(r=>r.platform===e.platform);
   card.append(node('p','Startup source: '+(e.source_sha256?e.source_sha256.slice(0,12):'not reported')+' · '+(!candidate?'no candidate':!e.source_sha256?'version unknown':e.source_sha256===candidate.source_sha256?'matches candidate':'different source — review before updating'),'dm-muted'));
   const caps=node('details');caps.append(node('summary',e.capabilities.length+' registered capabilities'));
   const tags=node('div',undefined,'dm-list');for(const c of e.capabilities)tags.append(node('span',c.name+(c.variant?' · '+c.variant:''),'dm-cap'));caps.append(tags);
   card.append(caps);
   const capacity=node('p',probes.get(e.id)||'Capacity not checked. Optional CPU/RAM telemetry requires psutil on the endpoint.','dm-muted');
   const probe=btn('Check capacity',async()=>{probe.disabled=true;capacity.textContent='Checking selected endpoint…';try{const r=await api('capacity',{endpoint:e.id});let text=r.ok?('CPU threads: '+(r.cpu_count??'Unavailable')+' · Free compute slots: '+(r.compute_slots??'Unavailable')+' · Free workload disk: '+(typeof r.disk_free_bytes==='number'?(r.disk_free_bytes/1073741824).toFixed(2)+' GiB':'Unavailable')+' · CPU load: '+(r.cpu_usage_percent==null?'Unavailable':r.cpu_usage_percent.toFixed(1)+'%')+' · RAM available: '+(r.memory_available_bytes==null?'Unavailable':(r.memory_available_bytes/1073741824).toFixed(2)+' GiB')+' · Admission: '+(r.admission_ready?'ready':'not ready')):(r.error||'Probe unavailable');probes.set(e.id,text);capacity.textContent=text;}catch(_){capacity.textContent='Probe failed.';}finally{probe.disabled=false;}});
   probe.disabled=e.status!=='online'||!e.capacity_supported;card.append(probe,capacity);
   if(e.daemon_stat_supported){
    const dstat=node('p','Daemon runtime not checked.','dm-muted');
    const checkStat=btn('Check daemon runtime',async()=>{checkStat.disabled=true;dstat.textContent='Checking daemon runtime…';try{const r=await api('daemon_stat',{endpoint:e.id});if(!r.ok){dstat.textContent=r.error||'Daemon runtime unavailable.';}else{const sv=r.server,cn=r.connectivity||{};dstat.textContent='Mode: '+(r.mode||'unknown')+' · PID: '+(r.pid??'?')+' · Uptime: '+fmt(r.uptime_seconds)+(sv?' · HTTP Server: '+sv.host+':'+sv.port+' ('+(sv.healthy?'healthy':'unhealthy')+', restarts '+(sv.restarts??0)+')':' · HTTP Server: central (client mode)')+(r.status_url?' · Client UI: '+r.status_url:'')+(cn.public_ipv4?' · Public IP: '+cn.public_ipv4:'')+(cn.duckdns_fqdn?' · DuckDNS: '+cn.duckdns_fqdn+(cn.duckdns_enabled?' (on)':' (off)'):'')+(cn.ngrok_status&&cn.ngrok_status!=='stopped'?' · Ngrok: '+cn.ngrok_status+(cn.ngrok_url?' ('+cn.ngrok_url+')':''):'');}}catch(_){dstat.textContent='Daemon runtime probe failed.';}finally{checkStat.disabled=false;}});
    checkStat.disabled=e.status!=='online';card.append(checkStat,dstat);
   }
   if(e.platform==='windows'&&e.capabilities.some(c=>c.name==='cap:document.ocr')){
    const diag=node('p','OCR installation not checked.','dm-muted');
    const check=btn('Check OCR',async()=>{check.disabled=true;try{const r=await api('ocr.status',{endpoint:e.id});diag.textContent=r.ok?'Tesseract: '+(r.version|| (r.tesseract_available?'installed, version unavailable':'not installed'))+' · Languages: '+(r.languages.join(', ')||'unavailable')+' · Pillow: '+(r.pillow_available===null?'unknown':r.pillow_available?'ready':'missing')+' · Slot: '+(r.busy===null?'unknown':r.busy?'busy':'idle')+' · OCR revision: '+(r.capability_revision||'unknown'):r.error;}catch(_){diag.textContent='OCR probe failed.';}finally{check.disabled=false;}});
    check.disabled=e.status!=='online';card.append(check,diag);
   }
   fleet.append(card);
  }
 }
 function renderJobs(r){jobs.replaceChildren(node('h2','Endpoint jobs'));if(!r.job_history_available){jobs.append(node('p','Job history unavailable.'));return;}if(!r.jobs.length){jobs.append(node('p','No endpoint jobs in current queue or recent history.'));return;}const wrap=node('div',undefined,'dm-table'),table=node('table'),thead=node('thead'),head=node('tr');for(const t of ['Job ID','Endpoint','Task','Status'])head.append(node('th',t));thead.append(head);table.append(thead);const body=node('tbody');for(const j of r.jobs){const row=node('tr');for(const text of [j.id,j.endpoint,j.task,j.status])row.append(node('td',text));body.append(row);}table.append(body);wrap.append(table);jobs.append(wrap);}
 async function refresh(){
  if(busy||disposed)return;busy=true;refreshBtn.disabled=true;
  try{const r=await api('status');if(!r.ok)throw Error('Registry unavailable');rows=r.endpoints||[];releaseRows=r.releases||[];renderReleases();renderEndpoints();renderJobs(r);await loadDevices();status.textContent='Updated '+new Date().toLocaleTimeString()+'. Registry shows currently connected endpoints only.';}
  catch(e){status.textContent='Unable to refresh: '+e.message+' (previous data may be stale).';}
  finally{busy=false;refreshBtn.disabled=false;}
 }
 el.append(node('h1','Daemon Manager'),node('p','Manage the visibility of Pylon execution nodes. Inspect endpoints and explicitly approve or revoke device fingerprints. Raw credentials and remote commands are not handled here.'),toolbar,status,metrics,fleet,releases,jobs,setup,enrollment);
 refresh();timer=setInterval(()=>{if(!el.isConnected){disposed=true;clearInterval(timer);}else if(!document.hidden)refresh();},15000);
}
window.AppUIReady.then(()=>AppUI.createApp({id:'platform-daemon-manager',title:'Daemon Manager',content:{render:mount},statusbar:{}}));
})();
