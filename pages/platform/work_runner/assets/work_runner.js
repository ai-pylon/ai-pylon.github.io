// Work Runner — AppUI page. Served at /apps/platform/work_runner/.
// Submit a local/remote job and watch the queue + history (auto-refresh).
var APP = "platform/work_runner";

function esc(s){ return String(s==null?"":s).replace(/[&<>"]/g, function(c){
  return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]; }); }

window.addEventListener("error", function (e) {
  try { fetch("/v1/log", { method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ level:"error", source:"work_runner.page", message:String(e.message||e) }) }); } catch(_){}
});

async function api(op, body) {
  var response = await window.AppUIApi.requestResponse("/v1/apps/" + APP + "/" + op, body || {}, {
    method: "POST", timeout: null, decode: function (result) { return result.json(); }
  });
  return response.data;
}

async function confirmDialog(title, bodyHtml, okText) {
  var D = window.AppUIDialog;
  if (!(D && D.confirmAsync)) return Promise.resolve(window.confirm(title.replace(/<[^>]+>/g, "")));
  var body = document.createElement("div"); body.innerHTML = bodyHtml;
  return D.confirmAsync(body, { title: title, width: "440px", cancelFirst: true,
    confirmText: okText || "OK", primary: true });
}

var _app = null, _root = null;

// ---- job rows + expandable details -------------------------------------------------------
var _open = {};          // job id -> true while its detail panel is expanded
var _receipts = {};
var _detail = {};        // job id -> last fetched full job (get)
var _lastJobs = [];

function fmtTs(t) { return t ? new Date(t * 1000).toLocaleString() : ""; }
function fmtDur(s) {
  if (s == null || !isFinite(s) || s < 0) return "";
  s = Math.round(s);
  var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? (h + "h " + m + "m") : m ? (m + "m " + x + "s") : (x + "s");
}
function elapsed(j) {
  var st = j.status, now = Date.now() / 1000;
  if (j.started_ts) return (j.done_ts || (st === "running" ? now : j.started_ts)) - j.started_ts;
  return null;
}
function jobTitle(j) {
  if (j.label) return j.label;
  if (j.kind === "op") return (j.app || "?") + "." + (j.op || "?");
  if (j.kind === "copy") return (j.src || "") + " → " + (j.dest || "");
  return j.cmd || "";
}
function argsBrief(j) {
  var a = j.args;
  if (!a || typeof a !== "object") return "";
  return Object.keys(a).filter(function (k) { return k !== "confirm"; }).map(function (k) {
    var v = a[k]; v = (typeof v === "string") ? v : JSON.stringify(v);
    return k + "=" + (v.length > 40 ? v.slice(0, 40) + "…" : v);
  }).join("  ");
}
function progressBar(p) {
  if (!p) return "";
  var pct = p.fraction != null ? Math.round(p.fraction * 100) : null;
  var txt = (pct != null ? pct + "%" : "") + (p.detail ? " " + p.detail : "") + (p.eta_s ? " · eta " + fmtDur(p.eta_s) : "");
  return '<span class="wr-prog" title="' + esc(txt) + '"><span class="wr-bar"><i style="width:' + (pct == null ? 100 : pct) +
    '%"' + (pct == null ? ' class="ind"' : '') + '></i></span><span class="wr-ptxt">' + esc(txt) + '</span></span>';
}
function stClass(st) {
  return ({done:"ok", error:"bad", running:"run", claimed:"run", pending:"pend", cancelled:"muted"})[st] || "muted";
}
function canCancel(st) { return st === "pending" || st === "claimed" || st === "running"; }

