// platform/tool_profiler - per-tool metrics / traces / slow calls / analytics (the v1 tools_profiler page).
// AppUI conventions: AppUI.createApp layout (left sidebar = tool tree, content = routed views, status bar),
// AppUIRouter for the URL (?view=overview|slow|analytics|tool&tool=<id>; back/forward work),
// AppUI.services.api.operation for every op call. Served at /apps/platform/tool_profiler/.
(function () {
  "use strict";
  var APP = "platform/tool_profiler", NS = "tool_profiler";
  var router = null, app = null, tree = null, body = null, top = null, timer = null, last = null;

  function op(name, args) {
    return AppUI.services.api.operation(APP, name, args || {}).then(function (r) {
      if (r && r.ok === false) throw new Error(r.error || r._error || "request failed");
      return r;
    });
  }
  function el(tag, text, cls) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function ms(v) { return v == null ? "" : v >= 1000 ? (v / 1000).toFixed(1) + " s" : (v < 10 ? v.toFixed(1) : Math.round(v)) + " ms"; }
  function when(t) { return t ? new Date(t * 1000).toLocaleTimeString() : ""; }
  function status(t) { if (app && app.setStatus) app.setStatus(t); }
  function table(host, columns, items, opts) {
    var box = el("div", null, "tp-table");
    host.appendChild(box);
    return AppUIDataTable.create(Object.assign({container: box, columns: columns, items: items, stickyHeader: true,
                                                maxRows: 500, empty: "Nothing recorded yet."}, opts || {}));
  }
  var toolCol = function (label) {
    return {id: "tool", label: label || "Tool", sortable: true, filterable: true, width: "330px",
            render: function (x, scope) {
              var a = el("a", x.tool); a.href = "?view=tool&tool=" + encodeURIComponent(x.tool);
              a.addEventListener("click", function (e) { e.preventDefault(); go("tool", x.tool); });
              return a;
            }};
  };

  // ── routing ──────────────────────────────────────────────────────────────────
  function go(view, tool) {
    router.set("view", view === "overview" ? "" : view, {silent: true});
    router.set("tool", view === "tool" ? tool : "", {silent: true});
    route();
  }
  function route() {
    clearTimeout(timer);
    var view = router.get("view") || "overview", tool = router.get("tool") || "";
    if (top) top.querySelectorAll("button[data-view]").forEach(function (b) { b.classList.toggle("on", b.dataset.view === view); });
    body.replaceChildren(el("p", "loading.", "tp-dim"));
    if (tree && tool) tree.setActive(tool);
    ({overview: viewOverview, slow: viewSlow, analytics: viewAnalytics, tool: viewTool}[view] || viewOverview)(tool);
  }

  // ── views ────────────────────────────────────────────────────────────────────
  function viewOverview() {
    var sort = router.get("sort") || "calls";
    op("metrics", {sort: sort}).then(function (r) {
      var m = r.metrics || {}, t = m.totals || {};
      body.replaceChildren();
      var head = el("div", null, "tp-head");
      head.appendChild(el("span", t.calls + " calls · " + t.errors + " errors · " + t.ops + " tools since " + when(m.since)));
      var sel = el("select");
      [["calls", "most called"], ["p95", "slowest (p95)"], ["avg", "slowest (avg)"], ["errors", "most errors"], ["last", "most recent"]].forEach(function (o) {
        var opt = el("option", "sort: " + o[1]); opt.value = o[0]; if (o[0] === sort) opt.selected = true; sel.appendChild(opt);
      });
      sel.addEventListener("change", function () { router.set("sort", sel.value === "calls" ? "" : sel.value, {silent: true}); route(); });
      head.appendChild(sel);
      body.appendChild(head);
      if (!t.calls) body.appendChild(el("p", "Nothing recorded yet - tool calls are counted from the host's start.", "tp-dim"));
      table(body, [toolCol(),
        {id: "calls", label: "Calls", sortable: true},
        {id: "errors", label: "Errors", sortable: true},
        {id: "error_rate", label: "Err %", sortable: true, render: function (x) { return (x.error_rate * 100).toFixed(1); }},
        {id: "avg_ms", label: "avg", sortable: true, render: function (x) { return ms(x.avg_ms); }},
        {id: "p50_ms", label: "p50", sortable: true, render: function (x) { return ms(x.p50_ms); }},
        {id: "p95_ms", label: "p95", sortable: true, render: function (x) { return ms(x.p95_ms); }},
        {id: "max_ms", label: "max", sortable: true, render: function (x) { return ms(x.max_ms); }},
        {id: "last_error", label: "Last error"}], m.tools || [], {getId: function (x) { return x.tool; }});
      status(t.ops + " tools");
      timer = setTimeout(route, 15000);
    }).catch(fail);
  }
  function viewSlow() {
    op("slow", {limit: 100}).then(function (r) {
      body.replaceChildren(el("p", "Calls slower than " + ms(r.slow_threshold_ms) + ", newest first.", "tp-dim"));
      table(body, [{id: "ts", label: "When", render: function (x) { return when(x.ts); }}, toolCol(),
        {id: "duration_ms", label: "Took", sortable: true, render: function (x) { return ms(x.duration_ms != null ? x.duration_ms : x.ms); }},
        {id: "status", label: "Status", filterable: true}, {id: "caller", label: "Caller", filterable: true}], r.slow_calls || []);
    }).catch(fail);
  }
  function viewAnalytics() {
    var hours = Number(router.get("hours") || 1);
    op("analytics", {hours: hours, top: 15}).then(function (r) {
      body.replaceChildren();
      var head = el("div", null, "tp-head"), sel = el("select");
      [1, 6, 24].forEach(function (h) { var o = el("option", "last " + h + " h"); o.value = String(h); if (h === hours) o.selected = true; sel.appendChild(o); });
      sel.addEventListener("change", function () { router.set("hours", sel.value === "1" ? "" : sel.value, {silent: true}); route(); });
      head.appendChild(sel);
      body.appendChild(head);
      var grid = el("div", null, "tp-cards");
      body.appendChild(grid);
      var lists = Object.keys(r).filter(function (k) { return Array.isArray(r[k]); });
      if (!lists.length) grid.appendChild(el("p", "No calls in this window.", "tp-dim"));
      lists.forEach(function (k) {
        var card = el("div", null, "tp-card");
        card.appendChild(el("h3", k.replace(/_/g, " ")));
        (r[k] || []).forEach(function (x) {
          var row = el("div", null, "tp-row");
          var a = el("a", x.tool || x.id || "?"); a.href = "#";
          a.addEventListener("click", function (e) { e.preventDefault(); go("tool", x.tool || x.id); });
          row.appendChild(a);
          row.appendChild(el("span", [x.calls != null ? x.calls + " calls" : "", x.errors ? x.errors + " errors" : "", x.avg_ms != null ? "avg " + ms(x.avg_ms) : ""].filter(Boolean).join(" · "), "tp-dim"));
          card.appendChild(row);
        });
        if (!(r[k] || []).length) card.appendChild(el("p", "-", "tp-dim"));
        grid.appendChild(card);
      });
    }).catch(fail);
  }
  function viewTool(tool) {
    if (!tool) { body.replaceChildren(el("p", "Pick a tool on the left.", "tp-dim")); return; }
    op("tool", {tool: tool, limit: 100}).then(function (r) {
      body.replaceChildren();
      var s = r.stats;
      body.appendChild(el("h2", tool));
      if (!s) body.appendChild(el("p", "No calls of this tool since the host started.", "tp-dim"));
      else {
        var kpi = el("div", null, "tp-kpis");
        [["calls", s.calls], ["errors", s.errors], ["error rate", (s.error_rate * 100).toFixed(1) + " %"], ["avg", ms(s.avg_ms)],
         ["p50", ms(s.p50_ms)], ["p95", ms(s.p95_ms)], ["max", ms(s.max_ms)]].forEach(function (k) {
          var c = el("div", null, "tp-kpi"); c.appendChild(el("b", String(k[1]))); c.appendChild(el("span", k[0])); kpi.appendChild(c);
        });
        body.appendChild(kpi);
        if (s.last_error) body.appendChild(el("p", "last error: " + s.last_error, "tp-bad"));
      }
      var cat = el("a", "open in the Tool Catalog (Try-It)");
      cat.href = "/apps/platform/tool_catalog/?view=try&tool=" + encodeURIComponent(tool);
      body.appendChild(el("p")).appendChild(cat);
      body.appendChild(el("h3", "Recent calls"));
      table(body, [{id: "ts", label: "When", render: function (x) { return when(x.ts); }},
        {id: "duration_ms", label: "Took", sortable: true, render: function (x) { return ms(x.duration_ms); }},
        {id: "status", label: "Status", filterable: true}, {id: "caller", label: "Caller", filterable: true},
        {id: "params_keys", label: "Params", render: function (x) { return (x.params_keys || []).join(", "); }},
        {id: "error", label: "Error"}], r.traces || [], {getId: function (x) { return x.trace_id; }});
      status(tool);
    }).catch(fail);
  }
  function fail(e) { body.replaceChildren(el("p", "Failed: " + (e && e.message || e), "tp-bad")); }

  // ── left sidebar: tools grouped like the catalog, badged with calls / errors ──
  function mountTree(host) {
    var box = el("div");
    host.appendChild(box);
    tree = AppUI.components.Tree.create({
      container: box, searchable: true, searchPlaceholder: "Filter tools…", storageKey: "tool_profiler.tree",
      decorateRow: function (node, row) {
        var d = node.data || {};
        if (d.calls != null) { var b = el("span", String(d.calls) + (d.errors ? " · " + d.errors + "✗" : ""), "tp-badge" + (d.errors ? " err" : "")); row.appendChild(b); }
      },
      onSelect: function (node) { if (!node.hasChildren && node.data && node.data.tool) go("tool", node.data.tool); }});
    loadTree();
    return function () { if (tree) tree.destroy(); tree = null; };
  }
  function loadTree() {
    op("metrics", {sort: "calls"}).then(function (r) {
      var rows = (r.metrics || {}).tools || [], groups = {};
      rows.forEach(function (x) {
        var appId = x.tool.slice(0, x.tool.lastIndexOf(".")), g = appId.indexOf("/") > 0 ? appId.slice(0, appId.indexOf("/")) : appId;
        ((groups[g] = groups[g] || {})[appId] = groups[g][appId] || []).push(x);
      });
      var roots = Object.keys(groups).sort().map(function (g) {
        var apps = groups[g];
        return {name: g, path: "g:" + g, hasChildren: true, children: Object.keys(apps).sort().map(function (a) {
          return {name: a.slice(g.length + 1) || a, path: "a:" + a, hasChildren: true, children: apps[a].map(function (x) {
            return {name: x.tool.slice(a.length + 1), path: x.tool, hasChildren: false, data: {tool: x.tool, calls: x.calls, errors: x.errors}};
          })};
        })};
      });
      if (tree) { tree.setRoots(roots); var t = router.get("tool"); if (t) tree.expandTo(t); }
    }).catch(function () { /* the content view reports errors */ });
  }

  window.AppUIReady.then(function () { return AppUIAssets.load("tree", "dataTable"); }).then(function () {
    AppUIRouter.alias(NS, "view", "view");
    AppUIRouter.alias(NS, "tool", "tool");
    AppUIRouter.alias(NS, "sort", "sort");
    AppUIRouter.alias(NS, "hours", "hours");
    router = AppUIRouter.create(NS, route);
    app = AppUI.createApp({
      id: "platform-tool_profiler", title: "Tool Profiler", menubar: {theme: true}, statusBar: {},
      menu: {View: [{id: "overview", label: "Overview"}, {id: "slow", label: "Slow calls"}, {id: "analytics", label: "Analytics"},
                    {id: "refresh", label: "Refresh"}],
             Metrics: [{id: "reset", label: "Reset all metrics…"}]},
      onAction: function (_menu, id) {
        if (id === "refresh") { loadTree(); route(); }
        else if (id === "reset") AppUI.components.Dialog.confirm("Clear all recorded metrics and traces?", function () {
          op("reset", {confirm: true}).then(function () { loadTree(); route(); status("metrics cleared"); }).catch(fail); });
        else go(id);
      },
      leftSidebar: {width: 330, tabs: [{id: "tools", label: "Tools", active: true, render: mountTree}]},
      content: {
        top: function (host) {
          top = el("div", null, "tp-nav");
          [["overview", "Overview"], ["slow", "Slow calls"], ["analytics", "Analytics"], ["tool", "Tool"]].forEach(function (v) {
            var b = el("button", v[1]); b.type = "button"; b.dataset.view = v[0];
            b.addEventListener("click", function () { go(v[0], v[0] === "tool" ? router.get("tool") : ""); });
            top.appendChild(b);
          });
          host.replaceChildren(top);
        },
        body: function (host) { body = el("div", null, "tp-body"); host.replaceChildren(body); route(); }
      }
    });
  });
})();
