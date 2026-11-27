// platform/tool_runner - Try-It tool browser, workflows, runs, metrics/profiler, triggers, offline queue.
// Served at /apps/platform/tool_runner/.  ?view=<tools|flows|runs|metrics|triggers|queue>  ?run=<id>  ?tool=<id>
(function () {
  "use strict";
  var API = "/v1/apps/platform/tool_runner/";
  var CAT = "/v1/apps/platform/tool_catalog/";
  var panel = null, nav = null, view = "tools", timer = null, status = null;

  function post(base, op, args) {
    return fetch(base + op, {method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify(args || {})}).then(function (r) { return r.json(); });
  }
  function api(op, args) { return post(API, op, args); }
  function el(tag, text, attrs) {
    var e = document.createElement(tag);
    if (text != null) e.textContent = text;
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    return e;
  }
  function btn(label, fn, title) {
    var b = el("button", label, {type: "button"});
    if (title) b.title = title;
    b.addEventListener("click", fn);
    return b;
  }
  function tell(msg, bad) {
    if (status) status.textContent = msg || "";
    if (msg && window.AppUIToast) (bad ? AppUIToast.error : AppUIToast.info)(msg);
  }
  function ts(t) { return t ? new Date(t * 1000).toLocaleString() : ""; }
  function ms(v) { return v == null ? "" : (v >= 1000 ? (v / 1000).toFixed(1) + " s" : Math.round(v) + " ms"); }
  function confirmThen(text, fn) {
    if (window.AppUIDialog) AppUIDialog.confirm(text, fn); else if (window.confirm(text)) fn();
  }
  function table(host, columns, items, opts) {
    var box = el("div", null, {"class": "tr-table"});
    host.appendChild(box);
    var o = Object.assign({container: box, columns: columns, items: items, empty: "Nothing here yet.",
                           stickyHeader: true, maxRows: 500}, opts || {});
    return AppUIDataTable.create(o);
  }
  function refreshLater(fn, every) {
    clearTimeout(timer);
    timer = setTimeout(fn, every || 3000);
  }

  // ── Workflows ───────────────────────────────────────────────────────────────
  function viewFlows(host) {
    host.appendChild(el("h2", "Workflows"));
    var bar = el("div");
    var area = el("div");
    host.appendChild(bar);
    host.appendChild(area);

    function runFlow(name) {
      api("run", {workflow: name, confirm: false}).then(function (p) {
        if (p.ok === false) { tell(p._error, true); return; }
        var warn = (p.issues || []).filter(function (i) { return i.level === "error"; }).length;
        confirmThen("Run workflow " + name + " (" + p.steps + " steps)?" + (warn ? " It has validation errors." : ""), function () {
          api("run", {workflow: name, confirm: true}).then(function (r) {
            if (r.ok === false) { tell(r._error, true); return; }
            tell("started run " + r.run_id);
            go("runs", {run: r.run_id});
          });
        });
      });
    }
    function list() {
      area.replaceChildren();
      api("flows", {}).then(function (r) {
        table(area, [
          {id: "name", label: "Name", sortable: true, filterable: true},
          {id: "folder", label: "Folder", sortable: true},
          {id: "steps", label: "Steps", sortable: true},
          {id: "triggers", label: "Triggers", render: function (w) { return (w.triggers || []).map(function (t) { return t.type + (t.cron ? " " + t.cron : "") + (t.channel ? " " + t.channel : ""); }).join("; "); }},
          {id: "enabled", label: "On", render: function (w) { return w.enabled ? "yes" : "no" + (w.disabled_reason ? " (" + w.disabled_reason + ")" : ""); }},
          {id: "act", label: "", actions: function (w) {
            return [{label: "Run", action: function () { runFlow(w.name); }},
                    {label: "Edit", action: function () { go("editor", {flow: w.name}); }},
                    {label: w.enabled ? "Disable" : "Enable", action: function () {
                      api("flow_enable", {workflow: w.name, enabled: !w.enabled, confirm: true}).then(list); }},
                    {label: "Delete", action: function () {
                      confirmThen("Delete workflow " + w.name + "?", function () {
                        api("flow_delete", {workflow: w.name, confirm: true}).then(list); }); }}];
          }}], r.flows || [], {getId: function (w) { return w.name; }});
      });
    }
    bar.appendChild(btn("New workflow", function () { go("editor", {}); }));
    bar.appendChild(btn("Refresh", list));
    list();
  }

  // ── Runs ────────────────────────────────────────────────────────────────────
  function stepTree(host, steps, run, depth) {
    var ul = el("ul");
    (steps || []).forEach(function (s) {
      var li = el("li");
      var head = el("span", s.path + "  " + (s.label || s.kind) + "  - " + s.status +
                    (s.duration_ms != null ? "  " + ms(s.duration_ms) : "") + (s.reused ? "  (reused)" : "") +
                    (s.attempts > 1 ? "  x" + s.attempts : ""));
      li.appendChild(head);
      if (s.error) li.appendChild(el("div", "error: " + s.error, {"class": "tr-error"}));
      if (s.unresolved && s.unresolved.length) li.appendChild(el("div", "unresolved: " + s.unresolved.join(", ")));
      if (depth === 0 && run && !run.live && /^\d+$/.test(s.path)) {
        li.appendChild(document.createTextNode(" "));
        li.appendChild(btn("retry from here", function () {
          confirmThen("Re-run " + run.workflow + " from step " + s.path + "?", function () {
            api("run_retry", {run_id: run.id, from_step: Number(s.path), confirm: true}).then(function (r) {
              if (r.ok === false) tell(r._error, true); else go("runs", {run: r.run_id});
            });
          });
        }));
      }
      if (s.result !== undefined) {
        var d = el("details"); d.appendChild(el("summary", "result"));
        d.appendChild(el("pre", JSON.stringify(s.result, null, 2).slice(0, 4000)));
        li.appendChild(d);
      }
      if (s.children && s.children.length) stepTree(li, s.children, run, depth + 1);
      ul.appendChild(li);
    });
    host.appendChild(ul);
  }

  function viewRuns(host, params) {
    host.appendChild(el("h2", "Runs"));
    var area = el("div"), detail = el("div");
    host.appendChild(area);
    host.appendChild(detail);
    var open = params && params.run;

    function showRun(id) {
      open = id;
      api("run_get", {run_id: id}).then(function (r) {
        detail.replaceChildren();
        if (!r.ok) { detail.appendChild(el("p", r._error)); return; }
        var run = r.run; run.live = r.live;
        detail.appendChild(el("h3", run.workflow + "  " + run.id + "  - " + run.status));
        if (run.error) detail.appendChild(el("p", run.error, {"class": "tr-error"}));
        if (run.pending) {
          detail.appendChild(el("p", "waiting: " + run.pending.message));
          detail.appendChild(btn("Approve / continue", function () {
            if (run.pending.kind === "debug") api("run_advance", {run_id: run.id, mode: "step", confirm: true}).then(function () { showRun(id); });
            else api("run_respond", {run_id: run.id, action: "approve", confirm: true}).then(function () { showRun(id); });
          }));
          if (run.pending.kind !== "debug") detail.appendChild(btn("Reject", function () {
            api("run_respond", {run_id: run.id, action: "reject", confirm: true}).then(function () { showRun(id); }); }));
        }
        if (r.live) detail.appendChild(btn("Cancel run", function () {
          api("run_cancel", {run_id: run.id, confirm: true}).then(function () { showRun(id); }); }));
        else detail.appendChild(btn("Re-run", function () {
          api("run_retry", {run_id: run.id, confirm: true}).then(function (x) { if (x.ok) go("runs", {run: x.run_id}); }); }));
        stepTree(detail, run.steps, run, 0);
        if (r.live || run.status === "running" || run.status === "paused") refreshLater(function () { if (open === id) showRun(id); }, 1500);
      });
    }
    function list() {
      api("runs", {limit: 100}).then(function (r) {
        area.replaceChildren();
        var rows = (r.active || []).map(function (a) { return Object.assign({duration_ms: null}, a); })
          .concat((r.runs || []).filter(function (x) { return !(r.active || []).some(function (a) { return a.id === x.id; }); }));
        table(area, [
          {id: "id", label: "Run", filterable: true},
          {id: "workflow", label: "Workflow", sortable: true, filterable: true},
          {id: "status", label: "Status", sortable: true, filterable: true},
          {id: "source", label: "Source", sortable: true, filterable: true},
          {id: "started", label: "Started", sortable: true, render: function (x) { return ts(x.started); }},
          {id: "duration_ms", label: "Took", render: function (x) { return ms(x.duration_ms); }},
          {id: "error", label: "Error"}], rows,
          {getId: function (x) { return x.id; }, onRowClick: function (x) { showRun(x.id); }});
        if ((r.active || []).length) refreshLater(list, 3000);
      });
    }
    area.appendChild(btn("Refresh", list));
    list();
    if (open) showRun(open);
  }

  // ── Triggers + offline queue ────────────────────────────────────────────────
  function viewTriggers(host) {
    host.appendChild(el("h2", "Triggers"));
    var area = el("div");
    host.appendChild(area);
    function load() {
      api("triggers", {}).then(function (r) {
        area.replaceChildren();
        var s = r.scheduler || {};
        area.appendChild(el("p", "Scheduler " + (s.running ? "running" : "stopped") + ", " + (s.ticks || 0) + " ticks" +
                            (s.channels && s.channels.length ? ", watching " + s.channels.join(", ") : "") +
                            (s.last_error ? "  last error: " + s.last_error : "")));
        area.appendChild(btn(s.running ? "Stop scheduler" : "Start scheduler", function () {
          api("scheduler", {action: s.running ? "stop" : "start", confirm: true}).then(load); }));
        table(area, [
          {id: "workflow", label: "Workflow", sortable: true, filterable: true},
          {id: "type", label: "Type", sortable: true},
          {id: "cron", label: "When", render: function (t) { return t.human || t.channel || ""; }},
          {id: "next", label: "Next fires", render: function (t) { return (t.next || []).join(", "); }},
          {id: "last_fire", label: "Last fired"},
          {id: "enabled", label: "On", render: function (t) { return t.enabled ? "yes" : "no"; }}], r.triggers || []);
      });
    }
    load();
  }

  function viewQueue(host) {
    host.appendChild(el("h2", "Offline queue"));
    host.appendChild(el("p", "Tool calls parked because their app was unreachable (flows with queue_offline)."));
    var area = el("div");
    host.appendChild(area);
    function load() {
      api("queue", {}).then(function (r) {
        area.replaceChildren();
        area.appendChild(btn("Retry all", function () {
          api("queue_retry", {confirm: true}).then(function (x) { tell(x.succeeded + " succeeded, " + x.failed + " failed"); load(); }); }));
        area.appendChild(btn("Discard all", function () {
          confirmThen("Discard every queued call?", function () { api("queue_discard", {all: true, confirm: true}).then(load); }); }));
        table(area, [
          {id: "tool", label: "Tool", filterable: true},
          {id: "workflow", label: "Workflow"},
          {id: "queued_at", label: "Queued", render: function (e) { return ts(e.queued_at); }},
          {id: "attempts", label: "Tries"},
          {id: "last_error", label: "Last error", render: function (e) { return e.last_error || e.error || ""; }},
          {id: "act", label: "", actions: function (e) {
            return [{label: "Retry", action: function () { api("queue_retry", {id: e.id, confirm: true}).then(load); }},
                    {label: "Discard", action: function () { api("queue_discard", {id: e.id, confirm: true}).then(load); }}];
          }}], r.queue || [], {getId: function (e) { return e.id; }});
      });
    }
    load();
  }

  // ── Visual editor (editor/*.js) ─────────────────────────────────────────────
  var editorInst = null;
  function viewEditor(host, params) {
    if (!window.WFEditor) { host.appendChild(el("p", "The editor scripts did not load.")); return; }
    editorInst = window.WFEditor.mount(host, {params: params || {}, api: {
      tr: function (op, args) { return api(op, args); },
      catalog: function (op, args) { return post(CAT, op, args); }}});
  }

  // ── Dashboard ───────────────────────────────────────────────────────────────
  function card(host, title, cls) {
    var c = el("div", null, {"class": "tr-card " + (cls || "")});
    c.appendChild(el("h3", title));
    host.appendChild(c);
    return c;
  }
  function viewDashboard(host) {
    host.appendChild(el("h2", "Workflow dashboard"));
    var head = el("p"), grid = el("div", null, {"class": "tr-cards"});
    host.appendChild(head);
    host.appendChild(grid);
    api("dashboard", {}).then(function (r) {
      head.textContent = r.total + " workflows · " + r.enabled + " enabled" +
        Object.keys(r.by_trigger_type || {}).map(function (k) { return " · " + r.by_trigger_type[k] + " " + k; }).join("");
      var a = card(grid, "Alerts", r.healthy ? "tr-ok" : "tr-warn");
      if (r.healthy) a.appendChild(el("p", "All systems healthy."));
      (r.alerts || []).forEach(function (x) {
        var d = el("div", x.kind + ": " + x.workflow + " - " + String(x.detail || "").slice(0, 120));
        d.className = "tr-link";
        d.addEventListener("click", function () { x.run_id ? go("runs", {run: x.run_id}) : go("editor", {flow: x.workflow}); });
        a.appendChild(d);
      });
      var s = card(grid, "Scheduled");
      (r.scheduled || []).forEach(function (x) {
        var d = el("div", x.workflow + " - " + x.human + (x.next ? " (next " + x.next + ")" : ""));
        d.className = "tr-link"; d.addEventListener("click", function () { go("editor", {flow: x.workflow}); });
        s.appendChild(d);
      });
      if (!(r.scheduled || []).length) s.appendChild(el("p", "No enabled schedules."));
      var t = card(grid, "Reusable (ask for inputs)");
      (r.reusable || []).forEach(function (n) {
        var d = el("div", n); d.className = "tr-link"; d.addEventListener("click", function () { go("editor", {flow: n}); }); t.appendChild(d);
      });
      if (!(r.reusable || []).length) t.appendChild(el("p", "None yet."));
      var rr = card(grid, "Recent runs");
      (r.recent || []).forEach(function (x) {
        var d = el("div", (x.status === "done" ? "✓ " : "✗ ") + x.workflow + " · " + ts(x.started) + " · " + ms(x.duration_ms));
        d.className = "tr-link"; d.addEventListener("click", function () { go("runs", {run: x.id}); }); rr.appendChild(d);
      });
      if (!(r.recent || []).length) rr.appendChild(el("p", "No runs yet."));
    });
    var bar = el("p");
    bar.appendChild(btn("New workflow", function () { go("editor", {}); }));
    bar.appendChild(btn("Refresh", function () { go("dashboard"); }));
    host.appendChild(bar);
  }

  // ── Schedule planner ────────────────────────────────────────────────────────
  function viewSchedule(host, params) {
    host.appendChild(el("h2", "Schedule planner"));
    var days = Number((params && params.days) || 1), date = (params && params.date) || "";
    var bar = el("p"), area = el("div");
    host.appendChild(bar);
    host.appendChild(area);
    function shift(n) {
      var d = date ? new Date(date + "T00:00:00") : new Date();
      d.setDate(d.getDate() + n * days);
      date = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
      load();
    }
    bar.appendChild(btn("Day", function () { days = 1; load(); }));
    bar.appendChild(btn("Week", function () { days = 7; load(); }));
    bar.appendChild(btn("◀", function () { shift(-1); }));
    bar.appendChild(btn("Today", function () { date = ""; load(); }));
    bar.appendChild(btn("▶", function () { shift(1); }));
    function load() {
      area.replaceChildren(el("p", "loading."));
      api("schedule_plan", {days: days, date: date || undefined}).then(function (r) {
        area.replaceChildren();
        area.appendChild(el("p", r.start + (r.days > 1 ? " + " + r.days + " days" : "") + " · " + (r.lanes || []).length + " scheduled trigger(s)"));
        if (!(r.lanes || []).length) area.appendChild(el("p", "No enabled workflow has a schedule trigger in this window."));
        (r.lanes || []).forEach(function (lane) {
          var row = el("div", null, {"class": "tr-lane"});
          var lab = el("div", lane.workflow + " - " + lane.human + " (" + lane.count + ")", {"class": "tr-lane-label"});
          lab.title = lane.cron;
          lab.addEventListener("click", function () { go("editor", {flow: lane.workflow}); });
          row.appendChild(lab);
          var track = el("div", null, {"class": "tr-track"});
          if (r.days === 1) {
            for (var h = 0; h < 24; h += 3) track.appendChild(el("span", String(h), {"class": "tr-hour", style: "left:" + (h / 24 * 100) + "%"}));
            lane.fires.forEach(function (f) {
              var m = Number(f.slice(11, 13)) * 60 + Number(f.slice(14, 16));
              var tick = el("i", null, {"class": "tr-tick", style: "left:" + (m / 1440 * 100) + "%", title: f});
              track.appendChild(tick);
            });
          } else {
            var per = {};
            lane.fires.forEach(function (f) { per[f.slice(0, 10)] = (per[f.slice(0, 10)] || 0) + 1; });
            for (var i = 0; i < r.days; i++) {
              var d = new Date(r.start + "T00:00:00"); d.setDate(d.getDate() + i);
              var key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
              var cell = el("span", per[key] ? String(per[key]) : "", {"class": "tr-day" + (per[key] ? " on" : ""), title: key + " (" + (per[key] || 0) + " runs)"});
              track.appendChild(cell);
            }
          }
          row.appendChild(track);
          area.appendChild(row);
        });
        if (r.days === 1) {
          area.appendChild(el("h3", "By hour"));
          var any = false;
          (r.by_hour || []).forEach(function (hh) {
            if (!hh.workflows.length) return;
            any = true;
            area.appendChild(el("div", String(hh.hour).padStart(2, "0") + ":00  " + hh.workflows.join(", ")));
          });
          if (!any) area.appendChild(el("p", "Nothing is scheduled today."));
        }
      });
    }
    load();
  }

  // ── Events: which channels workflow triggers listen to ──────────────────────
  function viewEvents(host) {
    host.appendChild(el("h2", "Events"));
    host.appendChild(el("p", "EventBus channels a workflow can trigger on. Declared = the publishing app lists it in its manifest `events`; seeds are well-known channels no app declares yet. Switching a channel OFF stops every workflow trigger on it (nothing else changes)."));
    var area = el("div");
    host.appendChild(area);
    function load() {
      api("events_available", {}).then(function (r) {
        area.replaceChildren();
        table(area, [
          {id: "subscribed", label: "On", checkbox: function (e) { return {checked: !!e.subscribed, ariaLabel: "listen to " + e.channel, onChange: function (row, checked) {
            api("events_subscribe", {channel: row.channel, subscribed: checked, confirm: true}).then(function (x) { tell(x.ok === false ? x._error : row.channel + (checked ? " on" : " muted"), x.ok === false); load(); }); }}; }},
          {id: "channel", label: "Channel", sortable: true, filterable: true},
          {id: "event", label: "Event", sortable: true, filterable: true},
          {id: "declared", label: "Source", render: function (e) { return e.declared ? "declared by " + e.app_id : "seed / live"; }},
          {id: "fields", label: "Payload fields", render: function (e) { return (e.fields || []).join(", "); }},
          {id: "workflows", label: "Workflows", sortable: true},
          {id: "description", label: "What"}], r.events || [], {getId: function (e) { return e.channel + ":" + e.event; }});
      });
    }
    load();
  }

  // ── Dependencies ────────────────────────────────────────────────────────────
  function viewDeps(host) {
    host.appendChild(el("h2", "Dependencies"));
    var area = el("div");
    host.appendChild(area);
    api("dependencies", {}).then(function (r) {
      area.appendChild(el("h3", "Tools → workflows that use them"));
      var byNs = {};
      Object.keys(r.tools || {}).forEach(function (t) { var ns = t.slice(0, t.lastIndexOf(".")); (byNs[ns] = byNs[ns] || []).push(t); });
      Object.keys(byNs).sort().forEach(function (ns) {
        var d = el("details", null, {open: "open"});
        d.appendChild(el("summary", ns + "  (" + byNs[ns].length + " tool" + (byNs[ns].length > 1 ? "s" : "") + ")"));
        byNs[ns].forEach(function (t) {
          var line = el("div", null, {"class": "tr-dep"});
          line.appendChild(el("code", t.slice(ns.length + 1)));
          r.tools[t].forEach(function (w) {
            var a = el("a", w, {href: "#", "class": "tr-chipl"});
            a.addEventListener("click", function (e) { e.preventDefault(); go("editor", {flow: w}); });
            line.appendChild(a);
          });
          d.appendChild(line);
        });
        area.appendChild(d);
      });
      if (!Object.keys(byNs).length) area.appendChild(el("p", "No workflow uses a tool yet."));
      area.appendChild(el("h3", "Workflows → what they use"));
      Object.keys(r.workflows || {}).sort().forEach(function (w) {
        var u = r.workflows[w], line = el("div", null, {"class": "tr-dep"});
        var a = el("a", w, {href: "#"});
        a.addEventListener("click", function (e) { e.preventDefault(); go("editor", {flow: w}); });
        line.appendChild(a);
        line.appendChild(el("small", "  tools: " + (u.tools.join(", ") || "-") + (u.workflows.length ? " · sub-workflows: " + u.workflows.join(", ") : "") + (u.agents.length ? " · agents: " + u.agents.join(", ") : "")));
        area.appendChild(line);
      });
    });
  }
  // ── AI assistant (chat_profile platform/tool_runner.assistant) ───────────────
  function registerHooks() {
    if (!window.AppUIHostHooks || !window.AppUIHostHooks.register) return;
    window.AppUIHostHooks.register("tool_runner.assistant", {
      context: function () {
        var parts = ["Current view: " + view];
        if (view === "editor" && editorInst) {
          var wf = editorInst.getWf(), sel = editorInst.getSelection(), run = editorInst.getRun();
          parts.push("Editing workflow: " + (wf.name || "(unnamed)") + (editorInst.isDirty() ? " (UNSAVED changes)" : ""));
          if (sel) parts.push("Selected: " + (sel.type === "trigger" ? "trigger " + sel.index : "step " + sel.path.join("/")));
          if (run) parts.push("Last run: " + run.status + (run.dry ? " (dry run)" : "") + (run.error ? " - " + run.error : ""));
          var json = JSON.stringify(wf);
          parts.push("Workflow JSON" + (json.length > 6000 ? " (truncated)" : "") + ":\n" + json.slice(0, 6000));
        }
        return parts.join("\n");
      },
      onAction: function (type, payload) {
        payload = payload || {};
        var withEditor = function (fn) {
          if (view === "editor" && editorInst) fn(editorInst);
          else { go("editor", {}); setTimeout(function () { if (editorInst) fn(editorInst); }, 400); }
        };
        if (type === "workflow.set" && payload.definition) { withEditor(function (ed) { ed.setDefinition(payload.definition); tell("assistant replaced the editor content - undo with Ctrl+Z, nothing was saved"); }); return true; }
        if (type === "workflow.add_step" && payload.step) { withEditor(function (ed) { ed.appendStep(payload.step); }); return true; }
        if (type === "workflow.open" && payload.name) { go("editor", {flow: payload.name}); return true; }
        if (type === "view.show" && VIEWS[payload.view]) { go(payload.view, payload); return true; }
        return false;
      }
    });
  }
  function mountAssistant() {
    registerHooks();
    if (!window.AppUIAssets) return;
    window.AppUIAssets.load("feedback", "aiSidebar").then(function () {
      if (window.AppUIPanelApp && window.AppUIPanelApp.mountDeclaredSidebars) return window.AppUIPanelApp.mountDeclaredSidebars({appId: "platform/tool_runner"});
    }).catch(function () { /* the page works without the assistant */ });
  }
  var VIEWS = {dashboard: ["Dashboard", viewDashboard], schedule: ["Schedule", viewSchedule], events: ["Events", viewEvents], deps: ["Dependencies", viewDeps], editor: ["Editor", viewEditor], flows: ["Workflows", viewFlows], runs: ["Runs", viewRuns],
                triggers: ["Triggers", viewTriggers], queue: ["Queue", viewQueue]};

  function go(name, params) {
    clearTimeout(timer);
    if (editorInst) { editorInst.destroy(); editorInst = null; }
    view = name;
    if (nav) nav.querySelectorAll("button").forEach(function (b) { b.classList.toggle("on", b.dataset.view === name); });
    panel.replaceChildren();
    VIEWS[name][1](panel, params || {});
  }

  window.AppUIReady.then(function () { return AppUIAssets.load("dataTable", "jsonEditor"); }).then(function () {
    AppUI.createApp({
      id: "platform-tool_runner", title: "Tool Runner",
      content: {render: function (host) {
        nav = el("div", null, {"class": "tr-nav"});
        status = el("p", "", {role: "status"});
        panel = el("section");
        host.appendChild(nav);
        host.appendChild(status);
        host.appendChild(panel);
        Object.keys(VIEWS).forEach(function (k) {
          var b = el("button", VIEWS[k][0], {type: "button"});
          b.dataset.view = k;
          b.addEventListener("click", function () { if (k !== view || k === "editor") go(k); });
          nav.appendChild(b);
        });
        [["Tool Catalog ↗", "/apps/platform/tool_catalog/"], ["Profiler ↗", "/apps/platform/tool_profiler/"]].forEach(function (l) {
          var a = el("a", l[0], {href: l[1], "class": "tr-navlink"});
          nav.appendChild(a);
        });
        var qs = new URLSearchParams(location.search);
        var v = qs.get("view") || (qs.get("flow") ? "editor" : qs.get("run") ? "runs" : "dashboard");
        go(VIEWS[v] ? v : "dashboard", {run: qs.get("run"), flow: qs.get("flow")});
        mountAssistant();
      }},
    });
  });
})();