function jobRow(j) {
  var st = j.status || "?";
  var where = (j.target === "endpoint" ? ("endpoint: "+j.host) : j.target === "remote" ? (j.host || "remote") : "local") + " · " + (j.kind || "run") +
    (j.isolate || j.transport === "op-isolated" ? " · isolated" : "");
  var tail = (j.exit !== undefined && j.exit !== null && j.kind !== "op") ? (" exit " + j.exit) : (j.error ? (" — " + j.error) : "");
  var open = !!_open[j.id];
  var el = elapsed(j);
  var h = '<div class="wr-job' + (open ? ' open' : '') + '" data-jid="' + esc(j.id) + '">' +
    '<span class="wr-tw">' + (open ? '▾' : '▸') + '</span>' +
    '<span class="wr-st wr-' + stClass(st) + '">' + esc(st) + '</span>' +
    '<span class="wr-lbl">' + esc(where) + '</span>' +
    '<span class="wr-cmd" title="' + esc(argsBrief(j)) + '">' + esc(jobTitle(j)) +
      (j.kind === "op" && argsBrief(j) ? ' <span class="wr-args">' + esc(argsBrief(j)) + '</span>' : '') + esc(tail) + '</span>' +
    progressBar(j.progress) +
    '<span class="wr-el">' + esc(el != null ? fmtDur(el) : "") + '</span>' +
    (canCancel(st) ? '<button class="wr-cancel" data-jid="' + esc(j.id) + '" data-st="' + esc(st) + '" data-coop="' + (j.cooperative_cancel ? '1' : '0') + '">' + (j.stop_requested ? 'stopping…' : 'cancel') + '</button>' : '') +
    '</div>';
  if (open) h += '<div class="wr-detail" data-for="' + esc(j.id) + '">' + detailHtml(_detail[j.id] || j) + '</div>';
  return h;
}

function pre(label, v, cap) {
  if (v == null || v === "") return "";
  var t = (typeof v === "string") ? v : JSON.stringify(v, null, 2);
  var cut = t.length > (cap || 20000);
  if (cut) t = t.slice(0, cap || 20000) + "\n…[" + (t.length - (cap || 20000)) + " more chars]";
  return '<div class="wr-dh">' + esc(label) + '</div><pre class="wr-pre">' + esc(t) + '</pre>';
}
function kv(k, v) {
  return (v == null || v === "") ? "" : '<div class="wr-kv"><span>' + esc(k) + '</span><b>' + esc(v) + '</b></div>';
}
function detailHtml(j) {
  var el = elapsed(j), p = j.progress, h = '<div class="wr-kvs">';
  h += kv("id", j.id) + kv("status", j.status) + kv("target", (j.target || "") + (j.host ? " · " + j.host : "")) +
    kv("kind", j.kind) + kv("app.op", j.kind === "op" ? (j.app + "." + j.op) : "") + kv("transport", j.transport) +
    kv("submitted", fmtTs(j.submitted_ts)) + kv("started", fmtTs(j.started_ts)) + kv("finished", fmtTs(j.done_ts)) +
    kv("elapsed", el != null ? fmtDur(el) : "") + kv("timeout", j.timeout ? fmtDur(j.timeout) : "") +
    kv("exit", j.exit) + kv("timed out", j.timed_out ? "yes" : "") + kv("reclaimed", j.reclaim_count ? (j.reclaim_count + "×") : "") +
    kv("cwd", j.cwd) + kv("error", j.error);
  if (p) h += kv("progress", (p.fraction != null ? Math.round(p.fraction * 100) + "% " : "") + (p.done != null && p.total && !p.detail ? "(" + p.done + "/" + p.total + ") " : "") + (p.detail || "") + (p.eta_s ? " · eta " + fmtDur(p.eta_s) : ""));
  h += '</div>';
  if (j.kind === "run") h += pre("command", j.cmd) + pre("script", j.script);
  if (j.kind === "copy") h += pre("copy", (j.src || "") + "  →  " + (j.dest || "") + (j.direction ? "  (" + j.direction + ")" : ""));
  if (j.args && Object.keys(j.args).length) h += pre("args", j.args);
  if (j.op_result !== undefined) h += pre("result (op_result)", j.op_result);
  else if (j.has_op_result) h += '<div class="wr-dh muted">result loading…</div>';
  if(j.target==="endpoint")h+='<button class="wr-receipt" data-receipt="'+esc(j.id)+'">Check endpoint receipt</button><pre class="wr-receipt-result">'+esc(_receipts[j.id]||"")+'</pre>';
  h += pre("stdout", j.stdout) + pre("stderr", j.stderr);
  if (j.status === "running" && !p && j.kind === "op") {
    h += '<div class="wr-dh muted">This op does not report progress (framework.jobprogress), so only the elapsed time is known.</div>';
  }
  return h;
}

async function loadDetail(id) {
  var r = await api("get", { job_id: id });
  if (r && r.ok && r.job) _detail[id] = r.job;
  return _detail[id];
}

