// WFModel - the workflow editor's DOM-free core: step kinds, path addressing, edits, undo/redo,
// references (wires), previous-output pickers, light validation and a line diff. Pure functions
// over plain JSON so it is unit-tested in node (tests/wf_model.test.js).
//
// EDITOR PATHS are arrays: [2] a top-level step; [2,"then",0] inside a condition's then-branch;
// [3,"cases","admin",0]; [4,"branches",1,0]; [5,"steps",0]; [6,"try",0]. A LIST path addresses a list of
// steps: [] is wf.steps, [2,"then"] is step 2's then list. pathKey() joins with "/".
(function (root) {
  "use strict";

  // ── step kinds ─────────────────────────────────────────────────────────────
  var KINDS = {
    tool:             {label: "Tool call",        icon: "🔧", group: "Actions",  make: function () { return {type: "tool", tool: "", params: {}}; }},
    llm:              {label: "LLM prompt",       icon: "✨", group: "Actions",  make: function () { return {type: "llm", prompt: ""}; }},
    agent:            {label: "Agent",            icon: "🤖", group: "Actions",  make: function () { return {type: "agent", agent: "", input: "{{last}}"}; }},
    http:             {label: "HTTP request",     icon: "🌐", group: "Actions",  make: function () { return {type: "http", method: "GET", url: ""}; }},
    notify:           {label: "Notify",           icon: "🔔", group: "Actions",  make: function () { return {type: "notify", title: "", message: ""}; }},
    sub_workflow:     {label: "Sub-workflow",     icon: "↪", group: "Actions",  make: function () { return {type: "sub_workflow", workflow: "", inputs: {}}; }},
    map_reduce:       {label: "Map / reduce",     icon: "⇉", group: "Actions",  make: function () { return {type: "map_reduce", over: "{{last}}", tool: "", param: "item", reduce: "collect"}; }},
    condition:        {label: "Condition",        icon: "⑂", group: "Logic",    make: function () { return {type: "condition", condition: "last.ok == true", then: [], else: []}; }},
    switch:           {label: "Switch / case",    icon: "⇶", group: "Logic",    make: function () { return {type: "switch", expression: "{{last}}", cases: {default: []}}; }},
    loop:             {label: "Loop (for each)",  icon: "⟳", group: "Logic",    make: function () { return {type: "loop", items: "{{last}}", steps: []}; }},
    parallel:         {label: "Parallel",         icon: "∥", group: "Logic",    make: function () { return {type: "parallel", branches: [[], []]}; }},
    try_catch:        {label: "Try / catch",      icon: "🛡", group: "Logic",    make: function () { return {type: "try_catch", try: [], catch: []}; }},
    group:            {label: "Group",            icon: "▣", group: "Logic",    make: function () { return {type: "group", steps: []}; }},
    delay:            {label: "Delay",            icon: "⏱", group: "Logic",    make: function () { return {type: "delay", seconds: 5}; }},
    set_variable:     {label: "Set variable",     icon: "𝑥", group: "Data",     make: function () { return {type: "set_variable", name: "", value: ""}; }},
    transform_string: {label: "Transform text",   icon: "Aa", group: "Data",    make: function () { return {type: "transform_string", operation: "trim", input: "{{last}}", arg: ""}; }},
    transform_array:  {label: "Transform list",   icon: "[ ]", group: "Data",   make: function () { return {type: "transform_array", operation: "first", input: "{{last}}", arg: ""}; }},
    approval:         {label: "Approval gate",    icon: "✋", group: "Human",    make: function () { return {type: "approval", message: "Approval required"}; }},
    input:            {label: "Ask for input",    icon: "⌨", group: "Human",    make: function () { return {type: "input", message: "Enter value", field: "user_input"}; }},
    prompt:           {label: "Confirm prompt",   icon: "❓", group: "Human",    make: function () { return {type: "prompt", message: "Continue?"}; }},
    output:           {label: "Show output",      icon: "📄", group: "Human",    make: function () { return {type: "output", title: "Result", content: "{{last}}"}; }},
    note:             {label: "Note",             icon: "📝", group: "Human",    make: function () { return {type: "note", text: ""}; }}
  };
  var KIND_ORDER = ["tool", "llm", "agent", "http", "notify", "sub_workflow", "map_reduce", "condition", "switch", "loop",
                    "parallel", "try_catch", "group", "delay", "set_variable", "transform_string", "transform_array",
                    "approval", "input", "prompt", "output", "note"];
  var STRING_OPS = ["truncate", "uppercase", "lowercase", "trim", "replace", "split", "prepend", "append", "extract_regex",
                    "extract_regex_all", "template", "json_path", "parse_json", "format_date", "math", "substring",
                    "pad_left", "pad_right", "base64_encode", "base64_decode", "url_encode", "length"];
  var ARRAY_OPS = ["first", "last", "count", "slice", "filter", "map", "join", "sort", "reverse", "unique", "flatten", "sum"];
  var OP_HINTS = {truncate: "20", replace: "old|new", split: ",", prepend: "text", append: "text", extract_regex: "(\\d+)",
                  json_path: "a.b.0", format_date: "%Y-%m-%d", substring: "0:5", pad_left: "8|0", slice: "0:5",
                  filter: "field==value", map: "field", join: ", ", sort: "field", sum: "field", template: "Hello {{last}}"};
  var TRIGGER_TYPES = ["manual", "schedule", "event", "file_watch", "webhook"];
  var CRON_PRESETS = [
    ["Every 10 minutes", "*/10 * * * *"], ["Every hour", "0 * * * *"], ["Weekdays at 9:00", "0 9 * * 1-5"],
    ["Daily at 9:00", "0 9 * * *"], ["Daily at midnight", "0 0 * * *"], ["Weekly (Monday 9:00)", "0 9 * * 1"],
    ["Monthly (1st, 00:00)", "0 0 1 * *"]];

  function kind(step) { return (step && step.type) || "tool"; }
  function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
  function isList(a) { return Array.isArray(a); }

  // child lists a step owns: [{key: path-segments-after-the-step, label, list}]
  function slots(step) {
    var k = kind(step), out = [];
    if (k === "condition") {
      out.push({path: ["then"], label: "Then", list: step.then || (step.then = [])});
      out.push({path: ["else"], label: "Else", list: step.else || (step.else = [])});
    } else if (k === "loop" || k === "group") {
      out.push({path: ["steps"], label: k === "loop" ? "For each item" : "Steps", list: step.steps || (step.steps = [])});
    } else if (k === "try_catch") {
      out.push({path: ["try"], label: "Try", list: step.try || (step.try = [])});
      out.push({path: ["catch"], label: "Catch", list: step.catch || (step.catch = [])});
      if (step.finally) out.push({path: ["finally"], label: "Finally", list: step.finally});
    } else if (k === "switch") {
      step.cases = step.cases || {default: []};
      Object.keys(step.cases).forEach(function (c) { out.push({path: ["cases", c], label: "Case " + c, list: step.cases[c]}); });
    } else if (k === "parallel") {
      step.branches = isList(step.branches) ? step.branches : [[], []];
      step.branches.forEach(function (b, i) { out.push({path: ["branches", i], label: "Branch " + (i + 1), list: b}); });
    }
    return out;
  }
  function isContainer(step) { return ["condition", "loop", "group", "try_catch", "switch", "parallel"].indexOf(kind(step)) >= 0; }

  // ── paths ──────────────────────────────────────────────────────────────────
  function pathKey(p) { return (p || []).join("/"); }
  function parseKey(s) { return s === "" || s == null ? [] : String(s).split("/").map(function (x) { return /^\d+$/.test(x) ? Number(x) : x; }); }
  function sameList(a, b) { return pathKey(a) === pathKey(b); }
  function startsWith(p, prefix) { return pathKey(prefix) === "" || pathKey(p) === pathKey(prefix) || pathKey(p).indexOf(pathKey(prefix) + "/") === 0; }

  // the list array addressed by a LIST path ([] = wf.steps)
  function listAt(wf, lp) {
    var cur = wf.steps = wf.steps || [];
    var i = 0;
    while (i < lp.length) {
      var step = cur[lp[i]];
      if (!step) return null;
      var key = lp[i + 1];
      if (key === "cases" || key === "branches") {
        var sub = lp[i + 2];
        step[key] = step[key] || (key === "cases" ? {} : []);
        cur = step[key][sub];
        i += 3;
      } else {
        step[key] = step[key] || [];
        cur = step[key];
        i += 2;
      }
      if (!isList(cur)) return null;
    }
    return cur;
  }
  function parentList(p) { return p.slice(0, -1); }
  function getStep(wf, p) {
    var l = listAt(wf, parentList(p));
    return l ? l[p[p.length - 1]] || null : null;
  }

  // engine run-record path ("2.then.0", "3.case.admin.0", "4.branch.1.0", "5.loop.2.1") -> editor path
  function fromEnginePath(s) {
    var t = String(s).split("."), out = [], i = 0;
    while (i < t.length) {
      var x = t[i];
      if (/^\d+$/.test(x)) { out.push(Number(x)); i++; continue; }
      if (x === "case") { out.push("cases", t[i + 1]); i += 2; continue; }
      if (x === "branch") { out.push("branches", Number(t[i + 1])); i += 2; continue; }
      if (x === "loop") { out.push("steps"); i += 2; continue; }       // skip the iteration index
      out.push(x); i++;
    }
    return out;
  }

  // ── traversal ──────────────────────────────────────────────────────────────
  // document order: [{path, step, depth}]
  function flatten(wf) {
    var out = [];
    (function walk(list, base, depth) {
      (list || []).forEach(function (s, i) {
        var p = base.concat([i]);
        out.push({path: p, step: s, depth: depth});
        slots(s).forEach(function (sl) { walk(sl.list, p.concat(sl.path), depth + 1); });
      });
    })(wf.steps || [], [], 0);
    return out;
  }
  function allIds(wf) { return flatten(wf).map(function (n) { return n.step.id; }).filter(Boolean); }
  function newId(wf, base) {
    var used = {}; allIds(wf).forEach(function (i) { used[i] = 1; });
    var n = 1, stem = String(base || "step").replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "step";
    while (used[stem + (n > 1 ? "_" + n : "")]) n++;
    return stem + (n > 1 ? "_" + n : "");
  }
  function ensureId(wf, p) {
    var s = getStep(wf, p);
    if (s && !s.id) s.id = newId(wf, s.type === "tool" ? (String(s.tool || "").split(".").pop() || "tool") : kind(s));
    return s && s.id;
  }

  // ── edits (all mutate wf in place; callers snapshot with History first) ─────
  function insertStep(wf, lp, index, step) {
    var l = listAt(wf, lp);
    if (!l) return null;
    var i = Math.max(0, Math.min(index == null ? l.length : index, l.length));
    l.splice(i, 0, step);
    return lp.concat([i]);
  }
  function removeStep(wf, p) {
    var l = listAt(wf, parentList(p));
    if (!l) return null;
    return l.splice(p[p.length - 1], 1)[0];
  }
  // move a step to (list, index); false when the target is inside the moved step
  function moveStep(wf, p, toList, toIndex) {
    if (startsWith(toList, p)) return false;
    var fromList = parentList(p), fromIdx = p[p.length - 1];
    var step = removeStep(wf, p);
    if (!step) return false;
    // removing shifted later siblings of the same list (and any path through them)
    var adj = toList.slice();
    if (adj.length > fromList.length && sameList(adj.slice(0, fromList.length), fromList) && typeof adj[fromList.length] === "number"
        && adj[fromList.length] > fromIdx) adj[fromList.length]--;
    var idx = toIndex;
    if (sameList(fromList, toList) && toIndex > fromIdx) idx = toIndex - 1;
    return !!insertStep(wf, adj, idx, step);
  }
  function duplicateStep(wf, p) {
    var s = getStep(wf, p);
    if (!s) return null;
    var c = clone(s);
    delete c.id;
    return insertStep(wf, parentList(p), p[p.length - 1] + 1, c);
  }
  // merge two sibling steps into one parallel step (v1: shift-drop)
  function mergeParallel(wf, a, b) {
    var l = listAt(wf, parentList(a));
    if (!l || !sameList(parentList(a), parentList(b))) return null;
    var ia = a[a.length - 1], ib = b[b.length - 1];
    var sa = l[ia], sb = l[ib];
    if (!sa || !sb || ia === ib) return null;
    var lo = Math.min(ia, ib), hi = Math.max(ia, ib);
    var par = {type: "parallel", branches: [[ia < ib ? sa : sb], [ia < ib ? sb : sa]]};
    l.splice(hi, 1);
    l.splice(lo, 1, par);
    return parentList(a).concat([lo]);
  }
  // wrap a step and the next into a group / dissolve a group
  function groupWithNext(wf, p) {
    var l = listAt(wf, parentList(p)), i = p[p.length - 1];
    if (!l || i + 1 >= l.length) return null;
    var g = {type: "group", steps: [l[i], l[i + 1]]};
    l.splice(i, 2, g);
    return p;
  }
  function ungroup(wf, p) {
    var l = listAt(wf, parentList(p)), s = getStep(wf, p);
    if (!l || !s || kind(s) !== "group") return null;
    l.splice.apply(l, [p[p.length - 1], 1].concat(s.steps || []));
    return p;
  }
  function addCase(wf, p, name) {
    var s = getStep(wf, p);
    if (!s || kind(s) !== "switch" || !name || (s.cases || {})[name]) return false;
    s.cases = s.cases || {};
    s.cases[name] = [];
    return true;
  }
  function addBranch(wf, p) {
    var s = getStep(wf, p);
    if (!s || kind(s) !== "parallel") return false;
    s.branches = s.branches || [];
    s.branches.push([]);
    return true;
  }
  function removeSlot(wf, p, segs) {
    var s = getStep(wf, p);
    if (!s) return false;
    if (segs[0] === "cases") { delete s.cases[segs[1]]; return true; }
    if (segs[0] === "branches") { s.branches.splice(segs[1], 1); return true; }
    return false;
  }
  function setStep(wf, p, patch) {
    var s = getStep(wf, p);
    if (!s) return null;
    Object.keys(patch).forEach(function (k) {
      if (patch[k] === undefined || patch[k] === "" || patch[k] === null) delete s[k]; else s[k] = patch[k];
    });
    return s;
  }
  function replaceKind(wf, p, type) {
    var s = getStep(wf, p), fresh = KINDS[type].make();
    if (!s) return null;
    ["id", "when", "timeout", "retry", "on_error", "_breakpoint", "_label"].forEach(function (k) { if (s[k] !== undefined) fresh[k] = s[k]; });
    var l = listAt(wf, parentList(p));
    l[p[p.length - 1]] = fresh;
    return fresh;
  }

  // ── references / wires ─────────────────────────────────────────────────────
  var REF_RE = /\{\{\s*steps\.([A-Za-z0-9_\-]+)/g;
  function stringsIn(v, out) {
    if (typeof v === "string") out.push(v);
    else if (isList(v)) v.forEach(function (x) { stringsIn(x, out); });
    else if (v && typeof v === "object") Object.keys(v).forEach(function (k) { if (k !== "then" && k !== "else" && k !== "steps" && k !== "try" && k !== "catch" && k !== "finally" && k !== "cases" && k !== "branches") stringsIn(v[k], out); });
    return out;
  }
  // [{from: path-of-the-step-with-that-id, to: path-of-the-referencing-step, id}]
  function wires(wf) {
    var flat = flatten(wf), byId = {};
    flat.forEach(function (n) { if (n.step.id) byId[n.step.id] = n.path; });
    var out = [];
    flat.forEach(function (n) {
      var seen = {};
      stringsIn(n.step, []).forEach(function (s) {
        var m; REF_RE.lastIndex = 0;
        while ((m = REF_RE.exec(s))) {
          if (byId[m[1]] && !seen[m[1]]) { seen[m[1]] = 1; out.push({from: byId[m[1]], to: n.path, id: m[1]}); }
        }
      });
    });
    return out;
  }
  // what a field of the step at `p` can reference: trigger inputs, earlier steps (document order), variables, loop item
  function previousOutputs(wf, p) {
    var out = [], key = pathKey(p);
    ((wf.triggers || []).forEach(function (t) {
      (t.inputs || []).forEach(function (i) { if (i && i.name) out.push({ref: "{{inputs." + i.name + "}}", label: "input · " + i.name}); });
      if (t.type === "event" || t.type === "file_watch") out.push({ref: "{{trigger}}", label: "trigger payload"});
    }));
    out.push({ref: "{{last}}", label: "previous step result"});
    var inLoop = false;
    for (var i = 1; i < p.length; i++) { if (p[i] === "steps" && kind(getStep(wf, p.slice(0, i))) === "loop") inLoop = true; }
    if (inLoop) { out.push({ref: "{{item}}", label: "loop item"}); out.push({ref: "{{index}}", label: "loop index"}); }
    flatten(wf).forEach(function (n) {
      if (pathKey(n.path) === key) return;
      if (comparePaths(n.path, p) >= 0) return;
      if (startsWith(p, n.path)) return;                              // an ancestor container
      if (n.step.type === "set_variable" && n.step.name) out.push({ref: "{{vars." + n.step.name + "}}", label: "variable · " + n.step.name});
      if (["note", "condition", "switch", "group", "loop", "try_catch"].indexOf(kind(n.step)) >= 0 && kind(n.step) !== "loop") return;
      out.push({ref: n.step.id ? "{{steps." + n.step.id + "}}" : null, path: n.path, step: n.step,
                label: "step " + pathKey(n.path) + " · " + label(n.step)});
    });
    return out;
  }
  function comparePaths(a, b) {                                      // document order
    for (var i = 0; i < Math.min(a.length, b.length); i++) {
      var x = a[i], y = b[i];
      if (x === y) continue;
      if (typeof x === "number" && typeof y === "number") return x - y;
      return String(x) < String(y) ? -1 : 1;
    }
    return a.length - b.length;
  }

  // ── labels ─────────────────────────────────────────────────────────────────
  function label(s) {
    var k = kind(s);
    if (s._label) return s._label;
    if (k === "tool") return s.tool || "(choose a tool)";
    if (k === "agent") return "agent " + (s.agent || "?");
    if (k === "sub_workflow") return "run " + (s.workflow || "?");
    if (k === "set_variable") return "set " + (s.name || "?");
    if (k === "transform_string" || k === "transform_array") return (s.operation || "?") + (s.arg ? "(" + s.arg + ")" : "");
    return (KINDS[k] || {}).label || k;
  }
  function subtitle(s) {
    var k = kind(s), v;
    if (k === "tool") v = Object.keys(s.params || {}).map(function (x) { return x + "=" + short(s.params[x]); }).join(", ");
    else if (k === "condition") v = s.condition;
    else if (k === "switch") v = s.expression;
    else if (k === "loop") v = "over " + short(s.items);
    else if (k === "delay") v = s.seconds + " s";
    else if (k === "llm") v = s.prompt;
    else if (k === "http") v = (s.method || "GET") + " " + (s.url || "");
    else if (k === "set_variable") v = short(s.value);
    else if (k === "transform_string" || k === "transform_array") v = short(s.input);
    else if (k === "note") v = s.text;
    else if (k === "approval" || k === "input" || k === "prompt") v = s.message;
    else if (k === "output") v = s.title;
    else if (k === "notify") v = s.title || s.message;
    else if (k === "map_reduce") v = (s.tool || "?") + " over " + short(s.over);
    else if (k === "parallel") v = (s.branches || []).length + " branches";
    return String(v == null ? "" : v).slice(0, 90);
  }
  function short(v) { var t = typeof v === "string" ? v : JSON.stringify(v); return t == null ? "" : String(t).slice(0, 40); }
  function triggerLabel(t) {
    var ty = (t && t.type) || "manual";
    if (ty === "schedule") return {title: "Schedule", sub: t.cron || ""};
    if (ty === "event") return {title: "Event", sub: (t.channel || "?") + (t.event ? ":" + t.event : "")};
    if (ty === "file_watch") return {title: "File watch", sub: t.channel || "files"};
    if (ty === "webhook") return {title: "Webhook", sub: t.path || ""};
    return {title: "Manual", sub: (t.inputs || []).map(function (i) { return i.name; }).join(", ")};
  }

  // ── light validation (the server's validate op is authoritative) ────────────
  function issues(wf) {
    var out = [];
    if (!wf.name) out.push({path: [], level: "error", message: "the workflow needs a name"});
    if (!(wf.triggers || []).length) out.push({path: [], level: "warning", message: "no trigger (it can still be run by hand)"});
    var ids = {};
    flatten(wf).forEach(function (n) {
      var s = n.step, k = kind(s), p = n.path;
      if (!KINDS[k]) out.push({path: p, level: "error", message: "unknown step type " + k});
      if (s.id) { if (ids[s.id]) out.push({path: p, level: "error", message: "duplicate id " + s.id}); ids[s.id] = 1; }
      if (k === "tool" && !s.tool) out.push({path: p, level: "error", message: "choose a tool"});
      if (k === "condition" && !s.condition) out.push({path: p, level: "error", message: "empty condition"});
      if ((k === "transform_string" || k === "transform_array") && !s.operation) out.push({path: p, level: "error", message: "choose an operation"});
      if (k === "sub_workflow" && !s.workflow) out.push({path: p, level: "error", message: "choose a workflow"});
      if (k === "set_variable" && !s.name) out.push({path: p, level: "error", message: "name the variable"});
    });
    wires(wf);                                                         // (references to unknown ids are server-side warnings)
    return out;
  }

  // ── undo / redo ────────────────────────────────────────────────────────────
  function History(max) {
    this.max = max || 50; this.undoStack = []; this.redoStack = [];
  }
  History.prototype.push = function (wf) {                             // call BEFORE a mutation
    this.undoStack.push(JSON.stringify(wf));
    if (this.undoStack.length > this.max) this.undoStack.shift();
    this.redoStack = [];
  };
  History.prototype.undo = function (current) {
    if (!this.undoStack.length) return null;
    this.redoStack.push(JSON.stringify(current));
    return JSON.parse(this.undoStack.pop());
  };
  History.prototype.redo = function (current) {
    if (!this.redoStack.length) return null;
    this.undoStack.push(JSON.stringify(current));
    return JSON.parse(this.redoStack.pop());
  };
  History.prototype.can = function () { return {undo: this.undoStack.length > 0, redo: this.redoStack.length > 0}; };
  History.prototype.clear = function () { this.undoStack = []; this.redoStack = []; };

  // ── line diff (LCS) -> [{t: " "|"+"|"-", s}] ───────────────────────────────
  function lineDiff(a, b) {
    var x = String(a).split("\n"), y = String(b).split("\n"), n = x.length, m = y.length;
    var dp = [], i, j;
    for (i = 0; i <= n; i++) { dp.push(new Array(m + 1).fill(0)); }
    for (i = n - 1; i >= 0; i--) for (j = m - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    var out = []; i = 0; j = 0;
    while (i < n && j < m) {
      if (x[i] === y[j]) { out.push({t: " ", s: x[i]}); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({t: "-", s: x[i]}); i++; }
      else { out.push({t: "+", s: y[j]}); j++; }
    }
    while (i < n) out.push({t: "-", s: x[i++]});
    while (j < m) out.push({t: "+", s: y[j++]});
    return out;
  }

  function blank(name) {
    return {name: name || "new-flow", description: "", enabled: true, triggers: [{type: "manual"}], steps: []};
  }

  root.WFModel = {
    KINDS: KINDS, KIND_ORDER: KIND_ORDER, STRING_OPS: STRING_OPS, ARRAY_OPS: ARRAY_OPS, OP_HINTS: OP_HINTS,
    TRIGGER_TYPES: TRIGGER_TYPES, CRON_PRESETS: CRON_PRESETS, History: History,
    kind: kind, clone: clone, slots: slots, isContainer: isContainer,
    pathKey: pathKey, parseKey: parseKey, sameList: sameList, startsWith: startsWith, parentList: parentList,
    listAt: listAt, getStep: getStep, fromEnginePath: fromEnginePath, comparePaths: comparePaths,
    flatten: flatten, allIds: allIds, newId: newId, ensureId: ensureId,
    insertStep: insertStep, removeStep: removeStep, moveStep: moveStep, duplicateStep: duplicateStep,
    mergeParallel: mergeParallel, groupWithNext: groupWithNext, ungroup: ungroup, addCase: addCase, addBranch: addBranch,
    removeSlot: removeSlot, setStep: setStep, replaceKind: replaceKind,
    wires: wires, previousOutputs: previousOutputs, label: label, subtitle: subtitle, triggerLabel: triggerLabel,
    issues: issues, lineDiff: lineDiff, blank: blank
  };
  if (typeof module !== "undefined" && module.exports) module.exports = root.WFModel;
})(typeof window !== "undefined" ? window : this);
