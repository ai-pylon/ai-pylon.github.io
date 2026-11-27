(function () {
  'use strict';
  let form, table, scriptTable, scriptNotice, message, busy = false, disposed = false;
  const pending = new Set();
  let inventory = [], overviewCards, permissionsSelect, showTab;
  async function api(op, args = {}) {
    const response = await fetch('/v1/apps/personal/googlevm/' + op, {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(args)
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result._error || result.error || 'Request failed');
    return result;
  }
  function node(tag, text) { const el = document.createElement(tag); if (text) el.textContent = text; return el; }
  function status(text) { if (!disposed) message.textContent = text; }
  function target() { const value = form.getValue(); return {project: value.Project.trim(), zone: value.Zone.trim()}; }
  async function refresh() {
    if (busy) return;
    busy = true;
    status('Loading instances...');
    try {
      const result = await api('instances', target());
      if (disposed) return;
      table.setItems(result.instances); inventory = result.instances; updateOverview(); if (permissionsSelect) permissionsSelect(inventory);
      status(result.instances.length + ' instances' + (result.warnings.length ? ' | ' + JSON.stringify(result.warnings) : ''));
    } catch (e) { status(e.message); } finally { busy = false; }
  }
  async function refreshScripts() {
    scriptNotice.textContent = 'Reading deployed scripts...';
    try {
      const result = await api('daemon.scripts');
      if (disposed) return;
      scriptTable.setItems(result.items || []);
        scriptNotice.textContent = result.connected ? result.endpoint + ' | ' + result.items.length + ' deployed entries | ' + (result.warnings || []).join(' | ') : 'Linux daemon is not connected.';
    } catch (error) { scriptNotice.textContent = error.message; }
  }
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function openSSH(row) {
    try {
      const args = {project: row.project, zone: row.zone, name: row.name};
      const result = await api('ssh.info', args), info = result.ssh;
      const content = node('div');
      content.append(node('p', 'SSH host: ' + info.host + (info.os_login ? ' | OS Login enabled: use your OS Login Linux username.' : ' | Choose the Linux username.')));
      const fields = node('div'); content.append(fields);
      const sshForm = AppUIJsonForm.create({container: fields, value: {User: info.users[0] || ''}});
      content.append(node('p', 'Terminal uses the existing SSH key or SSH configuration on the framework host. This saves a connection entry; press Connect in Terminal to establish the shell.'));
      const notice = node('p'); notice.setAttribute('role', 'status'); content.append(notice);
      let authorizing = false;
      AppUIDialog.show({title: 'SSH: ' + row.name, body: content, onClose: () => sshForm.destroy(), buttons: [
        ...(!info.os_login ? [{text: 'Authorize SSH key', action: () => {
          if (authorizing) return false;
          const user = sshForm.getValue().User;
          AppUIDialog.confirm('Add this machine\'s existing public SSH key for ' + user + ' on ' + row.name + '? Other keys and metadata will be preserved.', async () => {
            authorizing = true;
            try {
              notice.textContent = 'Authorizing SSH key...';
              let result = await api('ssh.authorize', {...args, user, confirm: true});
              const deadline = Date.now() + 120000;
              while (result.operation && result.operation.status !== 'DONE') {
                if (result.operation.error) throw new Error(JSON.stringify(result.operation.error));
                if (Date.now() > deadline) throw new Error('Key update still running. Check Google Cloud Console before retrying.');
                await wait(2000);
                result = await api('operation', {...args, name: result.operation.name});
              }
              if (result.operation?.error) throw new Error(JSON.stringify(result.operation.error));
              notice.textContent = 'SSH key authorized. Open Terminal and press Connect; the guest may take a few seconds to apply the key.';
            } catch (e) { notice.textContent = e.message; } finally { authorizing = false; }
          });
          return false;
        }}] : []),
        {text: 'Cancel'}, {text: 'Open Terminal', action: () => {
          const user = sshForm.getValue().User;
          const popup = window.open('about:blank', '_blank');
          api('ssh.save', {...args, user, confirm: true}).then(saved => {
            if (popup) { popup.opener = null; popup.location.href = saved.terminal_url; }
            else location.href = saved.terminal_url;
            status('SSH connection saved for ' + user + '@' + info.host);
          }).catch(e => { popup?.close(); status(e.message); });
        }}
      ]});
    } catch (e) { status(e.message); }
  }
  async function control(row, action) {
    const key = row.project + '/' + row.zone + '/' + row.name;
    if (pending.has(key)) return;
    AppUIDialog.confirm(action.toUpperCase() + ' ' + row.name + ' in ' + row.project + ' / ' + row.zone + '?' +
      (action === 'reset' ? ' This is a hard restart.' : ''), async () => {
      if (pending.has(key) || disposed) return;
      pending.add(key);
      const args = {project: row.project, zone: row.zone, name: row.name, action, confirm: true};
      try {
        status('Requesting ' + action + '...');
        let result = await api('control', args);
        const name = result.operation.name;
        const deadline = Date.now() + 10 * 60 * 1000;
        while (!disposed) {
          const operation = result.operation;
          if (operation.error) throw new Error(JSON.stringify(operation.error));
          status(action + ': ' + operation.status + ' | operation ' + name);
          if (operation.status === 'DONE') { await refresh(); status(action + ' completed for ' + row.name); break; }
          if (Date.now() > deadline) { status('Operation ' + name + ' is still running. Check its status in Google Cloud Console.'); break; }
          await wait(2500);
          if (disposed) break;
          result = await api('operation', {project: row.project, zone: row.zone, name});
        }
      } catch (e) { status(e.message); } finally { pending.delete(key); }
    });
  }
  function updateOverview() {
    if (!overviewCards) return;
    const stats = [['Instances',inventory.length],['Running',inventory.filter(v=>v.status==='RUNNING').length],
      ['Stopped',inventory.filter(v=>v.status==='TERMINATED').length],['Public IPv4',inventory.filter(v=>v.external_ip).length]];
    overviewCards.replaceChildren(...stats.map(([label,value])=>{
      const c=node('div'); c.className='gvm-stat'; c.append(node('span',label),node('strong',String(value))); return c;
    }));
  }
  function permissionsPanel(el) {
    const top=node('div'); top.className='gvm-section-header';
    top.append(node('h2','Permissions & access'),node('p','Choose a VM and optionally its disk and target service account. Test the permissions of the same Google identity used for VM actions.'));
    el.append(top);
    const guide=node('div'); guide.className='gvm-guide';
    const linkRow=node('div'); linkRow.className='gvm-toolbar';
    function link(label,url) {const a=node('a',label);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;}
    guide.append(node('h3','1. Connect Google Cloud'),node('p','Enable Compute Engine API. Sign in with Google in Overview, or configure Application Default Credentials. A VM access scope does not grant IAM roles.'),linkRow);
    el.append(guide);
    const updateLinks=()=>{const project=encodeURIComponent(target().project);linkRow.replaceChildren(
      link('Enable Compute Engine API','https://console.cloud.google.com/apis/library/compute.googleapis.com?project='+project),
      link('Project IAM','https://console.cloud.google.com/iam-admin/iam?project='+project),
      link('Service accounts','https://console.cloud.google.com/iam-admin/serviceaccounts?project='+project),
      link('Official permission guide','https://cloud.google.com/compute/docs/access/iam'));};
    const fields=node('div'); fields.className='gvm-filter';
    const vm=node('select'); vm.setAttribute('aria-label','VM for permission check');
    const disk=node('input');disk.placeholder='Boot disk (automatic if blank)';
    const account=node('input');account.placeholder='Service account email (automatic if blank)';
    const zone=node('input');zone.placeholder='Zone (from selected VM)';
    for(const [label,field] of [['VM',vm],['Zone',zone],['Disk',disk],['Service account to attach',account]]) {
      const l=node('label');l.append(node('span',label),field);fields.append(l);
    }
    const bar=node('div');bar.className='gvm-toolbar';
    const test=node('button','Check current permissions');test.type='button';
    const search=node('input');search.placeholder='Filter actions or permission names';search.setAttribute('aria-label','Filter permissions');
    const filter=node('select');filter.setAttribute('aria-label','Filter permission status');
    for(const [val,label] of [['all','All actions'],['not_granted','Missing permissions'],['unknown','Not verified'],['granted','Core checks passed']]){const o=node('option',label);o.value=val;filter.append(o);}
    bar.append(test,search,filter);
    const notice=node('div');notice.className='gvm-note';notice.setAttribute('role','status');
    const summary=node('div');summary.className='gvm-stats';
    const rows=node('div');rows.className='gvm-permission-list';
    const roles=node('div');roles.className='gvm-guide';
    el.append(node('h3','2. Test the acting identity'),fields,bar,notice,summary,node('h3','3. Action requirements'),rows,roles);
    let catalog=null,result=null,checking=false,selectionRevision=0;
    function fillVms(items) {
      const current=vm.value;vm.replaceChildren();
      const blank=node('option','Project only — no VM selected');blank.value='';vm.append(blank);
      for(const item of items){const o=node('option',item.name+' · '+item.zone);o.value=item.zone+'/'+item.name;vm.append(o);}
      if([...vm.options].some(o=>o.value===current))vm.value=current;else if(current)reset();
    }
    permissionsSelect=fillVms;fillVms(inventory);
    vm.addEventListener('change',()=>{zone.value=vm.value.split('/')[0]||target().zone;disk.value='';account.value='';reset();});
    function reset(){selectionRevision++;result=null;notice.textContent='Selection changed. Run the permission check again.';render();}
    for(const i of [zone,disk,account])i.addEventListener('input',reset);
    function badge(state) {
      const b=node('span',{granted:'Core checks passed',not_granted:'Missing permission',unknown:'Not verified'}[state]||'Not verified');
      b.className='gvm-status '+(state||'unknown');return b;
    }
    function render() {
      if(!catalog)return;
      const actions=result?.actions||catalog.actions.map(a=>({...a,state:'unknown',requirements:a.requirements.map(r=>({...r,state:'unknown'}))}));
      summary.replaceChildren(...[['Actions',actions.length],['Core checks passed',actions.filter(a=>a.state==='granted').length],['Missing',actions.filter(a=>a.state==='not_granted').length],['Not verified',actions.filter(a=>a.state==='unknown').length]].map(([label,value])=>{
        const c=node('div');c.className='gvm-stat';c.append(node('span',label),node('strong',String(value)));return c;
      }));
      const q=search.value.trim().toLowerCase();rows.replaceChildren();
      for(const group of [...new Set(actions.map(a=>a.group))]){
        const subset=actions.filter(a=>a.group===group&&(filter.value==='all'||filter.value===a.state)&&(!q||JSON.stringify(a).toLowerCase().includes(q)));
        if(!subset.length)continue;
        const block=node('section');block.className='gvm-permission-group';block.append(node('h4',group));
        for(const a of subset){
          const d=node('details');d.className='gvm-permission';
          const line=node('summary');line.append(node('strong',a.label),badge(a.state));d.append(line);
          const body=node('div');body.className='gvm-permission-body';
          if(a.note)body.append(node('p',a.note));
          for(const r of a.requirements){const x=node('div');x.className='gvm-requirement';const desc=node('div');desc.append(node('code',r.permission),node('small',catalog.scope_names[r.scope]));x.append(desc,badge(r.state));body.append(x);}
          const role=node('p');role.append(node('strong','Suggested roles: '),node('span',a.roles.join(' · ')));body.append(role);
          d.append(body);block.append(d);
        }
        rows.append(block);
      }
      if(!rows.children.length)rows.append(node('p','No matching actions.'));
    }
    search.addEventListener('input',render);filter.addEventListener('change',render);
    window.addEventListener('googlevm:permission-target',event=>{
      const d=event.detail;vm.value=d.row.zone+'/'+d.row.name;vm.dispatchEvent(new Event('change'));
      if(d.disk)disk.value=d.disk;
      const aliases={stop_source:'Stop VM',stop_replacement:'Stop VM',start_replacement:'Start VM'};
      const item=catalog?.actions.find(a=>a.id===d.action);
      search.value=aliases[d.action]||item?.label||'';filter.value='all';render();
      if(d.accountFromSource)notice.textContent='For migration identity, enter the ORIGINAL VM service account email here, then check permissions. Do not test only the replacement’s current account.';
    });
    test.addEventListener('click',async()=>{
      if(checking)return;checking=true;test.disabled=true;result=null;render();
      notice.textContent='Testing permissions with Google…';updateLinks();
      const cfg=target(), selected=vm.value.split('/'), revision=selectionRevision;
      try{
        if(!cfg.project)throw new Error('Set the Google Cloud project in Overview.');
        if(vm.value&&zone.value.trim()&&zone.value.trim()!==selected[0])throw new Error('Selected VM and zone must match.');
        const checked=await api('permissions.check',{project:cfg.project,zone:selected[0]||zone.value.trim()||cfg.zone,vm:selected[1]||'',disk:disk.value.trim(),service_account:account.value.trim()});
        if(disposed)return;
        if(revision!==selectionRevision || cfg.project!==target().project){reset();return;}
        result=checked;
        notice.replaceChildren(node('strong','Credential: '+(result.credential_source==='adc'?'Application Default Credentials':'Browser OAuth')+(result.principal?' · '+result.principal:'')),node('p','VM: '+(result.selection.vm||'none')+' | Disk: '+(result.selection.disk||'none')+' | Service account: '+(result.selection.service_account||'none')));
        for(const [scope,state] of Object.entries(result.scopes))notice.append(node('p',catalog.scope_names[scope]+': '+state.reason));
        for(const w of result.warnings||[])notice.append(node('p',w));
        notice.append(node('p',result.note));render();
      }catch(e){notice.textContent=e.message;result=null;render();}
      finally{checking=false;test.disabled=false;}
    });
    api('permissions.catalog').then(c=>{
      catalog=c;roles.append(node('h3','4. Grant the minimum required roles'));
      for(const r of c.roles){const p=node('p');p.append(node('strong',r.title+' — '),node('code',r.id),node('span',' | '+r.scope));roles.append(p);}
      for(const entry of c.setup_steps||[]){
        const d=node('details');d.className='gvm-permission';
        d.append(node('summary',entry.title+' · '+entry.role));
        const ol=node('ol');for(const step of entry.steps)ol.append(node('li',step));d.append(ol);roles.append(d);
      }
      for(const g of c.guidance)roles.append(node('p',g));
      updateLinks();render();notice.textContent='No live permission check has run yet. Expand an action for exact IAM permissions.';
    }).catch(e=>{notice.textContent=e.message;});
    return {selectRow(row){if(inventory.some(v=>v.name===row.name&&v.zone===row.zone)){vm.value=row.zone+'/'+row.name;vm.dispatchEvent(new Event('change'));}updateLinks();},
      reset(){reset();updateLinks();}};
  }
  // The reviewed plan can be exported and resumed on an independent Pylon controller.
  function migrationPanel(el) {
    const panel = node('section'), fields = node('div'), controls = node('div');
    const report = node('pre'), rows = node('div'), warnings = node('div');
    const text = node('textarea'); text.rows = 8; text.style.width = '100%';
    text.setAttribute('aria-label', 'Reviewed migration plan JSON');
    const independent = node('input'); independent.type = 'checkbox';
    const independentLabel = node('label'); independentLabel.append(independent, ' I have independent management access (this controller is not either VM being stopped).');
    const acceptance = node('fieldset'); acceptance.append(node('legend', 'Manual acceptance before removing the original VM'));
    const checks = {};
    const titles = {filesystem:'Filesystem expanded and healthy', databases:'Databases and private data verified',
      services:'All required services and apps verified', owner_auth:'Real owner authentication verified',
      mcp:'MCP and management access verified on replacement', public_endpoint:'DNS, HTTPS and endpoint access verified (or private-only access confirmed)',
      backup:'Rollback copy/backup verified'};
    for (const [key, label] of Object.entries(titles)) {
      const input = node('input'); input.type = 'checkbox'; checks[key] = input;
      const line = node('label'); line.style.display = 'block'; line.append(input, ' ' + label); acceptance.append(line);
    }
    const deleteName = node('input'); deleteName.placeholder = 'Type original VM name'; deleteName.setAttribute('aria-label', 'Original VM name for deletion');
    acceptance.append(deleteName);
    panel.append(node('h2','VM migration'), node('p','Same-zone, single-boot-disk migration. Each step is separately confirmed. The replacement and original boot disks are retained for rollback. Resume from an independent controller before stopping a VM.'), fields, controls, warnings, independentLabel, text, report, rows, acceptance);
    el.append(panel);
    const mf = AppUIJsonForm.create({container:fields, value:{Source:'', Replacement:'', 'Clone disk GB':'20'}});
    let plan = null, running = false, currentOperation = null, state = null;
    function info(message) { report.textContent = message; }
    function btn(host, label, fn) {
      const b = node('button',label); b.type = 'button'; b.addEventListener('click',fn); host.append(b); return b;
    }
    function args() { if (!plan) throw new Error('Create or import a reviewed plan first.'); return {project:plan.project, zone:plan.zone, plan}; }
    function clearAcceptance() { for (const c of Object.values(checks)) c.checked = false; deleteName.value = ''; }
    function showPlan(p) {
      plan = p; state = null; currentOperation = null;
      text.value = JSON.stringify(p,null,2); rows.replaceChildren(); clearAcceptance();
      info('Reviewed plan ' + p.review_sha256 + '\n' + p.source + ' → ' + p.replacement + ' | ' + p.size_gb + ' GB ' + p.disk_type + '\nClone: ' + p.clone_disk + ' | Public IP: ' + (p.source_ip || 'none'));
    }
    function readStatus(result) {
      state = result; rows.replaceChildren();
      const controller = result.controller ? result.controller.name : 'not identified (verify independently)';
      info('Source: ' + result.source_status + ' | Replacement: ' + result.replacement_status + '\nBoot: ' + (result.replacement_boot || 'none') + ' | IP: ' + (result.replacement_ip || 'none') + '\nController: ' + controller + '\nIdentity: ' + (result.identity_ready ? 'ready' : 'pending; may require Service Account User (iam.serviceAccounts.actAs)'));
      for (const step of result.steps) {
        const line = node('div'); line.style.display='flex'; line.style.alignItems='center'; line.style.gap='0.75rem';
        const name = node('span',step.title + ' — ' + step.status); name.style.flex='1'; line.append(name);
        const guide = btn(line,'Access', () => {
          const useSource=['stop_source','clone_disk','reserve_ip','release_ip','retain_source_disk','delete_source'].includes(step.action);
          const name=useSource?plan.source:plan.replacement;
          showTab('permissions');
          const selected=inventory.find(v=>v.name===name&&v.zone===plan.zone);
          if(selected) window.dispatchEvent(new CustomEvent('googlevm:permission-target',{detail:{row:selected,action:step.action,accountFromSource:step.action==='copy_identity',disk:step.action==='clone_disk'?plan.source_disk:step.action==='attach_clone'?plan.clone_disk:''}}));
        });
        guide.setAttribute('aria-label','Permission guide for '+step.title);
        const b = btn(line,'Run', () => run(step)); b.disabled = running || step.status !== 'available';
        b.dataset.migrationRun='1'; rows.append(line);
      }
    }
    async function refreshState() {
      if (disposed || !plan) return;
      readStatus(await api('migration.status', args()));
    }
    async function run(step) {
      if (running || disposed) return;
      try {
        const base = {...args(), action:step.action};
        const preview = await api('migration.step', base);
        if (preview.already_done) { await refreshState(); return; }
        if (!preview.dry_run) throw new Error('Expected a read-only preview');
        const stop = ['stop_source','stop_replacement'].includes(step.action);
        const remove = step.action === 'delete_source';
        if (stop && !independent.checked) throw new Error('Confirm independent management access first.');
        const attested = Object.fromEntries(Object.entries(checks).map(([k,v])=>[k,v.checked]));
        if (remove && (!Object.values(attested).every(v=>v) || deleteName.value !== plan.source)) throw new Error('Complete all manual acceptance checks and type the original VM name.');
        AppUIDialog.confirm(preview.title + '?' + (remove ? ' The old VM will be permanently removed; its boot disk will be retained.' : '') + '\nPlan: ' + plan.review_sha256, async () => {
          if (running || disposed) return;
          running=true;
          for (const b of rows.querySelectorAll('[data-migration-run]')) b.disabled=true;
          try {
            const result = await api('migration.step', {...base, review_sha256:plan.review_sha256, confirm:true,
              independent_controller:independent.checked, ...(remove ? {acceptance:attested,delete_name:deleteName.value} : {})});
            if (result.already_done) { await refreshState(); return; }
            currentOperation={scope:result.scope,name:result.operation.name,action:step.action};
            await poll(result);
          } catch(e) { info(e.message + '\nRefresh live status before retrying.'); }
          finally { running=false; if (state) for (const [i,b] of [...rows.querySelectorAll('[data-migration-run]')].entries()) b.disabled=!!currentOperation || state.steps[i]?.status!=='available'; }
        });
      } catch(e) { info(e.message); }
    }
    async function poll(result) {
      const until=Date.now()+10*60*1000;
      while (!disposed) {
        const op=result.operation;
        info(currentOperation.action + ': ' + op.status + ' | ' + currentOperation.name + ' (' + currentOperation.scope + ')');
        if (op.error) {currentOperation=null; throw new Error(JSON.stringify(op.error));}
        if (op.status==='DONE') {
          const removed=currentOperation.action==='delete_source'; currentOperation=null;
          if (removed) { rows.replaceChildren(); state=null; info('Google reports original VM deletion complete. Its boot disk was retained. Check the instance/disk inventory.'); await refresh(); }
          else { running=false; await refreshState(); await refresh(); }
          return;
        }
        if(Date.now()>until) {info('Operation still running: '+currentOperation.name+' ('+currentOperation.scope+'). Poll again; do not repeat the mutation.'); return;}
        await wait(2500);
        if(disposed)return;
        result=await api('migration.operation',{...args(),scope:currentOperation.scope,name:currentOperation.name});
      }
    }
    btn(controls,'Check IAM permissions',()=>showTab('permissions'));
    btn(controls,'Create migration plan',async()=>{
      if(running || currentOperation)return;
      try {
        const v=mf.getValue();const cfg=target();
        if(!cfg.zone)throw new Error('Set the exact source/replacement zone above.');
        const result=await api('migration.plan',{...cfg,source:v.Source.trim(),replacement:v.Replacement.trim(),size_gb:Number(v['Clone disk GB'])});
        showPlan(result.plan);warnings.replaceChildren(...(result.warnings||[]).map(w=>node('p',w)));await refreshState();
      }catch(e){info(e.message);}
    });
    btn(controls,'Import / resume plan',async()=>{
      if(running||currentOperation)return;
      try {
        const p=JSON.parse(text.value);
        const result=await api('migration.status',{project:p.project,zone:p.zone,plan:p});
        showPlan(p);readStatus(result);
      }catch(e){info(e.message);}
    });
    btn(controls,'Download reviewed plan',()=>{
      if(!plan)return;
      const a=node('a');const url=URL.createObjectURL(new Blob([JSON.stringify(plan,null,2)],{type:'application/json'}));
      a.href=url;a.download='pylon-vm-migration-'+plan.review_sha256.slice(0,12)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    });
    btn(controls,'Refresh migration status',async()=>{
      if(running||currentOperation)return;
      try{await refreshState();}catch(e){info(e.message);}
    });
    btn(controls,'Poll pending operation',async()=>{
      if(running||!currentOperation)return;running=true;
      try{await poll(await api('migration.operation',{...args(),scope:currentOperation.scope,name:currentOperation.name}));}
      catch(e){info(e.message);}finally{running=false;}
    });
    window.addEventListener('pagehide',()=>mf.destroy(),{once:true});
  }
  window.addEventListener('pagehide', () => { disposed = true; table?.destroy(); scriptTable?.destroy(); form?.destroy(); });
  window.AppUIReady.then(() => {
    AppUI.createApp({id: 'personal-googlevm', title: 'Google VM', content: {render(el) {
      const title = node('h2', 'Google Compute Engine');
      const help = node('p', 'Connect using Sign in with Google. Enable the Compute Engine API and grant your account permission to list, start, stop and reset instances. Leave Zone blank to list all zones.');
      const setup=node('div');setup.className='gvm-guide';
      setup.append(node('h3','Google Cloud connection'),node('p','Manage the shared OAuth client and the Compute authorization profile in Google Auth. Google VM uses the saved Compute token, or Application Default Credentials when no browser token is configured.'));
      const authNotice=node('p','Checking Google connection…');setup.append(authNotice);
      async function checkAuth(){
        try{const r=await api('auth.status');authNotice.textContent=r.signed_in===true?'Google account connected':r.signed_in===false?'No valid Google browser sign-in. VM credentials (ADC) may still be available.':(r.reason||'Google sign-in could not be verified.');}
        catch(e){authNotice.textContent=e.message;}
      }
      const central=node('a','Manage Google connections in Google Auth');central.href='/apps/platform/googleauth/';const centralRow=node('p');centralRow.append(central);setup.append(centralRow);
      const fields = node('div'), toolbar = node('div'), host = node('div');
      message = node('p'); message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite');
      el.classList.add('gvm-dashboard');
      const tabs=node('div');tabs.className='gvm-tabs';tabs.setAttribute('role','tablist');
      const panels={},tabButtons={};
      for(const [id,label] of [['overview','Overview'],['permissions','Permissions'],['migration','Migration'],['services','Services & scripts']]){
        const b=node('button',label);b.type='button';b.setAttribute('role','tab');b.id='gvm-tab-'+id;b.setAttribute('aria-controls','gvm-panel-'+id);
        const section=node('section');section.id='gvm-panel-'+id;section.setAttribute('role','tabpanel');section.setAttribute('aria-labelledby',b.id);
        b.addEventListener('click',()=>showTab(id));tabs.append(b);tabButtons[id]=b;panels[id]=section;
      }
      showTab=id=>{for(const key of Object.keys(panels)){panels[key].hidden=key!==id;tabButtons[key].setAttribute('aria-selected',String(key===id));}};
      overviewCards=node('div');overviewCards.className='gvm-stats';updateOverview();
      toolbar.className='gvm-toolbar';
      panels.overview.append(help, setup, fields, toolbar, overviewCards, host);
      el.append(title,tabs,message,...Object.values(panels));showTab('overview');
      form = AppUIJsonForm.create({container: fields, value: {Project: '', Zone: ''}});
      fields.addEventListener('input',()=>{if(typeof permissionUI!=='undefined')permissionUI.reset();});
      function button(label, handler) {
        const b = node('button', label); b.type = 'button'; b.addEventListener('click', handler); toolbar.append(b);
      }
      button('Sign in with Google', () => { location.href='/apps/platform/googleauth/'; });
      button('Save defaults', async () => {
        try { await api('configure', {...target(), confirm: true}); status('Defaults saved.'); } catch (e) { status(e.message); }
      });
      button('Refresh', async()=>{await checkAuth();await refresh();});
      checkAuth();
      button('Daemon status', async () => {
        try {
          const result = await api('daemon.status');
          if (!result.connected) { status('Linux daemon is not connected.'); return; }
          const warn = result.disk_warning ? (' [' + result.disk_warning.toUpperCase() + ' DISK]') : '';
          const pct = result.disk_used_pct != null ? (' (' + result.disk_used_pct + '% used)') : '';
          status(result.endpoint + ' connected | ' + result.system.hostname + ' | ' + Math.round(result.system.uptime_s) + 's uptime | ' + Math.round(result.system.disk.free / 1073741824 * 10) / 10 + ' GiB free' + pct + warn);
        } catch (e) { status(e.message); }
      });
      button('Cleanup VM caches', async () => {
        try {
          const preview = await api('daemon.cleanup', {days: 14});
          if (!confirm('Clean VM caches on ' + (preview.endpoint || 'VM') + '?\n' + (preview.actions || []).join('\n'))) return;
          const res = await api('daemon.cleanup', {days: 14, confirm: true});
          status('VM cleanup done: ' + ((res.result && res.result.stdout) || 'ok').trim());
        } catch (e) { status(e.message); }
      });
      button('Permissions', () => showTab('permissions'));
      button('Export XLSX', () => table.exportXlsx({filename: 'google-vms'}));
      button('Export CSV', () => table.exportCsv({filename: 'google-vms'}));
      const columns = ['name','status','zone','machine_type','internal_ip','external_ip'].map(id => ({id, label: id.replaceAll('_', ' '), sortable: true, filterable: true}));
      columns.push({id: 'console_url', label: 'Console', render: row => {
        const a = node('a', 'Open'); a.href = row.console_url; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a;
      }, exportLink: row => row.console_url});
      columns.push({id: 'ssh', label: 'SSH', export: false, actions: row => [{label: 'SSH', disabled: row.status !== 'RUNNING', action: () => openSSH(row)}]});
      columns.push({id:'permissions',label:'Permissions',export:false,actions:row=>[{label:'Check access',action:()=>{showTab('permissions');permissionUI.selectRow(row);}}]});
      columns.push({id: 'actions', label: 'Controls', export: false, actions: row => ['start','stop','reset'].map(action => ({
        label: action, disabled: action === 'start' ? row.status !== 'TERMINATED' : row.status !== 'RUNNING',
        action: () => control(row, action)
      }))});
      table = AppUIDataTable.create({container: host, columns, items: [], getId: row => row.project + '/' + row.zone + '/' + row.name, empty: 'Set your project and refresh to list VMs.'});
      const permissionUI=permissionsPanel(panels.permissions);
      migrationPanel(panels.migration);
      panels.services.append(node('h2', 'Deployed scripts and capabilities'));
      const refreshServices=node('button','Refresh scripts');refreshServices.type='button';refreshServices.addEventListener('click',refreshScripts);panels.services.append(refreshServices);
      scriptNotice = node('p'); scriptNotice.setAttribute('role', 'status'); panels.services.append(scriptNotice);
      const scriptsHost = node('div'); panels.services.append(scriptsHost);
      scriptTable = AppUIDataTable.create({container: scriptsHost, getId: row => row.path, items: [],
        empty: 'No deployed scripts found.', columns: [
          {id:'path', label:'Deployed script', sortable:true},
          {id:'capability', label:'Capability', sortable:true},
          {id:'methods', label:'Exposed methods'},
            {id:'endpoint', label:'MCP endpoint'},
          {id:'service', label:'Service'},
          {id:'status', label:'Status', sortable:true},
          {id:'mtime', label:'Updated', sortable:true, render: row => row.mtime ? new Date(row.mtime * 1000).toLocaleString() : ''}
        ]});
      refreshScripts();
      api('settings').then(result => {
        if (disposed) return;
        form.setValue({Project: result.settings.project, Zone: result.settings.zone});
        status(result.setup);
        if (result.settings.project) refresh();
      }).catch(e => status(e.message));
    }}});
  });
})();
