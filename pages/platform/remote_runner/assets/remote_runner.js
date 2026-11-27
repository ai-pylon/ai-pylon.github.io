// Remote Runner — AppUI page. Served at /apps/platform/remote_runner/.
// Run a command, and manage DETACHED jobs (launch/list/status/log/cancel) on a
// host (an auth_ssh alias). run/copy/job_launch/job_cancel are safety=confirm;
// the page confirms job_cancel via AppUIDialog.
var APP = "platform/remote_runner";
var STATE = { host: "", view: "run" };

function esc(s){ return String(s==null?"":s).replace(/[&<>"]/g, function(c){
  return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]; }); }

window.addEventListener("error", function (e) {
  try { fetch("/v1/log", { method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ level:"error", source:"remote_runner.page", message:String(e.message||e) }) }); } catch(_){}
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
    confirmText: okText || "OK", primary: true, danger: true });
}

function host(){ return STATE.host.trim(); }

async function doRun(root) {
  var out = root.querySelector("#rr-out");
  var cmd = root.querySelector("#rr-cmd").value.trim();
  if (!host()) { out.textContent = "Pick or type a host first."; return; }
  if (!cmd) { out.textContent = "Enter a command."; return; }
  out.textContent = "Running…";
  var r = await api("run", { host: host(), cmd: cmd });
  if (!r.ok) { out.textContent = "FAILED (" + (r.phase||"") + " " + (r.category||"") + "): " + (r._error || r.stderr || "error"); return; }
  out.textContent = "exit " + r.exit + "\n\n" + (r.stdout || "") + (r.stderr ? ("\n[stderr]\n" + r.stderr) : "");
}

async function loadJobs(root) {
  var box = root.querySelector("#rr-jobs");
  if (!host()) { box.innerHTML = '<div class="empty">Pick a host.</div>'; return; }
  box.innerHTML = '<div class="empty">Loading jobs…</div>';
  var r = await api("job_list", { host: host() });
  if (!r.ok) { box.innerHTML = '<div class="empty">' + esc(r._error||"error") + '</div>'; return; }
  var jobs = r.jobs || [];
  if (!jobs.length) { box.innerHTML = '<div class="empty">No jobs under ' + esc(r.job_root) + '.</div>'; return; }
  box.innerHTML = jobs.map(function (j) {
    var running = j.status === "running" && (j.rc === null || j.rc === undefined);
    return '<div class="rr-job" data-jid="' + esc(j.job_id) + '">' +
      '<span class="rr-st rr-' + (running?"run":"done") + '">' + esc(j.status||"?") + '</span>' +
      '<span class="rr-jid">' + esc(j.job_id) + '</span>' +
      '<span class="rr-rc">' + (j.rc===null||j.rc===undefined?"":("rc "+j.rc)) + '</span>' +
      '<button class="rr-jlog" data-jid="' + esc(j.job_id) + '">log</button>' +
      '<button class="rr-jcancel danger" data-jid="' + esc(j.job_id) + '">cancel</button>' +
      '</div>';
  }).join('') + '<div id="rr-joblog"></div>';
}

async function launchJob(root) {
  var cmd = root.querySelector("#rr-jobcmd").value.trim();
  if (!host()) { return; }
  if (!cmd) { root.querySelector("#rr-joberr").textContent = "Enter a job command."; return; }
  root.querySelector("#rr-joberr").textContent = "Launching…";
  var r = await api("job_launch", { host: host(), cmd: cmd });
  root.querySelector("#rr-joberr").textContent = r.ok
    ? ("Launched " + r.job_id + " (pid " + r.pid + ")") : ("Launch failed: " + (r._error||"error"));
  loadJobs(root);
}

function mountContent(el) {
  el.classList.add("rr-content");
  el.innerHTML =
    '<div class="rr-bar">' +
      '<select id="rr-host"><option value="">— host —</option></select>' +
      '<input id="rr-hosttext" placeholder="or type an alias/host">' +
      '<button id="rr-refresh">↻ hosts</button>' +
    '</div>' +
    '<div class="rr-tabs" id="tabs">' +
      [['run','run command'],['jobs','detached jobs']].map(function (v) {
        return '<button data-v="' + v[0] + '"' + (v[0]===STATE.view?' class="active"':'') + '>' + v[1] + '</button>';
      }).join('') +
    '</div>' +
    '<div id="rr-panel"></div>';
  return el;
}

