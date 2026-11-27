// knowledge/vis — the VIS bench. Served at /apps/knowledge/vis/.
//   left    : provider TREE (AppUITree; lazy VIS children, searchable), synced
//             with wherever the explorer is
//   content : the current provider's header card + AppUIVisExplorer (cards,
//             breadcrumbs, search, leaf detail; deep link ?vis=<uri>)
//   right   : the VIS assistant — chat_profile knowledge/vis.assistant
//             (tool_mode "vis": the model navigates VIS itself)
(function () {
  "use strict";
  var API = "/v1/apps/knowledge/vis/";

  function api(op, args) {
    return fetch(API + op, {method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify(args || {})}).then(function (r) { return r.json(); });
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c];
    });
  }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function providerOf(uri) { var m = /^vis:\/\/([^/]+)/.exec(uri || ""); return m ? m[1] : ""; }
  function kindIcon(k) { return (window.AppUIVisExplorer && AppUIVisExplorer.kindIcon) ? AppUIVisExplorer.kindIcon(k) : "•"; }

  var S = { providers: [], byName: {}, cur: null, app: null };
  var VX = null, TREE = null, TREE_READY = null;
  var KIDS = {};          // uri -> tree child nodes (the lazy-load cache)
  var PAGE = {};          // uri -> {page, total, size} pagination state for "more"

  // ------------------------------------------------------------ tree ------
  function toTreeNode(c) {
    return { name: c.title || c.path || c.uri, path: c.uri, icon: kindIcon(c.kind),
             badge: c.badge || "", hasChildren: !!c.has_children, data: c };
  }
  // Append a "… N more" affiliate row when a level is paged. Clicking it FETCHES
  // the next page and attaches it to this level in place (not a no-op re-open).
  function _withMore(uri, kids, total, page) {
    var remaining = Math.max(0, (total || kids.length) - kids.length);
    if (remaining > 0) {
      kids = kids.concat([{
        name: "load " + Math.min(remaining, (PAGE[uri] && PAGE[uri].size) || kids.length) +
              " more (" + remaining + " remaining)",
        path: uri + "#more:" + page, icon: "⋯", hasChildren: false,
        data: { more: true, uri: uri },
      }]);
    }
    return kids;
  }
  function loadKids(uri) {
    if (KIDS[uri]) return Promise.resolve(KIDS[uri]);
    return api("expand", { uri: uri, depth: 1, page: 0 }).then(function (r) {
      var raw = ((r && r.children) || []).map(toTreeNode);
      var total = (r && r.total != null) ? r.total : raw.length;
      PAGE[uri] = { page: (r && r.page) || 0, total: total, size: raw.length || 100 };
      var kids = _withMore(uri, raw, total, PAGE[uri].page);
      KIDS[uri] = kids;
      return kids;
    });
  }
  // Fetch the NEXT page of a paged level and append it to the tree in place.
  function loadMoreKids(uri) {
    var st = PAGE[uri] || { page: 0, total: 0, size: 100 };
    var next = (st.page || 0) + 1;
    return api("expand", { uri: uri, depth: 1, page: next }).then(function (r) {
      var more = ((r && r.children) || []).map(toTreeNode);
      // strip the previous "… more" marker, append the new page, re-mark.
      var base = (KIDS[uri] || []).filter(function (n) { return !(n.data && n.data.more); });
      var merged = base.concat(more);
      var total = (r && r.total != null) ? r.total : (st.total || merged.length);
      PAGE[uri] = { page: next, total: total, size: st.size || more.length || 100 };
      KIDS[uri] = _withMore(uri, merged, total, next);
      if (TREE) TREE.setChildren(uri, KIDS[uri]);     // re-render this level in place
      return KIDS[uri];
    });
  }
  function renderTree(host) {
    host.innerHTML = '<div class="vt-wrap"><div class="vt-tree"></div></div>';
    var box = $(".vt-tree", host);
    TREE_READY = AppUIAssets.load("tree").then(function () {
      TREE = AppUITree.create({
        container: box,
        searchable: true,
        storageKey: "vis:tree",
        onExpand: function (node, cb) { loadKids(node.path).then(cb, function () { cb([]); }); },
        onSelect: function (node) {
          var d = node.data || {};
          // the "… more" affiliate row: fetch the NEXT page into this level
          // (keep the parent expanded) instead of re-opening the parent.
          if (d.more) { loadMoreKids(d.uri); return; }
          if (VX) VX.open(node.path);
        },
        decorateRow: function (node, row) {
          var d = node.data || {};
          if (d.child_count) {
            var b = document.createElement("span");
            b.className = "vt-count"; b.textContent = d.child_count;
            row.appendChild(b);
          }
          if (d.provider) row.title = d.provider.description || "";
          else if (d.description) row.title = d.description;
        },
      });
      return renderRoots();
    });
  }
  function renderRoots() {
    if (!TREE || !S.providers.length) return;
    TREE.setRoots(S.providers.map(function (p) {
      return { name: p.label || p.name, path: p.root || ("vis://" + p.name), icon: p.icon || "🗂️",
               hasChildren: true, data: { provider: p } };
    }));
  }
  // Reveal the explorer's node in the tree: load + open each ancestor top-down
  // (VIS gives the ancestor chain), then highlight the node itself.
  function revealInTree(node) {
    if (!TREE || !node || !node.uri) return;
    var chain = (node.ancestors || []).map(function (a) { return a.uri; });
    var step = function (i) {
      if (i >= chain.length) { TREE.setActive(node.uri); return; }
      loadKids(chain[i]).then(function (kids) { TREE.setChildren(chain[i], kids); step(i + 1); },
                              function () { TREE.setActive(node.uri); });
    };
    step(0);
  }

  // ------------------------------------------------------- header card ----
  function renderHeader(prov) {
    var box = $("#vb-head"); if (!box) return;
    if (!prov) { box.innerHTML = ""; return; }
    var caps = [];
    if (prov.has_search) caps.push('<span class="vb-pill">🔍 search</span>');
    if (prov.has_neighbors) caps.push('<span class="vb-pill">🔗 neighbors</span>');
    if (prov.app_id) caps.push('<span class="vb-pill">provided by <b>' + esc(prov.app_id) + '</b></span>');
    caps.push('<span class="vb-pill mono">' + esc(prov.root || ("vis://" + prov.name)) + '</span>');
    box.innerHTML =
      '<div class="vb-hero">' +
        '<div class="vb-ic">' + esc(prov.icon || "🗂️") + '</div>' +
        '<div class="vb-main">' +
          '<div class="vb-kicker">VIS provider</div>' +
          '<h1>' + esc(prov.label || prov.name) + '</h1>' +
          '<p>' + esc(prov.description || "") + '</p>' +
          '<div class="vb-pills">' + caps.join("") + '</div>' +
        '</div>' +
        '<div class="vb-search">' +
          '<input id="vb-q" type="search" autocomplete="off" spellcheck="false" placeholder="Search ' +
            esc(prov.label || prov.name) + '…"' + (prov.has_search ? "" : " disabled") + '>' +
          '<div class="vb-hint">' + (prov.has_search ? "Enter to search · Esc to clear" : "this provider has no search") + '</div>' +
        '</div>' +
      '</div>';
    var q = $("#vb-q");
    if (q && prov.has_search) {
      q.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && VX) VX.search(q.value, { under: prov.root || ("vis://" + prov.name) });
        else if (e.key === "Escape") { q.value = ""; if (VX) VX.search(""); }
      });
    }
  }

  // ---------------------------------------------------------- content -----
  function renderContent(el) {
    el.innerHTML = '<div class="vb"><div id="vb-head"></div><div id="vb-vx"></div></div>';
    AppUIAssets.load("visExplorer").then(function () {
      VX = AppUIVisExplorer.create({
        container: $("#vb-vx"),
        providers: false,                 // the left tree is the provider switch
        route: "vis", routeAlias: "vis",  // AppUIRouter deep link: ?vis=<uri>
        onNavigate: function (node) {
          if (node.search) {
            setStatus(node.hits.length + " hit(s) for “" + node.search + "” in " + (node.provider || "VIS"));
            return;
          }
          S.cur = node;
          var p = S.byName[providerOf(node.uri)];
          if (p !== S.curProv) { S.curProv = p; renderHeader(p); }
          revealInTree(node);
          setStatus((p ? (p.label || p.name) : providerOf(node.uri)) + " · " + (node.kind || "node") +
            " · " + (node.children || []).length + " child(ren) · " + node.uri);
        },
      });
    });
  }
  function setStatus(t) { if (S.app && S.app.setStatus) S.app.setStatus(t); }

  // ------------------------------------------------------------- bench ----
  // #13: the test-bench controls — run vis.navigate for a question and WATCH the
  // trail, and run a lightweight in-page CONFORMANCE check of the current
  // provider. The heavy conformance gate is tools/check_vis_provider.py --live;
  // this is the browse-time smoke a tester runs against the selected provider.
  function renderBench(host) {
    host.innerHTML =
      '<div style="padding:10px 10px 4px;display:flex;flex-direction:column;gap:10px">' +
        '<div>' +
          '<div style="font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--text-muted);margin-bottom:4px">Navigate (greedy drill-down)</div>' +
          '<input id="vbn-q" type="search" placeholder="a question for the current provider…" ' +
            'style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid var(--border);background:var(--bg-primary);color:var(--text-primary);font-size:13px">' +
          '<div id="vbn-trail" style="margin-top:8px;font-size:12px"></div>' +
        '</div>' +
        '<div>' +
          '<button id="vbn-conf" style="font-size:12px;padding:6px 12px;border-radius:8px;border:1px solid var(--border);background:var(--bg-primary);color:var(--text-primary);cursor:pointer">Run conformance on this provider</button>' +
          '<label style="font-size:11px;margin-left:8px;color:var(--text-muted);cursor:pointer"><input id="vbn-deep" type="checkbox" style="vertical-align:middle"> walk 2 levels deeper</label>' +
          '<div id="vbn-conf-out" style="margin-top:8px;font-size:12px"></div>' +
        '</div>' +
        '<div>' +
          '<div style="font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--text-muted);margin-bottom:4px">Page as a VIS provider (#9)</div>' +
          '<button id="vbn-page" style="font-size:12px;padding:6px 12px;border-radius:8px;border:1px solid var(--border);background:var(--bg-primary);color:var(--text-primary);cursor:pointer">Introspect THIS page as vis://page</button>' +
          '<div id="vbn-page-out" style="margin-top:8px;font-size:12px"></div>' +
          // NEXT5 #3: the page-agent testbed (folded from platform/pageintrospect):
          // a form fixture + the profile-driven Assistant that inspects/fills/clicks.
          '<div style="margin-top:10px"><a id="vbn-pageagent" href="bench/page-agent.htm" ' +
            'style="font-size:12px;color:var(--accent)">Open the page-agent testbed →</a> ' +
            '<span style="font-size:11px;color:var(--text-muted)">(inspect / fill / click / record a case on a sample form)</span></div>' +
        '</div>' +
      '</div>';
    var q = $("#vbn-q", host);
    q.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      var prov = S.curProv;
      var under = prov ? (prov.root || ("vis://" + prov.name)) : undefined;
      var out = $("#vbn-trail", host);
      out.innerHTML = '<span style="color:var(--text-muted)">navigating…</span>';
      api("navigate", { query: q.value, under: under }).then(function (r) {
        if (!r || !r.ok) { out.innerHTML = '<span style="color:var(--color-error,#d33)">navigate failed</span>'; return; }
        var trail = r.trail || [];
        var steps = trail.map(function (u, i) {
          return '<div style="padding:2px 0 2px ' + (i * 12) + 'px">↳ <a href="#" data-u="' + esc(u) + '" style="color:var(--accent)">' + esc(u) + '</a></div>';
        }).join("");
        var landed = r.landed ? ('<div style="margin-top:6px"><b>landed:</b> ' + esc(r.landed.title || r.landed.uri) +
          ' <span style="color:var(--text-muted)">(' + esc(r.landed.kind || "") + ')</span></div>') : "";
        out.innerHTML = '<div style="color:var(--text-muted)">depth ' + (r.depth || 0) + ', entry ' + esc(r.entry || "—") + '</div>' + steps + landed;
        out.querySelectorAll("a[data-u]").forEach(function (a) {
          a.addEventListener("click", function (ev) { ev.preventDefault(); if (VX) VX.open(a.getAttribute("data-u")); });
        });
      });
    });
    $("#vbn-conf", host).addEventListener("click", function () { runConformance(host); });
    $("#vbn-page", host).addEventListener("click", function () { runPageProvider(host); });
  }

  // #9: the LIVE PAGE as a client-side VIS provider — express the page's own
  // structure (menu/sidebar/content) in the VIS node shape via AppUIVisPage and
  // render the vis://page tree, so page-structure navigation uses the SAME model
  // as data navigation. This is the pageintrospect demo, moved into the VIS
  // bench. Needs the aiSidebar bundle (AppUIVisPage + AppUIPageIntrospect).
  function runPageProvider(host) {
    var out = $("#vbn-page-out", host);
    out.innerHTML = '<span style="color:var(--text-muted)">loading…</span>';
    AppUIAssets.load("aiSidebar").then(function () {
      if (!(window.AppUIVisPage && AppUIVisPage.create)) {
        out.innerHTML = '<span style="color:var(--color-error,#d33)">AppUIVisPage unavailable</span>'; return;
      }
      var prov = AppUIVisPage.create({ appId: "knowledge/vis", label: "VIS bench page" });
      var root = prov.node("");
      if (!root.ok) { out.innerHTML = '<span style="color:var(--color-error,#d33)">page scan failed</span>'; return; }
      function _render(vn, depth) {
        var pad = (depth || 0) * 12;
        var head = '<div style="padding:2px 0 2px ' + pad + 'px">' +
          (depth ? "↳ " : "🪟 ") +
          '<a href="#" data-p="' + esc(vn.path || "") + '" style="color:var(--accent)">' + esc(vn.uri) + '</a>' +
          ' <span style="color:var(--text-muted)">' + esc(vn.title || "") + '</span></div>';
        var kids = (vn.children || []).map(function (c) {
          return '<div style="padding:1px 0 1px ' + (pad + 12) + 'px">· <a href="#" data-p="' + esc(c.path) + '" style="color:var(--accent)">' +
            esc(c.uri) + '</a> <span style="color:var(--text-muted)">' + esc(c.title) +
            (c.description ? (" — " + esc(c.description)) : "") + '</span></div>';
        }).join("");
        return head + kids;
      }
      out.innerHTML = '<div style="color:var(--text-muted);margin-bottom:4px">page provider: ' +
        esc(prov.providers()[0].root) + ' (client-side)</div>' + _render(root, 0);
      out.querySelectorAll("a[data-p]").forEach(function (a) {
        a.addEventListener("click", function (ev) {
          ev.preventDefault();
          var vn = prov.node(a.getAttribute("data-p"));
          if (vn.ok) { out.insertAdjacentHTML("beforeend", _render(vn, 1)); }
        });
      });
    }).catch(function () { out.innerHTML = '<span style="color:var(--color-error,#d33)">bundle load failed</span>'; });
  }

  function runConformance(host) {
    var prov = S.curProv;
    var out = $("#vbn-conf-out", host);
    if (!prov) { out.textContent = "select a provider first (open one in the tree)."; return; }
    var root = prov.root || ("vis://" + prov.name);
    var deep = !!($("#vbn-deep", host) && $("#vbn-deep", host).checked);   // #15 walk-deeper
    var checks = [];
    out.innerHTML = '<span style="color:var(--text-muted)">walking…</span>';
    // Walk the root's children; for each sampled child, round-trip open it, and
    // (when deep) also expand ONE of its children a level further — the same
    // client checks two levels down (#15).
    api("open", { uri: root }).then(function (r) {
      checks.push(["root opens", !!(r && r.ok)]);
      var kids = (r && r.children) || [];
      var sample = kids.slice(0, 5);
      return Promise.all(sample.map(function (c) {
        return api("open", { uri: c.uri }).then(function (cr) {
          checks.push(["title: " + String(c.title || c.uri).slice(0, 26), !!(c.title && String(c.title).trim())]);
          var hasSummary = !!(c.description && c.description.trim()) || !!c.summary_pending || !!c.pending;
          checks.push(["summary/pending: " + String(c.title || "").slice(0, 18), hasSummary]);
          checks.push(["round-trip: " + String(c.title || "").slice(0, 18), !!(cr && cr.ok && cr.uri === c.uri)]);
          if (!deep) return null;
          // #15 walk-deeper: expand this child and spot-check a grandchild
          var gkids = (cr && cr.children) || [];
          if (!gkids.length) return null;
          var g = gkids[0];
          return api("open", { uri: g.uri }).then(function (gr) {
            checks.push(["deep round-trip: " + String(g.title || "").slice(0, 16), !!(gr && gr.ok && gr.uri === g.uri)]);
            var gsum = !!(g.description && g.description.trim()) || !!g.summary_pending;
            checks.push(["deep summary: " + String(g.title || "").slice(0, 16), gsum]);
          });
        });
      }));
    }).then(function () {
      var pass = checks.filter(function (c) { return c[1]; }).length;
      out.innerHTML = '<div style="margin-bottom:4px"><b>' + pass + "/" + checks.length + ' checks passed</b> <span style="color:var(--text-muted)">(in-page smoke' + (deep ? ", 2 levels" : "") + '; full gate: tools/check_vis_provider.py --live)</span></div>' +
        checks.map(function (c) { return '<div>' + (c[1] ? "✅" : "❌") + " " + esc(c[0]) + "</div>"; }).join("");
      // #15: surface the preamble token-win VIS mode buys for this provider —
      // the describe-cap/allow-all scope means the model sees only ~60 one-line
      // descriptions up front instead of every tool's full schema. Show the
      // provider's node fan-out as a proxy (children carry descriptions, not
      // schemas) + a link to the real --static number.
      _showPreambleWin(out, prov);
    }).catch(function (e) { out.innerHTML = '<span style="color:var(--color-error,#d33)">conformance failed: ' + esc(e) + "</span>"; });
  }

  // #15: show the token win — compare the size of ONE level of node DESCRIPTIONS
  // (what VIS navigation shows per turn) against a naive "dump every tool schema"
  // baseline, as a rough char ratio, so the bench makes the VIS-mode saving
  // concrete for the selected provider.
  function _showPreambleWin(out, prov) {
    try {
      var root = prov.root || ("vis://" + prov.name);
      api("expand", { uri: root }).then(function (r) {
        if (!r || !r.ok) return;
        var kids = r.children || [];
        var descChars = kids.reduce(function (a, c) { return a + (String(c.description || "").length + String(c.title || "").length + 6); }, 0);
        var line = document.createElement("div");
        line.style.cssText = "margin-top:6px;color:var(--text-muted);font-size:11px";
        line.innerHTML = "VIS per-turn cost at this level: " + kids.length + " node descriptions ≈ " + descChars +
          " chars (no schemas). A flat 'dump every tool/schema' preamble is many× this — run <code>tools/eval_vis_navigation.py --live</code> for the measured turns/tokens.";
        out.appendChild(line);
      });
    } catch (e) {}
  }

  // --------------------------------------------------------- assistant ----
  function renderAssistant(host) {
    host.textContent = "Loading the VIS assistant…";
    AppUIAssets.load("feedback", "aiSidebar").then(function () {
      if (!(window.AppUIChatPanel && AppUIChatPanel.mountProfile)) { host.textContent = "Assistant unavailable."; return; }
      host.textContent = "";
      // STATIC half (prompt, tool_mode "vis") = manifest chat_profile; LIVE half = where you are.
      AppUIChatPanel.mountProfile(host, "knowledge/vis.assistant", {
        context: function () {
          var n = S.cur;
          return n ? "The user is looking at VIS node " + n.uri + " (" + (n.kind || "node") + ": " +
            (n.title || "") + ")." : "";
        },
      });
    }).catch(function () { host.textContent = "Assistant failed to load."; });
  }

  // ------------------------------------------------------------- mount ----
  window.AppUIReady.then(function () {
    S.app = AppUI.createApp({
      id: "knowledge-vis",
      title: "VIS — Virtual Information System",
      menubar: { theme: true },
      leftSidebar: { width: 300, tabs: [
        { id: "providers", label: "Providers", active: true, render: renderTree },
        { id: "bench", label: "🧪 Bench", render: renderBench },
      ] },
      rightSidebar: { width: 380, tabs: [ { id: "vis-ai", label: "🤖 Assistant", render: renderAssistant } ] },
      content: { render: renderContent },
      statusbar: {},
    });
    api("providers", {}).then(function (r) {
      S.providers = (r && r.providers) || [];
      S.byName = {};
      S.providers.forEach(function (p) { S.byName[p.name] = p; });
      if (TREE_READY) TREE_READY.then(renderRoots); else renderRoots();
      if (S.cur) { S.curProv = S.byName[providerOf(S.cur.uri)]; renderHeader(S.curProv); revealInTree(S.cur); }
    });
  }).catch(function (e) {
    var b = document.getElementById("app-content-body");
    if (b) b.innerHTML = '<div style="padding:18px">AppUI failed to load: ' + esc(e) + '</div>';
  });
})();
