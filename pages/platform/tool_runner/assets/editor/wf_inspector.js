// WFInspector - the right-hand "Details" panel: workflow settings (nothing selected), trigger forms and a form
// per step kind. Tool parameters are generated from the tool's catalog schema. Every text field has an
// "insert from previous step" picker (trigger inputs, earlier step outputs, variables, loop item).
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
  function typeOfHint(desc) {
    var d = String(desc || "").toLowerCase();
    if (/^(boolean|bool)\b/.test(d)) return "boolean";
    if (/^(number|int|integer|float)\b/.test(d)) return "number";
    if (/^(object|array|string\[\]|list)\b/.test(d)) return "json";
    return "string";
  }
  function show(v) { return v == null ? "" : typeof v === "string" ? v : JSON.stringify(v); }
  function parseLoose(raw, type) {
    raw = String(raw).trim();
    if (raw === "") return undefined;
    if (type === "boolean") return /^(true|1|yes)$/i.test(raw);
    if (type === "number") { var n = Number(raw); return isNaN(n) ? raw : n; }
    if (type === "json") { try { return JSON.parse(raw); } catch (e) { return raw; } }
    return raw;
  }

  function create(opts) {
    var host = opts.container;
    var schemaCache = {};

    function schemaFor(tool) {
      if (!tool || /\{\{/.test(tool)) return Promise.resolve(null);
      if (!schemaCache[tool]) schemaCache[tool] = opts.api.catalog("detail", {names: [tool]}).then(function (r) { return (r.tools || [])[0] || null; })
        .catch(function () { return null; });
      return schemaCache[tool];
    }

    // a labelled input; `set(value)` is called on change. `pickAt` (a step path) adds the reference picker.
    function field(parent, spec) {
      var row = el("div", "wf-field");
      var lab = el("label", null, spec.label);
      row.appendChild(lab);
      var inp;
      var type = spec.type || "text";
      if (type === "select") {
        inp = el("select");
        (spec.options || []).forEach(function (o) {
          var v = typeof o === "string" ? o : o.value, t = typeof o === "string" ? o : o.label;
          var op = el("option", null, t, {value: v});
          if (String(v) === String(spec.value == null ? "" : spec.value)) op.selected = true;
          inp.appendChild(op);
        });
        inp.addEventListener("change", function () { spec.set(inp.value); });
      } else if (type === "bool") {
        inp = el("input", null, null, {type: "checkbox"});
        inp.checked = !!spec.value;
        inp.addEventListener("change", function () { spec.set(inp.checked); });
        row.classList.add("wf-field-inline");
      } else if (type === "area" || type === "json") {
        inp = el("textarea", null, null, {rows: spec.rows || (type === "json" ? 4 : 3)});
        inp.value = type === "json" ? (spec.value == null || spec.value === "" ? "" : JSON.stringify(spec.value, null, 2)) : show(spec.value);
        inp.addEventListener("change", function () {
          if (type === "json") {
            var raw = inp.value.trim(), v;
            if (!raw) { spec.set(undefined); return; }
            try { v = JSON.parse(raw); inp.classList.remove("wf-bad"); } catch (e) { inp.classList.add("wf-bad"); opts.toast("not valid JSON", true); return; }
            spec.set(v);
          } else spec.set(inp.value);
        });
      } else {
        inp = el("input", null, null, {type: type === "number" ? "number" : "text"});
        inp.value = show(spec.value);
        if (spec.hint) inp.placeholder = spec.hint;
        inp.addEventListener("change", function () { spec.set(type === "number" ? (inp.value === "" ? undefined : Number(inp.value)) : inp.value); });
      }
      row.appendChild(inp);
      if (spec.ref && spec.path) {
        var pick = el("select", "wf-pick", null, {title: "insert from a previous step"});
        pick.appendChild(el("option", null, "⤵ insert…", {value: ""}));
        M.previousOutputs(opts.getWf(), spec.path).forEach(function (o, i) {
          pick.appendChild(el("option", null, o.label, {value: String(i)}));
        });
        var outs = M.previousOutputs(opts.getWf(), spec.path);
        pick.addEventListener("change", function () {
          var o = outs[Number(pick.value)];
          pick.value = "";
          if (!o) return;
          var ref = o.ref;
          if (!ref) { opts.edit(function (wf) { var id = M.ensureId(wf, o.path); ref = "{{steps." + id + "}}"; }, {refresh: false}); }
          inp.value = (type === "json" ? inp.value : inp.value) + ref;
          inp.dispatchEvent(new Event("change"));
        });
        row.appendChild(pick);
      }
      if (spec.help) row.appendChild(el("small", "wf-help", spec.help));
      parent.appendChild(row);
      return inp;
    }
    function section(parent, title) {
      var s = el("div", "wf-section");
      s.appendChild(el("h4", null, title));
      parent.appendChild(s);
      return s;
    }
    function button(parent, text, fn, cls) {
      var b = el("button", cls || "", text, {type: "button"});
      b.addEventListener("click", fn);
      parent.appendChild(b);
      return b;
    }

    // ── workflow settings ────────────────────────────────────────────────────
    function renderWorkflow() {
      var wf = opts.getWf();
      host.replaceChildren();
      host.appendChild(el("h3", null, "Workflow"));
      var set = function (k) { return function (v) { opts.edit(function (w) { if (v === undefined || v === "" || v === false && k !== "enabled") delete w[k]; else w[k] = v; }, {refresh: false}); }; };
      field(host, {label: "Name", value: wf.name, set: function (v) { opts.edit(function (w) { w.name = v; }, {refresh: false, renamed: true}); }});
      field(host, {label: "Description", type: "area", value: wf.description, set: set("description")});
      field(host, {label: "Folder", value: opts.getFolder(), set: function (v) { opts.setFolder(v); }, help: "a/b nests"});
      field(host, {label: "Tags (comma)", value: (wf.tags || []).join(", "), set: function (v) {
        opts.edit(function (w) { var t = String(v).split(",").map(function (x) { return x.trim(); }).filter(Boolean); if (t.length) w.tags = t; else delete w.tags; }, {refresh: false}); }});
      field(host, {label: "Enabled", type: "bool", value: wf.enabled !== false, set: function (v) { opts.edit(function (w) { w.enabled = v; }, {refresh: false}); }});
      var adv = section(host, "Run behaviour");
      field(adv, {label: "Workflow timeout (s)", type: "number", value: wf.timeout, set: set("timeout")});
      field(adv, {label: "On step error", type: "select", value: wf.on_error || "stop", options: ["stop", "continue"],
        set: function (v) { opts.edit(function (w) { if (v === "continue") w.on_error = "continue"; else delete w.on_error; }, {refresh: false}); }});
      field(adv, {label: "Queue tool calls when an app is offline", type: "bool", value: !!wf.queue_offline, set: set("queue_offline")});
      field(adv, {label: "Disable after N consecutive failures", type: "number", value: wf.error_budget, set: set("error_budget"),
        help: "only for scheduled / event runs"});
      var notes = section(host, "Notes");
      var ann = wf.annotations || {};
      field(notes, {label: "Author", value: ann.author, set: function (v) { opts.edit(function (w) { w.annotations = Object.assign({}, w.annotations, {author: v}); }, {refresh: false}); }});
      field(notes, {label: "Notes", type: "area", rows: 5, value: ann.notes, set: function (v) { opts.edit(function (w) { w.annotations = Object.assign({}, w.annotations, {notes: v}); }, {refresh: false}); }});
      var iss = M.issues(wf);
      if (iss.length) {
        var box = section(host, "Problems (" + iss.length + ")");
        iss.forEach(function (i) {
          var li = el("div", "wf-issue wf-issue-" + i.level, (i.path.length ? "step " + M.pathKey(i.path) + ": " : "") + i.message);
          li.addEventListener("click", function () { if (i.path.length) opts.select({type: "step", path: i.path}); });
          box.appendChild(li);
        });
      }
    }

    // ── triggers ─────────────────────────────────────────────────────────────
    function renderTrigger(index) {
      var wf = opts.getWf(), t = wf.triggers[index];
      host.replaceChildren();
      if (!t) { renderWorkflow(); return; }
      host.appendChild(el("h3", null, "Trigger"));
      var upd = function (patch, refresh) {
        opts.edit(function (w) { Object.keys(patch).forEach(function (k) { if (patch[k] === undefined || patch[k] === "") delete w.triggers[index][k]; else w.triggers[index][k] = patch[k]; }); }, {refresh: refresh !== false});
      };
      field(host, {label: "Type", type: "select", value: t.type, options: M.TRIGGER_TYPES, set: function (v) {
        opts.edit(function (w) { var old = w.triggers[index]; w.triggers[index] = {type: v}; if (old.enabled === false) w.triggers[index].enabled = false; }, {refresh: true});
      }});
      field(host, {label: "Enabled", type: "bool", value: t.enabled !== false, set: function (v) { upd({enabled: v ? undefined : false}, false); }});
      if (t.type === "manual") {
        var sec = section(host, "Inputs asked when run by hand");
        (t.inputs || []).forEach(function (inp, i) {
          var r = el("div", "wf-inline");
          var name = el("input", null, null, {type: "text", placeholder: "name"}); name.value = inp.name || "";
          var def = el("input", null, null, {type: "text", placeholder: "default"}); def.value = show(inp.default);
          var rm = el("button", "wf-x", "×", {type: "button", title: "remove"});
          var save = function () { opts.edit(function (w) { var a = w.triggers[index].inputs[i]; a.name = name.value.trim(); if (def.value !== "") a.default = parseLoose(def.value, "string"); else delete a.default; }, {refresh: false}); };
          name.addEventListener("change", save); def.addEventListener("change", save);
          rm.addEventListener("click", function () { opts.edit(function (w) { w.triggers[index].inputs.splice(i, 1); if (!w.triggers[index].inputs.length) delete w.triggers[index].inputs; }, {refresh: true}); });
          r.appendChild(name); r.appendChild(def); r.appendChild(rm); sec.appendChild(r);
        });
        button(sec, "+ input", function () { opts.edit(function (w) { var tr = w.triggers[index]; tr.inputs = (tr.inputs || []).concat([{name: "input" + ((tr.inputs || []).length + 1)}]); }, {refresh: true}); });
        sec.appendChild(el("small", "wf-help", "Used as {{inputs.<name>}} in any step."));
      } else if (t.type === "schedule") {
        var presets = [{value: "", label: "Custom…"}].concat(M.CRON_PRESETS.map(function (p) { return {value: p[1], label: p[0]}; }));
        var cur = M.CRON_PRESETS.some(function (p) { return p[1] === t.cron; }) ? t.cron : "";
        field(host, {label: "Preset", type: "select", value: cur, options: presets, set: function (v) { if (v) upd({cron: v}); }});
        var cron = field(host, {label: "Cron (min hour day month weekday)", value: t.cron, hint: "*/10 * * * *", set: function (v) { upd({cron: v}); }});
        var info = el("div", "wf-help");
        host.appendChild(info);
        if (t.cron) opts.api.tr("cron_preview", {cron: t.cron, count: 4}).then(function (r) {
          info.textContent = r.valid ? r.human + " - next: " + (r.next || []).join(" · ") : "invalid: " + r.error;
          info.classList.toggle("wf-bad", !r.valid);
        });
        void cron;
      } else if (t.type === "event" || t.type === "file_watch") {
        var evbox = el("div");
        host.appendChild(evbox);
        opts.api.tr("events_available", {}).then(function (r) {
          var evs = r.events || [];
          var current = evs.findIndex(function (e) { return e.channel === t.channel && (e.event === t.event || e.event === "*" && !t.event); });
          field(evbox, {label: "Known event", type: "select", value: String(current), options: [{value: "-1", label: "Custom…"}].concat(evs.map(function (e, i) {
            return {value: String(i), label: e.channel + ":" + e.event + (e.description ? " - " + e.description : "")}; })),
            set: function (v) { var e = evs[Number(v)]; if (e) upd({channel: e.channel, event: e.event === "*" ? undefined : e.event}); }});
          var e = evs[current];
          if (e && e.fields && e.fields.length) {
            var chips = el("div", "wf-chips");
            chips.appendChild(el("small", null, "available: "));
            e.fields.forEach(function (f) { var c = el("code", "wf-chip", "{{trigger." + f + "}}"); c.title = "click to copy"; c.addEventListener("click", function () { if (navigator.clipboard) navigator.clipboard.writeText(c.textContent); opts.toast("copied " + c.textContent); }); chips.appendChild(c); });
            evbox.appendChild(chips);
          }
        });
        field(host, {label: "Channel", value: t.channel || (t.type === "file_watch" ? "files" : ""), set: function (v) { upd({channel: v}, false); }});
        field(host, {label: "Event (blank = any)", value: t.event, set: function (v) { upd({event: v}, false); }});
        field(host, {label: "Only when", value: t.condition, hint: "trigger.subject == 'urgent'", set: function (v) { upd({condition: v}, false); },
          help: "a condition over {{trigger.<field>}}"});
      } else if (t.type === "webhook") {
        field(host, {label: "Path / name", value: t.path, hint: "/" + (wf.name || "flow"), set: function (v) { upd({path: v}, false); }});
        host.appendChild(el("small", "wf-help", "Fire it with POST /v1/apps/platform/tool_runner/fire {workflow, data, confirm:true}; data becomes {{trigger}}."));
      }
      var rm = el("div", "wf-actions");
      button(rm, "Remove trigger", function () { opts.edit(function (w) { w.triggers.splice(index, 1); }, {refresh: true, clearSelection: true}); }, "wf-danger");
      host.appendChild(rm);
    }

    // ── steps ────────────────────────────────────────────────────────────────
    function renderStep(path) {
      var wf = opts.getWf(), step = M.getStep(wf, path);
      host.replaceChildren();
      if (!step) { renderWorkflow(); return; }
      var k = M.kind(step);
      host.appendChild(el("h3", null, (M.KINDS[k] || {}).label || k));
      var upd = function (patch, refresh) {
        opts.edit(function (w) { M.setStep(w, path, patch); }, {refresh: !!refresh});
      };
      field(host, {label: "Step type", type: "select", value: k, options: M.KIND_ORDER.map(function (x) { return {value: x, label: M.KINDS[x].label}; }),
        set: function (v) { if (v !== k) opts.edit(function (w) { M.replaceKind(w, path, v); }, {refresh: true}); }});
      var P = path;
      var f = function (spec) { spec.path = P; return field(host, spec); };

      if (k === "tool") {
        field(host, {label: "Tool", value: step.tool, hint: "<group>/<app>.<op>", set: function (v) { upd({tool: v}, true); }, help: "search the Tools tab on the left and click, or type an id"});
        var pbox = section(host, "Parameters");
        schemaFor(step.tool).then(function (info) {
          var params = (info && info.params) || {}, have = step.params || {};
          var setP = function (key, type) { return function (v) {
            opts.edit(function (w) { var s = M.getStep(w, P); s.params = s.params || {};
              var val = type === "bool" || type === "number" || type === "json" ? v : v;
              if (val === undefined || val === "") delete s.params[key]; else s.params[key] = (typeof val === "string" && type !== "string") ? parseLoose(val, type) : val; }, {refresh: false}); }; };
          if (info) host.insertBefore(el("p", "wf-help", info.description || ""), pbox.nextSibling);
          Object.keys(params).forEach(function (key) {
            var type = typeOfHint(params[key]);
            field(pbox, {label: key, type: type === "boolean" ? "bool" : type === "json" ? "json" : type === "number" ? "text" : "text", value: have[key],
              hint: params[key], ref: true, path: P, set: setP(key, type === "boolean" ? "bool" : type)});
          });
          Object.keys(have).filter(function (x) { return !(x in params); }).forEach(function (key) {
            field(pbox, {label: key + " (custom)", value: have[key], ref: true, path: P, set: setP(key, typeof have[key] === "object" ? "json" : "string")});
          });
          button(pbox, "+ parameter", function () {
            var name = window.prompt("Parameter name"); if (!name) return;
            opts.edit(function (w) { var s = M.getStep(w, P); s.params = s.params || {}; s.params[name] = ""; }, {refresh: true});
          });
          if (info && info.safety !== "read_only") pbox.appendChild(el("small", "wf-help wf-warnbox", "This tool is " + info.safety + ": add a confirm=true parameter, otherwise it only returns a preview."));
        });
      } else if (k === "llm") {
        f({label: "Prompt", type: "area", rows: 6, value: step.prompt, ref: true, set: function (v) { upd({prompt: v}); }});
        f({label: "Backend", value: step.backend, set: function (v) { upd({backend: v}); }});
        f({label: "Model", value: step.model, set: function (v) { upd({model: v}); }});
        f({label: "Tool scope (comma)", value: (step.scope || []).join(", "), hint: "knowledge/workspace_rag, file/vfs",
          set: function (v) { var l = String(v).split(",").map(function (x) { return x.trim(); }).filter(Boolean); upd({scope: l.length ? l : undefined}); }, help: "lets the model call these tools"});
      } else if (k === "agent") {
        var agSel = f({label: "Agent", value: step.agent, set: function (v) { upd({agent: v}); }});
        opts.api.tr("agents", {}).then(function (r) { var dl = el("datalist", null, null, {id: "wf-agents"}); (r.agents || []).forEach(function (a) { dl.appendChild(el("option", null, null, {value: a.name})); }); agSel.setAttribute("list", "wf-agents"); host.appendChild(dl); });
        f({label: "Input", type: "area", value: step.input, ref: true, set: function (v) { upd({input: v}); }});
      } else if (k === "http") {
        f({label: "Method", type: "select", value: step.method || "GET", options: ["GET", "POST", "PUT", "PATCH", "DELETE"], set: function (v) { upd({method: v}); }});
        f({label: "URL", value: step.url, ref: true, set: function (v) { upd({url: v}); }});
        f({label: "Headers", type: "json", value: step.headers, set: function (v) { upd({headers: v}); }});
        f({label: "Body", type: "json", value: step.body, ref: true, set: function (v) { upd({body: v}); }});
        f({label: "Treat HTTP errors as success", type: "bool", value: !!step.allow_http_error, set: function (v) { upd({allow_http_error: v || undefined}); }});
      } else if (k === "notify") {
        f({label: "Title", value: step.title, ref: true, set: function (v) { upd({title: v}); }});
        f({label: "Message", type: "area", value: step.message, ref: true, set: function (v) { upd({message: v}); }});
        f({label: "Level", type: "select", value: step.level || "info", options: ["info", "warning", "error", "action"], set: function (v) { upd({level: v}); }});
      } else if (k === "sub_workflow") {
        var wfIn = f({label: "Workflow", value: step.workflow, set: function (v) { upd({workflow: v}); }});
        opts.api.tr("flows", {}).then(function (r) { var dl = el("datalist", null, null, {id: "wf-flows"}); (r.flows || []).forEach(function (a) { dl.appendChild(el("option", null, null, {value: a.name})); }); wfIn.setAttribute("list", "wf-flows"); host.appendChild(dl); });
        f({label: "Inputs", type: "json", value: step.inputs, ref: true, set: function (v) { upd({inputs: v}); }});
      } else if (k === "map_reduce") {
        f({label: "Over", value: step.over, ref: true, set: function (v) { upd({over: v}); }});
        f({label: "Tool", value: step.tool, set: function (v) { upd({tool: v}); }});
        f({label: "Item parameter", value: step.param, set: function (v) { upd({param: v}); }});
        f({label: "Other parameters", type: "json", value: step.params, ref: true, set: function (v) { upd({params: v}); }});
        f({label: "Reduce", type: "select", value: step.reduce || "collect", options: ["collect", "count", "first", "join", "sum", "flatten"], set: function (v) { upd({reduce: v}); }});
        f({label: "Concurrency", type: "number", value: step.max_concurrency, set: function (v) { upd({max_concurrency: v}); }});
        f({label: "Allow partial failure", type: "bool", value: !!step.allow_partial, set: function (v) { upd({allow_partial: v || undefined}); }});
      } else if (k === "condition") {
        f({label: "Condition", value: step.condition, ref: true, hint: "last.ok == true", set: function (v) { upd({condition: v}); },
          help: "truthy expression over last / steps.<id> / vars / inputs. Use == != < > and or not"});
      } else if (k === "switch") {
        f({label: "Expression", value: step.expression, ref: true, set: function (v) { upd({expression: v}); }});
        host.appendChild(el("small", "wf-help", "Cases: " + Object.keys(step.cases || {}).join(", ") + " - add more with “+ case” on the node."));
      } else if (k === "loop") {
        f({label: "Items", value: step.items, ref: true, set: function (v) { upd({items: v}); }, help: "a list; each pass sees {{item}} and {{index}}"});
        f({label: "Variable name", value: step.as, hint: "item", set: function (v) { upd({as: v}); }});
        f({label: "Max iterations", type: "number", value: step.max, set: function (v) { upd({max: v}); }});
      } else if (k === "parallel") {
        f({label: "Max concurrency", type: "number", value: step.max_concurrency, set: function (v) { upd({max_concurrency: v}); }});
        f({label: "Allow partial failure", type: "bool", value: !!step.allow_partial, set: function (v) { upd({allow_partial: v || undefined}); }});
      } else if (k === "try_catch") {
        f({label: "Has a finally block", type: "bool", value: !!step.finally, set: function (v) {
          opts.edit(function (w) { var s = M.getStep(w, P); if (v) s.finally = s.finally || []; else delete s.finally; }, {refresh: true}); }});
      } else if (k === "delay") {
        f({label: "Seconds", type: "number", value: step.seconds, set: function (v) { upd({seconds: v}); }});
      } else if (k === "set_variable") {
        f({label: "Variable", value: step.name, set: function (v) { upd({name: v}); }, help: "read it back as {{vars.<name>}}"});
        f({label: "Value", type: "area", value: step.value, ref: true, set: function (v) { upd({value: v}); }});
      } else if (k === "transform_string" || k === "transform_array") {
        var ops = k === "transform_string" ? M.STRING_OPS : M.ARRAY_OPS;
        f({label: "Input", value: step.input, ref: true, set: function (v) { upd({input: v}); }});
        f({label: "Operation", type: "select", value: step.operation, options: ops, set: function (v) { upd({operation: v}, true); }});
        f({label: "Argument", value: step.arg, hint: M.OP_HINTS[step.operation] || "", ref: true, set: function (v) { upd({arg: v}); }});
      } else if (k === "approval" || k === "input" || k === "prompt") {
        f({label: "Message", type: "area", value: step.message, ref: true, set: function (v) { upd({message: v}); }});
        if (k === "input") f({label: "Store answer in variable", value: step.field, set: function (v) { upd({field: v}); }});
        if (k !== "approval") f({label: "Default", value: step.default, set: function (v) { upd({default: v}); }});
        f({label: "Wait at most (s)", type: "number", value: step.timeout, set: function (v) { upd({timeout: v}); }});
      } else if (k === "output") {
        f({label: "Title", value: step.title, ref: true, set: function (v) { upd({title: v}); }});
        f({label: "Content", type: "area", value: step.content, ref: true, set: function (v) { upd({content: v}); }});
      } else if (k === "note") {
        f({label: "Text", type: "area", rows: 5, value: step.text, set: function (v) { upd({text: v}); }});
      }

      if (k !== "note") {
        var com = section(host, "Options");
        field(com, {label: "Step id", value: step.id, hint: "referenced as {{steps.<id>}}", set: function (v) {
          var vv = String(v || "").trim();
          if (vv && M.flatten(opts.getWf()).some(function (n) { return n.step.id === vv && M.pathKey(n.path) !== M.pathKey(P); })) { opts.toast("id already used", true); return; }
          upd({id: vv}, false); }});
        field(com, {label: "Label", value: step._label, set: function (v) { upd({_label: v}); }});
        field(com, {label: "Run only when", value: step.when, ref: true, path: P, hint: "vars.mode == 'full'", set: function (v) { upd({when: v}); }});
        field(com, {label: "Timeout (s)", type: "number", value: step.timeout, set: function (v) { upd({timeout: v}); }});
        var rc = step.retry || {};
        field(com, {label: "Retries", type: "number", value: rc.count, set: function (v) {
          opts.edit(function (w) { var s = M.getStep(w, P); if (v && v > 1) s.retry = Object.assign({}, s.retry, {count: v}); else delete s.retry; }, {refresh: false}); }});
        field(com, {label: "Continue on error", type: "bool", value: step.on_error === "continue", set: function (v) { upd({on_error: v ? "continue" : undefined}); }});
        field(com, {label: "Breakpoint (pause before)", type: "bool", value: !!step._breakpoint, set: function (v) { upd({_breakpoint: v ? true : undefined}); }});
        if (k === "tool") field(com, {label: "Queue if the app is offline", type: "bool", value: !!step.queue_offline, set: function (v) { upd({queue_offline: v || undefined}); }});
        if (["tool", "llm", "agent", "http", "sub_workflow", "map_reduce", "transform_string", "transform_array"].indexOf(k) >= 0)
          field(com, {label: "Save result as variable", value: step.save_as, set: function (v) { upd({save_as: v}); }});
        var out = M.flatten(wf).length;
        void out;
        if (step.id) com.appendChild(el("small", "wf-help", "Later steps can use {{steps." + step.id + "}} or {{steps." + step.id + ".<field>}}."));
        else com.appendChild(el("small", "wf-help", "No id yet - the “insert” pickers assign one automatically when needed."));
      }
      var info = opts.runInfo ? opts.runInfo(M.pathKey(path)) : null;
      if (info) {
        var rs = section(host, "Last run: " + info.status + (info.duration_ms != null ? " · " + Math.round(info.duration_ms) + " ms" : ""));
        if (info.error) rs.appendChild(el("pre", "wf-json wf-bad", info.error));
        if (info.input !== undefined) { rs.appendChild(el("small", null, "In")); rs.appendChild(el("pre", "wf-json", JSON.stringify(info.input, null, 2))); }
        if (info.result !== undefined) { rs.appendChild(el("small", null, "Out")); rs.appendChild(el("pre", "wf-json", JSON.stringify(info.result, null, 2).slice(0, 4000))); }
        if (info.unresolved && info.unresolved.length) rs.appendChild(el("div", "wf-issue wf-issue-warning", "unresolved references: " + info.unresolved.join(", ")));
      }
      var act = el("div", "wf-actions");
      button(act, "Duplicate", function () { opts.act("duplicate", path); });
      button(act, "Delete step", function () { opts.act("delete", path); }, "wf-danger");
      host.appendChild(act);
    }

    function render(sel) {
      if (!sel) renderWorkflow();
      else if (sel.type === "trigger") renderTrigger(sel.index);
      else renderStep(sel.path);
    }
    return {render: render};
  }

  root.WFInspector = {create: create};
})(window);
