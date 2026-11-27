window.AppUIReady.then(()=>{
  const APP="platform/code_sync";
  const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
  async function api(app,op,args={}){
    const r=await AppUIApi.requestResponse("/v1/apps/"+app+"/"+op,args,{method:"POST",timeout:20000,decode:r=>r.json()});
    return r.data;
  }
  // A shared directory-tree renderer for all source review modes.
  // Text labels accompany color; file names are always rendered as text.
  const labels={added:"Added",modified:"Modified",deleted:"Deleted",conflict:"Conflict",untracked:"Untracked",blocked:"Blocked",other:"Other"};
  const symbols={added:"A",modified:"M",deleted:"D",conflict:"!",untracked:"U",blocked:"!",other:"?"};
  function changeType(row){
    if(row.blocked)return "blocked";
    if(row.kind){
      if(row.kind==="conflict"||row.kind.endsWith("_missing"))return "conflict";
      if(row.kind==="unverified_remote")return "blocked";
      if(row.kind.endsWith("_new"))return "added";
      if(row.kind.endsWith("_modified"))return "modified";
      return "other";
    }
    const s=(row.status||"").trim();
    if(s==="??")return "untracked";
    if(s.includes("U")||["AA","DD"].includes(s))return "conflict";
    if(s.includes("D"))return "deleted";
    if(s.includes("A"))return "added";
    if(s.includes("M")||s.includes("T")||s.includes("R")||s.includes("C"))return "modified";
    return "other";
  }
  function fileTree(host,rows,{onFile,selected,indexClean=true,onSelection,empty="No changed files.",name="Files"}={}){
    host.replaceChildren();host.className="cs-tree-panel";
    const items=rows.map(r=>({...r,type:changeType(r)}));
    const tools=el("div");tools.className="cs-tree-tools";
    const search=el("input");search.type="search";search.placeholder="Find a file or folder…";search.setAttribute("aria-label","Search "+name);
    const filter=el("select");filter.setAttribute("aria-label","Filter "+name);
    filter.add(new Option("All changes","all"));
    const totals={};for(const r of items)totals[r.type]=(totals[r.type]||0)+1;
    for(const [key,label] of Object.entries(labels))if(totals[key])filter.add(new Option(label+" ("+totals[key]+")",key));
    const expand=el("button","Expand all"),collapse=el("button","Collapse all");
    expand.type=collapse.type="button";
    const stats=el("div");stats.className="cs-tree-stats";
    const legend=el("div");legend.className="cs-tree-legend";
    for(const [key,label] of Object.entries(labels))if(totals[key]){
      const tag=el("span",symbols[key]+" "+label+" "+totals[key]);tag.className="cs-change";tag.dataset.change=key;legend.append(tag);
    }
    tools.append(search,filter,expand,collapse);
    if(selected){
      const selectVisible=el("button","Select matching files"),clear=el("button","Clear selection");selectVisible.type=clear.type="button";
      selectVisible.onclick=()=>{
        if(!indexClean)return;
        const q=search.value.trim().toLowerCase(),kind=filter.value;
        const eligible=items.filter(r=>!r.blocked&&r.fingerprint&&(!q||r.path.toLowerCase().includes(q))&&(kind==="all"||r.type===kind));
        if(new Set([...selected.keys(),...eligible.map(r=>r.path)]).size>500){stats.textContent="More than 500 files match. Filter to a smaller batch first.";return;}
        for(const r of eligible)selected.set(r.path,{path:r.path,fingerprint:r.fingerprint});
        render();onSelection?.();
      };
      clear.onclick=()=>{selected.clear();render();onSelection?.();};
      selectVisible.disabled=!indexClean;tools.append(selectVisible,clear);
    }
    host.append(tools,legend,stats);
    const body=el("div");body.className="cs-tree-scroll";host.append(body);
    const open=new Set();let expandAll=false,activePath=null;
    function render(){
      body.replaceChildren();
      const query=search.value.trim().toLowerCase(),kind=filter.value;
      const visible=items.filter(r=>(!query||r.path.toLowerCase().includes(query))&&(kind==="all"||r.type===kind));
      stats.textContent=visible.length+" of "+items.length+" files";
      if(selected)stats.textContent+=" · "+selected.size+" selected (including hidden)";
      if(!visible.length){body.append(el("p",items.length?"No files match this filter.":empty));return;}
      const top={dirs:new Map(),files:[],counts:{}};
      for(const row of visible){
        const parts=row.path.split("/");let node=top;
        const add=n=>n.counts[row.type]=(n.counts[row.type]||0)+1;
        add(node);
        for(const part of parts.slice(0,-1)){
          if(!node.dirs.has(part))node.dirs.set(part,{dirs:new Map(),files:[],counts:{}});
          node=node.dirs.get(part);add(node);
        }
        node.files.push({...row,basename:parts.at(-1)});
      }
      function draw(node,parent,prefix){
        for(const [dir,child] of Array.from(node.dirs).sort(([a],[b])=>a.localeCompare(b))){
          const path=prefix?prefix+"/"+dir:dir;
          const details=el("details");details.className="cs-tree-dir";details.dataset.path=path;
          const head=el("summary");head.className="cs-dir-row";
          const icon=el("span");icon.className="cs-folder-icon";icon.setAttribute("aria-hidden","true");
          const title=el("span",dir);title.className="cs-dir-name";title.title=path;
          const count=el("span",String(Object.values(child.counts).reduce((a,b)=>a+b,0)));count.className="cs-dir-count";
          const marks=el("span");marks.className="cs-dir-marks";
          for(const type of Object.keys(labels))if(child.counts[type]){
            const mark=el("span",symbols[type]+" "+child.counts[type]);mark.dataset.change=type;mark.className="cs-change";mark.title=labels[type];marks.append(mark);
          }
          head.append(icon,title,count,marks);details.append(head);
          const inner=el("div");inner.className="cs-tree-children";details.append(inner);
          details.open=expandAll||open.has(path)||!!query||kind!=="all";
          // Lazy branch rendering keeps a thousand-file review responsive.
          let drawn=false;
          function drawChildren(){if(!drawn){drawn=true;draw(child,inner,path);}}
          if(details.open)drawChildren();
          details.addEventListener("toggle",()=>{if(details.open){open.add(path);drawChildren();}else open.delete(path);});
          parent.append(details);
        }
        for(const row of node.files.sort((a,b)=>a.basename.localeCompare(b.basename))){
          const line=el("div");line.className="cs-tree-file";line.dataset.path=row.path;line.dataset.change=row.type;
          if(selected){
            const check=el("input");check.type="checkbox";check.checked=selected.has(row.path);
            check.disabled=!!row.blocked||!indexClean||!row.fingerprint;
            check.setAttribute("aria-label","Select "+row.path);
            check.onchange=()=>{
              if(check.checked&&selected.size>=500){check.checked=false;stats.textContent="Commit limit: select at most 500 files.";return;}
              if(check.checked)selected.set(row.path,{path:row.path,fingerprint:row.fingerprint});else selected.delete(row.path);
              stats.textContent=visible.length+" of "+items.length+" files · "+selected.size+" selected (including hidden)";
              onSelection?.();
            };line.append(check);
          }
          const glyph=el("span");glyph.className="cs-file-icon";glyph.setAttribute("aria-hidden","true");line.append(glyph);
          const file=el(onFile?"button":"span",row.basename);file.className="cs-file";file.title=row.path;
          if(onFile){file.type="button";file.onclick=()=>{activePath=row.path;body.querySelectorAll(".cs-tree-file.is-active").forEach(n=>n.classList.remove("is-active"));line.classList.add("is-active");onFile(row);};}
          if(activePath===row.path)line.classList.add("is-active");
          const state=el("span",symbols[row.type]+" "+(row.kind?row.kind.replaceAll("_"," "):labels[row.type]));state.className="cs-change cs-file-state";state.dataset.change=row.type;state.title=row.blocked||row.status||row.kind||"";
          line.append(file,state);if(row.blocked){const reason=el("span",row.blocked);reason.className="cs-block-reason";line.append(reason);}parent.append(line);
        }
      }
      draw(top,body,"");
    }
    search.oninput=filter.onchange=render;
    expand.onclick=()=>{expandAll=true;render();};
    collapse.onclick=()=>{expandAll=false;open.clear();search.value="";filter.value="all";render();};
    render();
  }
  function renderPatch(target,path,r){
    target.replaceChildren();
    const title=el("div",path);title.className="cs-diff-title";target.append(title);
    if(!r.ok){target.append(el("div",r.error||"Diff unavailable"));return;}
    const lines=el("div");lines.className="cs-diff-lines";
    const frag=document.createDocumentFragment();
    for(const text of (r.text||"").split("\n")){
      const line=el("div",text||" ");line.className="cs-diff-line";
      if(text.startsWith("+++")||text.startsWith("---")||text.startsWith("diff ")||text.startsWith("index "))line.dataset.line="meta";
      else if(text.startsWith("@@"))line.dataset.line="hunk";
      else if(text.startsWith("+"))line.dataset.line="added";
      else if(text.startsWith("-"))line.dataset.line="deleted";
      frag.append(line);
    }
    lines.append(frag);target.append(lines);
    if(r.truncated)target.append(el("div","Preview truncated by server."));
  }
  function mount(host){
    const root=el("div");root.className="cs-wrap";host.append(root);
    const header=el("header");header.append(el("h1","Code Sync"),el("p","GitHub version history · Google Drive working files · VM source reconciliation"));root.append(header);
    const nav=el("div");nav.className="cs-actions";
    for(const [label,url] of [["Deploy","/apps/platform/deploy/"],["Work Runner","/apps/platform/work_runner/"],["Project Hub","/apps/platform/home/"]]){
      const a=el("a",label);a.href=url;nav.append(a);
    }root.append(nav);
    const grid=el("div");grid.className="cs-grid";root.append(grid);
    const section=(parent,title,desc)=>{const c=el("section");c.className="cs-card";c.append(el("h2",title),el("p",desc));parent.append(c);return c;};
    const gh=section(grid,"GitHub","Private monorepo · reviewed version history");
    const gs=el("pre","Checking…");gs.className="cs-summary";gh.append(gs);
    const dr=section(grid,"Google Drive","Shared working files · repository mirror");
    const ds=el("pre","Checking…");ds.className="cs-summary";dr.append(ds);
    const controls=section(root,"Incoming and outgoing changes","A fresh three-way comparison uses the existing mirror baseline. Staging does not modify running code.");
    const table=el("div");table.className="cs-review-list";
    const staged=section(root,"Staged source","Verified incoming files are stored separately under data/code-sync-stage. No automatic apply or deployment.");
    const stageList=el("div");staged.append(stageList);
    const message=el("div");message.setAttribute("role","status");message.className="cs-operation-status";root.insertBefore(message,grid);
    const gitMessage=el("div","Review outgoing commits before pushing.");gitMessage.className="cs-operation-status";gitMessage.setAttribute("role","status");gitMessage.id="cs-git-status";gh.append(gitMessage);
    const driveMessage=el("div");driveMessage.className="cs-operation-status";driveMessage.setAttribute("role","status");dr.append(driveMessage);
    let operationMessage=message;
    function feedback(text,kind="info"){
      operationMessage.textContent=text;operationMessage.dataset.kind=kind;
    }
    const actions=()=>{const c=el("div");c.className="cs-actions";return c;};
    const buttons=[];let busy=false,tracked=null,disposed=false,gitState=null,gitPreview=null,working=null,destinationKey=null,destinationValues=null;
    async function refresh(){
      const r=await api(APP,"status");
      const g=r.github||{},d=r.drive||{},last=d.last||{};gitState=g;
      if(destinationKey&&r.destination_key&&destinationKey!==r.destination_key){gitPreview=null;working=null;selected.clear();filesBox.replaceChildren();workList.replaceChildren();table.replaceChildren();}
      destinationKey=r.destination_key||null;destinationValues=r.destinations||null;
      if(destinationValues){githubInput.value=destinationValues.github;driveInput.value=destinationValues.drive;destinationSummary.textContent="GitHub: "+destinationValues.github+" / main · Drive: "+destinationValues.drive+"/source";}
      pendingNotice.textContent=g.ok&&g.dirty_count?g.dirty_count+" uncommitted working-tree entries are NOT included in Push committed main. Review and commit working files first.":"";
      gs.textContent=g.ok?["Repository: "+(g.repository||destinationValues?.github||"Unavailable"),"Target branch: "+(g.target_branch||"main"),"Branch: "+g.branch,"HEAD: "+g.head.slice(0,12),"Cached remote main: "+(g.upstream||"unknown").slice(0,12),"Ahead / behind: "+(g.ahead??"?")+" / "+(g.behind??"?"),"Changed entries: "+g.dirty_count,g.origin_verified?"Expected repository origin (privacy checked on operation)":"Unexpected origin; GitHub operations disabled"].join("\n"):g.error||"Unavailable";
      if(r.source_lock)gs.textContent+="\nSource mutation lock: "+(r.source_lock.busy===true?"busy — refresh before editing":r.source_lock.busy===false?"available":"unavailable");
      ds.textContent=d.ok?["Source folder: "+(d.source_destination||(destinationValues?.drive?destinationValues.drive+"/source":"Unavailable")),"Automatic push: "+(d.enabled?"enabled":"disabled"),"Last result: "+(last.status||"unknown"),"Files: "+(last.files??"—"),"Remaining: "+(last.remaining??"—"),"Conflicts: "+(last.conflicts??"—"),last.change_counts?"Detected: "+Object.entries(last.change_counts).map(([k,v])=>k.replaceAll("_"," ")+": "+v).join(", "):"",last.at?"Last check: "+new Date(last.at*1000).toLocaleString():""].join("\n"):d.error||"Unavailable";
      stageList.replaceChildren();
      for(const item of r.stages||[])stageList.append(el("p",item.stage_id+" · "+item.files+" files · "+item.bytes+" bytes"));
      if(!stageList.childNodes.length)stageList.append(el("p","No verified stages yet."));
    }
    function renderChanges(r){
      table.replaceChildren();
      table.append(el("p",r.changes_total+" changed paths"+(r.changes_truncated?" (first 1,000 shown)":"")));
      const tree=el("div");table.append(tree);fileTree(tree,r.changes||[],{name:"Drive changes"});
    }
    async function watch(id){
      tracked=id;feedback("Queued "+id);
      while(root.isConnected&&!disposed&&tracked===id){
        const q=await api("platform/work_runner","get",{job_id:id});const j=q.job||q;
        if(!j.status){feedback("Job status unavailable. Check Work Runner: "+id,"error");return;}
        feedback(id+" · "+j.status+(j.progress?.detail?" · "+j.progress.detail:""));
        if(["done","error","cancelled"].includes(j.status)){
          const r=j.op_result||{};
          const failed=j.status!=="done"||r.ok===false;
          let result=id+" · "+j.status+" · "+(r.status||r.error||j.error||"");
          if(r.error)result+="\n"+r.error;
          if(Array.isArray(r.changes))renderChanges(r);
          if(r.stage_id)result+="\nStage: "+r.stage_id+" · "+r.files+" files; active source unchanged";
          if(r.committed_head)result+="\nLocal commit: "+r.committed_head;
          if(r.remote_verified&&r.pushed_head)result+="\nVerified GitHub main: "+r.pushed_head;
          feedback(result,failed?"error":"success");
          await refresh();return r;
        }
        await new Promise(resolve=>setTimeout(resolve,2000));
      }
    }
    function button(parent,label,handler,confirmation){
      const b=el("button",label);b.type="button";buttons.push(b);parent.append(b);
      b.onclick=async()=>{if(busy)return;busy=true;buttons.forEach(x=>x.disabled=true);
        operationMessage=gh.contains(b)?gitMessage:dr.contains(b)?driveMessage:workBox.contains(b)?workMessage:message;
        feedback(label+"…");
        try{if(confirmation&&!await AppUIDialog.confirmAsync(confirmation)){feedback("Cancelled. No operation submitted.");return;}await handler();}
        catch(e){feedback("Operation unavailable: "+String(e.message||e),"error");}
        finally{busy=false;buttons.forEach(x=>x.disabled=false);operationMessage=message;}
      };return b;
    }
    const queued=async (action,extra={})=>{const r=await api(APP,"submit",{action,confirm:true,...(destinationKey?{expected_destination:destinationKey}:{}),...extra});if(!r.ok)throw new Error(r.error||r._error||"Rejected");return await watch(r.job.id);};
    const settings=el("details");settings.className="cs-card cs-destinations";settings.append(el("summary","Source destinations"));
    root.insertBefore(settings,grid);
    const destinationSummary=el("p","Loading configured destinations…");settings.append(destinationSummary);
    const settingsFields=el("div");settingsFields.className="cs-destination-fields";
    const githubInput=el("input");githubInput.type="text";githubInput.placeholder="owner/repository";githubInput.setAttribute("aria-label","GitHub repository");
    const driveInput=el("input");driveInput.type="text";driveInput.placeholder="vfs://gdrive://folder/repo";driveInput.setAttribute("aria-label","Google Drive repository folder");
    for(const [name,input] of [["GitHub private repository (main)",githubInput],["Google Drive repository folder (/source is appended)",driveInput]]){const label=el("label",name);label.append(input);settingsFields.append(label);}
    settings.append(settingsFields,el("p","Host-local settings. Changing Drive folders pauses auto push and uses a separate baseline. GitHub repositories must already exist and be private."));
    const settingsActions=actions();settings.append(settingsActions);
    button(settingsActions,"Save destinations",async()=>{
      if(!destinationKey)throw new Error("Refresh current destinations first.");
      if(!await AppUIDialog.confirmAsync("Use GitHub "+githubInput.value+" / main and Drive "+driveInput.value+"/source? No source will be uploaded. A changed Drive destination starts with auto push paused.")){feedback("Destination change cancelled.");return;}
      const r=await api(APP,"destinations",{action:"set",github:githubInput.value,drive:driveInput.value,expected_destination:destinationKey,confirm:true});
      if(!r.ok)throw new Error(r.error||"Destination change rejected");
      gitPreview=null;working=null;selected.clear();filesBox.replaceChildren();workList.replaceChildren();table.replaceChildren();summary.textContent="Fetch and preview the selected destination.";await refresh();feedback("Destinations saved. Fetch and review before pushing.","success");
    });
    const pendingNotice=el("p");pendingNotice.className="cs-operation-status";pendingNotice.dataset.kind="error";gh.append(pendingNotice);
    const githubActions=actions();gh.append(githubActions);
    button(githubActions,"Fetch GitHub main",()=>queued("fetch"),"Fetch the verified private repository? No merge or checkout changes.");
    const reviewBox=section(root,"GitHub review","Preview committed history separately from uncommitted files. Fetch first for current remote state.");
    const summary=el("pre","No preview yet.");summary.className="cs-summary";reviewBox.append(summary);
    const commitRows=el("details"),commitTitle=el("summary","Commit list");commitRows.append(commitTitle);reviewBox.append(commitRows);
    const reviewLayout=el("div");reviewLayout.className="cs-review-layout";reviewBox.append(reviewLayout);
    const filesBox=el("div");filesBox.className="cs-review-list";reviewLayout.append(filesBox);
    const patch=el("div","Select a file to inspect its diff.");patch.className="cs-diff";reviewLayout.append(patch);
    const workBox=section(root,"Working-tree changes","Select exact file versions to commit. Existing staged changes must be reviewed separately. No automatic push.");
    const workSummary=el("p","Load working changes to review.");workBox.append(workSummary);
    const workMessage=el("div");workMessage.className="cs-operation-status";workMessage.setAttribute("role","status");workMessage.id="cs-work-status";workBox.append(workMessage);
    const workLayout=el("div");workLayout.className="cs-review-layout";workBox.append(workLayout);
    const workList=el("div");workList.className="cs-review-list";workLayout.append(workList);
    const workPatch=el("div","Select a working file to inspect its diff.");workPatch.className="cs-diff";workLayout.append(workPatch);
    const selected=new Map();
    const msg=el("input");msg.placeholder="Commit message";msg.maxLength=200;msg.setAttribute("aria-label","Commit message");
    const wa=actions();workBox.append(msg,wa);
    const diffEpoch={working:0,committed:0};
    async function showDiff(path,mode){
      const key=mode==="working"?"working":"committed",target=key==="working"?workPatch:patch,epoch=++diffEpoch[key];
      target.textContent="Loading diff: "+path;
      try{
        const r=await api(APP,"review",{action:"diff",path,mode,head:gitPreview?.head,base:gitPreview?.base});
        if(epoch!==diffEpoch[key])return;
        renderPatch(target,path,r);
      }catch(e){if(epoch===diffEpoch[key])target.textContent="Diff unavailable: "+path;}
      if(epoch===diffEpoch[key]&&window.innerWidth<900)target.scrollIntoView({block:"nearest"});
    }
    function renderGit(p){
      gitPreview=p;
      const sc=p.screening||{};
      summary.textContent=["Local: "+p.head,"Remote: "+p.base,"Outgoing / incoming: "+p.ahead+" / "+p.behind,p.shortstat||"No net outgoing changes","History screening: "+(sc.ok?"passed":"BLOCKED"),sc.reason||"",sc.reviewed_placeholder_blobs?"Verified private-key input placeholders: "+sc.reviewed_placeholder_blobs:"",sc.reviewed_nonsecret_paths?.length?"Verified historical non-secret configuration/documentation paths: "+sc.reviewed_nonsecret_paths.length:"",sc.flagged_blobs!==undefined?"Credential-pattern matches: "+sc.flagged_blobs+" · protected paths: "+(sc.protected_count||0):"",...(sc.flagged_objects||[]).map(x=>"Flagged: "+x.path_hint),...(sc.protected_paths||[]).map(x=>"Protected: "+x),p.overlap?.length?"Potential overlapping changes: "+p.overlap.length:"",p.merge_check?"Merge simulation: "+p.merge_check.status:"",...(p.merge_check?.conflicts||[]).map(x=>"Conflict: "+x)].filter(Boolean).join("\n");
      commitRows.replaceChildren(el("summary","Commit list ("+p.ahead+" outgoing, "+p.behind+" incoming)"));
      for(const [dir,rows] of [["Outgoing",p.outgoing_commits],["Incoming",p.incoming_commits]])for(const c of rows||[])commitRows.append(el("p",dir+" "+c.sha.slice(0,12)+" · "+c.subject));
      diffEpoch.committed++;patch.textContent="Select a file to inspect its diff.";
      filesBox.replaceChildren();
      for(const [mode,rows,total] of [["outgoing",p.outgoing,p.outgoing_total],["incoming",p.incoming,p.incoming_total]]){
        const group=el("details");group.className="cs-review-group";group.open=mode==="outgoing"||!(p.outgoing||[]).length;
        const heading=el("summary",(mode==="outgoing"?"↑ Outgoing":"↓ Incoming")+" · "+(total??(rows||[]).length)+" files");group.append(heading);
        if(total>(rows||[]).length)group.append(el("p","Showing first "+rows.length+" files (server limit)."));
        const tree=el("div");group.append(tree);filesBox.append(group);
        fileTree(tree,rows||[],{name:mode+" files",onFile:row=>showDiff(row.path,mode)});
      }
    }
    async function previewGit(){
      feedback("Checking outgoing and incoming history…");
      const p=await api(APP,"review",{action:"preview"});if(!p.ok)throw new Error(p.error||"Preview unavailable");renderGit(p);
      feedback(p.screening?.ok?"Preview ready: "+p.ahead+" outgoing, "+p.behind+" incoming commits.":"Push blocked by history screening. "+(p.screening?.flagged_blobs??"Unknown")+" credential-pattern matches; "+(p.screening?.protected_count??"unknown")+" protected paths. Review the GitHub review section.",""+(p.screening?.ok?"success":"error"));
      return p;
    }
    async function loadWorking(){
      const r=await api(APP,"review",{action:"working"});if(!r.ok)throw new Error(r.error||"Working changes unavailable");
      working=r;selected.clear();diffEpoch.working++;workPatch.textContent="Select a working file to inspect its diff.";
      workSummary.textContent=r.total+" changed files · "+(r.index_clean?"index clean":"existing staged changes; commit blocked")+(r.total>(r.files||[]).length?" · showing first "+r.files.length:"");
      fileTree(workList,r.files||[],{name:"working files",selected,indexClean:r.index_clean,onFile:row=>showDiff(row.path,"working")});
    }
    button(githubActions,"Preview push / pull",previewGit);
    const reviewLink=el("button","View GitHub review");reviewLink.type="button";reviewLink.onclick=()=>reviewBox.scrollIntoView({block:"start",behavior:"smooth"});gh.append(reviewLink);
    button(githubActions,"Push committed main",async()=>{
      if(!gitState?.ok||gitState.branch!=="main"||!gitState.origin_verified)throw new Error("Refresh status and verify the configured main branch first.");
      const p=(!gitPreview||gitPreview.head!==gitState.head||gitPreview.base!==gitState.upstream)?await previewGit():gitPreview;
      if(p.destination_key&&p.destination_key!==destinationKey){feedback("Destination changed. Refresh and preview again.","error");return;}
      if(!p.screening?.ok){
        feedback("Push blocked: "+(p.screening?.flagged_blobs??"unknown")+" credential-pattern matches and "+(p.screening?.protected_count??"unknown")+" protected paths. "+(p.screening?.reason||"Open GitHub review for details. No push submitted."),"error");return;
      }
      if(p.behind){feedback("Push blocked: "+p.behind+" incoming commits. Fetch and reconcile before pushing.","error");return;}
      if(!p.ahead){feedback("Committed history is up to date. "+(gitState.dirty_count?gitState.dirty_count+" working-tree entries are not committed or uploaded. Use Review working changes.":"No outgoing commits."),gitState.dirty_count?"error":"success");return;}
      if(p.head!==gitState?.head||p.base!==gitState?.upstream){feedback("Repository references changed. Refresh status and review again.","error");return;}
      if(!await AppUIDialog.confirmAsync("Push "+p.ahead+" reviewed commits ending at "+p.head+" to "+(p.repository||gitState.repository||"private GitHub")+" / main? Uncommitted files are excluded. No force push.")){feedback("Push cancelled. No push submitted.");return;}
      await queued("push",{expected_head:p.head,expected_base:p.base,...(p.destination_key?{expected_destination:p.destination_key}:{})});gitPreview=null;
      // Preserve terminal feedback instead of hiding it behind a fresh preview.
    });
    button(githubActions,"Pull fast-forward",async()=>{
      const p=gitPreview;if(!p||p.ahead||p.head!==gitState?.head||p.base!==gitState?.upstream)throw new Error("Fetch and preview first. Divergent history needs separate conflict review.");
      if(!await AppUIDialog.confirmAsync("Apply "+p.behind+" incoming commits to a clean checkout? No deployment or forced merge."))return;
      await queued("pull",{expected_head:p.head,expected_base:p.base,...(p.destination_key?{expected_destination:p.destination_key}:{})});gitPreview=null;await previewGit();
    });
    button(githubActions,"Merge reviewed clean result",async()=>{
      const p=gitPreview;if(!p||!p.ahead||!p.behind||!p.merge_check?.clean||p.head!==gitState?.head||p.base!==gitState?.upstream)throw new Error("Fetch and preview a clean divergent merge first. Conflicting histories are held for manual resolution.");
      if(!await AppUIDialog.confirmAsync("Merge reviewed local and remote histories into a clean checkout? No push or service restart."))return;
      await queued("merge",{expected_head:p.head,expected_base:p.base,expected_tree:p.merge_check.tree,...(p.destination_key?{expected_destination:p.destination_key}:{})});gitPreview=null;await previewGit();
    });
    button(githubActions,"Review working changes",async()=>{await loadWorking();workBox.scrollIntoView({block:"start"});});
    button(wa,"Load working changes",loadWorking);
    button(wa,"Commit selected files",async()=>{
      if(!working||!selected.size||!msg.value.trim())throw new Error("Select reviewed files and enter a commit message.");
      if(!await AppUIDialog.confirmAsync("Commit "+selected.size+" selected file versions? No other files will be staged and nothing will be pushed."))return;
      await queued("commit",{expected_head:working.head,files:Array.from(selected.values()),message:msg.value.trim()});gitPreview=null;await loadWorking();await previewGit();
    });
    button(wa,"Commit & Push",async()=>{
      if(!working||!selected.size||!msg.value.trim())throw new Error("Select reviewed files and enter a commit message.");
      if(!destinationKey||!gitState?.origin_verified||gitState.branch!=="main")throw new Error("Verify your GitHub destination and main branch first.");
      const p=await previewGit();
      if(!p.screening?.ok||p.behind||p.head!==working.head||p.head!==gitState.head||p.base!==gitState.upstream||p.destination_key&&p.destination_key!==destinationKey){
        feedback("Commit & Push blocked: fetch and review the current destination, resolve incoming changes or screening findings, and reload working files. No commit created.","error");return;
      }
      const count=selected.size,files=Array.from(selected.values());
      if(!await AppUIDialog.confirmAsync("Commit "+count+" selected file versions and push the new commit plus "+p.ahead+" existing outgoing commits to "+(p.repository||gitState.repository||destinationValues?.github||"configured private GitHub")+" / main? Other working files are excluded. If push fails, the local commit is retained.")){feedback("Commit & Push cancelled. No changes submitted.");return;}
      const r=await queued("commit_push",{expected_head:working.head,expected_base:p.base,expected_destination:p.destination_key||destinationKey,files,message:msg.value.trim()});
      gitPreview=null;
      if(r?.committed_head){await loadWorking();if(r.remote_verified){msg.value="";feedback("Committed "+r.files+" files and verified GitHub main: "+r.committed_head,"success");}else feedback("Local commit retained: "+r.committed_head+"\n"+(r.error||"Push verification incomplete. Fetch before retry."),"error");}
    });
    const driveActions=actions();dr.append(driveActions);
    button(driveActions,"Push next batch",async()=>{const r=await api(APP,"drive",{action:"sync",confirm:true,...(destinationKey?{expected_destination:destinationKey}:{})});if(!r.ok)throw new Error(r.error||"Sync unavailable");await watch(r.job_id);},"Push safe local changes only? External conflicts and deletions remain held.");
    for(const enabled of [true,false])button(driveActions,enabled?"Enable auto push":"Pause auto push",async()=>{const r=await api(APP,"drive",{action:"configure",enabled,confirm:true,...(destinationKey?{expected_destination:destinationKey}:{})});if(!r.ok)throw new Error("Configuration rejected");await refresh();},enabled?"Enable periodic safe VM-to-Drive push?":"Pause automatic Drive push?");
    const a=actions();controls.append(a,table);
    button(a,"Refresh status",refresh);
    button(a,"Scan changes",()=>queued("scan"));
    button(a,"Stage incoming files",()=>queued("stage"),"Download non-conflicting incoming files into a separate review directory? Active source will not change.");
    refresh().catch(()=>{message.textContent="Source status unavailable.";});
  }
  AppUI.createApp({id:"platform-code-sync",title:"Code Sync",content:{render:mount},statusbar:{}});
});
