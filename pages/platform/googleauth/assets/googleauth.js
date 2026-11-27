(function(){
'use strict';
const node=(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;};
async function api(op,args={}){const r=await fetch('/v1/apps/platform/googleauth/'+op,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(args)});const j=await r.json();if(!r.ok||!j.ok)throw new Error(j._error||'Google connection request failed');return j;}
function link(label,url){const a=node('a',label);a.href=url;if(url.startsWith('https:')){a.target='_blank';a.rel='noopener noreferrer';}return a;}
function mount(el){
 el.classList.add('ga-wrap');
 const origin=location.origin,callback=origin+'/apps/platform/googleauth/oauth/callback',hosted=location.protocol==='https:';
 const status=node('p','Checking configuration…');status.setAttribute('role','status');
 const cards=node('div');cards.className='ga-grid';
 const setup=node('section');setup.className='ga-card';
 const project=node('input');project.placeholder='Google Cloud project ID';project.value='';project.setAttribute('aria-label','Google Cloud project ID');
 const links=node('div');links.className='ga-actions';
 function renderLinks(){const p=project.value.trim();const suffix=p?'?project='+encodeURIComponent(p):'';links.replaceChildren(link('Google Auth clients','https://console.cloud.google.com/auth/clients'+suffix),link('Branding','https://console.cloud.google.com/auth/branding'+suffix),link('Audience','https://console.cloud.google.com/auth/audience'+suffix),link('Enable Compute API','https://console.cloud.google.com/apis/library/compute.googleapis.com'+suffix));}
 project.addEventListener('input',renderLinks);renderLinks();
 const code=node('code',callback);
 function btn(label,fn){const b=node('button',label);b.type='button';b.addEventListener('click',fn);return b;}
 const projectPicker=node('select');projectPicker.setAttribute('aria-label','Discovered Google Cloud projects');
 const projectNotice=node('p','Discover projects using the available Cloud credential.');projectNotice.setAttribute('role','status');
 async function refreshProjects(){
  projectRefresh.disabled=true;projectNotice.textContent='Discovering Google Cloud projects…';
  try{
   const r=await api('projects.list');
   const empty=node('option','Choose a discovered project');empty.value='';projectPicker.replaceChildren(empty);
   for(const item of r.projects||[]){const opt=node('option',item.name+(item.name===item.id?'':' — '+item.id)+(item.verification==='compute'?' (Compute verified)':''));opt.value=item.id;projectPicker.append(opt);}
   if(!project.value&&r.projects?.length===1){project.value=r.projects[0].id;renderLinks();}
   if(Array.from(projectPicker.options).some(o=>o.value===project.value))projectPicker.value=project.value;
   projectNotice.textContent=(r.source==='adc'?'VM credentials: ':'Connected Compute account: ')+(r.projects?.length||0)+' project(s). '+(r.complete?'List complete for this credential.':r.reason+' List may be incomplete. Enter another ID manually if needed.');
  }catch(e){projectNotice.textContent=e.message+' Enter a project ID manually.';}finally{projectRefresh.disabled=false;}
 }
 const projectRefresh=btn('Refresh Google Cloud projects',refreshProjects);
 projectPicker.addEventListener('change',()=>{if(projectPicker.value){project.value=projectPicker.value;renderLinks();}});
 project.addEventListener('input',()=>{projectPicker.value=Array.from(projectPicker.options).some(o=>o.value===project.value)?project.value:'';});
 const file=node('input');file.type='file';file.accept='.json,application/json';file.hidden=true;
 file.addEventListener('change',async()=>{try{const f=file.files[0];if(!f)return;if(f.size>65536)throw new Error('Maximum client JSON size is 64 KB');const raw=await f.text();const preview=await api('configure',{origin,client_json:raw});AppUIDialog.confirm('Store this '+preview.kind+' OAuth client in the sealed vault? Existing authorization tokens are retained.',async()=>{try{await api('configure',{origin,client_json:raw,confirm:true});await refresh();}catch(e){status.textContent=e.message;}});}catch(e){status.textContent=e.message;}finally{file.value='';}});
 setup.append(node('h2','1. Configure Google Auth Platform'),node('p',hosted?'Create a Web application OAuth client; register the exact callback below.':'Create a Desktop app OAuth client for loopback sign-in.'),projectPicker,projectRefresh,projectNotice,project,links,code,btn('Copy callback',async()=>{try{await navigator.clipboard.writeText(callback);status.textContent='Callback copied.';}catch(e){status.textContent='Copy the displayed URI manually.';}}),node('p','Download the OAuth client JSON and import it here. Google requires console registration and explicit consent; no password or MFA automation.'),file,btn('Import client JSON',()=>file.click()));
 const messages={opened:'Open the new OAuth client form in the selected project. Choose Web application and add a redirect URI field.',sign_in_required:'Google login is required. Use Check Google sign-in progress in the open viewer.',outside_setup:'Return to the OAuth clients page in the same tab.',open_create_form:'Open Create client, select Web application and add a URI field.',review_required:'Verify the project in the URL and the form. No submission was performed.',existing_values:'Existing form values conflict. They were not overwritten.',select_web_type:'Choose Web application.',form_ready:'Recognized form. Ready to prepare fields.',prepared:'Public fields prepared. Review the project, Web application type, name and callback, then click Create yourself. Download and import the client JSON.',forgotten:'Setup tracking removed; browser tab remains open.'};
 const linuxViewer=node('details');linuxViewer.className='ga-card';linuxViewer.open=true;
 linuxViewer.append(node('summary','Interactive Linux Google setup'),node('p','Open the selected project in graphical Chromium (Linux viewer). Page Automation recognizes login stages, then prepares the public OAuth fields in the same tab. Google authentication is still performed by you. For single-line fields, Ctrl+A selects the field text. Other unsupported shortcuts are reported without disconnecting the viewer. A named profile retains browser state when disk space permits. Temporary profiles are removed when closed.'));
 const linuxEndpoint=node('select');linuxEndpoint.setAttribute('aria-label','Linux setup endpoint');
 const linuxProfile=node('input');linuxProfile.value='temporary';linuxProfile.setAttribute('aria-label','Linux setup profile');
 const linuxStatus=node('p','Refresh to discover interactive endpoints.');linuxStatus.setAttribute('role','status');
 async function viewerPost(action,body){
   try{const r=await fetch('/apps/system/cdp/viewer/'+action,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return await r.json();}catch(e){return {ok:false,error:'Viewer unavailable. Check owner sign-in.'};}
 }
 async function discoverLinux(){
   linuxRefresh.disabled=true;linuxOpen.disabled=true;
   const previous=linuxEndpoint.value;linuxStatus.textContent='Discovering interactive Linux browsers…';
   try{
    const r=await viewerPost('endpoints',{});linuxEndpoint.replaceChildren();
    if(!r.ok){linuxStatus.textContent=r.error||'Sign in as Pylon owner to discover interactive browsers.';return;}
    for(const ep of (r.endpoints||[]).filter(x=>x.graphical===true)){const o=node('option',ep.id);o.value=ep.id;linuxEndpoint.append(o);}
    if(Array.from(linuxEndpoint.options).some(o=>o.value===previous))linuxEndpoint.value=previous;
    linuxStatus.textContent=linuxEndpoint.value?'Browser ready. Select the project above and open interactive setup.':'No interactive Linux endpoint.';
   }finally{linuxRefresh.disabled=false;linuxOpen.disabled=!linuxEndpoint.value;}
 }
 const linuxRefresh=btn('Refresh Linux setup endpoints',discoverLinux);
 const linuxOpen=btn('Open interactive Google setup',async()=>{
  const endpoint=linuxEndpoint.value,selectedProject=project.value.trim(),profileName=linuxProfile.value.trim()||'temporary';
  if(!endpoint||!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(selectedProject)){linuxStatus.textContent='Select a Linux endpoint and enter the exact project ID.';return;}
  if(!await AppUIDialog.confirmAsync('Open '+selectedProject+' in '+profileName+' on '+endpoint+'? You will operate the browser directly.'))return;
  linuxOpen.disabled=true;
  let r;
  try{
   await AppUIAssets.load('remoteBrowserViewer');
   r=await viewerPost('google_open',{endpoint,project:selectedProject,profile:profileName,confirm:true});
   if(!r.ok&&r.code==='viewer_active'){
    if(await AppUIDialog.confirmAsync('Reconnect to the existing viewer for this exact project and profile? This disconnects the old viewer window but keeps its browser session.')){
     r=await viewerPost('google_resume',{endpoint,project:selectedProject,profile:profileName,confirm:true});
    }
   }
   if(!r.ok){linuxStatus.textContent=r.error||'Browser could not open.';return;}
   let nextLoginCheck=0,loginFinished=false,checkProgress=null,closed=false,v=null,inputBusy=0;
   const inputNotice=node('p','');inputNotice.setAttribute('role','status');
   const transport={input:async(session,kind,payload)=>{
    inputBusy++;
    try{return await viewerPost('input',{session,kind,payload});}
    finally{inputBusy--;}
   },stop:async session=>{closed=true;const x=await viewerPost('stop',{session});if(!x.ok)linuxStatus.textContent='Viewer close not confirmed. Open the same project and profile to reconnect.';return x;},shot:async session=>{
    if(closed||inputBusy)return {ok:true,unchanged:true};
    const frame=await viewerPost('shot',{session});
    if(!frame.ok&&frame.error==='Viewer expired'){closed=true;if(v){v.setStep('Viewer disconnected. Close and reopen the same project to reconnect.');}return frame;}
    if(frame.ok&&!closed&&!loginFinished&&checkProgress&&Date.now()>=nextLoginCheck){nextLoginCheck=Date.now()+4000;void checkProgress();}
    return frame;
   },stream:()=>{throw new Error('Private POST polling');}};
   v=AppUIRemoteBrowserViewer.create({session:r.session,transport,title:'Google Cloud setup (graphical Chromium) — '+selectedProject,why:'Page Automation monitors the sign-in stage. Review all changes before creating the OAuth client.',allowHeadful:false,primeShots:0,debugger:{boundedInput:true,readFocus:session=>viewerPost('diagnostics',{session}),isActive:()=>!closed,onInputNotice:msg=>{inputNotice.textContent=msg;}}});
   const relay=v.el.querySelector('input');if(relay){relay.autocomplete='off';relay.spellcheck=false;relay.autocapitalize='off';}
   const actions=node('div');actions.className='ga-actions';const result=node('p','');
   async function recipe(action){
     if(action==='google_prepare'&&!await AppUIDialog.confirmAsync('Prepare the public application name and redirect URI in this tab? No submission.'))return;
     const x=await viewerPost(action,{session:r.session,confirm:true});result.textContent=x.ok?(messages[x.state]||x.state):x.error||'Setup unavailable';
   }
   const loginMessages={login_email:'Google asks for your email or phone. Enter it in the viewer.',login_password:'Google asks for your password. Enter it in the viewer.',login_verification:'Complete Google verification in the viewer or on your device.',login_denied:'Google declined sign-in. Stop and use a supported browser; do not retry automatically.',login_unknown:'Google login screen not recognized. Check the viewer.',login_returned:'Returned to the selected Cloud project. Inspect the OAuth client form.',outside_setup:'Not on the selected Google setup page.'};
   let checking=false;
   async function loginCheck(){
     if(checking||closed)return;checking=true;
     try{
       const x=await viewerPost('google_login_state',{session:r.session,confirm:true});
       result.textContent=x.ok?(loginMessages[x.state]||x.state):x.error||'Login inspection unavailable';
       if(x.ok&&x.state==='login_returned'){loginFinished=true;await recipe('google_inspect');}
       if(x.ok&&x.state==='login_denied')loginFinished=true;
     }finally{checking=false;}
   }
   actions.append(btn('Check Google sign-in progress',loginCheck),btn('Inspect this Google tab',()=>recipe('google_inspect')),btn('Prepare this Google tab',()=>recipe('google_prepare')),result);v.el.append(actions,inputNotice);
   checkProgress=loginCheck;nextLoginCheck=Date.now()+4000;await loginCheck();
   linuxStatus.textContent='Viewer opened. Close it after reviewing the setup. Import the downloaded client JSON separately.';
  }catch(e){if(r?.session)await viewerPost('stop',{session:r.session});linuxStatus.textContent='Viewer unavailable.';}finally{linuxOpen.disabled=false;}
 });
 linuxOpen.disabled=true;
 const stopIdle=btn('Stop idle browser',async()=>{
  if(!linuxEndpoint.value){linuxStatus.textContent='Select an endpoint first.';return;}
  if(!await AppUIDialog.confirmAsync('Stop the idle Linux browser? Temporary profile data is removed; an active viewer will not be stopped.'))return;
  const r=await viewerPost('browser_stop',{endpoint:linuxEndpoint.value,confirm:true});
  linuxStatus.textContent=r.ok?'Idle browser stopped. Open interactive setup again.':r.error||'Browser could not stop; close any active viewer first.';
 });
 linuxViewer.append(linuxEndpoint,linuxRefresh,linuxProfile,linuxOpen,stopIdle,linuxStatus);
 if(origin==='https://pylon-server.duckdns.org')setup.append(linuxViewer);
 // Windows CDP uses the existing fixed OAuth setup recipe, not the Linux
 // viewer or the older automated sign-in methods.
 const winSetup=node('details');winSetup.className='ga-card';winSetup.open=true;
 const winEndpoint=node('select');winEndpoint.setAttribute('aria-label','Windows setup endpoint');
 const winState=node('p','Discover Windows CDP endpoints.');winState.setAttribute('role','status');
 const winMode=node('select');winMode.setAttribute('aria-label','Windows browser mode');
 for(const [value,label] of [['headful','Headful — visible Edge window'],['headless','Headless — background Edge']]){const o=node('option',label);o.value=value;winMode.append(o);}
 const winRestart=node('input');winRestart.type='checkbox';winRestart.checked=false;
 const winRestartLabel=node('label');winRestartLabel.append(winRestart,node('span',' Allow restart of the dedicated managed Edge browser (closes all its open tabs)'));
 let winSession=null,winBusy=false;
 const winInspect=btn('Inspect OAuth form',()=>winAction('windows_inspect'));
 const winPrepare=btn('Prepare public OAuth fields',()=>winAction('windows_prepare'));
 const winForget=btn('End setup session',()=>winAction('windows_forget'));
 const winOpen=btn('Open project using Windows CDP',()=>winAction('windows_start'));
 const confirmWin=async(message)=>{if(window.AppUIDialog&&typeof window.AppUIDialog.confirmAsync==='function'){try{return await window.AppUIDialog.confirmAsync(node('p',message));}catch(_){}}return window.confirm(message);};
 function winControls(){
  winOpen.disabled=winBusy||!winEndpoint.value||!!winSession;
  winInspect.disabled=winBusy||!winSession;winPrepare.disabled=winBusy||!winSession;
  winForget.disabled=winBusy||!winSession;winEndpoint.disabled=winBusy||!!winSession;winMode.disabled=winBusy||!!winSession;winRestart.disabled=winBusy||!!winSession;
 }
 async function discoverWindows(){
  if(winBusy||winSession)return;
  winBusy=true;winControls();const previous=winEndpoint.value;
  try{
   const r=await viewerPost('windows_endpoints',{});winEndpoint.replaceChildren();
   if(!r.ok)throw Error(r.error||'Windows CDP discovery failed');
   for(const e of r.endpoints||[]){const o=node('option',e.id);o.value=e.id;winEndpoint.append(o);}
   const available=Array.from(winEndpoint.options).map(o=>o.value);
   if(available.includes(previous))winEndpoint.value=previous;
   else if(available.includes('managed-win-my-pc'))winEndpoint.value='managed-win-my-pc';
   winState.textContent=winEndpoint.value?'Windows CDP available. Open the selected project.':'No connected Windows endpoint with CDP permission.';
  }catch(e){winState.textContent=e.message;}finally{winBusy=false;winControls();}
 }
 async function winAction(action){
  if(winBusy)return;winBusy=true;winControls();
  try{
   let body={confirm:true};
   if(action==='windows_start'){
    const p=project.value.trim(),endpoint=winEndpoint.value;
    if(!endpoint||!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(p))throw Error('Select the Windows endpoint and exact project ID.');
    const mode=winMode.value,restart=winRestart.checked;
    if(!await confirmWin('Open the Google OAuth clients page for '+p+' on '+endpoint+' in '+mode+' mode? '+(restart?'The dedicated managed Edge may be restarted, closing all its tabs. ':'')+'No login or consent will be automated.'))return;
    body={...body,project:p,endpoint,browser_mode:mode,restart_managed:restart};
   }else{
    if(!winSession)throw Error('Open a setup session first.');
    if(action==='windows_prepare'&&!await confirmWin('Prepare only the public OAuth application name and callback URI in the exact project tab? Nothing will be submitted.'))return;
    body.session=winSession;
   }
   winState.textContent='Contacting the selected Windows endpoint…';
   const r=await viewerPost(action,body);
   if(!r.ok)throw Error(r.error||'Windows CDP request failed');
   if(action==='windows_start'){winSession=r.session;winRestart.checked=false;winState.textContent='Project opened. Daemon confirmed '+r.browser_mode+' mode. '+(r.browser_mode==='headful'?'Look for the dedicated Edge window on your Windows PC. ':'The browser runs in the background. ')+'Google sign-in and consent remain manual.';}
   else if(action==='windows_forget'){winSession=null;winState.textContent='Setup session ended. Browser tab left open.';}
   else winState.textContent=r.state==='sign_in_required'?'Google requires sign-in. Stop CDP setup and use the ordinary browser link above. Do not try to bypass Google’s browser or verification checks.':messages[r.state]||r.state;
  }catch(e){winState.textContent=e.message;}finally{winBusy=false;winControls();}
 }
 winEndpoint.addEventListener('change',winControls);
 winSetup.append(node('summary','Windows CDP-assisted Google setup'),node('p','Use the selected Windows daemon’s existing managed browser for OAuth configuration. This is not a remote sign-in viewer: Google login, verification, client creation, download and consent remain manual. No credentials or screenshots are read.'),winEndpoint,btn('Refresh Windows endpoints',discoverWindows),winMode,winRestartLabel,winOpen,winInspect,winPrepare,winForget,winState);
 if(origin==='https://pylon-server.duckdns.org')setup.append(winSetup);
 winControls();
 const connect=node('section');connect.className='ga-card';
 const state=node('p','Not checked');
 const profile=node('select');profile.setAttribute('aria-label','Google authorization profile');for(const [id,label] of [['compute','Google VM — Cloud API'],['drive','Google Drive — Full Drive access']]){const o=node('option',label);o.value=id;profile.append(o);}
 const sign=btn('Connect selected profile',async()=>{const popup=window.open('about:blank','_blank');try{const r=await api('start',{origin,profile:profile.value,confirm:true});if(popup){popup.opener=null;popup.location.href=r.launch_url;}else location.href=r.launch_url;status.textContent='Complete Google consent and refresh connection status.';}catch(e){popup?.close();status.textContent=e.message;}});
 sign.disabled=true;
 connect.append(node('h2','2. Authorize and verify'),node('p','Choose a profile. Compute and Drive have separate scopes and stored tokens. Drive authorization does not switch the existing Drive connection.'),state,profile,sign,btn('Verify token with Google',async()=>{try{const r=await api('verify',{profile:profile.value});status.textContent='Google token: '+r.state.replaceAll('_',' ')+(r.drive_account_id?' | Drive account: '+r.drive_email+' | ID: '+r.drive_account_id+' (activation requires offline review)':'');}catch(e){status.textContent=e.message;}}),btn('Refresh',refresh),link('Open Google VM','/apps/personal/googlevm/'));
 const compare=node('section');compare.className='ga-card';
 const report=node('p','No comparison performed.');report.setAttribute('role','status');
 const compareButton=btn('Compare Drive accounts',async()=>{compareButton.disabled=true;report.textContent='Checking three connections…';try{
  const r=await api('drive.compare');
  const format=a=>a.state+(a.drive_email?' | '+a.drive_email:'')+(a.drive_account_id?' | ID: '+a.drive_account_id:'');
  report.replaceChildren(node('strong',r.comparison==='match'?'Same Drive account verified':r.comparison==='mismatch'?'Different accounts — do not activate':'Account match not verified'),node('p','Existing: '+format(r.legacy)),node('p','Central: '+format(r.central)),node('p','Drive Manager: '+(r.manager?.state||'unavailable')+' | vs existing: '+(r.manager?.legacy_comparison||'not_verified')+' | vs central: '+(r.manager?.central_comparison||'not_verified')),node('p','No credentials or account selection changed. Activation requires offline review and restart.'));
 }catch(e){report.textContent=e.message;}finally{compareButton.disabled=false;}});
 compare.append(node('h2','3. Review Drive account before activation'),node('p','Compare Google-issued account IDs. An email address alone is not an account match.'),compareButton,report);
 const manager=node('section');manager.className='ga-card';
 const managerReport=node('p','Independent session not checked.');managerReport.setAttribute('role','status');
 const managerCheck=btn('Check Drive Manager connection',async()=>{managerCheck.disabled=true;try{const r=await api('manager.status');managerReport.textContent=r.state==='session_present'?'Existing session present (not a live Google token check). Drive access: '+(r.drive_scope?'granted':'not verified')+'; write access: '+(r.write_scope?'granted':'not verified'):r.state==='not_signed_in'?'No existing Drive Manager sign-in.':'Drive Manager status not verified.';}catch(e){managerReport.textContent=e.message;}finally{managerCheck.disabled=false;}});
 manager.append(node('h2','4. Independent Drive Manager'),node('p','Drive Manager has its own account session and shares. This check does not replace or copy that session.'),managerCheck,managerReport,link('Open Drive Manager','/drive'));
 el.append(node('h1','Google Auth'),node('p','Manage Google API clients and connections. Pylon owner sign-in is managed separately in Accounts.'),status,cards,setup,connect,compare,manager);
 async function refresh(){try{const r=await api('status',{origin});sign.disabled=!r.ready;state.textContent=r.ready?'OAuth client ready for this origin':r.reason;cards.replaceChildren();for(const a of r.apps){const c=node('section');c.className='ga-card';c.append(node('h3',a.name),node('p',a.integration==='active'?(a.token_stored?'Token stored — verify with Google':'Not connected via browser'):(a.token_stored?'Central token stored — activation pending':'Existing connection unchanged — authorize separately')),node('code',a.scope),node('p',a.note),link('Open app','/apps/'+a.id+'/'));cards.append(c);}status.textContent='Configuration refreshed.';}catch(e){sign.disabled=true;status.textContent=e.message;}}
 // Best-effort project default from the existing VM app; no settings writes.
 fetch('/v1/apps/personal/googlevm/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(r=>r.json()).then(r=>{if(!project.value&&r.settings?.project){project.value=r.settings.project;renderLinks();}}).catch(()=>{});
 refresh();
 refreshProjects();
 if(origin==='https://pylon-server.duckdns.org'){discoverLinux();discoverWindows();}
}
window.AppUIReady.then(()=>AppUI.createApp({id:'platform-googleauth',title:'Google Auth',content:{render:mount},statusbar:{}}));
})();