function renderPanel(root) {
  var p = root.querySelector("#rr-panel");
  if (STATE.view === "run") {
    p.innerHTML =
      '<div class="rr-form"><input id="rr-cmd" placeholder="command (e.g. uname -a)"><button id="rr-go" class="primary">Run</button></div>' +
      '<pre class="rr-out" id="rr-out">Output appears here.</pre>';
    root.querySelector("#rr-go").addEventListener("click", function () { doRun(root); });
    root.querySelector("#rr-cmd").addEventListener("keydown", function (e) { if (e.key === "Enter") doRun(root); });
  } else {
    p.innerHTML =
      '<div class="rr-form"><input id="rr-jobcmd" placeholder="detached job command"><button id="rr-joblaunch" class="primary">Launch</button></div>' +
      '<div id="rr-joberr" class="rr-note"></div>' +
      '<div class="rr-form"><button id="rr-jobsrefresh">↻ jobs</button></div>' +
      '<div class="rr-jobs" id="rr-jobs"><div class="empty">Pick a host.</div></div>';
    root.querySelector("#rr-joblaunch").addEventListener("click", function () { launchJob(root); });
    root.querySelector("#rr-jobsrefresh").addEventListener("click", function () { loadJobs(root); });
    loadJobs(root);
  }
}

async function loadHosts(root) {
  var r = await api("hosts", {});
  var sel = root.querySelector("#rr-host");
  if (sel && r.ok) {
    (r.hosts || []).forEach(function (h) {
      var o = document.createElement("option");
      o.value = h.alias || h.host; o.textContent = (h.alias || h.host) + (h.host && h.alias ? "  (" + h.host + ")" : "");
      sel.appendChild(o);
    });
  }
}

window.AppUIReady.then(function () {
  var root = null;
  var app = AppUI.createApp({
    id: "system-remote-runner",
    title: "Remote Runner",
    content: { render: function (el) { root = mountContent(el); } },
    statusbar: {},
  });
  function wire() {
    if (!root) { setTimeout(wire, 20); return; }
    loadHosts(root);
    root.querySelector("#rr-host").addEventListener("change", function (e) {
      STATE.host = e.target.value; root.querySelector("#rr-hosttext").value = e.target.value;
      if (STATE.view === "jobs") loadJobs(root);
    });
    root.querySelector("#rr-hosttext").addEventListener("input", function (e) { STATE.host = e.target.value; });
    root.querySelector("#rr-refresh").addEventListener("click", function () {
      var sel = root.querySelector("#rr-host"); sel.length = 1; loadHosts(root);
    });
    root.querySelector("#tabs").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-v]"); if (!b) return;
      STATE.view = b.getAttribute("data-v");
      root.querySelectorAll("#tabs button").forEach(function (x) { x.classList.toggle("active", x === b); });
      renderPanel(root);
    });
    // delegated job actions
    root.querySelector("#rr-panel").addEventListener("click", async function (e) {
      var lg = e.target.closest(".rr-jlog");
      var cx = e.target.closest(".rr-jcancel");
      if (lg) {
        var box = root.querySelector("#rr-joblog");
        if (box) box.innerHTML = '<div class="empty">Loading log…</div>';
        var r = await api("job_log", { host: host(), job_id: lg.getAttribute("data-jid") });
        if (box) box.innerHTML = r.ok ? ('<pre class="rr-out">' + esc(r.log||"(empty)") + '</pre>') : ('<div class="empty">' + esc(r._error||"error") + '</div>');
      } else if (cx) {
        var jid = cx.getAttribute("data-jid");
        var ok = await confirmDialog("Cancel job", "<div>Cancel <b>" + esc(jid) + "</b>? This TERMs then KILLs its process group.</div>", "Cancel job");
        if (!ok) return;
        await api("job_cancel", { host: host(), job_id: jid });
        loadJobs(root);
      }
    });
    renderPanel(root);
    app.setStatus("Remote run + detached jobs over platform/auth_ssh.");
  }
  wire();
}).catch(function (e) {
  document.getElementById("app-content-body").innerHTML =
    '<div style="padding:18px">AppUI failed to load: ' + esc(e) + '</div>';
});
