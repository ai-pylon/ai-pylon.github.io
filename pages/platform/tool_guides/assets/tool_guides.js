// platform/tool_guides — the guide tree (root > group > app > tool, + recipes), each guide's tools /
// scenarios / notes, a tool's relationship map, and each assistant's favourite tools.
// Served at /apps/platform/tool_guides/. ?id=<guide id> opens a guide.
(function () {
  "use strict";
  var API = "/v1/apps/platform/tool_guides/";
  var tree = null, content = null, side2 = null, status = null;
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
  function tell(msg) { if (status) status.textContent = msg || ""; }
  function treeNode(c) {
    return {path: c.path, name: c.title + (c.badge && c.badge.indexOf("(auto)") >= 0 ? "" : " ✓"),
            hasChildren: !!c.has_children, data: c};
  }
  function idOfPath(p) {                        // tool path <app>/<op> -> <app>.<op>
    return api("vis_node", {path: p}).then(function (r) { return r; });
  }

  function list(host, title, items, render) {
    if (!items || !items.length) return;
    host.appendChild(node("h3", title));
    var ul = node("ul");
    items.forEach(function (it) { var li = node("li"); render(li, it); ul.appendChild(li); });
    host.appendChild(ul);
  }

  function showGuide(id, page) {
    content.replaceChildren(node("p", "loading…"));
    return api("guide", {id: id, page: page||0}).then(function (g) {
      content.replaceChildren();
      if (!g.ok) { content.appendChild(node("p", g._error || "not found")); return; }
      var crumb = (g.breadcrumb || []).filter(function (b) { return b.id; }).map(function (b) { return b.title; });
      if (crumb.length) content.appendChild(node("p", crumb.join(" › "), {"class": "tg-crumb"}));
      content.appendChild(node("h2", g.title + "  (" + g.level + (g.authored ? "" : ", no authored guide yet") + ")"));
      if (g.summary) content.appendChild(node("p", g.summary));
      if (g.description) content.appendChild(node("p", g.description));
      list(content, "Use it when", g.when, function (li, w) { li.textContent = w; });
      list(content, "Tools", g.tools, function (li, t) {
        var code = node("code", t.id); li.appendChild(code);
        li.appendChild(document.createTextNode("  [" + (t.safety || "?") + "]  " + (t.description || "")));
      });
      list(content, "Scenarios", g.scenarios, function (li, s) {
        li.appendChild(node("strong", s.ask));
        var ol = node("ol");
        (s.steps || []).forEach(function (st) { ol.appendChild(node("li", st)); });
        li.appendChild(ol);
      });
      list(content, "Notes", g.notes, function (li, n) { li.textContent = n; });
      list(content, "Asks it answers (generated, reviewed)", g.intents, function (li, i) {
        li.textContent = i.ask + "  →  " + (i.tools || []).join(", ");
      });
      if ((g.aliases || []).length) content.appendChild(node("p", "Also called: " + g.aliases.join(", ")));
      list(content, "Related guides", g.related, function (li, r) {
        var a = node("a", r, {href: "#"}); a.addEventListener("click", function (e) { e.preventDefault(); showGuide(r); });
        li.appendChild(a);
      });
      if(g.id==="~engineering"||String(g.id).startsWith("~engineering/")){
        list(content,"Child guides",g.children,function(li,c){const a=node("a",c.title,{href:"#"});a.onclick=e=>{e.preventDefault();showGuide(c.id,0)};li.append(a)});
        if(g.next_page!=null){const next=node("button","Next page");next.onclick=()=>showGuide(g.id,g.next_page);content.append(next)}
        if(g.page>0){const prev=node("button","Previous page");prev.onclick=()=>showGuide(g.id,g.page-1);content.append(prev)}
      }
      if (g.level === "tool") return showRelated(g.id);
    }).catch(function (e) { tell(e.message); });
  }

  function showRelated(tool) {
    return api("related", {tool: tool}).then(function (r) {
      if (!r.ok) return;
      content.appendChild(node("h3", "Relationship map (" + r.calls + " calls, " + r.ok + " ok, avg " + r.avg_ms + " ms)"));
      [["followed_by", "usually followed by"], ["preceded_by", "usually preceded by"], ["together", "used together with"],
       ["fails_then", "after a failure, fixed by"], ["used_by", "used by assistants"]].forEach(function (k) {
        list(content, k[1], r[k[0]], function (li, x) { li.textContent = x.id + "  ×" + x.count; });
      });
      if (!r.calls) content.appendChild(node("p", "No recorded use yet - it fills as assistants use the tool."));
    });
  }

  function mountTree(host) {
    var box = node("div");
    host.appendChild(box);
    tree = AppUITree.create({container: box, searchable: true, searchPlaceholder: "Filter guides…",
      storageKey: "platform-tool_guides.tree",
      onSelect: function (n) { idOfPath(n.path).then(function (r) { showGuide(guideId(r, n.path)); }); },
      onExpand: function (n, done) {
        api("vis_children", {path: n.path, page_size: 200}).then(function (r) {
          done((r.children || []).map(treeNode));
        }).catch(function (e) { tell(e.message); done([]); });
      }});
    api("vis_children", {path: "", page_size: 200}).then(function (r) { tree.setRoots((r.children || []).map(treeNode)); });
    return function () { if (tree) tree.destroy(); };
  }
  function guideId(r, path) {                    // a tool node's path is <app>/<op>; its guide id <app>.<op>
    if (r && r.kind === "tool") { var i = path.lastIndexOf("/"); return path.slice(0, i) + "." + path.slice(i + 1); }
    return path;
  }

  function mountAssistants(host) {
    side2 = node("div");
    host.appendChild(node("p", "Favourite tools per assistant: pinned, learned from use, declared."));
    host.appendChild(side2);
    api("usage", {}).then(function (r) {
      (r.profiles || []).forEach(function (p) {
        var a = node("a", p.profile + "  (" + p.calls + " calls)", {href: "#"});
        a.addEventListener("click", function (e) { e.preventDefault(); showFavorites(p.profile); });
        var d = node("div"); d.appendChild(a); side2.appendChild(d);
      });
      if (!(r.profiles || []).length) side2.appendChild(node("p", "No assistant has recorded tool use yet."));
    });
  }
  function showFavorites(profile) {
    content.replaceChildren(node("p", "loading…"));
    api("favorites", {profile: profile, limit: 12}).then(function (r) {
      content.replaceChildren(node("h2", "Favourites of " + profile));
      list(content, "Tools (in prompt order)", r.favorites, function (li, f) {
        var code = node("code", f.id); li.appendChild(code);
        li.appendChild(document.createTextNode("  " + f.why + (f.score ? " " + f.score : "") + "  " + (f.description || "")));
        var b = node("button", f.why === "pinned" ? "unpin" : "pin", {type: "button"});
        b.addEventListener("click", function () {
          api("pin", {profile: profile, tool: f.id, pinned: f.why !== "pinned", confirm: true}).then(function () { showFavorites(profile); });
        });
        li.appendChild(document.createTextNode(" ")); li.appendChild(b);
      });
    });
  }

  // ── ROUTE MEMORY: recent asks -> the tools that answered them, their nav cost + hit counts ──
  function mountRoutes(host) {
    var stats = node("p", "loading…");
    var q = node("input", null, {type: "search", placeholder: "Asks like…", "aria-label": "Find routes like an ask"});
    var go = node("button", "Find", {type: "button"});
    var recent = node("button", "Recent", {type: "button"});
    var report = node("button", "Refinement report", {type: "button"});
    var prune = node("button", "Prune", {type: "button", title: "expire old routes, drop routes of removed tools"});
    var evalBtn = node("button", "Routing eval", {type: "button", title: "the last scored eval runs (daily flow Guides/routing_eval_daily)"});
    [stats, q, go, recent, report, prune, evalBtn].forEach(function (e) { host.appendChild(e); });
    evalBtn.addEventListener("click", showEval);
    function refreshStats() {
      api("routes", {limit: 1, stats: true}).then(function (r) {
        var s = r.stats || {};
        stats.textContent = (s.enabled === false ? "route memory OFF · " : "") + (s.routes || 0) + " routes, " +
          (s.hits || 0) + " hits, " + (s.navigated || 0) + " needed navigation" +
          (s.embed ? ", " + (s.embedded || 0) + " embedded" : "") + " (keeps " + s.max_rows + ", " + s.ttl_days + " days)";
      });
    }
    go.addEventListener("click", function () { showRoutes(q.value.trim()); });
    q.addEventListener("keydown", function (e) { if (e.key === "Enter") showRoutes(q.value.trim()); });
    recent.addEventListener("click", function () { showRoutes(""); });
    report.addEventListener("click", showReport);
    prune.addEventListener("click", function () {
      api("route_prune", {confirm: true}).then(function (r) {
        tell("pruned: " + r.expired + " expired, " + r.missing_tools + " with missing tools; " + r.left + " left");
        refreshStats(); showRoutes("");
      });
    });
    refreshStats();
    showRoutes("");
  }
  function ago(ts) {
    var s = Math.max(0, Date.now() / 1000 - (ts || 0));
    return s < 3600 ? Math.round(s / 60) + " min ago" : s < 86400 ? Math.round(s / 3600) + " h ago" : Math.round(s / 86400) + " d ago";
  }
  function showRoutes(query) {
    content.replaceChildren(node("p", "loading…"));
    api("routes", query ? {query: query, limit: 20} : {limit: 100}).then(function (r) {
      content.replaceChildren(node("h2", query ? "Known routes for “" + query + "”" : "Recent routes"));
      var rows = r.routes || [];
      if (!rows.length) { content.appendChild(node("p", "No routes yet - they fill as assistants answer asks.")); return; }
      list(content, rows.length + " route(s) - the last tool answered", rows, function (li, x) {
        li.appendChild(node("strong", "“" + x.prompt + "”"));
        li.appendChild(document.createTextNode("  " + (x.profile || "") + " · " + ago(x.last || x.ts) +
          " · ×" + (x.hits || x.count || 1) + " · nav " + (x.nav || 0) + (x.score != null ? " · score " + x.score : "")));
        var chain = node("div");
        (x.tools || []).forEach(function (t, i) {
          if (i) chain.appendChild(document.createTextNode(" → "));
          var a = node("a", t, {href: "#"});
          a.addEventListener("click", function (e) { e.preventDefault(); showGuide(t); });
          chain.appendChild(a);
        });
        li.appendChild(chain);
        if (x.id != null) {
          var del = node("button", "forget", {type: "button", title: "delete this wrong route"});
          del.addEventListener("click", function () {
            api("route_delete", {id: x.id, confirm: true}).then(function (d) { tell("deleted " + d.deleted); showRoutes(query); });
          });
          li.appendChild(del);
        }
      });
    }).catch(function (e) { tell(e.message); });
  }
  // ── ROUTING EVAL: the scored runs (IMPROVEMENTS_NEXT #20) - the daily flow's result, a trend, the misses ──
  var EVAL_KEYS = ["find_top1", "find_top3", "find_tool_top3", "search_top1", "search_top3", "search_tool_top3", "routes_top1"];
  function showEval() {
    content.replaceChildren(node("p", "loading…"));
    api("routing_eval_last", {history: 10}).then(function (r) {
      content.replaceChildren(node("h2", "Routing eval"));
      var run = btnRun();
      if (!r.last) { content.appendChild(node("p", "No eval run stored yet.")); content.appendChild(run); return; }
      var L = r.last;
      content.appendChild(node("p", "Last run " + ago(L.ts) + " · " + (L.summary || {}).cases + " asks (" + (L.grown || 0) +
        " grown from real use) · " + L.seconds + " s" + (r.flow ? " · flow " + r.flow.name + (r.flow.enabled ? " (enabled)" : " (DISABLED)") : "")));
      var tbl = node("table"), head = node("tr");
      ["rate"].concat((r.history || []).map(function (h) { return ago(h.ts); })).forEach(function (t) { head.appendChild(node("th", t)); });
      tbl.appendChild(head);
      EVAL_KEYS.forEach(function (k) {
        var tr = node("tr");
        tr.appendChild(node("td", k));
        (r.history || []).forEach(function (h, i) {
          var v = ((h.summary || {})[k] || {}).pct, prev = i + 1 < r.history.length ? (((r.history[i + 1].summary || {})[k] || {}).pct) : null;
          var td = node("td", v == null ? "-" : v + "%");
          if (v != null && prev != null && v < prev) td.style.color = "var(--appui-bad, #c33)";
          tr.appendChild(td);
        });
        tbl.appendChild(tr);
      });
      content.appendChild(tbl);
      list(content, "Misses of the last run (the app is not in find's top 3)", L.misses || [], function (li, m) {
        li.appendChild(node("strong", "“" + m.ask + "”"));
        li.appendChild(document.createTextNode("  want " + m.app + " · got " + (m.find_top || []).join(", ")));
      });
      content.appendChild(run);
    }).catch(function (e) { tell(e.message); });
  }
  function btnRun() {
    var b = node("button", "Run the eval now", {type: "button"});
    b.addEventListener("click", function () {
      b.disabled = true; tell("scoring…");
      api("routing_eval", {}).then(function (r) { tell(r.ok ? "scored " + ((r.summary || {}).cases || 0) + " asks" : (r.error || r._error)); showEval(); });
    });
    return b;
  }
  function showReport() {
    content.replaceChildren(node("p", "loading…"));
    api("route_report", {}).then(function (r) {
      content.replaceChildren(node("h2", "Refinement report"));
      list(content, "Asks that needed catalog navigation (add as guide intents)", r.needs_intent, function (li, x) {
        li.appendChild(node("code", x.app_id));
        var ul = node("ul"); (x.asks || []).forEach(function (a) { ul.appendChild(node("li", a)); }); li.appendChild(ul);
      });
      list(content, "Cross-category apps answering one ask without a shared tag", r.tag_pairs, function (li, x) {
        li.textContent = x.apps.join(" + ") + "  ×" + x.count;
      });
      list(content, "Most re-used routes", r.top_routes, function (li, x) {
        li.textContent = "“" + x.prompt + "” → " + x.tools.join(" → ") + "  ×" + x.count;
      });
      if (!(r.needs_intent || []).length && !(r.top_routes || []).length) content.appendChild(node("p", "Nothing to report yet."));
    }).catch(function (e) { tell(e.message); });
  }

  // ── PROPOSALS: generated guide material awaiting review (accept / edit / reject) ──
  function mountProposals(host) {
    host.appendChild(node("p", "Generated guide material (intents, aliases, usage, description, category, tags) " +
      "is only applied after review."));
    var one = node("input", null, {type: "text", placeholder: "app id (empty = all apps)", "aria-label": "App id to propose for"});
    var gen = node("button", "Generate", {type: "button", title: "LLM + routes + docstring proposals (background job)"});
    var cond = node("button", "Condense groups", {type: "button"});
    var refresh = node("button", "Pending", {type: "button"});
    var byField = node("button", "Review by field", {type: "button",
      title: "One table per field across every pending app: the live value, the proposed one (word diff), accept a field in bulk"});
    [one, gen, cond, refresh, byField].forEach(function (e) { host.appendChild(e); });
    byField.addEventListener("click", function () { showByField("description"); });
    gen.addEventListener("click", function () {
      var a = one.value.trim();
      var args = a ? {app_id: a, confirm: true} : {all: true, confirm: true};
      tell("generating proposals" + (a ? " for " + a : " for every app") + "…");
      fetch("/v1/apps/platform/work_runner/submit", {method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({kind: "op", app: "platform/tool_guides", op: "propose", args: args, confirm: true})})
        .then(function (r) { return r.json(); })
        .then(function (r) {
          var id = r.job_id || (r.job && r.job.id);
          tell(id ? "job " + id + " running - press Pending when it is done" : (r._error || r.error || "submit failed"));
        });
    });
    cond.addEventListener("click", function () {
      tell("condensing group summaries…");
      api("condense_groups", {confirm: true}).then(function (r) {
        tell("condensed " + (r.condensed || []).length + ", unchanged " + (r.unchanged || []).length +
             (Object.keys(r.errors || {}).length ? ", errors " + Object.keys(r.errors).length : ""));
      });
    });
    refresh.addEventListener("click", showProposals);
    showProposals();
  }
  function showProposals() {
    content.replaceChildren(node("p", "loading…"));
    api("proposals", {}).then(function (r) {
      content.replaceChildren(node("h2", "Pending proposals (" + (r.count || 0) + ")"));
      if (!r.count) { content.appendChild(node("p", "Nothing pending - Generate makes proposals.")); return; }
      (r.proposals || []).forEach(function (p) { content.appendChild(proposalCard(p)); });
    }).catch(function (e) { tell(e.message); });
  }
  // ── REVIEW BY FIELD (IMPROVEMENTS_NEXT #9): one field across every pending app, live vs proposed, bulk accept ──
  var REVIEW_FIELDS = ["description", "category", "tags", "usage", "aliases"];
  function _asText(v) { return Array.isArray(v) ? v.join(", ") : (v == null ? "" : String(v)); }
  function wordDiff(a, b) {
    // the live -> proposed change as <del>/<ins> words (AppUITextDiff over word lists); plain text when unavailable
    var out = node("span");
    var A = _asText(a).split(/\s+/).filter(Boolean), B = _asText(b).split(/\s+/).filter(Boolean);
    var rows = null;
    try { rows = window.AppUITextDiff ? AppUITextDiff.lines(A, B, {maxPairs: 250000, fallback: "position"}) : null; }
    catch (_e) { rows = null; }
    if (!rows) { out.textContent = _asText(b); return out; }
    rows.forEach(function (r) {
      var el = node(r.type === "add" ? "ins" : r.type === "remove" ? "del" : "span", r.text);
      out.appendChild(el); out.appendChild(document.createTextNode(" "));
    });
    return out;
  }
  function showByField(field) {
    content.replaceChildren(node("p", "loading…"));
    Promise.all([api("proposals", {}), window.AppUIAssets ? AppUIAssets.load("textDiff").catch(function () {}) : null])
      .then(function (res) {
        var r = res[0], rows = (r.proposals || []).filter(function (p) {
          var v = (p.proposal || {})[field];
          return v != null && v !== "" && !(Array.isArray(v) && !v.length);
        });
        content.replaceChildren();
        var bar = node("div", null, {"class": "tg-byfield-bar"});
        var sel = node("select", null, {id: "tg-byfield-field"});
        REVIEW_FIELDS.forEach(function (f) {
          var o = node("option", f, {value: f}); if (f === field) o.selected = true; sel.appendChild(o);
        });
        sel.addEventListener("change", function () { showByField(sel.value); });
        var all = node("input", null, {type: "checkbox", id: "tg-byfield-all"});
        var acc = node("button", "Accept checked", {type: "button"});
        bar.appendChild(node("label", "Field ", {"for": sel.id})); bar.appendChild(sel);
        bar.appendChild(document.createTextNode("  "));
        bar.appendChild(all); bar.appendChild(node("label", " all (" + rows.length + ")", {"for": all.id}));
        bar.appendChild(document.createTextNode("  ")); bar.appendChild(acc);
        content.appendChild(node("h2", "Review '" + field + "' - " + rows.length + " pending app(s)"));
        content.appendChild(bar);
        if (!rows.length) { content.appendChild(node("p", "No pending proposal has this field.")); return; }
        var tbl = node("table", null, {"class": "tg-byfield"});
        var hd = node("tr");
        ["", "app", "live", "proposed (change)"].forEach(function (h) { hd.appendChild(node("th", h, {scope: "col"})); });
        tbl.appendChild(hd);
        var boxes = [];
        rows.forEach(function (p) {
          var tr = node("tr");
          var cb = node("input", null, {type: "checkbox", "aria-label": "accept " + field + " of " + p.app_id});
          cb.dataset.app = p.app_id; boxes.push(cb);
          var c0 = node("td"); c0.appendChild(cb); tr.appendChild(c0);
          tr.appendChild(node("th", p.app_id, {scope: "row"}));
          var live = (p.current || {})[field];
          tr.appendChild(node("td", _asText(live) || "(none)"));
          var c3 = node("td"); c3.appendChild(wordDiff(live, (p.proposal || {})[field])); tr.appendChild(c3);
          tbl.appendChild(tr);
        });
        content.appendChild(tbl);
        all.addEventListener("change", function () { boxes.forEach(function (b) { b.checked = all.checked; }); });
        acc.addEventListener("click", function () {
          var pick = boxes.filter(function (b) { return b.checked; }).map(function (b) { return b.dataset.app; });
          if (!pick.length) { tell("check at least one app"); return; }
          acc.disabled = true;
          var ok = 0, bad = [];
          // one targeted decide per app (manifest edits stay line edits; each app hot-reloads), in order
          pick.reduce(function (chain, aid) {
            return chain.then(function () {
              tell("accepting " + field + " of " + aid + "… (" + (ok + bad.length + 1) + "/" + pick.length + ")");
              return api("proposal_decide", {app_id: aid, decision: "accept", fields: [field], confirm: true})
                .then(function (x) { if (x.ok) ok++; else bad.push(aid + ": " + (x._error || x.error || "failed")); })
                .catch(function (e) { bad.push(aid + ": " + e.message); });
            });
          }, Promise.resolve()).then(function () {
            tell("accepted " + field + " for " + ok + " app(s)" + (bad.length ? "; failed: " + bad.join("; ") : ""));
            showByField(field);
          });
        });
      }).catch(function (e) { tell(e.message); });
  }
  function proposalCard(p) {
    var box = node("section", null, {"class": "tg-proposal"});
    box.appendChild(node("h3", p.app_id + "  (" + (p.sources || []).join(", ") + ")"));
    var pr = p.proposal || {}, checks = {}, edits = {};
    function field(name, label, value, editable) {
      if (value == null || (Array.isArray(value) && !value.length) || value === "") return;
      var row = node("div");
      var cb = node("input", null, {type: "checkbox", id: "f-" + p.app_id + "-" + name});
      cb.checked = true; checks[name] = cb;
      row.appendChild(cb);
      row.appendChild(node("label", " " + label + ": ", {"for": cb.id}));
      if (editable) {
        var ta = node("textarea", null, {rows: "2", cols: "90", "aria-label": label});
        ta.value = value; edits[name] = ta; row.appendChild(ta);
      } else {
        row.appendChild(node("span", typeof value === "string" ? value : JSON.stringify(value)));
      }
      box.appendChild(row);
    }
    field("description", "description", pr.description, true);
    field("usage", "usage", pr.usage, true);
    field("category", "category", pr.category, false);
    field("tags", "tags", pr.tags, false);
    field("aliases", "aliases", pr.aliases, false);
    if ((pr.intents || []).length) {
      field("intents", "intents (" + pr.intents.length + ")", " ", false);
      var ul = node("ul");
      pr.intents.forEach(function (i) { ul.appendChild(node("li", i.ask + "  →  " + (i.tools || []).join(", "))); });
      box.appendChild(ul);
    }
    if (pr.new_tag) box.appendChild(node("p", "new tag proposed (add it to vocabulary.json first): " + JSON.stringify(pr.new_tag)));
    if (pr.new_category) box.appendChild(node("p", "new category proposed: " + JSON.stringify(pr.new_category)));
    if (pr.tag_candidates) box.appendChild(node("p", "tag candidates (apps answering the same asks): " +
      pr.tag_candidates.map(function (t) { return t.with + " ×" + t.count; }).join(", ")));
    if (pr.tools) box.appendChild(node("pre", "tool schema from docstrings (apply in the manifest by hand):\n" + JSON.stringify(pr.tools, null, 1)));
    (p.errors || []).forEach(function (e) { box.appendChild(node("p", "⚠ " + e)); });
    var acc = node("button", "Accept checked", {type: "button"});
    var rej = node("button", "Reject", {type: "button"});
    acc.addEventListener("click", function () {
      var fields = Object.keys(checks).filter(function (k) { return checks[k].checked; });
      var ed = {};
      Object.keys(edits).forEach(function (k) { if (edits[k].value !== pr[k]) ed[k] = edits[k].value; });
      api("proposal_decide", {app_id: p.app_id, decision: "accept", fields: fields, edits: ed, confirm: true}).then(function (r) {
        tell(r.ok ? "accepted " + p.app_id + ": guide " + (r.generated || []).join(",") + "; manifest " + (r.manifest || []).join(",") +
                    (r.reload_needed ? " (reload needed)" : "") : (r._error || "failed"));
        if (r.ok) { if (r.status === "pending") showProposals(); else box.remove(); }
      });
    });
    rej.addEventListener("click", function () {
      api("proposal_decide", {app_id: p.app_id, decision: "reject", confirm: true}).then(function (r) { if (r.ok) box.remove(); });
    });
    box.appendChild(acc); box.appendChild(document.createTextNode(" ")); box.appendChild(rej);
    return box;
  }

  function mountEngineering(host) {
    const button=(label,fn)=>{const b=node("button",label,{"class":"appui-btn"});b.onclick=fn;host.appendChild(b);return b;};
    button("Knowledge hierarchy",()=>showGuide("~engineering"));
    button("Promotion proposals / evaluation",()=>showEngineering());
    showEngineering();
  }
  async function showEngineering(){
    content.replaceChildren(node("h2","Engineering learning"));
    const section=node("section");content.append(section);
    const call=(op,args)=>AppUIApi.operation("platform/tool_guides",op,args,{timeout:300000});
    const button=(parent,label,fn)=>{const b=node("button",label,{"class":"appui-btn"});b.onclick=async()=>{b.disabled=true;try{await fn()}catch(e){tell(e.message)}finally{b.disabled=false}};parent.append(b);return b;};
    const status=await call("engineering_learning",{action:"status"});
    if(!status.ok){section.append(node("p",status.error||status._error||"Unavailable"));return;}
    section.append(node("h3","Promotion proposals"));
    for(const p of status.proposals||[]){
      const row=node("section");row.append(node("p",p.finding+" → "+p.target+" · "+p.reason),node("p",p.hint));section.append(row);
      const review=(status.review||[]).find(x=>x.token===p.token);row.append(node("p","Review: "+(review?.decision||"unavailable")));
      if(review?.decision==="eligible_for_review")button(row,"Apply verified promotion",async()=>{if(!await AppUIDialog.confirmAsync("Apply verified promotion?"))return;const r=await call("engineering_learning",{action:"apply_verified",token:p.token,confirm:true});tell(r.status||r._error);await showEngineering()});
      for(const decision of (p.redundant?["reject"]:["accept","reject"]))button(row,decision,async()=>{if(!await AppUIDialog.confirmAsync(decision+" this reviewed hint?"))return;const r=await call("engineering_learning",{action:"decide",token:p.token,decision,confirm:true});tell(r.ok?r.status:(r.error||r._error||r.status));await showEngineering()});
    }
    section.append(node("h3","Google Drive text storage"),node("p","VFS immutable text revisions; no database or ZIP upload. Conflicts are never overwritten."));
    section.append(node("a","Open Work Runner jobs",{href:"/apps/platform/work_runner/"}));
    const driveReport=node("pre","",{"class":"appui-detail-pre"});
    const autoState=node("p","Auto-publish status not loaded");section.append(autoState);
    const showAuto=async()=>{const r=await call("engineering_learning",{action:"drive_settings"});autoState.textContent=r.ok?("Automatic publish: "+(r.enabled?"enabled":"disabled")+" · "+(r.last_status||"not yet verified")):"Auto-publish status unavailable"};
    button(section,"Refresh automatic publish status",showAuto);
    for(const enabled of [true,false])button(section,enabled?"Enable automatic Drive publish":"Disable automatic Drive publish",async()=>{if(await AppUIDialog.confirmAsync((enabled?"Enable":"Disable")+" periodic publishing of curated engineering text?")){const r=await call("engineering_learning",{action:"drive_configure",enabled,confirm:true});driveReport.textContent=JSON.stringify(r,null,2);await showAuto()}});

    button(section,"Preview Drive sync",async()=>{driveReport.textContent=JSON.stringify(await call("engineering_learning",{action:"drive_sync"}),null,2)});
    button(section,"Sync and verify Drive",async()=>{if(!await AppUIDialog.confirmAsync("Publish curated knowledge and evaluation text to Google Drive via VFS?"))return;driveReport.textContent=JSON.stringify(await call("engineering_learning",{action:"drive_sync",confirm:true}),null,2)});section.append(driveReport);
    const snap=node("select",null,{"aria-label":"Drive snapshot"});section.append(snap);
    const loadSnapshots=async()=>{const r=await call("engineering_learning",{action:"drive_snapshots"});snap.replaceChildren();for(const v of r.snapshots||[])snap.append(node("option",String(v.modified||"")+" · "+v.id.slice(0,12),{value:v.id}));if(!r.ok)driveReport.textContent=JSON.stringify(r,null,2)};
    button(section,"List Drive snapshots",loadSnapshots);
    button(section,"Preview selected restore",async()=>{if(snap.value)driveReport.textContent=JSON.stringify(await call("engineering_learning",{action:"drive_restore",snapshot:snap.value}),null,2)});
    button(section,"Restore to isolated cache",async()=>{if(snap.value&&await AppUIDialog.confirmAsync("Download and verify the selected snapshot without modifying active rules?"))driveReport.textContent=JSON.stringify(await call("engineering_learning",{action:"drive_restore",snapshot:snap.value,confirm:true}),null,2)});
    button(section,"Preview missing-file recovery",async()=>{if(snap.value)driveReport.textContent=JSON.stringify(await call("engineering_learning",{action:"drive_recover_missing",snapshot:snap.value}),null,2)});
    button(section,"Recover reviewed missing files",async()=>{if(snap.value&&await AppUIDialog.confirmAsync("Recover missing local documents and evidence from this reviewed snapshot? Existing files are never overwritten. Do not use untrusted snapshots."))driveReport.textContent=JSON.stringify(await call("engineering_learning",{action:"drive_recover_missing",snapshot:snap.value,reviewed_snapshot:snap.value,confirm:true}),null,2)});

    section.append(node("h3","Knowledge organization"));
    if(!(status.organization||[]).length)section.append(node("p","No merge or split candidates."));
    for(const p of status.organization||[]){const row=node("section");row.append(node("p",p.kind+" · "+p.domain+" · "+(p.keep?p.keep+" / "+p.duplicate:p.count+" entries")));section.append(row);
      if(p.kind!=="semantic_review")button(row,"Apply reviewed organization",async()=>{if(!await AppUIDialog.confirmAsync("Apply this source-preserving organization change?"))return;const r=await call("engineering_learning",{action:"organize",token:p.token,confirm:true});tell(r.status||r._error);await showEngineering()});}
    const report=node("pre",status.last?JSON.stringify(status.last,null,2):"No recorded replay",{"class":"appui-detail-pre"});
    section.append(node("h3","Deterministic regression"));
    button(section,"Run retrieval evaluation",async()=>{const r=await call("engineering_learning",{action:"evaluate",confirm:true});report.textContent=JSON.stringify(r,null,2)});section.append(report);
    const scaleReport=node("pre",JSON.stringify(status.scale_results||[],null,2),{"class":"appui-detail-pre"});
    button(section,"Scale replay (1,000 findings)",async()=>{const r=await call("engineering_learning",{action:"scale",count:1000,confirm:true});scaleReport.textContent=JSON.stringify(r,null,2)});section.append(scaleReport);
    section.append(node("h3","Repository artifact compliance"));
    const audit=node("pre",JSON.stringify(status.audits||{},null,2),{"class":"appui-detail-pre"});
    for(const id of status.audit_ids||[])button(section,"Audit "+id,async()=>{const r=await call("engineering_learning",{action:"audit",audit_id:id,confirm:true});audit.textContent=JSON.stringify(r,null,2)});
    section.append(audit);
    section.append(node("h3","Independent Gemini evaluation"),node("p","Store the API key in Credential Store as gemini-evaluator. Only curated engineering documents are sent to Google. Each case is limited to six calls; API charges may apply."));
    const link=node("a","Open Credential Store",{href:"/apps/platform/credential/"});section.append(link);
    const model=node("input",null,{value:"gemini-3.8-flash","aria-label":"Gemini model"});const pick=node("select",null,{"aria-label":"Evaluation case"});for(const c of status.cases||[])pick.append(node("option",c.id,{value:c.id}));section.append(model,pick);
    const prior=(status.gemini_results||[]).slice().reverse();
    if(prior.length){const history=node("details");history.append(node("summary","Saved Gemini trials ("+prior.length+")"));for(const record of prior){const r=record.result||{};const item=node("details");item.append(node("summary",String(r.id||"Case")+" · "+(r.ok?"PASS":"FAIL")+" · "+String(r.turns||0)+" turns · "+String(record.model||"")),node("pre",JSON.stringify(record,null,2),{"class":"appui-detail-pre"}));history.append(item)}section.append(history)}
    const level=node("select",null,{"aria-label":"Promotion level"});level.append(node("option","Domain",{value:"domain"}),node("option","Root",{value:"root"}));section.append(level);
    const output=node("pre","",{"class":"appui-detail-pre"});
    for(const action of ["test","run","compare","scale","artifact"])button(section,({test:"Test Gemini connection",run:"Run independent case",compare:"Compare promotion A/B",scale:"Gemini scale trial (1,000 findings)",artifact:"Gemini implementation test (SQLite)"})[action],async()=>{if(!await AppUIDialog.confirmAsync("Send curated evaluation context to Gemini? API charges may apply."))return;output.textContent="Running…";const r=await call("gemini_verify",{action,case_id:pick.value,model:model.value,count:1000,level:level.value,confirm:true});output.textContent=JSON.stringify(r,null,2)});section.append(output);
    if((status.comparisons||[]).length){const history=node("details");history.append(node("summary","Saved promotion comparisons"),node("pre",JSON.stringify(status.comparisons,null,2),{"class":"appui-detail-pre"}));section.append(history)}
  }
  window.AppUIReady.then(function () { return AppUIAssets.load("tree"); }).then(function () {
    AppUI.createApp({
      id: "platform-tool_guides", title: "Tool Guides",
      leftSidebar: {width: 330, tabs: [{id: "guides", label: "Guides", active: true, render: mountTree},
                                       {id: "assistants", label: "Assistants", render: mountAssistants},
                                       {id: "routes", label: "Routes", render: mountRoutes},
                                       {id: "proposals", label: "Proposals", render: mountProposals}, {id:"engineering",label:"Engineering",render:mountEngineering}]},
      content: {render: function (host) {
        status = node("p", "", {role: "status"});
        content = node("section");
        host.appendChild(status);
        host.appendChild(content);
        var want = new URLSearchParams(location.search).get("id");
        showGuide(want != null ? want : "");
      }},
    });
  });
})();