async function refresh(root) {
  var r = await api("list", { which: "all", limit: 50 });
  var box = root.querySelector("#wr-jobs");
  if (!r.ok) { box.innerHTML = '<div class="empty">' + esc(r._error||"error") + '</div>'; return; }
  var all = r.jobs || [];
  _lastJobs = all;
  var isActive = function (j) { return j.status === "pending" || j.status === "running" || j.status === "claimed"; };
  var active = all.filter(isActive);
  var recent = all.filter(function (j) { return !isActive(j); }).sort(function (a, b) {
    return (b.done_ts || b.submitted_ts || 0) - (a.done_ts || a.submitted_ts || 0); });
  // refresh the full record of every expanded job (running ones change; finished ones once)
  var ids = Object.keys(_open).filter(function (id) { return _open[id]; });
  await Promise.all(ids.map(function (id) {
    var j = all.filter(function (x) { return x.id === id; })[0];
    if (j && (isActive(j) || !_detail[id])) return loadDetail(id);
  }));
  // carry the live progress from the list row into the cached full record
  ids.forEach(function (id) {
    var j = all.filter(function (x) { return x.id === id; })[0];
    if (j && _detail[id]) _detail[id] = Object.assign({}, _detail[id], { progress: j.progress, status: j.status });
  });
  var scroll = box.scrollTop;
  var html = '<div class="wr-h">Active (' + active.length + ')</div>';
  html += active.length ? active.map(jobRow).join('') : '<div class="empty">No active jobs.</div>';
  html += '<div class="wr-h">Recent (' + recent.length + ')</div>';
  html += recent.length ? recent.map(jobRow).join('') : '<div class="empty">No history.</div>';
  box.innerHTML = html;
  box.scrollTop = scroll;
}

async function toggleJob(root, id) {
  if (_open[id]) { delete _open[id]; delete _detail[id]; }
  else { _open[id] = true; await loadDetail(id); }
  refresh(root);
}

async function cancelJob(root, id, st, cooperative) {
  var force = (st === "running" && !cooperative);
  if (force) {
    var ok = await confirmDialog("Cancel running job?",
      "<div>Job <b>" + esc(id) + "</b> is <b>running</b>. Force-cancelling drops it; work already in progress is lost " +
      "(an incremental job can be re-run and continues from what was saved).</div>", "Force cancel");
    if (!ok) return;
  }
  var r = await api("cancel", force ? { job_id: id, force: true } : { job_id: id });
  var msg = root.querySelector("#wr-msg");
  if (msg) msg.textContent = r.ok ? ((r.status === "stop_requested" ? "Stop requested at safe boundary: " : "Cancellation requested: ") + id) : ("Cancel failed: " + (r._error || "error"));
  refresh(root);
}
async function submitJob(root) {
  var target = root.querySelector("#wr-target").value;
  var host = root.querySelector("#wr-host").value.trim();
  var cmd = root.querySelector("#wr-cmd").value.trim();
  var msg = root.querySelector("#wr-msg");
  if (!cmd) { msg.textContent = "Enter a command."; return; }
  if (target === "remote" && !host) { msg.textContent = "Remote job needs a host."; return; }
  var ok = await confirmDialog("Submit job",
    "<div>Run on <b>" + esc(target === "remote" ? host : "local") + "</b>:</div>" +
    "<pre style=\"white-space:pre-wrap\">" + esc(cmd) + "</pre>", "Submit");
  if (!ok) return;
  var body = { target: target, kind: "run", cmd: cmd };
  if (target === "remote") body.host = host;
  var r = await api("submit", body);
  msg.textContent = r.ok ? ("Queued " + r.job.id) : ("Submit failed: " + (r._error||"error"));
  refresh(root);
}

