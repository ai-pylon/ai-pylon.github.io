// platform/ops — this host's operations: metrics, the dependency-ordered task plan with each
// task's last result (run one / all, reset), backups, the security audit and recent results.
// Served at /apps/platform/ops/.
(function () {
  "use strict";
  var API = "/v1/apps/platform/ops/";
  var main = null, status = null, timer = null, last = null, expect = false, expectUntil = 0;

  function api(op, args) {
    return fetch(API + op, {method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify(args || {})}).then(function (r) { return r.json(); });
  }
  function node(tag, text, attrs) {
    var e = document.createElement(tag);
    if (text != null) e.textContent = text;
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    return e;
  }
  function btn(label, onClick, primary, title) {
    var b = node("button", label, {type: "button", "class": "btn" + (primary ? " primary" : ""), title: title || ""});
    b.onclick = onClick;
    return b;
  }
  function tell(msg, bad) {
    status.textContent = msg || "";
    status.className = "op-status" + (bad ? " bad" : "");
  }
  function gb(n) { return (n / 1073741824).toFixed(1) + " GB"; }
  function when(iso) {
    if (!iso) return "";
    var d = new Date(iso), s = (Date.now() - d.getTime()) / 1000;
    if (s < 90) return "just now";
    if (s < 5400) return Math.round(s / 60) + " min ago";
    if (s < 129600) return Math.round(s / 3600) + " h ago";
    return d.toLocaleDateString();
  }
  function css() {
    var st = node("style");
    st.textContent = [
      ".op-main{padding:16px 20px;max-width:1150px}",
      ".op-main h2{margin:22px 0 8px;font-size:15px;text-transform:uppercase;letter-spacing:.05em;opacity:.75}",
      ".op-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px}",
      ".op-card{border:1px solid var(--appui-border,rgba(127,127,127,.25));border-radius:10px;padding:10px 12px}",
      ".op-card .k{font-size:11px;text-transform:uppercase;letter-spacing:.05em;opacity:.65}",
      ".op-card .v{font-size:20px;font-weight:600;margin:2px 0}.op-card .s{font-size:12px;opacity:.75;word-break:break-word}",
      ".op-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:6px 0 10px}",
      ".op-table{width:100%;border-collapse:collapse;font-size:13px}",
      ".op-table th{text-align:left;font-weight:600;opacity:.7;padding:6px 8px;border-bottom:1px solid var(--appui-border,rgba(127,127,127,.3))}",
      ".op-table td{padding:6px 8px;border-bottom:1px solid var(--appui-border,rgba(127,127,127,.15));vertical-align:top}",
      ".op-table td.d{opacity:.8;max-width:520px;word-break:break-word;font-size:12px}",
      ".op-chip{display:inline-block;padding:1px 8px;border-radius:9px;font-size:11.5px;border:1px solid currentColor;white-space:nowrap}",
      ".st-done{color:#2f9e44}.st-failed{color:#d0453a}.st-blocked{color:#b7791f}.st-skipped{color:#868e96}",
      ".st-running{color:#2a7de1}.st-pending{color:#868e96}",
      ".op-status{min-height:1.2em;font-size:12.5px;opacity:.85}.op-status.bad{color:#d0453a;opacity:1}",
      ".op-pre{max-height:320px;overflow:auto;font-size:12px;background:rgba(127,127,127,.08);padding:10px;border-radius:8px;white-space:pre-wrap}",
      ".op-note{font-size:12.5px;opacity:.75;margin:4px 0}",
    ].join("\n");
    document.head.appendChild(st);
  }

  function card(k, v, s) {
    var c = node("div", null, {"class": "op-card"});
    c.appendChild(node("div", k, {"class": "k"}));
    c.appendChild(node("div", v, {"class": "v"}));
    if (s) c.appendChild(node("div", s, {"class": "s"}));
    return c;
  }
  function chip(st) { return node("span", st, {"class": "op-chip st-" + st}); }

  function act(op, args, msg) {
    tell("working…");
    return api(op, Object.assign({confirm: true}, args || {})).then(function (r) {
      if (!r.ok) { tell(r.error || r._error || "failed", true); return r; }
      tell(msg ? msg(r) : "done");
      return refresh().then(function () { return r; });
    }).catch(function (e) { tell(e.message, true); });
  }
  function readOnly(op, msg) {
    tell("working…");
    return api(op, {}).then(function (r) {
      if (!r.ok) tell(r.error || r._error || "failed", true); else tell(msg(r));
    }).catch(function (e) { tell(e.message, true); });
  }

  function render(r) {
    var m = r.metrics || {}, tasks = r.tasks || [];
    var body = node("div");
    // ---- host -------------------------------------------------------------------
    body.appendChild(node("h2", "Host"));
    var cards = node("div", null, {"class": "op-cards"});
    var h = m.host || {};
    cards.appendChild(card("Host", h.name || "?", (h.os || "") + (h.systemd ? " · systemd services" : " · " + (h.note || ""))));
    var g = m.git || {};
    cards.appendChild(card("Git", g.commit || "–", (g.branch || "") + (g.dirty ? " · uncommitted changes" : " · clean")));
    if (m.disk) cards.appendChild(card("Disk free", gb(m.disk.free), "of " + gb(m.disk.total)));
    var b = m.backups || {};
    cards.appendChild(card("Backups", String(b.count || 0), b.latest ? "latest " + when(b.latest_at) : "none yet"));
    var counts = {};
    tasks.forEach(function (t) { counts[t.status] = (counts[t.status] || 0) + 1; });
    cards.appendChild(card("Tasks", (counts.done || 0) + "/" + tasks.length + " done",
      ["failed", "blocked", "skipped", "pending"].filter(function (k) { return counts[k]; })
        .map(function (k) { return counts[k] + " " + k; }).join(" · ") || "all passed"));
    body.appendChild(cards);
    var svc = m.services || {};
    if (Object.keys(svc).length) {
      var t = node("table", null, {"class": "op-table"});
      t.innerHTML = "<thead><tr><th>Service</th><th>State</th><th>Boot</th><th>Restarts</th><th>PID</th></tr></thead>";
      var tb = node("tbody");
      Object.keys(svc).forEach(function (n) {
        var v = svc[n], tr = node("tr");
        tr.appendChild(node("td", n + (v.required ? "" : " (optional)")));
        var td = node("td"); td.appendChild(chip(v.state === "active" ? "done" : (v.required ? "failed" : "skipped")));
        td.firstChild.textContent = v.state || "?"; tr.appendChild(td);
        [v.enabled, v.restarts, v.pid].forEach(function (x) { tr.appendChild(node("td", x || "")); });
        tb.appendChild(tr);
      });
      t.appendChild(tb); body.appendChild(t);
    }
    if(m.storage){
      var st=m.storage;
      body.appendChild(node("h2","Storage · "+st.level+" · "+st.used_percent+"%"));
      var meter=node("progress",null,{max:"100",value:String(st.used_percent),"aria-label":"Disk usage"});meter.style.width="100%";body.appendChild(meter);
      var grid=node("div",null,{"class":"op-cards"});
      (st.groups||[]).forEach(function(g){grid.appendChild(card(g.label,(g.bytes/1048576).toFixed(1)+" MiB",g.partial?"Partial scan":"Allocated bytes"));});
      body.appendChild(grid);
    }
    // ---- tasks ------------------------------------------------------------------
    body.appendChild(node("h2", "Tasks"));
    var bar = node("div", null, {"class": "op-bar"});
    var reviewBox=node("section",null,{"class":"op-card"});
    reviewBox.appendChild(node("h2","Continuous improvement"));
    reviewBox.appendChild(node("p","Hourly Work Runner review records observed issues in the owning app or framework TODO. No automatic task completion."));
    var reviewText=node("pre","");reviewBox.appendChild(reviewText);
    reviewBox.appendChild(btn("Review status",function(){api("improvements",{action:"status"}).then(function(r){reviewText.textContent=(r.results||[]).map(function(x){return x.status+" · "+x.app+" · "+x.key+" · "+x.todo_status+(x.todo_id?" #"+x.todo_id:"");}).join("\n")||"No observations yet";});}));
    reviewBox.appendChild(btn("Run improvement review",function(){if(confirm("Queue the improvement review in Work Runner?"))api("improvements",{action:"run",confirm:true}).then(function(r){reviewText.textContent=JSON.stringify(r,null,2);});}));
    reviewBox.appendChild(node("a","Open scoped TODOs",{href:"/apps/platform/tool_todo/"}));
    body.appendChild(reviewBox);
    var runAll = btn(r.running ? "Running…" : "▶ Run all", function () {
      if (!confirm("Run every task again (tests, backup, checks)?")) return;
      expect = true; act("run", {task: "all"}, function () { return "started: all tasks"; });
    }, true, "re-run every task in dependency order");
    runAll.disabled = !!r.running;
    bar.appendChild(runAll);
    bar.appendChild(btn("Reset results", function () {
      if (confirm("Forget every recorded result? (the plan stays)")) act("reset", {task: "all"}, function () { return "results reset"; });
    }));
    bar.appendChild(node("span", r.running ? "the executor is running — this view refreshes by itself" :
      (r.updated ? "last result " + when(r.updated) : ""), {"class": "op-note"}));
    body.appendChild(bar);
    var tt = node("table", null, {"class": "op-table"});
    tt.innerHTML = "<thead><tr><th>Task</th><th>Status</th><th>When</th><th>Result</th><th></th></tr></thead>";
    var tbody = node("tbody");
    tasks.forEach(function (x) {
      var tr = node("tr");
      var name = node("td"); name.appendChild(node("div", x.title));
      name.appendChild(node("div", x.id + (x.deps && x.deps.length ? " · after " + x.deps.join(", ") : ""), {"class": "op-note"}));
      tr.appendChild(name);
      var st = node("td"); st.appendChild(chip(x.status)); tr.appendChild(st);
      tr.appendChild(node("td", when(x.at)));
      tr.appendChild(node("td", x.detail || "", {"class": "d"}));
      var a = node("td");
      var rb = btn("Run", function () { expect = true; act("run", {task: x.id}, function () { return "started: " + x.id + " (with its dependencies)"; }); },
                   false, "run this task (and what it depends on)");
      rb.disabled = !!r.running; a.appendChild(rb); tr.appendChild(a);
      tbody.appendChild(tr);
    });
    tt.appendChild(tbody); body.appendChild(tt);
    body.appendChild(node("p", "Acceptance gates (gate-*) pass only with recorded evidence in .ops/acceptance/<name> from a real end-to-end test. " +
      "VM-only checks report skipped on other hosts.", {"class": "op-note"}));
    // ---- maintenance ----------------------------------------------------------------
    body.appendChild(node("h2", "Maintenance"));
    var mb = node("div", null, {"class": "op-bar"});
    mb.appendChild(btn("Back up now", function () {
      act("backup", {}, function (x) { return "backup " + x.archive.split(/[\\/]/).pop() + ": " + x.files.length + " database(s), verified"; });
    }, false, "archive the runtime databases (keeps 7)"));
    mb.appendChild(btn("Verify latest backup", function () {
      readOnly("verify_backup", function (x) { return "verified " + x.archive.split(/[\\/]/).pop() + " (" + x.databases + " databases)"; });
    }));
    mb.appendChild(btn("Security audit", function () {
      readOnly("security", function (x) { return "audit passed: " + x.tracked_files + " tracked files, " + x.checked_private_files + " private files checked"; });
    }));
    body.appendChild(mb);
    // ---- history -----------------------------------------------------------------
    var hist = node("details"); hist.appendChild(node("summary", "Recent results"));
    var pre = node("div"); hist.appendChild(pre);
    hist.addEventListener("toggle", function () {
      if (!hist.open) return;
      api("events", {limit: 40}).then(function (e) {
        pre.replaceChildren();
        var t2 = node("table", null, {"class": "op-table"});
        (e.events || []).forEach(function (ev) {
          var tr = node("tr");
          tr.appendChild(node("td", when(ev.at))); tr.appendChild(node("td", ev.task));
          var c = node("td"); c.appendChild(chip(ev.result)); tr.appendChild(c);
          tr.appendChild(node("td", ev.detail || "", {"class": "d"}));
          t2.appendChild(tr);
        });
        pre.appendChild((e.events || []).length ? t2 : node("p", "No results yet.", {"class": "op-note"}));
      });
    });
    body.appendChild(hist);
    var logd = node("details"); logd.appendChild(node("summary", "Executor log"));
    var lp = node("pre", "", {"class": "op-pre"}); logd.appendChild(lp);
    logd.addEventListener("toggle", function () {
      if (logd.open) api("run_log", {}).then(function (x) { lp.textContent = x.log || "(empty)"; lp.scrollTop = lp.scrollHeight; });
    });
    body.appendChild(logd);
    return body;
  }

  function refresh() {
    return api("status", {}).then(function (r) {
      if (!r.ok) { tell(r.error || r._error || "could not load", true); return; }
      var open = Array.prototype.map.call(main.querySelectorAll("details"), function (d) { return d.open; });
      var view = render(r);
      if (main.lastChild && main.lastChild !== status) main.removeChild(main.lastChild);
      main.appendChild(view);
      Array.prototype.forEach.call(view.querySelectorAll("details"), function (d, i) {
        if (open[i]) { d.open = true; d.dispatchEvent(new Event("toggle")); }
      });
      if (expect) { expectUntil = Date.now() + 15000; expect = false; }
      if (last && last.running && !r.running) { tell("run finished"); expectUntil = 0; }
      last = r;
      clearTimeout(timer);
      // keep polling while a run is on, and briefly after starting one (it may not hold its lock yet)
      if (r.running || Date.now() < expectUntil) timer = setTimeout(refresh, r.running ? 3000 : 1000);
    }).catch(function (e) { tell(e.message, true); });
  }

  css();
  window.AppUIReady.then(function () {
    AppUI.createApp({
      id: "platform-ops", title: "Operations",
      content: {render: function (host) {
        main = node("div", null, {"class": "op-main"});
        status = node("p", "", {role: "status", "class": "op-status"});
        main.appendChild(status);
        host.appendChild(main);
        refresh();
      }},
    });
  });
})();
