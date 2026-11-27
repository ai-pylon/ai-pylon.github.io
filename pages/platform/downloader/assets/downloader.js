// Downloader — full AppUI layout. Served at /apps/platform/downloader/.
// Left sidebar = section navigation (Fetch / History / Routing / Sources);
// the content area renders the active section. Drives the downloader ops.
var APP = "platform/downloader";

function esc(s){ return String(s==null?"":s).replace(/[&<>"]/g, function(c){
  return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]; }); }
function fmtBytes(b){ if(b==null)return ""; if(b===0)return "0 B"; var u=["B","KB","MB","GB"],i=0,n=b;
  while(n>=1024&&i<u.length-1){n/=1024;i++;} return (n>=10?Math.round(n):Math.round(n*10)/10)+" "+u[i]; }
function fmtWhen(ts){ if(!ts)return ""; try{return new Date(ts*1000).toLocaleString();}catch(e){return "";} }

async function api(op, body) {
  var headers = {"Content-Type":"application/json"};
  if (body && body.confirm === true) headers["X-Confirm"] = "true";
  var r = await fetch("/v1/apps/" + APP + "/" + op, {
    method:"POST", headers: headers, body: JSON.stringify(body||{}) });
  return await r.json();
}

var _app = null, _els = {}, _section = "fetch", _wsCache = null;

async function loadWorkspaces(){
  if(_wsCache) return _wsCache;
  // The downloader resolves workspace NAMES; reuse 3gpp's listing if present,
  // else offer free-text. (No cross-app list op on the downloader itself.)
  try { var r = await (await fetch("/v1/apps/knowledge/3gpp_spec/workspaces",{method:"POST",
    headers:{"Content-Type":"application/json"},body:"{}"})).json();
    _wsCache = (r.ok && r.workspaces) || []; } catch(e){ _wsCache = []; }
  return _wsCache;
}

// ============================================================ sidebar nav ==
function renderNav(host){
  _els.nav = host;
  host.classList.add("dl-nav");
  var items = [["fetch","⬇  Fetch"],["history","🕑  History"],
               ["routing","🗂  Routing"],["sources","🔌  Sources"]];
  host.innerHTML = items.map(function(it){
    return '<div class="dl-navitem'+(it[0]===_section?" active":"")+'" data-sec="'+it[0]+'">'+esc(it[1])+'</div>';
  }).join('');
  host.addEventListener("click", function(e){
    var row = e.target.closest(".dl-navitem[data-sec]"); if(!row) return;
    selectSection(row.getAttribute("data-sec"));
  });
}

function selectSection(sec){
  _section = sec;
  if(_els.nav) _els.nav.querySelectorAll(".dl-navitem").forEach(function(n){
    n.classList.toggle("active", n.getAttribute("data-sec")===sec); });
  render();
}

// ================================================================ content ==
function render(){
  var el = _els.content; if(!el) return;
  if(_section==="fetch") return renderFetch(el);
  if(_section==="history") return renderHistory(el);
  if(_section==="routing") return renderRouting(el);
  if(_section==="sources") return renderSources(el);
}

// ---- Fetch ----------------------------------------------------------------
function renderFetch(el){
  el.innerHTML =
    '<div class="dl-h1">Fetch a URL</div>' +
    '<div class="dl-card">' +
      '<div class="dl-row"><input id="dl-url" class="grow" placeholder="https:// or ftp:// or eridoc/wiki/fpt URL…"></div>' +
      '<div class="dl-row">' +
        '<select id="dl-ws"><option value="">— default (~/Downloads) —</option></select>' +
        '<input id="dl-sub" placeholder="subfolder (optional)">' +
        '<label><input type="checkbox" id="dl-dedup" checked> dedup</label>' +
        '<button id="dl-probe">Probe</button>' +
        '<button id="dl-go" class="primary">Download</button></div>' +
      '<pre class="dl-log" id="dl-fetch-log" style="display:none"></pre>' +
    '</div>';
  loadWorkspaces().then(function(list){
    var sel = el.querySelector("#dl-ws");
    list.forEach(function(w){ var o=document.createElement("option");
      o.value=w.name; o.textContent="workspace: "+w.name+(w.current?" (current)":""); sel.appendChild(o); });
  });
  el.querySelector("#dl-probe").addEventListener("click", function(){ doProbe(el); });
  el.querySelector("#dl-go").addEventListener("click", function(){ doFetch(el); });
  el.querySelector("#dl-url").addEventListener("keydown", function(e){ if(e.key==="Enter") doFetch(el); });
}