async function refreshEndpoints(root){
  var r=await api("endpoint_status",{}),host=root.querySelector("#wr-endpoint"),old=host.value;
  host.replaceChildren(new Option("Choose endpoint",""),new Option("Use my placement policy","@policy"));
  for(var ep of r.endpoints||[]){var opt=new Option(ep.id+" · "+ep.platform+" · "+ep.tasks.join(", "),ep.id);opt.dataset.tasks=ep.tasks.join(",");host.add(opt);}
  if(Array.from(host.options).some(o=>o.value===old))host.value=old;
  root.querySelector("#wr-endpoint-msg").textContent=r.endpoints?.length?"Select an endpoint; files and computation stay on that machine.":"No supported endpoint connected.";
}
async function submitEndpoint(root){
  var ep=root.querySelector("#wr-endpoint"),task=root.querySelector("#wr-endpoint-task").value,value=root.querySelector("#wr-endpoint-input").value.trim(),msg=root.querySelector("#wr-endpoint-msg");
  if(!ep.value||!value||(ep.value!=="@policy"&&!ep.selectedOptions[0].dataset.tasks.split(",").includes(task))){msg.textContent="Choose a supported endpoint/task and enter its input.";return;}
  var timeout=Number(root.querySelector("#wr-endpoint-timeout").value);
  if(!await confirmDialog("Submit endpoint work","Run "+esc(task)+" on <b>"+esc(ep.value)+"</b>? Policy routing is resolved before dispatch; no unapproved fallback. Do not include credentials.","Submit"))return;
  var r=await api("endpoint_submit",{endpoint:ep.value,task:task,args:task==="download"?{url:value}:{cmd:value},timeout:timeout,confirm:true});
  msg.textContent=r.ok?"Queued "+r.job.id:(r._error||r.error||"Submission failed");refresh(root);
}
async function refreshPlacement(root){
  var r=await api("placement_policy",{action:"get",confirm:true}),msg=root.querySelector("#wr-placement-msg");
  if(!r.ok){msg.textContent=r.error||"Policy unavailable";return;}
  for(var task of ["run","compute","download"]){
    var rule=r.policy[task];root.querySelector("#wr-policy-"+task+"-platform").value=rule.platform;
    root.querySelector("#wr-policy-"+task+"-order").value=rule.order.join(", ");
    if(task==="compute")root.querySelector("#wr-policy-strategy").value=rule.strategy||"ordered";
  }
  msg.textContent="Available nodes: "+(r.endpoints||[]).map(e=>e.id+" ("+e.platform+")").join(", ")+". Include the server's daemon in the order if server execution is allowed.";
}
async function savePlacement(root){
  var policy={},msg=root.querySelector("#wr-placement-msg");
  for(var task of ["run","compute","download"]){
    policy[task]={platform:root.querySelector("#wr-policy-"+task+"-platform").value,order:root.querySelector("#wr-policy-"+task+"-order").value.split(",").map(x=>x.trim()).filter(Boolean)};
  }
  policy.compute.strategy=root.querySelector("#wr-policy-strategy").value;
  if(!await confirmDialog("Save placement policy","New policy-routed jobs will use the first available compatible node in each ordered list. Explicit jobs and already dispatched work remain pinned.","Save"))return;
  var r=await api("placement_policy",{action:"set",policy:policy,confirm:true});msg.textContent=r.ok?"Policy saved.":(r.error||"Save failed");
}
function policyFields(){
  return ["run","compute","download"].map(task=>'<div class="wr-form"><label>'+task+'</label><select aria-label="'+task+' platform" id="wr-policy-'+task+'-platform"><option value="linux">Linux</option>'+(task==="download"?"":'<option value="windows">Windows</option>')+'</select><input aria-label="'+task+' preferred endpoints" id="wr-policy-'+task+'-order" placeholder="Endpoint IDs in priority order, comma separated"></div>').join("");
}
async function refreshDefinitions(root){
  var r=await api("work_definition",{action:"list",confirm:true}),select=root.querySelector("#wr-def-id"),old=select.value;
  select.replaceChildren(new Option("Choose reusable work",""));
  for(var d of r.definitions||[])select.add(new Option(d.title+" · "+d.id.slice(0,12),d.id));
  if(Array.from(select.options).some(x=>x.value===old))select.value=old;
}
async function registerDefinition(root){
  var msg=root.querySelector("#wr-def-msg");
  try{
    var source=root.querySelector("#wr-def-source").value;
    var digest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(source)))).map(x=>x.toString(16).padStart(2,"0")).join("");
    var d={title:root.querySelector("#wr-def-title").value,python:{source:source,sha256:digest,python:root.querySelector("#wr-def-python").value,packages:JSON.parse(root.querySelector("#wr-def-packages").value||"{}"),argv:JSON.parse(root.querySelector("#wr-def-argv").value||"[]")},vfs:JSON.parse(root.querySelector("#wr-def-vfs").value||"[]"),timeout:Number(root.querySelector("#wr-endpoint-timeout").value)};
    if(!await confirmDialog("Register immutable work",esc(d.title)+" · "+esc(digest.slice(0,12))+". Source and arguments must not contain credentials.","Register"))return;
    var r=await api("work_definition",{action:"register",definition:d,confirm:true});
    msg.textContent=r.ok?"Registered "+r.id:(r.error||"Registration failed");
    if(r.ok){await refreshDefinitions(root);root.querySelector("#wr-def-id").value=r.id;}
  }catch(e){msg.textContent="Invalid work definition: "+String(e.message||e);}
}
async function runDefinition(root){
  var id=root.querySelector("#wr-def-id").value,endpoint=root.querySelector("#wr-endpoint").value,msg=root.querySelector("#wr-def-msg");
  if(!id||!endpoint){msg.textContent="Choose a definition and endpoint above.";return;}
  if(!await confirmDialog("Run reusable work","Run the selected immutable definition on "+esc(endpoint)+"?","Run"))return;
  var r=await api("work_definition",{action:"run",id:id,endpoint:endpoint,confirm:true});
  msg.textContent=r.ok?"Queued "+r.job.id:(r.error||r._error||"Submission failed");refresh(root);
}
async function refreshSchedules(root){
  var r=await api("schedule",{action:"list"}),host=root.querySelector("#wr-schedules");host.replaceChildren();
  if(!r.ok){host.textContent="Schedule status unavailable";return;}
  for(var x of r.schedules||[]){
    var row=document.createElement("div");row.className="wr-form";
    var title=document.createElement("span");title.textContent=x.id+" · "+x.interval_s+"s · "+(x.enabled?"enabled":"paused")+" · "+(x.last_status||"not run")+" · "+(x.enabled?fmtTs(x.next_at):"");row.append(title);
    for(var action of ["toggle","run_now"]){
      (function(x,action){var b=document.createElement("button");b.textContent=action==="toggle"?(x.enabled?"Pause":"Enable"):"Run now";b.onclick=async function(){if(!await confirmDialog("Confirm schedule action",esc(x.id),"Confirm"))return;await api("schedule",{action:action,id:x.id,enabled:!x.enabled,confirm:true});await refreshSchedules(root);await refresh(root);};row.append(b);})(x,action);
    }
    host.append(row);
  }
  if(!(r.schedules||[]).length)host.textContent="No periodic work registered.";
}
async function saveSchedule(root){
  var msg=root.querySelector("#wr-schedule-msg");
  try{
    var id=root.querySelector("#wr-schedule-id").value,app=root.querySelector("#wr-schedule-app").value,op=root.querySelector("#wr-schedule-op").value,args=JSON.parse(root.querySelector("#wr-schedule-args").value||"{}");
    if(!await confirmDialog("Register periodic operation",esc(app+"."+op+" ("+id+")"),"Save"))return;
    var r=await api("schedule",{action:"set",id:id,interval_s:Number(root.querySelector("#wr-schedule-interval").value),enabled:true,job:{kind:"op",app:app,op:op,args:args},confirm:true});
    msg.textContent=r.ok?"Saved":(r.error||r._error||"Failed");await refreshSchedules(root);
  }catch(e){msg.textContent="Invalid schedule or JSON arguments";}
}
async function refreshWorkflows(root){
  var r=await api("workflow",{action:"list"}),host=root.querySelector("#wr-workflows");host.replaceChildren();
  if(!r.ok){host.textContent="Workflow list unavailable";return;}
  for(var w of r.workflows||[]){
    var block=document.createElement("details"),heading=document.createElement("summary");
    heading.textContent=w.title+" · "+w.status+" · "+fmtTs(w.created_at);block.append(heading);
    var pre=document.createElement("pre");pre.textContent=Object.entries(w.nodes).map(function(pair){var n=pair[1];return pair[0]+": "+n.status+(n.after.length?" (after "+n.after.join(", ")+")":"")+(n.job_id?" · "+n.job_id:"");}).join("\n");block.append(pre);
    if(w.status==="running"){
      var b=document.createElement("button");b.textContent="Stop scheduling remaining nodes";
      b.onclick=async function(){if(await confirmDialog("Cancel workflow",esc(w.title)+" — active jobs may finish.","Confirm")){await api("workflow",{action:"cancel",id:w.id,confirm:true});await refreshWorkflows(root);}};block.append(b);
    }host.append(block);
  }
  if(!host.children.length)host.textContent="No workflows yet.";
}
async function createWorkflow(root){
  var msg=root.querySelector("#wr-workflow-msg");
  try{
    var nodes=JSON.parse(root.querySelector("#wr-workflow-nodes").value),title=root.querySelector("#wr-workflow-title").value;
    if(!await confirmDialog("Create workflow","Run "+esc(nodes.length)+" declared local app operations?","Create"))return;
    var r=await api("workflow",{action:"create",title:title,nodes:nodes,confirm:true});msg.textContent=r.ok?"Created "+r.workflow.id:(r.error||"Rejected");await refreshWorkflows(root);
  }catch(e){msg.textContent="Invalid workflow: "+String(e.message||e);}
}
function mountContent(el) {
  el.classList.add("wr-content");
  el.innerHTML =
    '<div class="wr-form">' +
      '<select id="wr-target"><option value="local">local</option><option value="remote">remote</option></select>' +
      '<input id="wr-host" placeholder="host/alias (remote)">' +
      '<input id="wr-cmd" placeholder="command">' +
      '<button id="wr-go" class="primary">Submit</button>' +
    '</div>' +
    '<div id="wr-msg" class="wr-note"></div>' +
    '<details open><summary>Endpoint workloads</summary><p>Delegate computation and public downloads to a connected daemon. Short commands: up to 300 seconds; durable compute/download: up to 3600 seconds. Never include secrets.</p><div class="wr-form"><select id="wr-endpoint" aria-label="Endpoint"></select><button id="wr-endpoint-refresh">Refresh endpoints</button><select id="wr-endpoint-task" aria-label="Task"><option value="run">Short command</option><option value="compute">Durable compute</option><option value="download">Public HTTPS download (Linux)</option></select><input id="wr-endpoint-timeout" type="number" min="5" max="3600" value="300" aria-label="Timeout seconds"><textarea id="wr-endpoint-input" placeholder="Nonsecret command or public HTTPS URL"></textarea><button id="wr-endpoint-submit">Queue endpoint work</button></div><p id="wr-endpoint-msg"></p></details>' +
    '<details><summary>Workload placement policy</summary><p>Ordered eligible endpoints per workload. A server daemon may be first, last, or excluded. An empty list disables policy routing for that workload. Choose a compatible operating system; machine-local paths require an explicit endpoint. Python and declared VFS requirements are checked before policy dispatch.</p>'+policyFields()+'<label>Compute admission <select id="wr-policy-strategy"><option value="ordered">Ordered candidates</option><option value="capacity">Require available compute slot and disk reserve</option></select></label><button id="wr-policy-save">Save policy</button> <button id="wr-policy-refresh">Refresh policy</button><p id="wr-placement-msg"></p></details>' +
    '<details><summary>Reusable Python work</summary><p>Register versioned Python code with exact preinstalled package versions and VFS declarations. Uses the endpoint selection and timeout above. VFS route proxy_stream supports staged files up to 16 MiB. No automatic dependency installation.</p><div class="wr-form"><input id="wr-def-title" placeholder="Work title"><input id="wr-def-python" placeholder="Python major.minor (e.g. 3.13)"><textarea id="wr-def-source" rows="6" placeholder="Python source (no credentials)"></textarea><textarea id="wr-def-packages" placeholder="Exact package versions JSON">{}</textarea><textarea id="wr-def-argv" placeholder="Arguments JSON">[]</textarea><textarea id="wr-def-vfs" placeholder="Declared VFS routes JSON">[]</textarea><button id="wr-def-register">Register work</button></div><div class="wr-form"><select id="wr-def-id"></select><button id="wr-def-refresh">Refresh definitions</button><button id="wr-def-run">Run selected work</button></div><p id="wr-def-msg"></p></details>' +
    '<details><summary>Periodic work</summary><div id="wr-schedules"></div><button id="wr-schedule-refresh">Refresh schedules</button><div class="wr-form"><input id="wr-schedule-id" placeholder="Schedule ID"><input id="wr-schedule-app" placeholder="app/id"><input id="wr-schedule-op" placeholder="operation"><input id="wr-schedule-interval" type="number" min="60" value="300" aria-label="Interval seconds"><textarea id="wr-schedule-args" placeholder="Nonsecret JSON arguments">{}</textarea><button id="wr-schedule-save">Save periodic work</button></div><div id="wr-schedule-msg"></div></details>' +
    '<details><summary>Dependency workflows</summary><div id="wr-workflows"></div><button id="wr-workflow-refresh">Refresh workflows</button><div class="wr-form"><input id="wr-workflow-title" placeholder="Workflow title"><textarea id="wr-workflow-nodes" placeholder="Nonsecret node definitions (JSON)" rows="5">[]</textarea><button id="wr-workflow-create">Create workflow</button></div><p id="wr-workflow-msg"></p></details>' +
    '<label class="wr-auto"><input type="checkbox" id="wr-auto" checked> auto-refresh</label>' +
    '<div class="wr-jobs" id="wr-jobs"><div class="empty">Loading…</div></div>';
  return el;
}

