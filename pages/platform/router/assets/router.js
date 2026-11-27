// platform/router — this host's public hostnames: the Router-owned Caddy routes (desired vs live),
// the other live routes, diagnostics, and the versioned root Caddyfile.
// Served at /apps/platform/router/.
(function () {
  "use strict";
  var API = "/v1/apps/platform/router/";
  var main = null, status = null;

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
  function tell(msg, bad) { status.textContent = msg || ""; status.className = "rt-status" + (bad ? " bad" : ""); }
  function css() {
    var st = node("style");
    st.textContent = [
      ".rt-main{padding:16px 20px;max-width:1150px}",
      ".rt-main h2{margin:22px 0 8px;font-size:15px;text-transform:uppercase;letter-spacing:.05em;opacity:.75}",
      ".rt-table{width:100%;border-collapse:collapse;font-size:13px}",
      ".rt-table th{text-align:left;font-weight:600;opacity:.7;padding:6px 8px;border-bottom:1px solid var(--appui-border,rgba(127,127,127,.3))}",
      ".rt-table td{padding:6px 8px;border-bottom:1px solid var(--appui-border,rgba(127,127,127,.15));vertical-align:top}",
      ".rt-table code{font-size:12px}",
      ".rt-chip{display:inline-block;padding:1px 8px;border-radius:9px;font-size:11.5px;border:1px solid currentColor;white-space:nowrap}",
      ".ok{color:#2f9e44}.bad{color:#d0453a}.na{color:#868e96}",
      ".rt-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:6px 0 10px}",
      ".rt-note{font-size:12.5px;opacity:.75;margin:4px 0}",
      ".rt-banner{border:1px solid var(--appui-border,rgba(127,127,127,.3));border-radius:10px;padding:10px 14px;margin:6px 0 4px}",
      ".rt-status{min-height:1.2em;font-size:12.5px;opacity:.85}.rt-status.bad{color:#d0453a;opacity:1}",
      ".rt-pre{max-height:360px;overflow:auto;font-size:12px;background:rgba(127,127,127,.08);padding:10px;border-radius:8px;white-space:pre}",
    ].join("\n");
    document.head.appendChild(st);
  }
  function chip(flag, yes, no, na) {
    var cls = flag === true ? "ok" : flag === false ? "bad" : "na";
    return node("span", flag === true ? yes : flag === false ? no : na, {"class": "rt-chip " + cls});
  }
  function routeTable(rows, withLive) {
    var t = node("table", null, {"class": "rt-table"});
    t.innerHTML = "<thead><tr><th>Host</th><th>Paths</th><th>Goes to</th>" + (withLive ? "<th>Live</th>" : "") + "<th>Route id</th></tr></thead>";
    var tb = node("tbody");
    rows.forEach(function (r) {
      var tr = node("tr");
      var h = node("td");
      (r.hosts || []).forEach(function (x, i) {
        if (i) h.appendChild(document.createTextNode(", "));
        h.appendChild(node("a", x, {href: "https://" + x + "/", target: "_blank", rel: "noopener"}));
      });
      tr.appendChild(h);
      tr.appendChild(node("td", (r.paths || []).join(" ") || "all"));
      tr.appendChild(node("td", r.action));
      if (withLive) { var l = node("td"); l.appendChild(chip(r.live, r.via === "static" ? "live (Caddyfile)" : "live", "missing", "n/a")); tr.appendChild(l); }
      var id = node("td"); id.appendChild(node("code", r.id || "–")); tr.appendChild(id);
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    return t;
  }

  function act(op, args, ask) {
    if (ask && !confirm(ask)) return;
    tell("working…");
    api(op, Object.assign({confirm: true}, args || {})).then(function (r) {
      if (!r.ok) { tell(r.error || r._error || "failed", true); return; }
      tell(op + ": " + (r.result || "done") + (r.remaining_routes != null ? " (" + r.remaining_routes + " routes left)" : ""));
      refresh(true);
    }).catch(function (e) { tell(e.message, true); });
  }

  function render(st) {
    var body = node("div");
    var banner = node("div", null, {"class": "rt-banner"});
    if (st.caddy) {
      banner.appendChild(node("strong", "Caddy is running on this host "));
      banner.appendChild(node("span", "(admin " + st.admin + ", " + st.total_live + " live routes). Base domain " + st.base + "."));
    } else {
      banner.appendChild(node("strong", "Nothing to route here. "));
      banner.appendChild(node("span", st.note || ""));
    }
    body.appendChild(banner);

    body.appendChild(node("h2", "Router-owned routes"));
    body.appendChild(routeTable(st.routes || [], true));
    if (st.caddy) {
      var bar = node("div", null, {"class": "rt-bar"});
      bar.appendChild(btn("Run checks", function () { runChecks(); }, true, "routes live + every upstream answering"));
      bar.appendChild(btn("Reconcile routes", function () {
        act("apply", {}, "Re-apply the Router-owned routes in the live Caddy config? Other routes are kept; a snapshot is saved.");
      }));
      bar.appendChild(btn("Add gateway route", function () {
        act("gateway", {action: "apply"}, "Add the pylon-server gateway route (pylon." + st.base + ")?");
      }));
      bar.appendChild(btn("Remove gateway route", function () {
        act("gateway", {action: "remove"}, "Remove the pylon-server gateway route? pylon." + st.base + " stops answering.");
      }));
      bar.appendChild(btn("Roll back", function () {
        act("rollback", {}, "Remove every Router-owned route and restore the pre-migration routes from the snapshot?");
      }, false, "undo the Router routes"));
      body.appendChild(bar);
      body.appendChild(checks = node("div"));
      if ((st.other_routes || []).length) {
        body.appendChild(node("h2", "Other live routes (not touched)"));
        body.appendChild(routeTable(st.other_routes, false));
      }
    }

    body.appendChild(node("h2", "Root Caddyfile"));
    var p = node("p", null, {"class": "rt-note"});
    p.appendChild(chip(st.static_matches, "installed = versioned", "installed one differs", "none installed here"));
    p.appendChild(document.createTextNode("  The static file is installed by an operator with root (impl/deploy-root.sh, which validates, backs up, reloads and probes, restoring on failure); never from here."));
    body.appendChild(p);
    var det = node("details"); det.appendChild(node("summary", "Show the versioned Caddyfile"));
    var pre = node("pre", "", {"class": "rt-pre"}); det.appendChild(pre);
    det.addEventListener("toggle", function () {
      if (det.open && !pre.textContent) api("caddyfile", {}).then(function (c) {
        pre.textContent = c.ok ? c.caddyfile + "\n" + c.pending : (c.error || "unavailable");
      });
    });
    body.appendChild(det);
    return body;
  }
  var checks = null;

  function runChecks() {
    if (!checks) return;
    checks.replaceChildren(node("p", "checking…", {"class": "rt-note"}));
    api("check", {}).then(function (r) {
      checks.replaceChildren();
      if (!r.checks) { checks.appendChild(node("p", r.error || r._error || "failed", {"class": "rt-note bad"})); return; }
      var t = node("table", null, {"class": "rt-table"});
      t.innerHTML = "<thead><tr><th>Check</th><th>Result</th><th></th></tr></thead>";
      Object.keys(r.checks).forEach(function (k) {
        var v = r.checks[k], tr = node("tr");
        tr.appendChild(node("td", k.replace(/_/g, " ")));
        var c = node("td"); c.appendChild(chip(!!v.ok, "ok", "failed", "")); tr.appendChild(c);
        tr.appendChild(node("td", v.mode ? v.mode + " (" + v.count + " routes)" : v.status ? "HTTP " + v.status : (v.error || "")));
        t.appendChild(tr);
      });
      checks.appendChild(t);
      tell(r.ok ? "all checks passed" : "some checks failed", !r.ok);
    }).catch(function (e) { tell(e.message, true); });
  }

  function refresh(keep) {
    return api("status", {}).then(function (st) {
      if (!st.ok) { tell(st.error || st._error || "could not load", true); return; }
      if (main.lastChild && main.lastChild !== status) main.removeChild(main.lastChild);
      main.appendChild(render(st));
      if (!keep) tell("");
    }).catch(function (e) { tell(e.message, true); });
  }

  css();
  window.AppUIReady.then(function () {
    AppUI.createApp({
      id: "platform-router", title: "Router",
      content: {render: function (host) {
        main = node("div", null, {"class": "rt-main"});
        status = node("p", "", {role: "status", "class": "rt-status"});
        main.appendChild(status);
        host.appendChild(main);
        refresh();
      }},
    });
  });
})();
