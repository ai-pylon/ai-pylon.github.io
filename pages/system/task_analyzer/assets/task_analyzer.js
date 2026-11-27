// Task Analyzer — AppUI page. Served at /apps/system/task_analyzer/.
// Views: Analyze (summary + verdict + top consumers), Processes (sortable list
// + guarded kill), Tree (process hierarchy). Backed by the system/task_analyzer
// ops. Kill is safety=confirm; the page confirms via AppUIDialog before killing.
var APP = "system/task_analyzer";
var STATE = { view: "analyze", sort: "memory" };

function esc(s){ return String(s==null?"":s).replace(/[&<>"]/g, function(c){
  return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]; }); }

window.addEventListener("error", function (e) {
  try { fetch("/v1/log", { method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ level:"error", source:"task_analyzer.page", message:String(e.message||e) }) }); } catch(_){}
});

async function api(op, body) {
  var response = await window.AppUIApi.requestResponse("/v1/apps/" + APP + "/" + op, body || {}, {
    method: "POST", timeout: null, decode: function (result) { return result.json(); }
  });
  return response.data;
}

// Non-blocking confirm via AppUIDialog (falls back to window.confirm).
async function confirmDialog(title, bodyHtml) {
  var D = window.AppUIDialog;
  if (!(D && D.confirmAsync)) return Promise.resolve(window.confirm(title.replace(/<[^>]+>/g, "")));
  var body = document.createElement("div"); body.innerHTML = bodyHtml;
  return D.confirmAsync(body, { title: title, width: "460px", cancelFirst: true,
    confirmText: "Kill", primary: true, danger: true });
}

function mb(n){ return (n == null) ? "" : (Number(n).toLocaleString(undefined,{maximumFractionDigits:0}) + " MB"); }
function pct(n){ return (n == null) ? "" : (Number(n).toFixed(1) + "%"); }

function bar(pctVal) {
  var v = Math.max(0, Math.min(100, Number(pctVal) || 0));
  return '<span class="ta-bar"><span class="ta-bar-fill" style="width:' + v + '%"></span></span>';
}

function renderAnalyze(out, d) {
  if (!d || !d.ok) { out.innerHTML = '<div class="empty">' + esc((d && d._error) || "error") + '</div>'; return; }
  var s = d.summary || {};
  var html = '<div class="ta-verdict">' + esc(d.verdict || "") + '</div>';
  html += '<div class="ta-cards">' +
    '<div class="ta-card"><div class="ta-k">CPU</div><div class="ta-v">' + pct(s.cpu_percent) + '</div>' + bar(s.cpu_percent) + '<div class="ta-sub">' + esc(s.cpu_count || "?") + ' logical cores</div></div>' +
    '<div class="ta-card"><div class="ta-k">Memory</div><div class="ta-v">' + pct(s.memory_percent) + '</div>' + bar(s.memory_percent) + '<div class="ta-sub">' + mb(s.memory_used_mb) + ' / ' + mb(s.memory_total_mb) + '</div></div>' +
    '<div class="ta-card"><div class="ta-k">Processes</div><div class="ta-v">' + esc(s.process_count || "?") + '</div><div class="ta-sub">swap ' + pct(s.swap_percent) + '</div></div>' +
    '</div>';
  html += '<div class="ta-cols">';
  html += '<div class="ta-colsec"><div class="ta-h">Top CPU</div>' + procTable(d.top_cpu || [], "cpu") + '</div>';
  html += '<div class="ta-colsec"><div class="ta-h">Top memory</div>' + procTable(d.top_memory || [], "memory") + '</div>';
  html += '</div>';
  if ((d.by_program || []).length) {
    html += '<div class="ta-colsec"><div class="ta-h">By program</div>' +
      (d.by_program || []).map(function (g) {
        return '<div class="ta-prow"><span class="ta-nm">' + esc(g.name) + (g.count>1?' ×'+g.count:'') +
               '</span><span class="ta-c">' + pct(g.cpu_percent) + '</span><span class="ta-m">' + mb(g.memory_mb) + '</span></div>';
      }).join('') + '</div>';
  }
  out.innerHTML = html;
}

function procTable(rows, by) {
  if (!rows.length) return '<div class="empty">none</div>';
  return rows.map(function (p) {
    var metric = by === "cpu" ? pct(p.cpu_percent) : mb(p.memory_mb);
    return '<div class="ta-prow" data-pid="' + esc(p.pid) + '">' +
      '<span class="ta-pid">' + esc(p.pid) + '</span>' +
      '<span class="ta-nm">' + esc(p.name || "?") + '</span>' +
      '<span class="ta-metric">' + metric + '</span>' +
      '<button class="ta-kill" data-pid="' + esc(p.pid) + '" data-name="' + esc(p.name||"") + '" title="Kill">✕</button>' +
      '</div>';
  }).join('');
}

function renderProcesses(out, d, by) {
  if (!d || !d.ok) { out.innerHTML = '<div class="empty">' + esc((d && d._error) || "error") + '</div>'; return; }
  var rows = d.processes || [];
  var html = '<div class="ta-h">' + rows.length + ' processes · sorted by ' + esc(by) + '</div>' +
    '<div class="ta-list">' + procTable(rows, by) + '</div>';
  out.innerHTML = html;
}

