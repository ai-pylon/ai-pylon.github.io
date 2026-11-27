(function () {
  'use strict';
  let form, toolbar, table, statusText, notice, endpoint, logs, poller, jobPoller, fileTable, fileToolbar, fileLocation;
  let customTable, historyToolbar, toolSummary, sessionTree, treeToolbar, treeHint, overviewHost, sessionHost, sessionView;
  let sessions = [], treeFingerprint = null, treeInitialized = false;
  let selectedId = new URL(location.href).searchParams.get("session") || "";
  let filePath = '', fileRequest = 0, currentWorkspace = '';
  let disposed = false, busy = false, jobId = sessionStorage.getItem('googlevm_mcp.deployJob') || '';
  let jobLabel = sessionStorage.getItem('googlevm_mcp.jobLabel') || 'Deployment';
  const base = '/v1/apps/personal/googlevm_mcp/';
  const node = (tag, text) => {const el = document.createElement(tag); if (text) el.textContent = text; return el;};
  async function call(path, args = {}) {
    const r = await AppUIApi.request(path, args);
    if (!r.ok) throw new Error(r._error || r.error || 'Request failed');
    return r;
  }
  const api = (op, args) => call(base + op, args);
  async function refreshHistory() {
    const results = await Promise.allSettled([api('tools.catalog'),api('sessions.list',{limit:500})]);
    if (disposed) return;
    if (results[0].status === 'fulfilled') customTable.setItems(results[0].value.items || []);
    if (results[1].status === 'fulfilled') {
      sessions = results[1].value.items || [];
      renderSessionTree();
      const selected = sessions.find(row => row.id === selectedId);
      if (selected && !sessionView) openSession(selected);
      else if (selected && sessionView && sessionView.revision !== selected.updated) {sessionView.revision = selected.updated; sessionView.refresh();}
      else if (selectedId && !selected) {showOverview(); message('The selected session is not in the current history list.');}
    }
    const failed = results.find(result => result.status === 'rejected');
    if (failed) message(failed.reason.message);
  }
  function updateSessionUrl(id) {
    const url = new URL(location.href);
    if (id) url.searchParams.set('session',id); else url.searchParams.delete('session');
    history.replaceState(null,'',url);
  }
  function showOverview() {
    sessionView?.destroy(); sessionView = null;
    selectedId = ''; updateSessionUrl('');
    if (overviewHost) overviewHost.hidden = false;
    if (sessionHost) {sessionHost.hidden = true;sessionHost.replaceChildren();}
    if (notice && overviewHost) overviewHost.prepend(notice);
    sessionTree?.setActive('overview');
  }
  function sessionTitle(row) {
    return row.principal === 'http-unauthenticated' ? 'Authentication requests' : row.title === 'Unassigned client tool activity' ? 'Client activity' : row.title || 'Session';
  }
  function sessionLabel(row) {
    const title = sessionTitle(row);
    return title + ' - ' + new Date(row.updated).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) + ' - ' + row.id.slice(-6);
  }
  function renderSessionTree() {
    if (!sessionTree) return;
    const fingerprint = JSON.stringify(sessions.map(row => [row.id,row.title,row.updated,row.event_count,row.coverage,row.principal]));
    if (fingerprint === treeFingerprint) return;
    treeFingerprint = fingerprint;
    const groups = [
      {name:'Authenticated sessions',path:'activity/authenticated',anonymous:false},
      {name:'Authentication traffic',path:'activity/authentication',anonymous:true}
    ];
    const roots = [{name:'Overview',path:'overview',hasChildren:false,data:{kind:'overview'}}];
    const initialExpanded = {};
    for (const group of groups) {
      const records = sessions.filter(row => (row.principal === 'http-unauthenticated') === group.anonymous);
      if (!records.length) continue;
      const days = new Map();
      for (const row of records) {
        const day = new Date(row.created || row.updated).toLocaleDateString();
        if (!days.has(day)) days.set(day,[]);
        days.get(day).push({name:sessionLabel(row),path:'session/' + row.id,hasChildren:false,
          icon:group.anonymous ? '\u{1F512}' : row.coverage === 'client_transcript' ? '\u{1F4AC}' : '\u{1F4C4}',badge:(row.event_count || 0) + ' events',
          title:(group.anonymous ? 'Requests without valid OAuth credentials; not paired to a signed-in conversation.' : 'Authenticated client ' + row.principal) + '\n' + row.id + '\n' + (row.coverage === 'client_transcript' ? 'Client transcript + tools' : 'Tool activity only'),data:{kind:'session',row}});
      }
      const children = Array.from(days,([day,children]) => ({name:day,path:group.path + '/' + day,hasChildren:true,children,badge:String(children.length),data:{kind:'day'}}));
      roots.push({...group,hasChildren:true,children,badge:String(records.length),data:{kind:'group'}});
      initialExpanded[group.path] = true;
      children.forEach(day => {initialExpanded[day.path]=true;});
      if (selectedId) children.forEach(day => {if (day.children.some(child => child.data.row.id===selectedId)) initialExpanded[day.path]=true;});
    }
    if (!treeInitialized && sessions.length) {
      const expanded = sessionTree.getExpanded();
      if (!Object.keys(expanded).length) Object.assign(expanded,initialExpanded);
      if (selectedId) for (const group of roots) for (const day of group.children || []) {
        if (day.children.some(child => child.data.row.id===selectedId)) {expanded[group.path]=true;expanded[day.path]=true;}
      }
      sessionTree.setExpanded(expanded); treeInitialized = true;
    }
    sessionTree.setRoots(roots);
    treeHint.textContent = sessions.length ? sessions.length + ' activity records' + (sessions.length === 500 ? ' (latest 500)' : '') : 'No saved sessions yet.';
    sessionTree.setActive(selectedId ? 'session/' + selectedId : 'overview');
  }
  function mountSessionTree(host) {
    const controls = node('div'), treeHost = node('div'); treeHint = node('p','Loading sessions...');
    host.append(controls,treeHint,treeHost);
    treeToolbar = AppUIToolbar.create({container:controls,label:'Session navigation controls',items:[
      {label:'Overview',action:showOverview},{label:'Refresh sessions',action:refreshHistory}
    ]});
    sessionTree = AppUITree.create({container:treeHost,searchable:true,searchPlaceholder:'Search sessions...',
      storageKey:'googlevm_mcp.sessions.expanded',autoScrollActive:false,
      matchFn:(item,query) => [item.name,item.data?.row?.id,item.data?.row?.principal,item.data?.row?.title].filter(Boolean).join(' ').toLowerCase().includes(query),
      onSelect:item => {if (item.data?.kind === 'session') openSession(item.data.row); else if (item.data?.kind === 'overview') showOverview();},
      onExpand:(item,done) => done(item.children || [])
    });
    renderSessionTree();
    return () => {sessionTree?.destroy();treeToolbar?.destroy();sessionTree = null;treeToolbar = null;treeFingerprint = null;treeInitialized = false;};
  }
  async function reviewTool(row) {
    try {
      const result = await api('tools.review',{name:row.name,version:row.version});
      if (disposed) return;
      const value = result.version;
      const body = node('div');
      body.append(node('p',value.unrestricted ? 'Unrestricted VM execution: versions activate automatically. Tests and manual rollback are optional.' : 'Review the code, permissions, tests and exact hash before activation.'),node('pre',JSON.stringify(value,null,2)));
      AppUIDialog.show({title:row.name + ' v' + row.version,body,width:'900px',buttons:[
        {text:'Test this version',action:() => {enqueue('tools.test',{name:row.name,version:row.version,confirm:true},'Tool tests').catch(error => message(error.message));}},
        {text:value.approved ? 'Activate / roll back to this version' : 'Approve and activate',disabled:!value.tested && !value.unrestricted,action:async () => {
          try {await api('tools.activate',{name:row.name,version:row.version,hash:value.hash,confirm:true}); message('Activated ' + row.name + ' v' + row.version); await refreshHistory();}
          catch (error) {message(error.message);}
        }}, {text:'Close'}
      ]});
    } catch (error) {message(error.message);}
  }
  function viewEvent(event, sessionId) {
    const payload = event.payload || {};
    if (!payload.traffic_id) {
      AppUIDialog.show({title:event.kind,body:node('pre',JSON.stringify(payload,null,2)),buttons:[{text:'Close'}]});
      return;
    }
    let direction = payload.direction || 'response', offset = 0, next = 0, closed = false, request = 0;
    const body = node('div'), summary = node('p'), content = node('pre');
    body.append(node('pre',JSON.stringify(payload,null,2)),summary,content);
    async function load(selected = direction, start = 0, length = 65536) {
      const generation = ++request;
      const result = await api('traffic.read',{session_id:sessionId,traffic_id:payload.traffic_id,direction:selected,offset:start,length});
      if (closed || disposed || generation !== request) return;
      direction = selected; offset = start; next = result.next_offset;
      summary.textContent = direction + ' | bytes ' + offset + '-' + next + ' / ' + result.total_bytes + (result.has_more ? ' | more available' : ' | end of saved body');
      let text = result.text;
      if (!offset && !result.has_more) {try {text = JSON.stringify(JSON.parse(text),null,2);} catch (_) {}}
      content.textContent = text || '(empty body)';
    }
    const show = (selected,start,length) => {load(selected,start,length).catch(error => message(error.message));return false;};
    async function download() {
      const result = await api('traffic.read',{session_id:sessionId,traffic_id:payload.traffic_id,direction,offset:0,length:0});
      const bytes = Uint8Array.from(atob(result.content_b64),ch => ch.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'}));
      const link = document.createElement('a'); link.href = url; link.download = payload.traffic_id + '.' + direction + '.body'; link.click();
      setTimeout(() => URL.revokeObjectURL(url),1000);
    }
    AppUIDialog.show({title:'MCP traffic: ' + (payload.rpc_method || payload.http_method || event.kind),body,width:'1100px',onClose:() => {closed=true;},buttons:[
      {text:'Request body',action:() => show('request',0)},
      {text:'Response body',action:() => show('response',0)},
      {text:'Previous chunk',action:() => show(direction,Math.max(0,offset-65536))},
      {text:'Next chunk',action:() => show(direction,next)},
      {text:'Show complete body',action:() => show(direction,0,0)},
      {text:'Download full body',action:() => {download().catch(error => message(error.message));return false;}},
      {text:'Close'}
    ]});
    show(direction,0);
  }
  async function openSession(row) {
    if (!sessionHost || disposed) return;
    sessionView?.destroy();
    selectedId = row.id; updateSessionUrl(row.id); sessionTree?.setActive('session/' + row.id);
    overviewHost.hidden = true; sessionHost.hidden = false; sessionHost.replaceChildren();
    let sessionActions;
    let more = true;
    let eventTable, exchangeTable, closed = false, loading = false, offset = 0, all = [];
    const body = node('div'), summary = node('p'), exchangeHost = node('div'), host = node('div'), actions = node('div');
    sessionHost.append(notice,node('h2',sessionTitle(row)),node('p',row.id + ' | Updated ' + new Date(row.updated).toLocaleString()),actions,body);
    body.append(summary,node('h3','HTTP exchanges'),exchangeHost,node('h3','Raw events'),host);
    async function load(reset = false) {
      if (loading || (!reset && !more)) return;
      loading = true;
      let result;
      try {result = await api('sessions.get',{session_id:row.id,offset:reset ? 0 : offset,limit:200});} finally {loading = false;}
      if (closed || disposed) return;
      if (reset) all = [];
      more = !!result.has_more || (result.offset ?? 0) + (result.events || []).length < result.total;
      const seen = new Set(all.map(event => event.id));
      all = all.concat((result.events || []).filter(event => !seen.has(event.id))); offset = all.length; eventTable.setItems(all);
      const diagnostics = result.diagnostics || {};
      exchangeTable.setItems(diagnostics.exchanges || []);
      summary.textContent = sessionTitle(row) + ' | ' + (row.coverage === 'client_transcript' ? 'Client transcript supplied; completeness depends on the client.' : 'Tool activity only: no chat transcript was supplied.') + ' | ' + offset + ' / ' + result.total + ' saved events' + (result.diagnostics ? ' | ' + diagnostics.requests + ' requests, ' + diagnostics.tool_calls + ' tool calls, ' + diagnostics.errors + ' HTTP errors, ' + diagnostics.negotiation_fallbacks + ' negotiation fallbacks' : '');
    }
    exchangeTable = AppUIDataTable.create({container:exchangeHost,items:[],getId:item => item.traffic_id,columns:[
      {id:'rpc_method',label:'MCP method'}, {id:'rpc_id',label:'RPC ID'}, {id:'status',label:'HTTP'},
      {id:'outcome',label:'Outcome'}, {id:'duration_ms',label:'Server ms',sortable:true},
      {id:'request_bytes',label:'Request bytes',sortable:true}, {id:'response_bytes',label:'Response bytes',sortable:true},
      {id:'view',label:'Details',actions:item => [{label:'View exchange',action:() => viewEvent({kind:'protocol.exchange',payload:{...item,direction:'response'}},row.id)}]}
    ],empty:'No full traffic records in this session.'});
    eventTable = AppUIDataTable.create({container:host,items:[],getId:event => event.id,columns:[
      {id:'ts',label:'Time',render:event => new Date(event.ts).toLocaleString()},
      {id:'kind',label:'Event'}, {id:'rpc_method',label:'MCP method',render:event => event.payload?.rpc_method || ''},
      {id:'status',label:'HTTP',render:event => event.payload?.status ?? ''}, {id:'role',label:'Role',render:event => event.payload?.role || ''},
      {id:'content',label:'Content',render:event => event.kind === 'message' ? (typeof event.payload.content === 'string' ? event.payload.content : JSON.stringify(event.payload.content)) : JSON.stringify(event.payload)},
      {id:'view',label:'Details',actions:event => [{label:'View',action:() => viewEvent(event,row.id)}]}
    ]});
    sessionActions = AppUIToolbar.create({container:actions,label:'Selected session controls',items:[
      {label:'Overview',action:showOverview},
      {label:'Refresh session',action:() => load(true).catch(error => message(error.message))},
      {label:'Load next 200',action:() => load().catch(error => message(error.message))},
      {label:'Export complete session',action:() => exportSession(row)}
    ]});
    sessionView = {id:row.id,revision:row.updated,
      refresh:() => load(true).catch(error => message(error.message)),
      destroy:() => {closed=true;eventTable.destroy();exchangeTable.destroy();sessionActions.destroy();}};
    try {await load();} catch (error) {message(error.message);summary.textContent = error.message;}
  }
  async function exportSession(row) {
    try {const result = await api('sessions.export',{session_id:row.id,confirm:true}); message('Exported to VM ' + result.path + '. Open VM data → data → sessions to fetch it locally.'); await browseFiles('data/sessions');}
    catch (error) {message(error.message);}
  }
  async function browseFiles(path = filePath) {
    const request = ++fileRequest;
    try {
      const result = await api('files.list', {path,limit:2000});
      if (disposed || request !== fileRequest) return;
      filePath = path; fileLocation.textContent = 'VM: /' + path + ' | Fetch destination: active workspace / Google VM';
      fileTable.setItems(result.entries || []);
      if (result.total > result.entries.length) message('Showing the first 2000 entries. Open a subfolder to narrow the listing.');
    } catch (error) {if (!disposed && request === fileRequest) message(error.message);}
  }
  async function previewFile(row) {
    try {
      const result = await api('files.read', {path:row.path,max_bytes:65536});
      if (disposed) return;
      const body = node('pre',result.content ?? result.text ?? '');
      AppUIDialog.show({title:row.name + (result.truncated ? ' (preview truncated)' : ''),body,buttons:[{text:'Close'}]});
    } catch (error) {message(error.message);}
  }
  async function fetchFile(row) {
    try {
      const connection = await api('connection');
      const selectedWorkspace = connection.workspace;
      AppUIDialog.confirm('Fetch ' + row.name + ' into the active workspace (' + selectedWorkspace + ')? The VM copy is kept.',async () => {
        try {await enqueue('files.fetch',{path:row.path,workspace:selectedWorkspace,confirm:true},'Fetch ' + row.name);}
        catch (error) {message(error.message);}
      });
    } catch (error) {message(error.message);}
  }
  function message(text) {if (!disposed) notice.textContent = text;}
  async function refresh() {
    if (disposed) return;
    try {
      const r = await api('status');
      if (disposed) return;
      statusText.textContent = (r.running ? 'Running' : 'Stopped or unhealthy') + ' | ' + (r.state.UnitFileState || 'not installed') + ' | ' + r.host + ' | ' + r.service + (r.legacy_service ? ' (legacy service)' : '') + (r.health?.unrestricted ? ' | Unrestricted execution' : ' | Reviewed execution');
      const exposed = r.health?.tools || [];
      table.setItems(exposed);
      toolSummary.textContent = r.health ? exposed.length + ' MCP tools exposed by the deployed server. Refresh to update this live list.' : 'Tool inventory unavailable: the deployed server is stopped or unreachable.';
    } catch (error) {if (!disposed) statusText.textContent = error.message;}
  }
  async function refreshLogs() {
    try {const r = await api('logs', {lines: 100}); if (!disposed) logs.textContent = r.text || 'No service logs.';}
    catch (error) {message(error.message);}
  }
  let jobTicking = false;
  async function jobTick() {
    // ROUND3 #9: long-poll (work_runner.wait returns at completion or after 20 s);
    // one chain at a time - the poller and enqueue() both call this.
    if (!jobId || disposed || jobTicking) return;
    jobTicking = true;
    try {
      const r = await call('/v1/apps/platform/work_runner/wait', {job_id: jobId, timeout_s: 20});
      const job = r.job || r;
      if (disposed) return;
      if (job.status === 'done') {
        const result = job.op_result || r.op_result;
        message(result?.ok ? (result.passed === false ? 'Tool tests failed; inspect the version details.' : result.saved_to ? 'Fetched to ' + result.saved_to : jobLabel + ' completed.') : jobLabel + ' failed: ' + (result?._error || result?.error || 'Inspect the background job.'));
      } else if (['error','failed','cancelled'].includes(job.status)) {
        message(jobLabel + ' ' + job.status + ': ' + (job.error || 'Inspect the background job.'));
      } else {message(jobLabel + ' ' + job.status + ' | ' + jobId); return;}
      jobId = ''; sessionStorage.removeItem('googlevm_mcp.deployJob'); sessionStorage.removeItem('googlevm_mcp.jobLabel'); busy = false;
      await refresh(); await refreshLogs(); await refreshHistory();
    } catch (error) {message(error.message);}
    finally {jobTicking = false;}
  }
  function deploy() {
    if (busy || jobId) {message('Deployment is already running.'); return;}
    AppUIDialog.confirm('Deploy the Google VM MCP service and apply its HTTPS/OAuth settings?', async () => {
      try {await enqueue('deploy',{confirm:true},'Deployment');}
      catch (error) {message(error.message);}
    });
  }
  async function enqueue(op, args, label) {
    if (busy || jobId) throw new Error('Wait for the current background job.');
    busy = true;
    try {
      const r = await call('/v1/apps/platform/work_runner/submit',{kind:'op',app:'personal/googlevm_mcp',op,args,timeout:600,label,confirm:true});
      jobId = r.job_id || r.job?.id;
      if (!jobId) throw new Error('Background job ID was not returned.');
      jobLabel = label; sessionStorage.setItem('googlevm_mcp.deployJob',jobId); sessionStorage.setItem('googlevm_mcp.jobLabel',label);
      message(label + ' queued | ' + jobId); jobTick();
    } catch (error) {busy = false; throw error;}
  }
  function control(action) {
    if (busy || jobId) {message('Wait for the current deployment.'); return;}
    AppUIDialog.confirm(action + ' the Google VM MCP service?', async () => {
      busy = true;
      try {await api('control', {action, confirm:true}); message('Service ' + action + ' requested.'); await refresh();}
      catch (error) {message(error.message);}
      finally {busy = false;}
    });
  }
  async function password() {
    try {
      const r = await api('credentials', {confirm:true});
      if (disposed) return;
      const body = node('div'), field = node('input'), tools = node('div');
      field.type = 'password'; field.readOnly = true; field.value = r.owner_password; field.autocomplete = 'off'; field.setAttribute('aria-label','MCP owner password');
      body.append(node('p','Use this password on the OAuth approval page.'), field, tools);
      const actions = AppUIToolbar.create({container:tools, items:[
        {label:'Show / hide',action:() => {field.type = field.type === 'password' ? 'text' : 'password';}},
        {label:'Copy password',action:event => AppUICopyButton.copy(event.currentTarget, () => field.value)}
      ]});
      AppUIDialog.show({title:'MCP owner password',body,onClose:() => {field.value = ''; actions.destroy();},buttons:[{text:'Close'}]});
    } catch (error) {message(error.message);}
  }
  window.AppUIReady.then(() => {
    AppUI.createApp({id:'personal-googlevm_mcp',title:'Google VM MCP',leftSidebar:{width:320,tabs:[{id:'sessions',label:'Sessions',active:true,render:mountSessionTree}]},content:{render(el) {
      overviewHost = node('div'); sessionHost = node('section'); sessionHost.hidden = true;
      el.append(overviewHost,sessionHost); el = overviewHost;
      const controls = node('div'), fields = node('div'), tools = node('div');
      const historyControls = node('div'), customHost = node('div');
      const fileControls = node('div'), fileHost = node('div');
      fileLocation = node('p');
      statusText = node('p','Reading service status...'); statusText.setAttribute('role','status');
      notice = node('p'); notice.setAttribute('role','status'); notice.setAttribute('aria-live','polite');
      toolSummary = node('p','Loading deployed MCP tools...');
      endpoint = node('code'); logs = node('pre','Use Refresh logs to read the service journal.');
      el.append(node('h2','pylon_mcp'),node('p','Manage the remote MCP service and connect an LLM using OAuth. File and command paths refer to the VM.'),endpoint,statusText,controls,notice,
        node('h3','MCP tools'),toolSummary,tools,
        node('h3','Conversations and sessions'),node('p','Full MCP requests and responses are saved automatically, including initialization, notifications and errors. Open a protocol event to inspect or download either body. Full chat text is saved only when the client sends user/assistant messages through vm.session.append. Select a session in the left tree to view its saved content.'),historyControls,
        node('h3','Versioned tools'),node('p','Create and modify Python tools, inspect versions and tests, or roll back. In unrestricted mode new versions activate immediately; tests and approval are optional.'),customHost,
        node('h3','VM data'),node('p','Durable MCP results live on the VM under ~/pylon-server/mcp-data. Deployment updates preserve them. Downloaded files are also available here.'),fileLocation,fileControls,fileHost,
        node('h3','Connection settings'),fields,node('p','Save settings, then deploy to apply them. The owner password stays in the shared credential vault.'),node('h3','Service logs'),logs);
      fileToolbar = AppUIToolbar.create({container:fileControls,label:'VM data controls',items:[
        {label:'Data roots',action:() => browseFiles('')},
        {label:'Up',action:() => browseFiles(filePath.split('/').slice(0,-1).join('/'))},
        {label:'Refresh files',action:() => browseFiles()},
        {label:'Open in VFS',action:() => window.open('/apps/file/vfs/?path=' + encodeURIComponent('vfs://app://googlevm_mcp/' + filePath),'_blank','noopener')}
      ]});
      fileTable = AppUIDataTable.create({container:fileHost,items:[],getId:row => row.path,columns:[
        {id:'name',label:'Name',sortable:true}, {id:'kind',label:'Type',sortable:true}, {id:'size',label:'Bytes',sortable:true},
        {id:'actions',label:'Actions',export:false,actions:row => row.kind === 'dir' ? [{label:'Open',action:() => browseFiles(row.path)}] : [
          {label:'Preview',action:() => previewFile(row)}, {label:'Fetch to workspace',action:() => fetchFile(row)}]}
      ],empty:'No files in this VM folder.'});
      form = AppUIJsonForm.create({container:fields,value:{host:'',origin:'',instance:'',redirect_uris:[]}});
      historyToolbar = AppUIToolbar.create({container:historyControls,label:'Session history controls',items:[{label:'Refresh history and tools',action:refreshHistory}]});
      customTable = AppUIDataTable.create({container:customHost,items:[],getId:row => row.name + ':' + row.version,columns:[
        {id:'name',label:'Tool',sortable:true}, {id:'version',label:'Version',sortable:true}, {id:'description',label:'Purpose'},
        {id:'permissions',label:'Permissions',render:row => row.permissions.join(', ') || 'Compute only'},
        {id:'tested',label:'Tests',render:row => row.tested ? 'Passed' : row.test_result ? 'Failed' : 'Not tested'},
        {id:'active',label:'Release',render:row => row.active ? 'Active' : row.approved ? 'Approved' : 'Proposed'},
        {id:'actions',label:'Actions',actions:row => [{label:'Review / activate',action:() => reviewTool(row)},...(row.active ? [{label:'Disable',action:() => AppUIDialog.confirm('Disable ' + row.name + '?',async () => {
          try {await api('tools.disable',{name:row.name,confirm:true}); await refreshHistory();} catch (error) {message(error.message);}
        })}] : [])]}
      ],empty:'No custom tools yet. An LLM can use tool_create; approved versions run through tool_run.'});
      toolbar = AppUIToolbar.create({container:controls,label:'MCP controls',items:[
        {label:'Refresh',action:refresh}, {label:'Deploy / update',action:deploy,primary:true},
        ...['start','stop','restart','enable','disable'].map(action => ({label:action[0].toUpperCase()+action.slice(1),action:() => control(action)})),
        {label:'Save settings',action:async () => {
          if (busy || jobId) {message('Wait for deployment to finish.'); return;}
          try {await api('configure',{...form.getValue(),confirm:true}); const r=await api('connection'); endpoint.textContent=r.endpoint; message('Settings saved. Deploy to apply.');}
          catch (error) {message(error.message);}
        }},
        {label:'Owner password',action:password}, {label:'Copy endpoint',action:event => AppUICopyButton.copy(event.currentTarget,() => endpoint.textContent)},
        {label:'Refresh logs',action:refreshLogs}
      ]});
      table = AppUIDataTable.create({container:tools,items:[],getId:row => row.name,columns:[{id:'name',label:'Tool',sortable:true},{id:'description',label:'Purpose'},{id:'details',label:'Details',export:false,actions:row => [{label:'View tool',action:() => AppUIDialog.show({title:row.name,body:node('p',row.description || 'No description supplied.'),buttons:[{text:'Close'}]})}]}],empty:'No tool inventory available while the service is stopped.'});
      api('connection').then(r => {if (!disposed) {form.setValue(r.settings); endpoint.textContent=r.endpoint; currentWorkspace=r.workspace || '';}}).catch(error => message(error.message));
      browseFiles('');
      refreshHistory();
      poller = AppUIPollRefresh.create(async () => {await refresh();await refreshHistory();},15000,{refreshOnVisible:true}); poller.start(); refresh();
      jobPoller = AppUIPollRefresh.create(jobTick,2500,{refreshOnVisible:true}); jobPoller.start(); jobTick();
    }}});
  });
  window.addEventListener('pagehide',() => {disposed=true; poller?.stop(); jobPoller?.stop(); form?.destroy(); toolbar?.destroy(); table?.destroy(); fileTable?.destroy(); fileToolbar?.destroy();customTable?.destroy();sessionView?.destroy();sessionTree?.destroy();treeToolbar?.destroy();historyToolbar?.destroy();});
})();
