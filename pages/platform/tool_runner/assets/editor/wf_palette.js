// WFPalette - the editor's left side: Workflows (folders + tags), Steps (operators), Tools (catalog search),
// Templates, Agents/Pipelines. Items are click-to-add AND draggable onto the canvas
// (dataTransfer "application/x-wf" = {new: <step>}).
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

  function create(opts) {
    var host = opts.container, api = opts.api;
    var tabsEl = el("div", "wf-ptabs"), body = el("div", "wf-pbody");
    host.appendChild(tabsEl);
    host.appendChild(body);
    var TABS = [["flows", "Workflows"], ["steps", "Steps"], ["tools", "Tools"], ["templates", "Templates"], ["agents", "Agents"]];
    var current = "flows", tagFilter = {}, flowsCache = [];

    function draggable(node, step) {
      node.draggable = true;
      node.addEventListener("dragstart", function (ev) {
        ev.dataTransfer.setData("application/x-wf", JSON.stringify({new: step}));
        ev.dataTransfer.effectAllowed = "copy";
      });
    }
    function item(parent, icon, title, sub, onClick, step) {
      var r = el("div", "wf-pitem");
      r.appendChild(el("span", "wf-icon", icon));
      var t = el("span", "wf-ptext");
      t.appendChild(el("span", "wf-ptitle", title));
      if (sub) t.appendChild(el("small", "wf-psub", sub));
      r.appendChild(t);
      r.addEventListener("click", onClick);
      if (step) draggable(r, step);
      parent.appendChild(r);
      return r;
    }

    // ── workflows ────────────────────────────────────────────────────────────
    function renderFlows() {
      body.replaceChildren();
      var bar = el("div", "wf-pbar");
      var q = el("input", null, null, {type: "search", placeholder: "Filter workflows"});
      bar.appendChild(q);
      var nb = el("button", null, "+", {type: "button", title: "New workflow"});
      nb.addEventListener("click", function () { opts.onNew(""); });
      bar.appendChild(nb);
      var fb = el("button", null, "📁", {type: "button", title: "New folder"});
      fb.addEventListener("click", function () { var f = window.prompt("Folder name (a/b nests)"); if (f) api.tr("folder_create", {folder: f, confirm: true}).then(load); });
      bar.appendChild(fb);
      body.appendChild(bar);
      var tagsBox = el("div", "wf-tags"), tree = el("div", "wf-tree");
      body.appendChild(tagsBox);
      body.appendChild(tree);
      var draw = function () {
        var needle = q.value.trim().toLowerCase();
        var all = {};
        flowsCache.forEach(function (w) { (w.tags || []).forEach(function (t) { all[t] = 1; }); });
        tagsBox.replaceChildren();
        Object.keys(all).sort().forEach(function (t) {
          var c = el("button", "wf-tag" + (tagFilter[t] ? " on" : ""), t, {type: "button"});
          c.addEventListener("click", function () { tagFilter[t] = !tagFilter[t]; draw(); });
          tagsBox.appendChild(c);
        });
        var active = Object.keys(tagFilter).filter(function (t) { return tagFilter[t]; });
        var rows = flowsCache.filter(function (w) {
          return (!needle || w.name.toLowerCase().indexOf(needle) >= 0) && (!active.length || (w.tags || []).some(function (t) { return active.indexOf(t) >= 0; }));
        });
        var folders = {};
        (opts.folders() || []).forEach(function (f) { folders[f] = []; });
        rows.forEach(function (w) { (folders[w.folder || ""] = folders[w.folder || ""] || []).push(w); });
        tree.replaceChildren();
        Object.keys(folders).sort().forEach(function (f) {
          var box = tree;
          if (f) {
            var head = el("div", "wf-folder", "📁 " + f + " (" + folders[f].length + ")");
            head.addEventListener("contextmenu", function (ev) {
              ev.preventDefault();
              opts.menu(ev, [["New workflow here", function () { opts.onNew(f); }],
                             ["New subfolder", function () { var s = window.prompt("Subfolder name"); if (s) api.tr("folder_create", {folder: f + "/" + s, confirm: true}).then(load); }],
                             ["Delete folder (if empty)", function () { api.tr("folder_delete", {folder: f, confirm: true}).then(function (r) { if (r.ok === false) opts.toast(r._error, true); load(); }); }]]);
            });
            tree.appendChild(head);
            box = el("div", "wf-folder-body");
            tree.appendChild(box);
          }
          folders[f].sort(function (a, b) { return a.name < b.name ? -1 : 1; }).forEach(function (w) {
            var r = item(box, w.enabled ? "▶" : "⏸", w.name, (w.triggers || []).map(function (t) { return t.type; }).join(", ") + " · " + w.steps + " steps",
              function () { opts.onOpen(w.name); });
            if (w.name === opts.current()) r.classList.add("wf-pcurrent");
            r.addEventListener("contextmenu", function (ev) {
              ev.preventDefault();
              opts.menu(ev, [["Open", function () { opts.onOpen(w.name); }], ["Run", function () { opts.onRun(w.name); }],
                             ["Duplicate", function () { opts.onDuplicate(w.name); }],
                             [w.enabled ? "Disable" : "Enable", function () { api.tr("flow_enable", {workflow: w.name, enabled: !w.enabled, confirm: true}).then(load); }],
                             ["Move to folder…", function () { var t = window.prompt("Move to folder (blank = top level)", w.folder || ""); if (t !== null) opts.onMove(w.name, t); }],
                             ["Delete", function () { opts.onDelete(w.name); }]]);
            });
          });
        });
        if (!rows.length && !Object.keys(folders).length) tree.appendChild(el("p", "wf-help", "No workflows yet - press + to create one."));
      };
      q.addEventListener("input", draw);
      draw();
    }
    function load() {
      return api.tr("flows", {}).then(function (r) { flowsCache = r.flows || []; opts.setFolders(r.folders || []); if (current === "flows") renderFlows(); });
    }

    // ── steps ────────────────────────────────────────────────────────────────
    function renderSteps() {
      body.replaceChildren();
      var q = el("input", null, null, {type: "search", placeholder: "Filter step types"});
      body.appendChild(el("div", "wf-pbar")).appendChild(q);
      var box = el("div");
      body.appendChild(box);
      var draw = function () {
        box.replaceChildren();
        var needle = q.value.trim().toLowerCase(), last = "";
        M.KIND_ORDER.forEach(function (k) {
          var meta = M.KINDS[k];
          if (needle && meta.label.toLowerCase().indexOf(needle) < 0 && k.indexOf(needle) < 0) return;
          if (meta.group !== last) { box.appendChild(el("div", "wf-pgroup", meta.group)); last = meta.group; }
          item(box, meta.icon, meta.label, null, function () { opts.onAddStep(meta.make()); }, meta.make());
        });
      };
      q.addEventListener("input", draw);
      draw();
    }

    // ── tools ────────────────────────────────────────────────────────────────
    function renderTools() {
      body.replaceChildren();
      var q = el("input", null, null, {type: "search", placeholder: "Search tools (name, description)"});
      body.appendChild(el("div", "wf-pbar")).appendChild(q);
      var box = el("div");
      body.appendChild(box);
      var search = function () {
        var v = q.value.trim();
        (v ? api.catalog("search", {query: v, limit: 40}) : api.catalog("groups", {})).then(function (r) {
          box.replaceChildren();
          if (!v) {
            (r.groups || []).forEach(function (g) {
              var row = item(box, "📦", g.group, g.count + " tools", function () { q.value = g.group + "/"; search(); });
              void row;
            });
            return;
          }
          (r.tools || []).forEach(function (t) {
            var step = {type: "tool", tool: t.id, params: {}};
            item(box, t.safety === "read_only" ? "🔍" : "✏", t.id, (t.description || "").slice(0, 70), function () { opts.onAddStep(step); }, step);
          });
          if (!(r.tools || []).length) box.appendChild(el("p", "wf-help", "No tool matches."));
        });
      };
      var t = null;
      q.addEventListener("input", function () { clearTimeout(t); t = setTimeout(search, 250); });
      search();
    }

    // ── templates ────────────────────────────────────────────────────────────
    function renderTemplates() {
      body.replaceChildren(el("p", "wf-help", "loading."));
      api.tr("templates", {}).then(function (r) {
        body.replaceChildren();
        (r.templates || []).forEach(function (t) {
          var wf = t.workflow || {};
          item(body, "🧩", t.name, (t.builtin ? "built-in · " : "") + (wf.steps || []).length + " steps · " + (t.description || ""), function () {
            opts.onTemplate(M.clone(wf), t);
          });
        });
        var save = el("button", "wf-pwide", "Save current workflow as template", {type: "button"});
        save.addEventListener("click", function () { opts.onSaveTemplate(); });
        body.appendChild(save);
      });
    }

    // ── agents / pipelines ───────────────────────────────────────────────────
    function renderAgents() {
      body.replaceChildren(el("p", "wf-help", "loading."));
      Promise.all([api.tr("agents", {}), api.tr("pipelines", {})]).then(function (all) {
        body.replaceChildren();
        body.appendChild(el("div", "wf-pgroup", "Agents"));
        (all[0].agents || []).forEach(function (a) {
          var step = {type: "agent", agent: a.name, input: "{{last}}", _label: "🤖 " + a.name};
          item(body, "🤖", a.name, (a.description || "").slice(0, 70), function () { opts.onAddStep(step); }, step);
        });
        if (!(all[0].agents || []).length) body.appendChild(el("p", "wf-help", "No agents saved yet."));
        body.appendChild(el("div", "wf-pgroup", "Pipelines"));
        (all[1].pipelines || []).forEach(function (p) {
          var stages = p.stages || p.agents || [];
          var step = {type: "group", _label: "pipeline " + p.name, steps: stages.map(function (s) {
            var name = typeof s === "string" ? s : s.agent || s.name;
            return {type: "agent", agent: name, input: "{{last}}"}; })};
          item(body, "⛓", p.name, stages.length + " stages", function () { opts.onAddStep(step); }, step);
        });
        if (!(all[1].pipelines || []).length) body.appendChild(el("p", "wf-help", "No pipelines saved yet."));
      });
    }

    function show(tab) {
      current = tab;
      tabsEl.querySelectorAll("button").forEach(function (b) { b.classList.toggle("on", b.dataset.tab === tab); });
      ({flows: renderFlows, steps: renderSteps, tools: renderTools, templates: renderTemplates, agents: renderAgents})[tab]();
      if (tab === "flows") load();
    }
    TABS.forEach(function (t) {
      var b = el("button", null, t[1], {type: "button"});
      b.dataset.tab = t[0];
      b.addEventListener("click", function () { show(t[0]); });
      tabsEl.appendChild(b);
    });
    show("flows");
    return {show: show, reload: load};
  }

  root.WFPalette = {create: create};
})(window);