async function doProbe(el){
  var url = el.querySelector("#dl-url").value.trim();
  var log = el.querySelector("#dl-fetch-log"); log.style.display="block";
  if(!url){ log.textContent="enter a URL"; return; }
  log.textContent = "probing…";
  var r = await api("probe", { url: url });
  if(!r.ok){ log.textContent = "✗ "+(r._error||"probe failed"); return; }
  log.textContent =
    "source: "+(r.source||"(none — unsupported)")+"\n"+
    "filename: "+(r.filename||"?")+"\n"+
    (r.size!=null?"size: "+fmtBytes(r.size)+"\n":"")+
    (r.content_type?"type: "+r.content_type+"\n":"")+
    "already downloaded: "+(r.known?"yes":"no")+
    (r.routed_to?"\nwould route to: "+r.routed_to:"");
}

async function doFetch(el){
  var url = el.querySelector("#dl-url").value.trim();
  var ws = el.querySelector("#dl-ws").value;
  var sub = el.querySelector("#dl-sub").value.trim();
  var dedup = el.querySelector("#dl-dedup").checked;
  var log = el.querySelector("#dl-fetch-log"); log.style.display="block";
  if(!url){ log.textContent="enter a URL"; return; }
  log.textContent = "downloading…";
  var args = { url: url, confirm: true, dedup: dedup?"url":"off" };
  if(ws) args.workspace = ws;
  if(sub) args.subdir = sub;
  var btn = el.querySelector("#dl-go"); btn.disabled = true;
  var r = await api("fetch", args);
  btn.disabled = false;
  if(!r.ok){ log.textContent = "✗ "+(r.error||r._error||"download failed"); return; }
  var lines = [(r.skipped?"✓ already downloaded (deduped by "+(r.deduped_by||"url")+")":"✓ downloaded")];
  lines.push("saved: "+(r.saved_to||""));
  if(r.bytes) lines.push("size: "+fmtBytes(r.bytes));
  if(r.sha256) lines.push("sha256: "+r.sha256);
  if(r.content_duplicate_of) lines.push("content duplicate of: "+r.content_duplicate_of.join(", "));
  log.textContent = lines.join("\n");
  _app && _app.setStatus && _app.setStatus(r.skipped?"Deduped — already downloaded.":"Downloaded "+(r.filename||""));
}

// ---- History --------------------------------------------------------------
function renderHistory(el){
  el.innerHTML =
    '<div class="dl-h1">Download history</div>' +
    '<div class="dl-card"><div class="dl-row">' +
      '<input id="dl-hq" class="grow" placeholder="filter by url / filename…">' +
      '<button id="dl-hgo" class="primary">Search</button>' +
      '<span id="dl-hstats" class="dl-muted"></span></div></div>' +
    '<div id="dl-hlist" class="dl-list"><div class="empty">loading…</div></div>';
  el.querySelector("#dl-hgo").addEventListener("click", function(){ loadHistory(el); });
  el.querySelector("#dl-hq").addEventListener("keydown", function(e){ if(e.key==="Enter") loadHistory(el); });
  loadHistory(el);
  api("dedup_status",{}).then(function(s){ if(s.ok) el.querySelector("#dl-hstats").textContent =
    s.downloads+" downloads · "+fmtBytes(s.total_bytes)+" · "+s.content_dup_groups+" dup groups"; });
}

async function loadHistory(el){
  var q = el.querySelector("#dl-hq").value.trim();
  var out = el.querySelector("#dl-hlist");
  out.innerHTML = '<div class="empty">loading…</div>';
  var r = await api("history", { query: q, limit: 200 });
  if(!r.ok){ out.innerHTML = '<div class="empty">'+esc(r._error||"error")+'</div>'; return; }
  var rows = r.history || [];
  if(!rows.length){ out.innerHTML = '<div class="empty">No downloads recorded yet.</div>'; return; }
  out.innerHTML = rows.map(function(h){
    return '<div class="dl-hrow">' +
      '<div class="dl-hmain"><span class="dl-src">'+esc(h.source||"?")+'</span>'+
        '<span class="dl-fn">'+esc(h.filename||h.url)+'</span></div>' +
      '<div class="dl-hmeta">'+fmtBytes(h.bytes)+' · '+esc(fmtWhen(h.fetched_at))+
        ' · <span class="dl-path">'+esc(h.saved_to||"")+'</span></div>' +
      (h.sha256?'<div class="dl-hsha">'+esc(h.sha256)+'</div>':'') +
      '<div class="dl-hact"><button data-forget="'+esc(h.url)+'">forget</button>'+
        '<button data-reverify="'+esc(h.url)+'">re-verify</button></div></div>';
  }).join('');
  out.querySelectorAll("[data-forget]").forEach(function(b){ b.addEventListener("click", async function(){
    await api("forget",{url:b.getAttribute("data-forget"),confirm:true}); loadHistory(el); }); });
  out.querySelectorAll("[data-reverify]").forEach(function(b){ b.addEventListener("click", async function(){
    b.textContent="checking…"; var v=await api("reverify",{url:b.getAttribute("data-reverify")});
    b.textContent = v.ok ? (v.intact?"✓ intact":(v.exists?"✗ changed":"✗ missing")) : "error"; }); });
}

