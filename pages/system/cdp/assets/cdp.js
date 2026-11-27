// CDP Inspector — AppUI page. Served at /apps/system/cdp/.
var APP = "system/cdp", SEL = null;

function esc(s){ return String(s==null?"":s).replace(/[&<>"]/g, function(c){
  return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]; }); }

window.addEventListener("error", function (e) {
  try {
    fetch("/v1/log", { method: "POST", headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ level:"error", source:"cdp.page",
        message: String(e.message || e), fields:{ at:"window.error" } }) });
  } catch (_) {}
});

async function api(op, body) {
  var r = await window.AppUIApi.requestResponse("/v1/apps/" + APP + "/" + op, body || {}, {
    method: "POST", timeout: null, decode: function (response) { return response.json(); }
  });
  return { status: r.status, data: r.data };
}

async function listTabs(app, root) {
  app.setStatus("Listing tabs …");
  var r = await api("tabs", {});
  var box = root.querySelector("#tabs");
  if (r.data.error || r.data.ok === false) {
    box.innerHTML = '<div class="empty">' + esc(r.data.error || r.status) +
      (r.data.category ? " (" + esc(r.data.category) + ")" : "") + '</div>';
    app.setStatus("Error: " + (r.data.error || r.status));
    return;
  }
  var tabs = r.data.tabs || [];
  box.innerHTML = tabs.length ? "" : '<div class="empty">No open tabs.</div>';
  tabs.forEach(function (t) {
    var el = document.createElement("div");
    el.className = "tab" + (SEL === t.id ? " sel" : "");
    el.innerHTML = '<div class="ti">' + esc(t.title || "(untitled)") + '</div>' +
                   '<div class="tu">' + esc(t.url) + '</div>';
    el.onclick = function () { SEL = t.id; listTabs(app, root); };
    box.appendChild(el);
  });
  app.setStatus(tabs.length + " tab(s)" + (SEL ? " · selected " + SEL : ""));
}

async function navigate(app, root) {
  var u = root.querySelector("#url").value.trim();
  if (!u) { app.setStatus("Enter a URL."); return; }
  app.setStatus("Navigating …");
  var r = await api("navigate", { url: u, tab_id: SEL });
  root.querySelector("#out").textContent = JSON.stringify(r.data, null, 2);
  listTabs(app, root);
}

async function evaluate(app, root) {
  var e = root.querySelector("#expr").value.trim();
  if (!e) { app.setStatus("Enter a JS expression."); return; }
  app.setStatus("Evaluating …");
  var r = await api("eval", { expr: e, tab_id: SEL });
  root.querySelector("#out").textContent = JSON.stringify(r.data, null, 2);
  app.setStatus(r.data && r.data.ok === false ? "Error" : "OK");
}

