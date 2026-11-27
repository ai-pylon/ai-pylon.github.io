/* Account requests deliberately go directly to the gateway, never app ops or job logs. */
window.AppUIReady.then(function(){
  const base=location.pathname.split('/apps/')[0],gateway=base+'/_pylon/';
  const providers={google:{label:"Google",portal:"https://console.cloud.google.com/auth/clients",scope:"openid email profile",authHost:"accounts.google.com"},gitlab:{label:"GitLab",portal:"https://gitlab.com/-/user_settings/applications",scope:"read_user",authHost:"gitlab.com"}};
  let busy=false;
  function googleClient(raw,callback){
    if(raw.length>65536)throw new Error("Client JSON is too large.");
    let doc;try{doc=JSON.parse(raw);}catch(e){throw new Error("Select a valid Google OAuth client JSON file.");}
    const w=doc&&doc.web;
    if(!w||typeof w.client_id!=="string"||!w.client_id.endsWith(".apps.googleusercontent.com")||typeof w.client_secret!=="string"||!w.client_secret)throw new Error("Use a Google Web application client JSON, not a desktop client or service account.");
    if(!Array.isArray(w.redirect_uris)||!w.redirect_uris.includes(callback))throw new Error("The JSON does not include this redirect URI. Add it in Google Cloud and download the client JSON again.");
    return {client_id:w.client_id,client_secret:w.client_secret};
  }
  function goAuthorize(r,meta){
    const url=new URL(r.authorization_url);
    if(url.protocol!=="https:"||url.hostname!==meta.authHost||url.username||url.password||url.port)throw new Error("Unexpected authorization destination.");
    location.assign(url.href);
  }
  const el=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
  function field(form,name,label,type,auto){const l=el("label",label),input=el("input");input.name=name;input.type=type;input.required=true;input.autocomplete=auto;l.append(input);form.append(l);return input;}
  async function request(path,form){
    // Native fetch avoids retaining sensitive form fields in AppUI operation logs.
    const opts={credentials:"same-origin",cache:"no-store",redirect:"error",headers:{Accept:"application/json"}};
    if(form){opts.method="POST";opts.body=new URLSearchParams(new FormData(form));}
    const r=await fetch(gateway+path,opts);
    if(r.status===401)throw new Error("Your session expired. Sign in again to continue.");
    const result=await r.json().catch(()=>({error:"The request could not be completed. Check your inputs and try again."}));
    if(!r.ok||!result.ok)throw new Error(typeof result.error==="string"?result.error:"Request failed.");
    return result;
  }
  function mount(host){
    host.append(document.getElementById("accounts-template").content.cloneNode(true));
    const q=id=>host.querySelector("#"+id),msg=q("account-message"),form=q("owner-form"),list=q("provider-list");
    form.action=gateway+"account";
    const say=t=>{msg.textContent=t;};
    function clear(f){f.querySelectorAll('input[type="password"]').forEach(x=>x.value="");}
    async function act(f,action){
      if(busy)return;
      busy=true;f.querySelectorAll("button").forEach(b=>b.disabled=true);
      try{await action();}catch(e){say(e.message||"Request failed.");}
      finally{clear(f);busy=false;f.querySelectorAll("button").forEach(b=>b.disabled=false);}
    }
    function hidden(f,name,value){const i=el("input");i.type="hidden";i.name=name;i.value=value;f.append(i);}
    function button(text,primary){const b=el("button",text);b.type="submit";if(primary)b.className="primary";return b;}
    const browserSessions={};
    function browserSetup(key,meta){
      const box=el("details"),heading=el("summary","Prepare application in managed browser");box.append(heading);
      box.append(el("p","Use your connected Pylon browser. Sign in and open the new application form there; Pylon fills recognized public fields. Review and create the application in the provider page, then import the client credentials below."));
      const device=el("select");device.setAttribute("aria-label",meta.label+" browser endpoint");
      const placeholder=el("option","Choose a connected endpoint");placeholder.value="";device.append(placeholder);
      const line=el("div");line.className="provider-actions";
      const open=button("Open managed browser",true),prepare=button("Prepare application fields"),inspect=button("Check setup page"),forget=button("Forget setup tab"),reload=button("Refresh endpoints");
      for(const b of [open,prepare,inspect,forget,reload])b.type="button";
      line.append(device,open,reload,inspect,prepare,forget);box.append(line);
      const output=el("p","Checking available endpoints…");output.setAttribute("role","status");box.append(output);
      let working=false;
      async function call(args){
        const r=await AppUIApi.operation("platform/page_automation","oauth_setup",args,{timeout:35000});
        if(!r.ok)throw new Error(r.error||r._error||"Browser operation unavailable.");
        return r;
      }
      function controls(){const active=!!browserSessions[key];open.disabled=working||active||!device.value;prepare.disabled=inspect.disabled=forget.disabled=working||!active;reload.disabled=working;device.disabled=working||active;}
      async function perform(fn){if(working)return;working=true;controls();try{await fn();}catch(e){output.textContent=e.message||"Browser operation failed.";}finally{working=false;controls();}}
      async function endpoints(){
        const r=await call({action:"status",confirm:true});device.replaceChildren(placeholder);
        for(const ep of r.endpoints||[]){const o=el("option",ep.id+" · "+ep.platform);o.value=ep.id;device.append(o);}
        output.textContent=browserSessions[key]?"Setup tab opened. Continue in that browser.":device.options.length>1?"Choose your endpoint to open the setup page.":"No managed-browser endpoint connected. Start your Windows Pylon daemon, then refresh, or use manual setup.";
      }
      const messages={opened:"Setup tab opened. Sign in on the selected device, open the new application form, then check or prepare fields.",sign_in_required:"Sign in or complete verification in the managed browser. Pylon will not enter your provider password or approve consent.",outside_setup:"Open the provider's OAuth client creation page in the same tab.",open_create_form:"Open the new application form, choose Web application if applicable, and add a redirect URI field.",review_required:"The form needs manual review; no submission was performed.",existing_values:"Existing draft values differ. Review them in the provider browser; they were not overwritten.",select_web_type:"Choose Web application in the provider page.",form_ready:"The form is recognized and ready for preparation.",prepared:"Public fields prepared. Review application type, redirect URI and requested permissions in the browser, then create the application.",forgotten:"Setup tracking removed. Your browser tab was left open."};
      function show(r){output.textContent=(messages[r.state]||"Check the provider page.")+(r.fields?.length?" Fields: "+r.fields.join(", ")+".":"");}
      device.onchange=controls;
      reload.onclick=()=>perform(endpoints);
      open.onclick=()=>perform(async()=>{if(!await AppUIDialog.confirmAsync("Open "+meta.label+" application settings on "+device.value+"?"))return;const r=await call({action:"start",provider:key,endpoint:device.value,confirm:true});browserSessions[key]=r.session;show(r);});
      inspect.onclick=()=>perform(async()=>show(await call({action:"inspect",session:browserSessions[key],confirm:true})));
      prepare.onclick=()=>perform(async()=>{if(!await AppUIDialog.confirmAsync("Fill only the recognized public application fields in the managed browser?"))return;show(await call({action:"prepare",session:browserSessions[key],confirm:true}));});
      forget.onclick=()=>perform(async()=>{const r=await call({action:"forget",session:browserSessions[key],confirm:true});delete browserSessions[key];show(r);});
      controls();perform(endpoints);return box;
    }
    function renderProvider(key,st,status){
      const meta=providers[key],card=el("article");card.className="provider";const head=el("div");head.className="provider-head";
      const text=el("div");text.append(el("h3",meta.label),el("p",st.linked?"Connected to your owner account.":st.configured?"OAuth application saved. Connect your account to enable sign-in.":"Set up an OAuth application, then connect your account."));
      const state=el("span",st.linked?"Connected":st.configured?"Ready to connect":"Not configured");state.className="state";head.append(text,state);card.append(head);
      if(!status.owner.configured||status.owner.initial){card.append(el("p","Set your permanent owner password first."));return card;}
      if(!status.oauth_available){const a=el("a","Open accounts on the canonical HTTPS address");a.href=status.canonical_origin+"/apps/platform/accounts/";card.append(a);return card;}
      if(key==="gitlab"){
        const api=el("details"),summary=el("summary","Create and connect via GitLab API (group-owned)");api.append(summary);
        const pending=status.gitlab_provision||{status:"none"};
        api.append(el("p","Requires GitLab 19.6+ group applications API, a group you own, and a short-lived setup token with API permission. The created login client uses only read_user. The setup token is not saved."));
        if(pending.status==="creating"){
          api.open=true;
          api.append(el("p","Previous creation outcome uncertain. Check your group applications; use manual import if the app exists. No automatic retry."));
          const f=el("form"),grid=el("div");f.method="post";f.action=gateway+"oauth";grid.className="fields";hidden(f,"action","gitlab_reset_uncertain");hidden(f,"provider","gitlab");
          field(grid,"password","Current owner password","password","current-password");f.append(grid,button("Reset local registration check"));api.append(f);
          f.onsubmit=e=>{e.preventDefault();act(f,async()=>{if(!await AppUIDialog.confirmAsync("Only reset after checking your group applications. This does not delete anything at GitLab. Continue?"))return;await request("oauth",f);say("Local registration marker reset. Existing applications will be checked before creation.");await refresh();});};
        }else{
          const f=el("form"),grid=el("div");f.method="post";f.action=gateway+"oauth";grid.className="fields";hidden(f,"action","gitlab_provision");hidden(f,"provider","gitlab");
          const group=field(grid,"group_id","Numeric GitLab group ID","text","off");group.pattern="[1-9][0-9]{0,18}";if(pending.group){group.value=pending.group;group.readOnly=true;}
          if(pending.status!=="ready")field(grid,"setup_token","Temporary GitLab API token","password","off");
          field(grid,"password","Current owner password","password","current-password");f.append(grid,button(pending.status==="ready"?"Continue authorization":"Create application and connect",true));
          api.append(f);
          f.onsubmit=e=>{e.preventDefault();act(f,async()=>{if(!await AppUIDialog.confirmAsync(pending.status==="ready"?"Continue GitLab authorization?":"Create Pylon Owner Login in GitLab group "+group.value+" and begin authorization?"))return;goAuthorize(await request("oauth",f),meta);});};
        }
        card.append(api);
      }else{
        card.append(el("p","Google's public API does not create standard Google sign-in web clients. Create once in Auth Platform, then import its JSON and connect below."));
      }
      card.append(browserSetup(key,meta));
      const setup=el("details"),title=el("summary",st.configured?"Change OAuth application":"Set up OAuth application");setup.append(title);
      if(!st.configured)setup.open=true;
      function copyRow(label,value){
        const line=el("div");line.className="callback";line.append(el("strong",label+": "),el("code",value));
        const copy=button("Copy "+label);copy.type="button";copy.onclick=async()=>{try{await navigator.clipboard.writeText(value);say(label+" copied.");}catch(e){say("Select and copy "+label+".");}};line.append(copy);return line;
      }
      const a=el("a","Create "+meta.label+" OAuth application ↗");a.href=meta.portal;a.target="_blank";a.rel="noopener noreferrer";
      setup.append(el("h4","1. Create the application"),a,copyRow("Name","Pylon Owner Login"),copyRow("Redirect URI",st.callback),copyRow("Scope",meta.scope));
      if(key==="google"){
        setup.append(el("p","Choose Web application. If prompted, configure Branding and Audience (add yourself as a test user if the app is in testing). Add the redirect URI above under Authorized redirect URIs, then download the client JSON."));
      }else{
        setup.append(el("p","Choose Add new application, use the name and redirect URI above, leave Confidential checked, and select only read_user. Save the application and copy its Application ID and Secret."));
      }
      setup.append(el("h4","2. Import client credentials"));
      const config=el("form"),fields=el("div");config.method="post";config.action=gateway+"oauth";fields.className="fields";hidden(config,"action","configure");hidden(config,"provider",key);
      const id=field(fields,"client_id","Client ID","text","off"),secret=field(fields,"client_secret","Client secret","password","off");field(fields,"password","Current owner password","password","current-password");
      if(key==="google"){
        const label=el("label","Import Google client JSON (optional)"),file=el("input");file.type="file";file.accept=".json,application/json";label.append(file);config.append(label);
        file.onchange=async()=>{try{const f=file.files[0];if(!f)return;if(f.size>65536)throw new Error("Client JSON is too large.");const values=googleClient(await f.text(),st.callback);id.value=values.client_id;secret.value=values.client_secret;say("Client imported. Enter your owner password to connect.");}catch(e){id.value="";secret.value="";say(e.message);}finally{file.value="";}};
      }
      const actions=el("div");actions.className="provider-actions";const save=button("Save OAuth application"),connect=button("Save and connect "+meta.label,true);save.dataset.action="configure";connect.dataset.action="setup_connect";actions.append(connect,save);
      config.append(fields,el("p","Save and connect opens the provider consent screen. Existing linked credentials stay active until the new connection succeeds."),actions);setup.append(config);card.append(setup);
      config.onsubmit=e=>{e.preventDefault();const action=e.submitter?.dataset.action||"setup_connect";act(config,async()=>{
        const warning=action==="setup_connect"?"Continue to "+meta.label+" consent? Your existing connection stays active until authorization succeeds.":st.linked?"Replace configuration? Your existing linked account will be disconnected.":"Save this OAuth application without connecting?";
        if(!await AppUIDialog.confirmAsync(warning))return;
        config.elements.action.value=action;
        const r=await request("oauth",config);
        if(action==="setup_connect"){goAuthorize(r,meta);return;}
        say(meta.label+" application saved. Connect your account next.");await refresh();
      });};
      if(st.configured){
        const link=el("form"),f=el("div");link.method="post";link.action=gateway+"oauth";f.className="fields";hidden(link,"provider",key);hidden(link,"action","link");field(f,"password","Current owner password","password","current-password");link.append(f,button(st.linked?"Reconnect account":"Connect "+meta.label,true));card.append(link);
        link.onsubmit=e=>{e.preventDefault();act(link,async()=>{if(st.linked&&!await AppUIDialog.confirmAsync("Reconnect and replace the linked account?"))return;goAuthorize(await request("oauth",link),meta);});};
        if(st.linked){const unlink=el("form"),f=el("div");unlink.method="post";unlink.action=gateway+"oauth";f.className="fields";hidden(unlink,"provider",key);hidden(unlink,"action","unlink");field(f,"password","Current owner password to disconnect","password","current-password");unlink.append(f,button("Disconnect "+meta.label));card.append(unlink);unlink.onsubmit=e=>{e.preventDefault();act(unlink,async()=>{if(!await AppUIDialog.confirmAsync("Disconnect "+meta.label+"? Your password remains available."))return;await request("oauth",unlink);say(meta.label+" disconnected.");await refresh();});};}
      }
      return card;
    }
    async function refresh(){
      const s=await request("accounts/status");q("owner-state").textContent=s.owner.configured?"Password configured":"Setup required";form.hidden=false;form.elements.admin_user.value=s.owner.username;
      q("current-field").hidden=!s.owner.configured;form.elements.current_password.required=s.owner.configured;form.elements.current_password.disabled=!s.owner.configured;
      list.replaceChildren(...Object.keys(providers).map(k=>renderProvider(k,s.providers[k],s)));
    }
    form.onsubmit=e=>{e.preventDefault();act(form,async()=>{if(form.elements.new_password.value!==form.elements.confirm_password.value)throw new Error("The passwords do not match.");if(!await AppUIDialog.confirmAsync("Save your owner account and sign in again?"))return;const r=await request("account",form);location.assign(r.next);});};
    const result=new URLSearchParams(location.search).get("result");if(result==="connected"||result==="failed"){say(result==="connected"?"Account connected successfully.":"Account connection was not completed. Please try again.");history.replaceState(null,"",location.pathname);}
    refresh().catch(e=>say(e.message));
  }
  AppUI.createApp({id:"platform-accounts",title:"Accounts",content:{render:mount},statusbar:{}});
});