// ---- Routing --------------------------------------------------------------
function renderRouting(el){
  el.innerHTML =
    '<div class="dl-h1">Folder-routing rules</div>' +
    '<div class="dl-muted" style="margin-bottom:8px">When a download has no explicit destination, the first enabled rule whose glob matches (by url / filename / source) routes it to its folder.</div>' +
    '<div class="dl-card"><div class="dl-row">' +
      '<input id="dl-rmatch" placeholder="glob e.g. *.pdf or *3gpp*">' +
      '<select id="dl-rfield"><option value="url">url</option><option value="filename">filename</option><option value="source">source</option></select>' +
      '<input id="dl-rdest" class="grow" placeholder="destination folder">' +
      '<button id="dl-radd" class="primary">Add rule</button></div></div>' +
    '<div id="dl-rlist" class="dl-list"><div class="empty">loading…</div></div>';
  el.querySelector("#dl-radd").addEventListener("click", async function(){
    var m=el.querySelector("#dl-rmatch").value.trim(), f=el.querySelector("#dl-rfield").value,
        d=el.querySelector("#dl-rdest").value.trim();
    if(!m||!d){ return; }
    await api("routing_set",{match:m,field:f,dest:d,confirm:true});
    el.querySelector("#dl-rmatch").value=""; el.querySelector("#dl-rdest").value="";
    loadRouting(el);
  });
  loadRouting(el);
}

async function loadRouting(el){
  var out = el.querySelector("#dl-rlist");
  var r = await api("routing_list", {});
  var rules = (r.ok && r.rules) || [];
  if(!rules.length){ out.innerHTML = '<div class="empty">No routing rules.</div>'; return; }
  out.innerHTML = rules.map(function(x){
    return '<div class="dl-rrow"><span class="dl-rglob">'+esc(x.match)+'</span>'+
      '<span class="dl-rfield">['+esc(x.field||"url")+']</span>'+
      '<span class="dl-rarrow">→</span><span class="dl-rdest">'+esc(x.dest)+'</span>'+
      '<button data-del="'+esc(x.id)+'">delete</button></div>';
  }).join('');
  out.querySelectorAll("[data-del]").forEach(function(b){ b.addEventListener("click", async function(){
    await api("routing_delete",{id:b.getAttribute("data-del"),confirm:true}); loadRouting(el); }); });
}

// ---- Sources --------------------------------------------------------------
async function renderSources(el){
  el.innerHTML = '<div class="dl-h1">Sources</div><div id="dl-slist" class="dl-list"><div class="empty">loading…</div></div>';
  var out = el.querySelector("#dl-slist");
  var r = await api("sources", {});
  if(!r.ok){ out.innerHTML = '<div class="empty">error</div>'; return; }
  var cfg = r.config || {};
  var head = '<div class="dl-card dl-muted">retries '+esc(cfg.retries)+' · backoff '+esc(cfg.backoff_s)+
    's · max/host '+esc(cfg.max_concurrent_per_host)+' · inline cap '+fmtBytes(cfg.max_inline_bytes)+'</div>';
  out.innerHTML = head + (r.sources||[]).map(function(s){
    return '<div class="dl-srow"><span class="dl-sdot '+(s.configured?"ok":"off")+'"></span>'+
      '<span class="dl-sname">'+esc(s.name)+'</span>'+
      '<span class="dl-muted">priority '+esc(s.priority)+' · '+(s.configured?"configured":"not configured")+'</span></div>';
  }).join('');
}

// ================================================================== mount ==
window.AppUIReady.then(function(){
  _app = AppUI.createApp({
    id: "system-downloader",
    title: "Downloader",
    leftSidebar: { width: 220, tabs: [
      { id: "nav", label: "Downloader", active: true, render: renderNav } ]},
    content: { render: function(el){ el.classList.add("dl-content"); _els.content = el; render(); } },
    statusbar: {},
  });
  if(_app && _app.setStatus) _app.setStatus("Fetch · dedup · history · routing — the one download path.");
}).catch(function(e){
  document.getElementById("app-content-body").innerHTML =
    '<div style="padding:18px">AppUI failed to load: '+esc(e)+'</div>';
});