async function mountLinuxViewer(el) {
  const panel=document.createElement('section');panel.className='cdp-row';panel.style.flexWrap='wrap';
  const make=(tag,text)=>{const x=document.createElement(tag);if(text)x.textContent=text;return x;};
  const device=make('select');device.setAttribute('aria-label','Linux browser endpoint');
  const url=make('input');url.value='https://console.cloud.google.com/';url.setAttribute('aria-label','Viewer URL');
  const profile=make('input');profile.placeholder='temporary or named profile';profile.value='temporary';profile.setAttribute('aria-label','Browser profile');
  const graphical=make('input');graphical.type='checkbox';graphical.setAttribute('aria-label','Graphical Chromium');
  const graphicalLabel=make('label');graphicalLabel.append(graphical,document.createTextNode(' Graphical Chromium'));
  const github=make('button','GitHub organization setup');
  github.onclick=()=>{url.value='https://github.com/organizations/plan';profile.value='temporary';graphical.checked=true;};
  if(new URLSearchParams(location.search).get('preset')==='github-organization')github.onclick();
  const notice=make('p','Use temporary browsing or a private named profile (requires adequate disk space).');
  const base='/apps/system/cdp/viewer';
  const post=async(action,body)=>{try{const r=await fetch(base+'/'+action,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return await r.json();}catch(e){return {ok:false,error:'Viewer request unavailable'};}};
  const refresh=make('button','Refresh Linux viewers');refresh.onclick=async()=>{const r=await post('endpoints',{});device.replaceChildren();if(!r.ok){notice.textContent=r.error;return;}for(const ep of r.endpoints){const o=make('option',ep.id);o.value=ep.id;device.append(o);}notice.textContent=r.endpoints.length?'Select endpoint and profile.':'No interactive Linux browser connected.';};
  const open=make('button','Open interactive viewer');open.onclick=async()=>{
    if(!device.value){notice.textContent='Refresh and select a Linux endpoint.';return;}
    const name=profile.value.trim()||'temporary';
    const request={endpoint:device.value,url:url.value.trim(),profile:name,graphical:graphical.checked,confirm:true};
    const mode=request.graphical?'graphical':'headless';
    const confirm=async(message)=>{if(window.AppUIDialog&&typeof AppUIDialog.confirmAsync==='function'){try{return await AppUIDialog.confirmAsync(message);}catch(_){}}return window.confirm(message);};
    for(const control of [open,stop,refresh,device,url,profile,graphical,github])control.disabled=true;
    try {
      if(!await confirm('Open '+mode+' '+name+' browser profile on '+request.endpoint+'? Persistent profiles retain website sessions on this VM.'))return;
      let result=await post('open',request);
      if(!result.ok&&result.code==='mode_conflict'){
        notice.textContent='An idle browser is running in another mode.';
        if(!await confirm('Restart the idle managed browser on '+request.endpoint+' in '+mode+' mode? Its existing tabs will close. Temporary browsing data will be discarded. Named profile data is retained.'))return;
        notice.textContent='Restarting idle browser in '+mode+' mode…';
        result=await post('open',{...request,restart_idle:true});
      }
      if(!result.ok){notice.textContent=result.error;return;}
      await AppUIAssets.load('remoteBrowserViewer');
      const transport={
        open:()=>Promise.resolve(result),
        input:(session,kind,payload)=>post('input',{session,kind,payload}),
        stop:session=>post('stop',{session}),
        shot:session=>post('shot',{session}),
        stream:()=>{throw new Error('Use private POST polling');}
      };
      const view=AppUIRemoteBrowserViewer.create({session:result.session,transport,title:(result.graphical?'Graphical Linux browser — ':'Linux browser — ')+name,why:'You control this browser. Close to flush the profile. No viewer recording.',allowHeadful:false,primeShots:0});
      const relay=view.el.querySelector('input');if(relay){relay.autocomplete='off';relay.spellcheck=false;relay.autocapitalize='off';}
      notice.textContent='Viewer opened. Close its dialog before starting automation.';
    }catch(e){notice.textContent='Viewer unavailable.';}finally{for(const control of [open,stop,refresh,device,url,profile,graphical,github])control.disabled=false;}
  };
  const stop=make('button','Stop idle browser');stop.onclick=async()=>{if(device.value&&await AppUIDialog.confirmAsync('Stop the idle browser on '+device.value+'? Named profile data is retained.')){const r=await post('browser_stop',{endpoint:device.value,confirm:true});notice.textContent=r.ok?'Browser stopped.':r.error||'Browser could not stop.';}};
  panel.append(make('strong','Interactive Linux browser'),device,refresh,url,profile,graphicalLabel,github,open,stop,notice);
  el.prepend(panel);
}
function mountContent(el) {
  el.classList.add("cdp-content");
  el.innerHTML =
    '<div class="browser-status" id="bstatus">Checking browser…</div>' +
    '<div class="cdp-row"><button id="refresh">List tabs</button></div>' +
    '<div id="tabs"></div>' +
    '<div class="lbl">Navigate (new tab, or the selected tab)</div>' +
    '<div class="cdp-row"><input id="url" placeholder="https://example.com">' +
      '<button id="go">Open</button></div>' +
    '<div class="lbl">Evaluate JS (in selected tab, else first tab)</div>' +
    '<div class="cdp-row"><input id="expr" placeholder="document.title">' +
      '<button id="run" class="sec">Eval</button></div>' +
    '<div class="out" id="out"></div>';
  return el;
}

async function loadStatus(app, root) {
  var box = root.querySelector("#bstatus");
  var r = await api("status", {});
  var d = r.data || {};
  if (!d.ok || d.available === false) {
    box.className = "browser-status bad";
    box.innerHTML = '<span class="dot"></span> No debuggable browser' +
      (d.detail ? " — " + esc(d.detail) : "") +
      (d.debug_url ? ' <span class="muted">(' + esc(d.debug_url) + ')</span>' : "");
    return;
  }
  box.className = "browser-status ok";
  var kind = d.managed ? "managed profile" : "attached browser";
  box.innerHTML = '<span class="dot"></span> ' +
    esc(d.browser || "browser") + ' · <b>' + kind + '</b> · ' +
    esc(d.debug_url) + ' · ' + (d.tabs != null ? d.tabs : "?") + ' tab(s)' +
    (d.managed && d.profile_dir ? ' <span class="muted">[' + esc(d.profile_dir) + ']</span>' : "");
}

window.AppUIReady.then(function () {
  var contentEl = null;
  var app = AppUI.createApp({
    id: "system-cdp",
    title: "CDP Inspector",
    menu: { View: [ { id: "refresh", label: "List tabs" } ] },
    onAction: function (_menu, id) { if (id === "refresh" && contentEl) listTabs(app, contentEl); },
    content: { render: function (el) { contentEl = mountContent(el); } },
    statusbar: {},
  });
  function wire() {
    if (!contentEl) { setTimeout(wire, 20); return; }
    var r = contentEl;
    r.querySelector("#refresh").addEventListener("click", function () { listTabs(app, r); loadStatus(app, r); });
    r.querySelector("#go").addEventListener("click", function () { navigate(app, r); });
    r.querySelector("#run").addEventListener("click", function () { evaluate(app, r); });
    r.querySelector("#expr").addEventListener("keydown", function (e) { if (e.key === "Enter") evaluate(app, r); });
    r.querySelector("#url").addEventListener("keydown", function (e) { if (e.key === "Enter") navigate(app, r); });
    mountLinuxViewer(r);
    loadStatus(app, r);
    app.setStatus("Driving the endpoint's browser via cap:system.cdp.");
  }
  wire();
}).catch(function (e) {
  document.getElementById("app-content-body").innerHTML =
    '<div style="padding:18px">AppUI failed to load: ' + esc(e) + '</div>';
});