function renderTree(out, d) {
  if (!d || !d.ok) { out.innerHTML = '<div class="empty">' + esc((d && d._error) || "error") + '</div>'; return; }
  function node(n, depth) {
    var pad = 'style="padding-left:' + (depth * 16) + 'px"';
    var line = '<div class="ta-prow" ' + pad + '><span class="ta-pid">' + esc(n.pid) + '</span>' +
      '<span class="ta-nm">' + esc(n.name || "?") + '</span><span class="ta-m">' + mb(n.memory_mb) + '</span></div>';
    (n.children || []).forEach(function (c) { line += node(c, depth + 1); });
    return line;
  }
  out.innerHTML = '<div class="ta-list">' + (d.roots || []).map(function (r) { return node(r, 0); }).join('') + '</div>';
}

async function killPid(pid, name, app, root) {
  var ok = await confirmDialog("Kill process",
    "<div>Terminate <b>" + esc(name || "?") + "</b> (pid " + esc(pid) + ")?</div>" +
    "<div style=\"margin-top:6px;color:var(--text-muted);font-size:12px\">Graceful terminate, then force if needed. Critical OS processes are refused.</div>");
  if (!ok) return;
  var r = await api("kill", { pid: pid });
  if (!r.ok && r.protected) {
    var ok2 = await confirmDialog("Protected process",
      "<div><b>" + esc(name) + "</b> is a protected OS/session process. Force kill anyway?</div>" +
      "<div style=\"margin-top:6px;color:var(--color-warning)\">This can crash the desktop session.</div>");
    if (!ok2) return;
    r = await api("kill", { pid: pid, force_protected: "true" });
  }
  app.setStatus(r.ok ? ("Killed " + (r.name||pid) + " (" + (r.method||"") + ")") : ("Kill failed: " + (r._error||"error")));
  refresh(app, root);
}

async function refresh(app, root) {
  var out = root.querySelector("#out");
  app.setStatus("Loading " + STATE.view + "…");
  try {
    if (STATE.view === "analyze") { renderAnalyze(out, await api("analyze", { top_n: 8 })); }
    else if (STATE.view === "cpu") { renderProcesses(out, await api("top", { by: "cpu", limit: 40 }), "cpu"); }
    else if (STATE.view === "memory") { renderProcesses(out, await api("top", { by: "memory", limit: 40 }), "memory"); }
    else if (STATE.view === "tree") { renderTree(out, await api("tree", {})); }
  } catch (e) { out.innerHTML = '<div class="empty">' + esc(String(e)) + '</div>'; }
  finally { app.setStatus("Ready"); }
}

function mountContent(el) {
  el.classList.add("ta-content");
  el.innerHTML =
    '<div class="ta-tabs" id="tabs">' +
      [['analyze','analyze'],['cpu','top cpu'],['memory','top memory'],['tree','tree']].map(function (v) {
        return '<button data-v="' + v[0] + '"' + (v[0] === STATE.view ? ' class="active"' : '') + '>' + v[1] + '</button>';
      }).join('') +
      '<label class="ta-auto"><input type="checkbox" id="ta-auto"> auto-refresh</label>' +
      '<button id="ta-refresh">↻</button>' +
    '</div>' +
    '<div class="ta-out" id="out"><div class="empty">Loading…</div></div>';
  return el;
}

window.AppUIReady.then(function () {
  var root = null;
  var app = AppUI.createApp({
    id: "system-task-analyzer",
    title: "Task Analyzer",
    content: { render: function (el) { root = mountContent(el); } },
    statusbar: {},
  });
  var poller = AppUIPollRefresh.create(function () { return refresh(app, root); }, 3000, {
    stopWhen: function () { return !root || !root.isConnected; }
  });
  function setAuto(on) { if (on) poller.start(); else poller.stop(); }
  function wire() {
    if (!root) { setTimeout(wire, 20); return; }
    root.querySelector("#ta-refresh").addEventListener("click", function () { refresh(app, root); });
    root.querySelector("#ta-auto").addEventListener("change", function (e) { setAuto(e.target.checked); });
    root.querySelector("#tabs").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-v]"); if (!b) return;
      STATE.view = b.getAttribute("data-v");
      root.querySelectorAll("#tabs button").forEach(function (x) { x.classList.toggle("active", x === b); });
      refresh(app, root);
    });
    // Kill buttons (event-delegated from the output area).
    root.querySelector("#out").addEventListener("click", function (e) {
      var k = e.target.closest(".ta-kill"); if (!k) return;
      e.stopPropagation();
      killPid(Number(k.getAttribute("data-pid")), k.getAttribute("data-name"), app, root);
    });
    app.setStatus("Live process inspection via system/task_analyzer.");
    refresh(app, root);
  }
  wire();
}).catch(function (e) {
  document.getElementById("app-content-body").innerHTML =
    '<div style="padding:18px">AppUI failed to load: ' + esc(e) + '</div>';
});