window.AppUIReady.then(function () {
  _app = AppUI.createApp({
    id: "system-work-runner",
    title: "Work Runner",
    content: { render: function (el) { _root = mountContent(el); } },
    statusbar: {},
  });
  var poller = AppUIPollRefresh.create(function () { return refresh(_root); }, 2500, {
    stopWhen: function () { return !_root || !_root.isConnected; }
  });
  function setAuto(on) { if (on) poller.start(); else poller.stop(); }
  function wire() {
    if (!_root) { setTimeout(wire, 20); return; }
    _root.querySelector("#wr-endpoint-refresh").onclick=function(){refreshEndpoints(_root);};
    _root.querySelector("#wr-endpoint-submit").onclick=function(){submitEndpoint(_root);};
    _root.querySelector("#wr-endpoint-task").onchange=function(e){_root.querySelector("#wr-endpoint-timeout").value=e.target.value==="run"?300:1800;};
    refreshEndpoints(_root);
    _root.querySelector("#wr-policy-save").onclick=function(){savePlacement(_root);};
    _root.querySelector("#wr-policy-refresh").onclick=function(){refreshPlacement(_root);};
    refreshPlacement(_root);
    _root.querySelector("#wr-def-register").onclick=function(){registerDefinition(_root);};
    _root.querySelector("#wr-def-refresh").onclick=function(){refreshDefinitions(_root);};
    _root.querySelector("#wr-def-run").onclick=function(){runDefinition(_root);};
    refreshDefinitions(_root);
    _root.addEventListener("click",async function(e){
      var b=e.target.closest("[data-receipt]");if(!b)return;
      e.stopPropagation();b.disabled=true;
      try{var r=await api("endpoint_receipt",{job_id:b.dataset.receipt});_receipts[b.dataset.receipt]=JSON.stringify(r,null,2);var out=b.nextElementSibling;if(out)out.textContent=_receipts[b.dataset.receipt];}
      catch(err){if(b.nextElementSibling)b.nextElementSibling.textContent="Receipt unavailable";}
      finally{b.disabled=false;}
    },true);

    _root.querySelector("#wr-go").addEventListener("click", function () { submitJob(_root); });
    _root.querySelector("#wr-auto").addEventListener("change", function (e) { setAuto(e.target.checked); });
    _root.querySelector("#wr-jobs").addEventListener("click", function (e) {
      var c = e.target.closest(".wr-cancel");
      if (c) { cancelJob(_root, c.getAttribute("data-jid"), c.getAttribute("data-st"), c.getAttribute("data-coop")==="1"); return; }
      if (e.target.closest(".wr-detail")) return;          // selecting text in a panel must not collapse it
      var row = e.target.closest(".wr-job"); if (row) toggleJob(_root, row.getAttribute("data-jid"));
    });
    _root.querySelector("#wr-schedule-refresh").onclick=function(){refreshSchedules(_root);};
    _root.querySelector("#wr-schedule-save").onclick=function(){saveSchedule(_root);};
    _root.querySelector("#wr-workflow-refresh").onclick=function(){refreshWorkflows(_root);};
    _root.querySelector("#wr-workflow-create").onclick=function(){createWorkflow(_root);};
    refreshWorkflows(_root);
    refreshSchedules(_root);
    setAuto(true); poller.refresh();
    _app.setStatus("Background job queue (local / remote via remote_runner).");
  }
  wire();
}).catch(function (e) {
  document.getElementById("app-content-body").innerHTML =
    '<div style="padding:18px">AppUI failed to load: ' + esc(e) + '</div>';
});
