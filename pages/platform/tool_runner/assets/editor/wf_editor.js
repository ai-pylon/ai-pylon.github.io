// WFEditor - the full visual workflow editor: palette | canvas (or JSON / diff) | inspector + history + versions.
// Glue over WFModel (data + undo), WFCanvas (drawing + drag/drop), WFInspector (forms), WFPalette (sources),
// and the tool_runner ops (validate / flow_save / run / run_get / run_respond / run_advance / run_retry ...).
(function (root) {
  "use strict";
  var M = root.WFModel;

  function el(tag, cls, text, attrs) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    return e;
  }
  function ms(v) { return v == null ? "" : v >= 1000 ? (v / 1000).toFixed(1) + " s" : Math.round(v) + " ms"; }
  function when(t) { return t ? new Date(t * 1000).toLocaleString() : ""; }

  function mount(host, cfg) {
    var api = cfg.api;
    var wf = M.blank(), folder = "", origName = null, dirty = false, folders = [];
    var hist = new M.History(50), sel = null, mode = "visual", clip = null;
    var run = null, runInfo = {}, polling = null, viewingPast = false;
    var canvas, inspector, palette, jsonEd = null, rightTab = "details";

    host.replaceChildren();
    var rootEl = el("div", "wf-ed");
    var bar = el("div", "wf-toolbar");
    var left = el("div", "wf-left");
    var center = el("div", "wf-center");
    var right = el("div", "wf-right");
    var banner = el("div", "wf-banner");
    banner.style.display = "none";
    var rtabs = el("div", "wf-rtabs"), rbody = el("div", "wf-rbody");
    right.appendChild(rtabs);
    right.appendChild(rbody);
    var canvasHost = el("div", "wf-canvashost"), jsonHost = el("div", "wf-jsonhost"), diffHost = el("div", "wf-diffhost");
    center.appendChild(banner);
    center.appendChild(canvasHost);
    center.appendChild(jsonHost);
    center.appendChild(diffHost);
    var status = el("div", "wf-statusline");
    rootEl.appendChild(bar);
    rootEl.appendChild(left);
    rootEl.appendChild(center);
    rootEl.appendChild(right);
    rootEl.appendChild(status);
    host.appendChild(rootEl);

    // ── small UI helpers ─────────────────────────────────────────────────────
    function toast(msg, bad) {
      status.textContent = msg || "";
      status.classList.toggle("wf-bad", !!bad);
      if (msg && root.AppUIToast) (bad ? root.AppUIToast.error : root.AppUIToast.info)(msg);
    }
    var menuEl = null;
    function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }
    function menu(ev, items) {
      closeMenu();
      menuEl = el("div", "wf-menu");
      items.forEach(function (it) {
        if (!it) { menuEl.appendChild(el("hr")); return; }
        var b = el("button", null, it[0], {type: "button"});
        b.addEventListener("click", function () { closeMenu(); it[1](); });
        menuEl.appendChild(b);
      });
      menuEl.style.left = Math.min(ev.clientX, window.innerWidth - 220) + "px";
      menuEl.style.top = Math.min(ev.clientY, window.innerHeight - 40 * items.length - 20) + "px";
      document.body.appendChild(menuEl);
    }
    document.addEventListener("click", closeMenu);
    function modal(title, content, buttons) {
      var back = el("div", "wf-modal-back"), box = el("div", "wf-modal");
      box.appendChild(el("h3", null, title));
      box.appendChild(content);
      var bb = el("div", "wf-actions");
      var close = function () { back.remove(); };
      (buttons || [["Close", null]]).forEach(function (b) {
        var x = el("button", b[2] || "", b[0], {type: "button"});
        x.addEventListener("click", function () { if (!b[1] || b[1](close) !== false) close(); });
        bb.appendChild(x);
      });
      box.appendChild(bb);
      back.appendChild(box);
      document.body.appendChild(back);
      var first = box.querySelector("input,textarea,select");
      if (first) first.focus();
      return close;
    }
    function ask(title, label, value, then) {
      var inp = el("input", null, null, {type: "text"});
      inp.value = value || "";
      var c = el("div", "wf-field"); c.appendChild(el("label", null, label)); c.appendChild(inp);
      modal(title, c, [["OK", function () { if (!inp.value.trim()) return false; then(inp.value.trim()); }, "wf-primary"], ["Cancel", null]]);
      inp.addEventListener("keydown", function (e) { if (e.key === "Enter") { var ok = inp.closest(".wf-modal").querySelector(".wf-primary"); ok.click(); } });
    }
    function confirmBox(text, then) {
      var p = el("p", null, text);
      modal("Confirm", p, [["Yes", function () { then(); }, "wf-primary"], ["No", null]]);
    }
    function guardDiscard(then) {
      if (!dirty) { then(); return; }
      confirmBox("Discard unsaved changes to " + (wf.name || "this workflow") + "?", then);
    }

    // ── data flow ────────────────────────────────────────────────────────────
    function exists(s) { return !s || s.type === "trigger" ? (!s || !!wf.triggers[s.index]) : !!M.getStep(wf, s.path); }
    function marks() {
      var m = {};
      M.issues(wf).forEach(function (i) { if (i.path.length) m[M.pathKey(i.path)] = i; });
      canvas.setMarks(m);
    }
    function afterChange(o) {
      o = o || {};
      if (o.clearSelection || !exists(sel)) sel = null;
      canvas.render();
      canvas.select(sel);
      marks();
      if (jsonEd && mode === "json") jsonEd.setValue(wf);
      if (o.refresh !== false) inspector.render(sel);
      toolbarState();
      if (run && !viewingPast) canvas.setStatuses(statusMap(run));
    }
    function edit(fn, o) {
      hist.push(wf);
      fn(wf);
      dirty = true;
      afterChange(o);
    }
    function select(s) {
      sel = s;
      canvas.select(s);
      inspector.render(s);
      if (rightTab !== "details") showRight("details");
    }
    function setWf(next, o) {
      wf = next;
      wf.steps = wf.steps || [];
      wf.triggers = wf.triggers || [];
      sel = null;
      afterChange(o);
    }
    function undo() { var p = hist.undo(wf); if (p) { dirty = true; setWf(p); } }
    function redo() { var p = hist.redo(wf); if (p) { dirty = true; setWf(p); } }

    // ── open / new / save ────────────────────────────────────────────────────
    function load(def, name, fld) {
      wf = def; wf.steps = wf.steps || []; wf.triggers = wf.triggers || [];
      origName = name; folder = fld || ""; dirty = false; hist.clear(); sel = null;
      clearRun();
      afterChange();
      history.replaceState(null, "", location.pathname + "?view=editor" + (name ? "&flow=" + encodeURIComponent(name) : ""));
    }
    function open(name) {
      guardDiscard(function () {
        api.tr("flow", {workflow: name}).then(function (r) {
          if (!r.ok) { toast(r._error, true); return; }
          load(r.flow, name, r.folder);
          toast("opened " + name);
        });
      });
    }
    function newFlow(fld) {
      guardDiscard(function () {
        ask("New workflow", "Name", "workflow-" + Math.random().toString(36).slice(2, 8), function (name) {
          load(M.blank(name), null, fld || "");
          dirty = true;
          toolbarState();
          select({type: "trigger", index: 0});
        });
      });
    }
    function save(force) {
      var errs = M.issues(wf).filter(function (i) { return i.level === "error"; });
      if (errs.length && !force) {
        toast(errs.length + " problem(s): " + errs[0].message, true);
        showRight("details"); inspector.render(null);
        return;
      }
      api.tr("flow_save", {definition: wf, folder: folder, confirm: true, force: !!force}).then(function (r) {
        if (r.ok === false) {
          if (r.issues && !force) confirmBox("The server found " + r.issues.filter(function (i) { return i.level === "error"; }).length + " error(s): " + r._error + " Save anyway?", function () { save(true); });
          else toast(r._error, true);
          return;
        }
        origName = r.saved; dirty = false; toolbarState();
        toast("saved " + r.saved + (r.issues && r.issues.length ? " (" + r.issues.length + " warning(s))" : ""));
        palette.reload();
        history.replaceState(null, "", location.pathname + "?view=editor&flow=" + encodeURIComponent(r.saved));
      });
    }
    function validateServer() {
      api.tr("validate", {definition: wf}).then(function (r) {
        var box = el("div");
        if (!(r.issues || []).length) box.appendChild(el("p", null, "No problems found."));
        (r.issues || []).forEach(function (i) {
          var d = el("div", "wf-issue wf-issue-" + i.level, (i.path ? "step " + i.path + ": " : "") + i.message);
          box.appendChild(d);
        });
        modal(r.valid ? "Valid" : "Problems", box);
      });
    }
    function deleteFlow(name) {
      confirmBox("Delete workflow " + name + "? Earlier versions are kept on disk.", function () {
        api.tr("flow_delete", {workflow: name, confirm: true}).then(function (r) {
          if (r.ok === false) toast(r._error, true); else { toast("deleted " + name); if (origName === name) { load(M.blank(), null, ""); } palette.reload(); }
        });
      });
    }
    function duplicateFlow(name) {
      api.tr("flow", {workflow: name}).then(function (r) {
        if (!r.ok) { toast(r._error, true); return; }
        var c = M.clone(r.flow); c.name = name + "-copy"; c.enabled = false;
        api.tr("flow_save", {definition: c, folder: r.folder, confirm: true}).then(function (x) { toast(x.ok === false ? x._error : "created " + c.name, x.ok === false); palette.reload(); });
      });
    }
    function moveFlow(name, fld) {
      api.tr("flow", {workflow: name}).then(function (r) {
        if (!r.ok) { toast(r._error, true); return; }
        api.tr("flow_save", {definition: r.flow, folder: fld, confirm: true}).then(function (x) { toast(x.ok === false ? x._error : "moved " + name, x.ok === false); palette.reload(); });
      });
    }

    // ── adding things ────────────────────────────────────────────────────────
    function addStepAt(step, lp, index) {
      var at;
      edit(function (w) {
        if (step.type === "tool" && step.tool && !step.id) { /* ids are assigned lazily when a reference needs them */ }
        at = M.insertStep(w, lp, index, M.clone(step));
      }, {refresh: false});
      if (at) select({type: "step", path: at});
    }
    function addStepEnd(step) {
      var target = sel && sel.type === "step" ? M.parentList(sel.path) : [];
      var idx = sel && sel.type === "step" ? sel.path[sel.path.length - 1] + 1 : (M.listAt(wf, []) || []).length;
      addStepAt(step, target, idx);
    }
    function popover(anchor, lp, index) {
      closeMenu();
      menuEl = el("div", "wf-menu wf-pop");
      var q = el("input", null, null, {type: "search", placeholder: "Add a step: type a step kind or a tool name"});
      var list = el("div", "wf-pop-list");
      menuEl.appendChild(q);
      menuEl.appendChild(list);
      var r = anchor.getBoundingClientRect();
      menuEl.style.left = Math.min(r.left, window.innerWidth - 380) + "px";
      menuEl.style.top = Math.min(r.bottom + 4, window.innerHeight - 420) + "px";
      menuEl.addEventListener("click", function (e) { e.stopPropagation(); });
      document.body.appendChild(menuEl);
      var pick = function (step) { closeMenu(); addStepAt(step, lp, index); };
      var draw = function (tools) {
        list.replaceChildren();
        var n = q.value.trim().toLowerCase();
        M.KIND_ORDER.forEach(function (k) {
          var meta = M.KINDS[k];
          if (n && meta.label.toLowerCase().indexOf(n) < 0 && k.indexOf(n) < 0) return;
          var b = el("button", "wf-pop-item", null, {type: "button"});
          b.appendChild(el("span", "wf-icon", meta.icon)); b.appendChild(el("span", null, meta.label)); b.appendChild(el("small", null, meta.group));
          b.addEventListener("click", function () { pick(meta.make()); });
          list.appendChild(b);
        });
        (tools || []).forEach(function (t) {
          var b = el("button", "wf-pop-item", null, {type: "button"});
          b.appendChild(el("span", "wf-icon", "🔧")); b.appendChild(el("span", null, t.id)); b.appendChild(el("small", null, t.safety));
          b.title = t.description || "";
          b.addEventListener("click", function () { pick({type: "tool", tool: t.id, params: {}}); });
          list.appendChild(b);
        });
      };
      var timer = null;
      q.addEventListener("input", function () {
        draw();
        clearTimeout(timer);
        var v = q.value.trim();
        if (v.length >= 2) timer = setTimeout(function () { api.catalog("search", {query: v, limit: 12}).then(function (r) { if (menuEl) draw(r.tools); }); }, 250);
      });
      draw();
      q.focus();
    }
    function addTriggerMenu(anchor) {
      var r = anchor.getBoundingClientRect();
      menu({clientX: r.left, clientY: r.bottom + 4}, M.TRIGGER_TYPES.map(function (t) {
        return [t, function () { edit(function (w) { w.triggers.push({type: t}); }, {refresh: false}); select({type: "trigger", index: wf.triggers.length - 1}); }];
      }));
    }

    function onDrop(d, lp, index, shift, targetPath) {
      if (d.new) { addStepAt(d.new, lp, index); return; }
      if (!d.from) return;
      if (shift && targetPath) {
        var at;
        edit(function (w) { at = M.mergeParallel(w, d.from, targetPath); }, {refresh: false});
        if (at) { select({type: "step", path: at}); toast("merged into a parallel step"); } else toast("only siblings can be merged", true);
        return;
      }
      var ok = false;
      edit(function (w) { ok = M.moveStep(w, d.from, lp, index); }, {refresh: false});
      if (!ok) { hist.undoStack.pop(); toast("a step cannot be moved into itself", true); afterChange({refresh: false}); }
      else { sel = null; inspector.render(null); }
    }

    function stepAction(act, path) {
      if (act === "delete") { edit(function (w) { M.removeStep(w, path); }, {clearSelection: true}); }
      else if (act === "duplicate") { var at; edit(function (w) { at = M.duplicateStep(w, path); }, {refresh: false}); if (at) select({type: "step", path: at}); }
      else if (act === "copy") { clip = M.clone(M.getStep(wf, path)); toast("copied"); }
      else if (act === "breakpoint") { edit(function (w) { var s = M.getStep(w, path); if (s._breakpoint) delete s._breakpoint; else s._breakpoint = true; }); }
      else if (act === "group") { edit(function (w) { M.groupWithNext(w, path); }, {clearSelection: true}); }
      else if (act === "ungroup") { edit(function (w) { M.ungroup(w, path); }, {clearSelection: true}); }
      else if (act === "from-here") { runFlow({from: path[0]}); }
    }
    function paste() {
      if (!clip) { toast("nothing copied", true); return; }
      var c = M.clone(clip); delete c.id;
      addStepEnd(c);
    }
    function contextMenu(ev, s) {
      if (s.type === "trigger") { menu(ev, [["Remove trigger", function () { edit(function (w) { w.triggers.splice(s.index, 1); }, {clearSelection: true}); }]]); return; }
      var step = M.getStep(wf, s.path), k = M.kind(step);
      menu(ev, [
        ["Run from here", function () { runFlow({from: s.path[0]}); }],
        [step._breakpoint ? "Remove breakpoint" : "Toggle breakpoint", function () { stepAction("breakpoint", s.path); }],
        null,
        ["Duplicate", function () { stepAction("duplicate", s.path); }],
        ["Copy", function () { stepAction("copy", s.path); }],
        k === "group" ? ["Ungroup", function () { stepAction("ungroup", s.path); }] : ["Group with next", function () { stepAction("group", s.path); }],
        null,
        ["Delete", function () { stepAction("delete", s.path); }]]);
    }

    // ── running ──────────────────────────────────────────────────────────────
    // a loop has one record per iteration; the overlay shows ONE of them (default: the last), chosen with the ‹ › chip
    var iterSel = {}, iters = {};
    function statusMap(r) {
      var m = {}; runInfo = {}; iters = {};
      (function walk(recs) {
        (recs || []).forEach(function (rec) {
          var key = rec.kind !== "iteration" && rec.kind !== "branch" ? M.pathKey(M.fromEnginePath(rec.path)) : null;
          if (key !== null) {
            m[key] = {status: rec.status, ms: rec.duration_ms, error: rec.error};
            runInfo[key] = rec;
          }
          var kids = rec.children || [];
          if (rec.kind === "loop" && kids.length && kids[0].kind === "iteration") {
            var i = iterSel[key] == null ? kids.length - 1 : Math.max(0, Math.min(kids.length - 1, iterSel[key]));
            iters[key] = {count: kids.length, index: i};
            walk([kids[i]]);
            return;
          }
          walk(kids);
        });
      })(r.steps);
      return m;
    }
    function iterate(key, delta) {
      var it = iters[key]; if (!it || !run) return;
      iterSel[key] = Math.max(0, Math.min(it.count - 1, it.index + delta));
      canvas.setStatuses(statusMap(run));
      canvas.setIterations(iters);
      if (sel && sel.type === "step") inspector.render(sel);
    }
    function clearRun() {
      clearTimeout(polling); polling = null; run = null; runInfo = {}; viewingPast = false;
      banner.style.display = "none"; banner.replaceChildren();
      if (canvas) canvas.setStatuses({});
    }
    function showBanner(r, live) {
      banner.replaceChildren();
      banner.style.display = "";
      banner.className = "wf-banner wf-banner-" + r.status;
      var txt = (r.dry ? "Dry run " : viewingPast ? "Past run " : "Run ") + r.id + " · " + r.status + " · " + ms(r.duration_ms) + (r.error ? " · " + r.error : "");
      banner.appendChild(el("span", null, txt));
      var b = function (label, fn, cls) { var x = el("button", cls || "", label, {type: "button"}); x.addEventListener("click", fn); banner.appendChild(x); return x; };
      if (r.pending) {
        banner.appendChild(el("span", "wf-pending", " ⏸ " + r.pending.message));
        if (r.pending.kind === "debug") {
          b("Step", function () { api.tr("run_advance", {run_id: r.id, mode: "step", confirm: true}); });
          b("Continue", function () { api.tr("run_advance", {run_id: r.id, mode: "continue", confirm: true}); }, "wf-primary");
        } else {
          var val = null;
          if (r.pending.kind === "input" || r.pending.kind === "prompt") { val = el("input", null, null, {type: "text", placeholder: r.pending.default || "answer"}); banner.appendChild(val); }
          b("Approve", function () { api.tr("run_respond", {run_id: r.id, action: "approve", value: val ? val.value : undefined, confirm: true}); }, "wf-primary");
          b("Reject", function () { api.tr("run_respond", {run_id: r.id, action: "reject", confirm: true}); });
        }
      }
      if (live) b("Cancel", function () { api.tr("run_cancel", {run_id: r.id, confirm: true}); });
      b("Clear", clearRun);
    }
    function applyRun(r, live) {
      if (!run || run.id !== r.id) iterSel = {};
      run = r;
      canvas.setStatuses(statusMap(r));
      canvas.setIterations(iters);
      showBanner(r, live);
      if (sel && sel.type === "step") inspector.render(sel);
    }
    function poll(id) {
      clearTimeout(polling);
      api.tr("run_get", {run_id: id}).then(function (x) {
        if (!x.ok) return;
        applyRun(x.run, x.live);
        if (x.live || ["running", "paused", "queued"].indexOf(x.run.status) >= 0) polling = setTimeout(function () { poll(id); }, 500);
        else { rightTab === "history" && showRight("history"); }
      });
    }
    function runFlow(o) {
      o = o || {};
      var errs = M.issues(wf).filter(function (i) { return i.level === "error"; });
      if (errs.length) { toast("fix the problems first: " + errs[0].message, true); return; }
      var inputs = [];
      (wf.triggers || []).forEach(function (t) { if (t.type === "manual") (t.inputs || []).forEach(function (i) { if (i && i.name) inputs.push(i); }); });
      var start = function (vals) {
        clearRun();
        var args = {definition: wf, inputs: vals, confirm: true, dry_run: !!o.dry, debug: !!o.debug, breakpoints: !!o.breakpoints || wf.steps.some(function (s) { return s._breakpoint; }), from_step: o.from};
        if (o.dry) args.wait = 30; else args.wait = 0.3;
        banner.style.display = ""; banner.className = "wf-banner"; banner.textContent = "starting…";
        api.tr("run", args).then(function (r) {
          if (r.ok === false) { banner.style.display = "none"; toast(r._error + (r.issues ? " (" + r.issues.length + " issues)" : ""), true); return; }
          if (r.run) applyRun(r.run, false); else poll(r.run_id);
          if (!r.run) poll(r.run_id);
        });
      };
      if (!inputs.length) { start({}); return; }
      var box = el("div"), fields = {};
      inputs.forEach(function (i) {
        var f = el("div", "wf-field"); f.appendChild(el("label", null, i.label || i.name));
        var inp = el("input", null, null, {type: "text"}); inp.value = i.default == null ? "" : i.default; fields[i.name] = inp; f.appendChild(inp); box.appendChild(f);
      });
      modal((o.dry ? "Dry run " : "Run ") + wf.name, box, [["Run", function () { var v = {}; Object.keys(fields).forEach(function (k) { if (fields[k].value !== "") v[k] = fields[k].value; }); start(v); }, "wf-primary"], ["Cancel", null]]);
    }

    // ── right panel: details | history | versions ────────────────────────────
    function showRight(tab) {
      rightTab = tab;
      rtabs.querySelectorAll("button").forEach(function (b) { b.classList.toggle("on", b.dataset.tab === tab); });
      if (tab === "details") inspector.render(sel);
      else if (tab === "history") renderHistory();
      else renderVersions();
    }
    [["details", "Details"], ["history", "History"], ["versions", "Versions"]].forEach(function (t) {
      var b = el("button", null, t[1], {type: "button"}); b.dataset.tab = t[0];
      b.addEventListener("click", function () { showRight(t[0]); });
      rtabs.appendChild(b);
    });

    function renderHistory() {
      rbody.replaceChildren(el("p", "wf-help", "loading."));
      if (!wf.name) { rbody.replaceChildren(el("p", "wf-help", "Save the workflow to see its runs.")); return; }
      api.tr("runs", {workflow: wf.name, limit: 30}).then(function (r) {
        rbody.replaceChildren();
        var runs = r.runs || [];
        var strip = el("div", "wf-strip");
        runs.slice(0, 20).reverse().forEach(function (x) {
          var b = el("button", "wf-strip-bar wf-s-" + (x.status === "done" ? "ok" : "bad"), null, {type: "button", title: x.status + " " + ms(x.duration_ms)});
          b.style.height = Math.max(6, Math.min(30, (x.duration_ms || 0) / 200)) + "px";
          b.addEventListener("click", function () { viewRun(x.id); });
          strip.appendChild(b);
        });
        rbody.appendChild(strip);
        if (!runs.length) rbody.appendChild(el("p", "wf-help", "No runs yet."));
        runs.forEach(function (x) {
          var c = el("div", "wf-run wf-run-" + (x.status === "done" ? "ok" : "bad"));
          c.appendChild(el("strong", null, x.status));
          c.appendChild(el("span", null, " " + when(x.started) + " · " + ms(x.duration_ms) + " · " + x.source));
          if (x.error) c.appendChild(el("div", "wf-bad", x.error));
          var act = el("div", "wf-actions");
          var v = el("button", null, "View", {type: "button"}); v.addEventListener("click", function () { viewRun(x.id); });
          var rp = el("button", null, "Replay", {type: "button"});
          rp.addEventListener("click", function () { api.tr("run_retry", {run_id: x.id, confirm: true}).then(function (z) { if (z.ok === false) toast(z._error, true); else { viewingPast = false; poll(z.run_id); } }); });
          act.appendChild(v); act.appendChild(rp); c.appendChild(act);
          rbody.appendChild(c);
        });
      });
    }
    function viewRun(id) {
      api.tr("run_get", {run_id: id}).then(function (x) {
        if (!x.ok) { toast(x._error, true); return; }
        viewingPast = true;
        applyRun(x.run, x.live);
        gantt(x.run);
      });
    }
    function gantt(r) {
      var top = (r.steps || []).filter(function (s) { return /^\d+$/.test(s.path); });
      var box = el("div", "wf-gantt");
      box.appendChild(el("h4", null, "Timeline"));
      var t0 = r.started || 0, total = Math.max(1, ((r.finished || t0) - t0) * 1000);
      top.forEach(function (s) {
        var row = el("div", "wf-g-row");
        row.appendChild(el("span", "wf-g-label", s.path + " " + (s.label || s.kind)));
        var track = el("div", "wf-g-track"), bar2 = el("div", "wf-g-bar wf-g-" + s.status);
        bar2.style.left = (((s.started || t0) - t0) * 1000 / total * 100) + "%";
        bar2.style.width = Math.max(1.5, (s.duration_ms || 0) / total * 100) + "%";
        bar2.title = s.status + " " + ms(s.duration_ms);
        track.appendChild(bar2); row.appendChild(track);
        if (s.status === "error") {
          var rt = el("button", null, "retry from here", {type: "button"});
          rt.addEventListener("click", function () { api.tr("run_retry", {run_id: r.id, from_step: Number(s.path), confirm: true}).then(function (z) { if (z.ok === false) toast(z._error, true); else { viewingPast = false; poll(z.run_id); } }); });
          row.appendChild(rt);
        }
        box.appendChild(row);
      });
      rbody.appendChild(box);
    }
    function renderVersions() {
      rbody.replaceChildren(el("p", "wf-help", "loading."));
      if (!origName) { rbody.replaceChildren(el("p", "wf-help", "Save the workflow to keep versions.")); return; }
      api.tr("flow", {workflow: origName, versions: true}).then(function (r) {
        rbody.replaceChildren();
        var vs = r.versions || [];
        if (!vs.length) rbody.appendChild(el("p", "wf-help", "No earlier versions."));
        vs.forEach(function (v, i) {
          var c = el("div", "wf-run");
          c.appendChild(el("strong", null, "v" + (vs.length - i)));
          c.appendChild(el("span", null, " " + when(v.timestamp) + " · " + v.steps + " steps"));
          var act = el("div", "wf-actions");
          var d = el("button", null, "Diff", {type: "button"}); d.addEventListener("click", function () { showDiff(v); });
          var rs = el("button", null, "Restore", {type: "button"});
          rs.addEventListener("click", function () { confirmBox("Replace the editor content with this version?", function () { hist.push(wf); dirty = true; setWf(M.clone(v.definition)); showMode("visual"); }); });
          act.appendChild(d); act.appendChild(rs); c.appendChild(act); rbody.appendChild(c);
        });
      });
    }
    function showDiff(v) {
      var diff = M.lineDiff(JSON.stringify(v.definition, null, 2), JSON.stringify(wf, null, 2));
      diffHost.replaceChildren();
      var add = diff.filter(function (x) { return x.t === "+"; }).length, del = diff.filter(function (x) { return x.t === "-"; }).length;
      var head = el("div", "wf-diffhead");
      head.appendChild(el("strong", null, "Version " + when(v.timestamp) + " → current   "));
      head.appendChild(el("span", "wf-d-add", "+" + add));
      head.appendChild(el("span", "wf-d-del", " -" + del));
      var back = el("button", null, "Back to editor", {type: "button"}); back.addEventListener("click", function () { showMode("visual"); });
      head.appendChild(back);
      diffHost.appendChild(head);
      var pre = el("div", "wf-diff");
      diff.forEach(function (x) { pre.appendChild(el("div", "wf-d wf-d-" + (x.t === "+" ? "a" : x.t === "-" ? "r" : "c"), x.t + " " + x.s)); });
      diffHost.appendChild(pre);
      showMode("diff");
    }

    // ── modes ────────────────────────────────────────────────────────────────
    function showMode(m) {
      mode = m;
      canvasHost.style.display = m === "visual" ? "" : "none";
      jsonHost.style.display = m === "json" ? "" : "none";
      diffHost.style.display = m === "diff" ? "" : "none";
      if (m === "json") {
        if (!jsonEd && root.AppUIJsonEditor) {
          var t = null;
          jsonEd = root.AppUIJsonEditor.create({container: jsonHost, mode: "edit", value: wf, onChange: function (v) {
            if (!v || JSON.stringify(v) === JSON.stringify(wf)) return;
            clearTimeout(t); t = setTimeout(function () { hist.push(wf); dirty = true; wf = v; wf.steps = wf.steps || []; wf.triggers = wf.triggers || []; sel = null; canvas.render(); marks(); toolbarState(); }, 400);
          }});
        } else if (jsonEd) jsonEd.setValue(wf);
      } else if (m === "visual") { canvas.render(); canvas.select(sel); marks(); }
      toolbar.querySelectorAll("[data-mode]").forEach(function (b) { b.classList.toggle("on", b.dataset.mode === m); });
    }

    // ── import / export / AI draft ───────────────────────────────────────────
    function exportJson() {
      var a = el("a", null, null, {href: URL.createObjectURL(new Blob([JSON.stringify(wf, null, 2)], {type: "application/json"})), download: (wf.name || "workflow") + ".json"});
      document.body.appendChild(a); a.click(); a.remove();
    }
    function importJson() {
      var f = el("input", null, null, {type: "file", accept: ".json,application/json"});
      f.addEventListener("change", function () {
        var file = f.files[0]; if (!file) return;
        file.text().then(function (txt) {
          var v; try { v = JSON.parse(txt); } catch (e) { toast("not valid JSON", true); return; }
          if (v && !Array.isArray(v.steps) && isPowerAutomate(v)) { importPowerAutomate(v, file.name.replace(/\.json$/i, "")); return; }
          if (!v || !Array.isArray(v.steps)) { toast("this file is not a workflow (no steps list)", true); return; }
          guardDiscard(function () { v.name = v.name || file.name.replace(/\.json$/i, ""); load(v, null, ""); dirty = true; toolbarState(); toast("imported " + v.name + " - not saved yet"); });
        });
      });
      f.click();
    }
    function isPowerAutomate(v) {
      var d = v && (v.properties && v.properties.definition || v.definition || v);
      return !!(d && d.actions && typeof d.actions === "object" && !Array.isArray(d.actions));
    }
    function importPowerAutomate(doc, fallbackName) {
      api.tr("import_power_automate", {definition: doc, name: (doc.properties && doc.properties.displayName) || fallbackName}).then(function (r) {
        if (r.ok === false) { toast(r._error, true); return; }
        var box = el("div");
        box.appendChild(el("p", null, "Converted " + r.stats.steps + " step(s), " + r.stats.triggers + " trigger(s); " + r.stats.unmapped + " action(s) had no equivalent and became note steps. The workflow is created DISABLED and not saved."));
        if ((r.warnings || []).length) {
          box.appendChild(el("h4", null, "Review these (" + r.warnings.length + ")"));
          var ul = el("ul"); r.warnings.forEach(function (w) { ul.appendChild(el("li", null, w)); }); box.appendChild(ul);
        }
        modal("Power Automate import", box, [["Open in editor", function () {
          guardDiscard(function () { load(r.definition, null, ""); dirty = true; toolbarState(); toast("imported " + r.definition.name + " - review, then save"); });
        }, "wf-primary"], ["Cancel", null]]);
      });
    }
    function fromDescription() {
      var ta = el("textarea", null, null, {rows: 5, placeholder: "e.g. every weekday at 9 summarise unread mails and notify me"});
      var c = el("div", "wf-field"); c.appendChild(el("label", null, "Describe what the workflow should do")); c.appendChild(ta);
      modal("Create from description", c, [["Draft it", function (close) {
        if (!ta.value.trim()) return false;
        toast("asking the model…");
        api.tr("flow_from_description", {description: ta.value.trim()}).then(function (r) {
          if (r.ok === false) { toast(r._error, true); return; }
          guardDiscard(function () { load(r.definition, null, ""); dirty = true; toolbarState(); toast("drafted " + r.definition.name + " - review it, then save" + ((r.issues || []).length ? " (" + r.issues.length + " issue(s))" : "")); });
        });
        close();
        return false;
      }, "wf-primary"], ["Cancel", null]]);
    }
    function saveTemplate() {
      ask("Save as template", "Template name", wf.name, function (name) {
        api.tr("template_save", {template: {name: name, description: wf.description || "", workflow: wf}, confirm: true}).then(function (r) { toast(r.ok === false ? r._error : "template saved", r.ok === false); });
      });
    }

    // ── toolbar ──────────────────────────────────────────────────────────────
    var toolbar = bar;
    var btns = {};
    function tb(id, label, title, fn, cls) {
      var b = el("button", cls || "", label, {type: "button", title: title});
      b.addEventListener("click", fn); b.dataset.id = id; btns[id] = b; toolbar.appendChild(b); return b;
    }
    function sep() { toolbar.appendChild(el("span", "wf-sep")); }
    var nameLabel = el("span", "wf-name");
    toolbar.appendChild(nameLabel);
    sep();
    tb("new", "New", "New workflow (Ctrl+N)", function () { newFlow(folder); });
    tb("save", "Save", "Save (Ctrl+S)", function () { save(false); }, "wf-primary");
    tb("validate", "Validate", "Check the workflow on the server", validateServer);
    sep();
    tb("undo", "↶", "Undo (Ctrl+Z)", undo);
    tb("redo", "↷", "Redo (Ctrl+Y)", redo);
    sep();
    tb("run", "▶ Run", "Run (Ctrl+R)", function () { runFlow({}); }, "wf-run-btn");
    tb("dry", "Dry run", "Simulate: nothing is called, conditions and references are still evaluated", function () { runFlow({dry: true}); });
    tb("debug", "Step through", "Pause before every step", function () { runFlow({debug: true}); });
    sep();
    [["visual", "Visual"], ["json", "JSON"]].forEach(function (m) {
      var b = tb("mode-" + m[0], m[1], m[1] + " editor", function () { showMode(m[0]); }); b.dataset.mode = m[0];
    });
    sep();
    var zoomLbl = el("span", "wf-zoom", "100%");
    tb("zout", "−", "Zoom out", function () { canvas.zoomBy(-0.1); });
    toolbar.appendChild(zoomLbl);
    tb("zin", "+", "Zoom in", function () { canvas.zoomBy(0.1); });
    tb("zfit", "Fit", "Fit to view", function () { canvas.fit(); });
    tb("z1", "1:1", "Actual size", function () { canvas.zoomReset(); });
    sep();
    tb("export", "Export", "Download as JSON", exportJson);
    tb("import", "Import", "Load a workflow JSON file", importJson);
    tb("ai", "✨ From description", "Draft a workflow with the model", fromDescription);
    function toolbarState() {
      var c = hist.can();
      btns.undo.disabled = !c.undo; btns.redo.disabled = !c.redo;
      nameLabel.textContent = (wf.name || "(unnamed)") + (dirty ? " •" : "");
      nameLabel.title = dirty ? "unsaved changes" : "saved";
      btns.save.disabled = !dirty && !!origName;
      status.textContent = (wf.steps ? M.flatten(wf).length : 0) + " steps · " + (wf.triggers || []).length + " trigger(s)" + (folder ? " · folder " + folder : "");
    }

    // ── keyboard ─────────────────────────────────────────────────────────────
    function onKey(e) {
      if (!document.body.contains(rootEl)) { document.removeEventListener("keydown", onKey); return; }
      var tag = (e.target.tagName || "").toLowerCase(), typing = tag === "input" || tag === "textarea" || tag === "select" || e.target.isContentEditable;
      var mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); save(false); }
      else if (mod && e.key.toLowerCase() === "z" && !typing) { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if (mod && e.key.toLowerCase() === "y" && !typing) { e.preventDefault(); redo(); }
      else if (mod && e.key.toLowerCase() === "r" && !e.shiftKey) { e.preventDefault(); runFlow({}); }
      else if (mod && e.shiftKey && e.key.toLowerCase() === "r") { e.preventDefault(); runFlow({dry: true}); }
      else if (mod && e.key.toLowerCase() === "n" && !typing) { e.preventDefault(); newFlow(folder); }
      else if (mod && e.key.toLowerCase() === "c" && !typing && sel && sel.type === "step") { stepAction("copy", sel.path); }
      else if (mod && e.key.toLowerCase() === "v" && !typing) { paste(); }
      else if (mod && e.key.toLowerCase() === "d" && !typing && sel && sel.type === "step") { e.preventDefault(); stepAction("duplicate", sel.path); }
      else if ((e.key === "Delete" || e.key === "Backspace") && !typing && sel && sel.type === "step") { e.preventDefault(); stepAction("delete", sel.path); }
      else if (e.key === "Escape") { closeMenu(); }
    }
    document.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", function (e) { if (dirty && document.body.contains(rootEl)) { e.preventDefault(); e.returnValue = ""; } });

    // ── assemble ─────────────────────────────────────────────────────────────
    canvas = root.WFCanvas.create({
      container: canvasHost, getWf: function () { return wf; },
      onSelect: select, onAdd: function (lp, index, anchor) { popover(anchor, lp, index); }, onAddTrigger: addTriggerMenu, onDrop: onDrop, onContext: contextMenu,
      onAddSlot: function (path) {
        var s = M.getStep(wf, path);
        if (s.type === "switch") ask("Add case", "Case value", "", function (v) { edit(function (w) { if (!M.addCase(w, path, v)) toast("that case exists", true); }, {refresh: false}); });
        else edit(function (w) { M.addBranch(w, path); }, {refresh: false});
      },
      onRemoveSlot: function (path, segs) { edit(function (w) { M.removeSlot(w, path, segs); }, {refresh: false}); },
      onIterate: iterate,
      onZoom: function (s) { zoomLbl.textContent = Math.round(s * 100) + "%"; }
    });
    inspector = root.WFInspector.create({
      container: rbody, getWf: function () { return wf; }, edit: edit, select: select, toast: toast, api: api,
      getFolder: function () { return folder; }, setFolder: function (f) { folder = f; dirty = true; toolbarState(); },
      act: stepAction, runInfo: function (k) { return runInfo[k] || null; }
    });
    palette = root.WFPalette.create({
      container: left, api: api, toast: toast, menu: menu,
      folders: function () { return folders; }, setFolders: function (f) { folders = f; }, current: function () { return origName; },
      onOpen: open, onNew: newFlow, onRun: function (n) { guardDiscard(function () { api.tr("flow", {workflow: n}).then(function (r) { if (r.ok) { load(r.flow, n, r.folder); runFlow({}); } }); }); },
      onDuplicate: duplicateFlow, onMove: moveFlow, onDelete: deleteFlow,
      onAddStep: addStepEnd,
      onTemplate: function (w, t) { guardDiscard(function () { w.name = (w.name || "flow") + "-" + Math.random().toString(36).slice(2, 5); load(w, null, ""); dirty = true; toolbarState(); toast("created from template " + t.name + " - not saved yet"); }); },
      onSaveTemplate: saveTemplate
    });

    // splitters are plain CSS grid; initial content
    showMode("visual");
    showRight("details");
    var want = cfg.params && cfg.params.flow;
    if (want) open(want); else { load(M.blank(), null, ""); }
    toolbarState();

    return {
      open: open,
      getWf: function () { return wf; },
      getSelection: function () { return sel; },
      getRun: function () { return run ? {id: run.id, status: run.status, error: run.error, dry: run.dry} : null; },
      isDirty: function () { return dirty; },
      // undoable replacement of the editor content (used by the AI assistant); never saves
      setDefinition: function (def) { hist.push(wf); dirty = true; setWf(def); showMode("visual"); },
      appendStep: function (step) { addStepEnd(step); },
      destroy: function () { document.removeEventListener("keydown", onKey); clearTimeout(polling); closeMenu(); canvas.destroy(); }
    };
  }

  root.WFEditor = {mount: mount};
})(window);
