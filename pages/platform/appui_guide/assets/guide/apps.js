import { cachedApi, debounce, dropCache, sectionHead } from "./helpers.js";
import { show } from "./main.js";
import { confirmAsync } from "./scaffold.js";
import { api, app, btn, el, esc, load } from "./state.js";

// ===================================================== APP CATALOG =========
// Pure (exported for the node test): group rows by the app's discovery CATEGORY (manifest category, else
// its folder group - the same placement as the catalog tree), preserving the sorted order inside each (#3).
function groupApps(apps) {
  var order = [], by = {};
  (apps || []).forEach(function (a) {
    var g = a.category || a.group || "(none)";
    if (!by[g]) { by[g] = []; order.push(g); }
    by[g].push(a);
  });
  order.sort();
  return order.map(function (g) { return { group: g, apps: by[g] }; });
}
function healthCell(a) {
  var h = a.health;
  if (!a.scenarios) return '<span class="g-sub" title="no scenarios declared">—</span>';
  if (!h) return '<span class="g-sub" title="' + a.scenarios + ' scenario(s); not run yet">·</span>';
  var tip = (h.passed || 0) + "/" + (h.total || 0) + " passed" +
    (h.error ? " — " + h.error : "") +
    ((h.failed || []).length ? " — failing: " + h.failed.map(function (f) { return f.op + (f.reason ? " (" + f.reason + ")" : ""); }).join("; ") : "");
  return '<span title="' + esc(tip) + '">' + (h.ok ? "✅" : "❌") + ' ' + (h.passed || 0) + '/' + (h.total || 0) + '</span>';
}
// Pure: the grouped table HTML. Each group gets a header row (click to
// collapse); each app row carries data-key (filter) + data-group.
function appsTableHtml(apps) {
  var h = '<table class="ai-table g-apps" style="width:100%;font-size:12px">' +
    '<tr><th>App</th><th>Page</th><th>Sidebar</th><th>Chat</th><th>Health</th></tr>';
  groupApps(apps).forEach(function (gp) {
    h += '<tr class="g-grp" data-group="' + esc(gp.group) + '"><td colspan="5">' +
         '<span class="g-caret">▾</span> <b>' + esc(gp.group) + '</b> <span class="g-sub">(' + gp.apps.length + ')</span></td></tr>';
    gp.apps.forEach(function (a) {
      var key = (a.app_id + " " + (a.title || "") + " " + (a.group || "") + " " + (a.category || "")).toLowerCase();
      var pageCell = a.has_page
        ? '<a href="' + esc(a.url) + '" target="_blank" rel="noopener">open ↗</a>'
        : '<span class="g-sub">—</span>';
      var sbCell = a.has_sidebar
        ? ('✅ ' + esc((a.sidebar_types || []).join(", ") || "yes") +
           ' <a href="#" class="g-sbprev" data-app="' + esc(a.app_id) + '" title="embed a live preview">preview</a>')
        : '<span class="g-sub">—</span>';
      var chatCell = a.has_chat_profile
        ? ('<span title="' + esc(a.profile_id || "") + '">✅</span>')
        : '<span class="g-sub">—</span>';
      h += '<tr class="g-app" data-key="' + esc(key) + '" data-group="' + esc(gp.group) + '" data-app="' + esc(a.app_id) + '">' +
           '<td><a href="#" class="g-detail-link" data-app="' + esc(a.app_id) + '"><b>' + esc(a.title || a.app_id) + '</b></a>' +
           '<div class="g-sub">' + esc(a.app_id) + (a.protected ? ' · protected' : '') + '</div></td>' +
           '<td>' + pageCell + '</td><td>' + sbCell + '</td>' +
           '<td style="text-align:center">' + chatCell + '</td>' +
           '<td>' + healthCell(a) + '</td></tr>';
    });
  });
  return h + '</table>';
}
// Pure: which app ids pass the filter (used for row hiding + the node test).
function filterApps(apps, q) {
  q = (q || "").toLowerCase().trim();
  return (apps || []).filter(function (a) {
    return !q || (a.app_id + " " + (a.title || "") + " " + (a.group || "") + " " + (a.category || "")).toLowerCase().indexOf(q) >= 0;
  }).map(function (a) { return a.app_id; });
}

function renderAppDetail(box, appId) {
  box.style.display = "block";
  box.innerHTML = '<div class="g-sub">Loading ' + esc(appId) + '…</div>';
  cachedApi("apps", { detail: appId }).then(function (r) {
    if (!r.ok) { box.innerHTML = '<div class="g-msg g-err">' + esc(r._error || "detail failed") + '</div>'; return; }
    var a = r.app || {};
    var h = '<div style="display:flex;align-items:center;gap:8px"><h3 style="flex:1;margin:0">' + esc(a.title || appId) +
      ' <span class="g-bundle">' + esc(appId) + '</span></h3>' +
      '<button class="btn sm" data-act="health">▶ run scenarios</button>' +
      '<button class="btn sm" data-act="close">✕</button></div>';
    if (a.description) h += '<div class="g-blurb">' + esc(a.description) + '</div>';
    var ops = a.ops || [];
    h += '<div class="g-grp-title">Ops (' + ops.length + ')</div><table class="ai-table" style="width:100%;font-size:12px"><tr><th>Op</th><th>Safety</th><th>Facets</th><th>Params</th></tr>';
    ops.forEach(function (o) {
      var ts = o.tool_schema || {};
      var params = ts.params ? Object.keys(ts.params).join(", ") : "";
      h += '<tr><td><code>' + esc(o.name) + '</code><div class="g-sub">' + esc(ts.description || o.description || "") + '</div></td>' +
           '<td>' + (o.safety === "confirm" ? "✏️ confirm" : "read_only") + '</td>' +
           '<td class="g-sub">' + esc((o.facets || []).join(", ")) + '</td>' +
           '<td class="g-sub">' + esc(params) + '</td></tr>';
    });
    h += '</table>';
    var na = a.needs_apps || [];
    if (na.length) h += '<div class="g-grp-title">Needs apps</div><div class="g-sub">' + na.map(function (n) {
      return (n.present ? "✅ " : "⚠️ ") + esc(n.id) + (n.ops && n.ops.length ? " (" + esc(n.ops.join(", ")) + ")" : "");
    }).join("<br>") + '</div>';
    var ex = (a.example_prompts || []).slice();   // copy: never mutate the cached payload
    (a.chat_profiles || []).forEach(function (p) {
      (p.example_prompts || []).forEach(function (e) { ex.push(e.prompt || e); });
    });
    if (ex.length) h += '<div class="g-grp-title">Example prompts</div><ul class="g-ul">' + ex.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join("") + '</ul>';
    (a.chat_profiles || []).forEach(function (p) {
      h += '<div class="g-grp-title">Chat profile <code>' + esc(p.id) + '</code></div><div class="g-sub">backend: ' + esc(p.backend || "default") +
           ' · scope: ' + esc((p.scope || []).join(", ")) + (p.warnings ? ' · ⚠️ ' + esc(p.warnings.join("; ")) : '') + '</div>';
    });
    var sc = a.scenarios || [];
    h += '<div class="g-grp-title">Scenarios (' + sc.length + ')</div>' +
         '<div class="g-sub" data-slot="health">' + (r.health ? healthCell({ scenarios: sc.length, health: r.health }) : (sc.length ? "not run yet" : "none declared")) + '</div>';
    box.innerHTML = h;
    box.querySelector('[data-act="close"]').onclick = function () { box.style.display = "none"; };
    var hb = box.querySelector('[data-act="health"]');
    if (!sc.length) hb.disabled = true;
    hb.onclick = function () {
      var slot = box.querySelector('[data-slot="health"]');
      slot.textContent = "running…";
      api("apps", { health: true, app_ids: [appId] }).then(function (hr) {
        dropCache("apps");
        var row = (hr.apps || []).filter(function (x) { return x.app_id === appId; })[0];
        slot.innerHTML = row ? healthCell(row) : esc(hr._error || "no result");
        if (row && row.health && row.health.failed && row.health.failed.length)
          slot.innerHTML += '<div>' + row.health.failed.map(function (f) { return "❌ " + esc(f.op) + (f.reason ? " — " + esc(f.reason) : ""); }).join("<br>") + '</div>';
      });
    };
  });
}

// Live sidebar preview (#2): embed the app's gallery sidebar in a dialog via
// AppUIPanelApp.embedSidebar (the same path the sidebar gallery uses).
function previewSidebar(appId) {
  cachedApi("sidebars", {}).then(function (r) {
    var spec = (r.sidebars || []).filter(function (s) { return s.app_id === appId; })[0];
    if (!spec) { if (window.AppUIToast) AppUIToast.warn("no sidebar spec for " + appId); return; }
    var body = el("div", { class: "g-sbhost" });
    body.textContent = "Loading " + (spec.label || spec.type) + "…";
    var dispose = null;
    var dlg = AppUIDialog.show({ title: "Sidebar preview — " + (spec.label || spec.type), body: body, width: "460px",
      buttons: [{ text: "Close", action: function () { if (typeof dispose === "function") dispose(); } }] });
    void dlg;
    if (spec.local) { body.textContent = "This sidebar is page-local (only embeddable on " + appId + "'s own page)."; return; }
    load("feedback").then(function () {           // ships AppUIPanelApp
      body.textContent = "";
      return AppUIPanelApp.embedSidebar(spec, body);
    }).then(function (d) { dispose = d; }).catch(function (e) { body.textContent = "embed failed: " + e; });
  });
}

function renderApps(host) {
  host.innerHTML = "";
  var wrap = el("div", { class: "g-wrap" });
  sectionHead(wrap, "📱 App catalog",
    "EVERY app loaded in the system (the live fleet from <code>apphost.HOST</code>), grouped — click a group to collapse it, an app to drill into its ops / needs / prompts / chat profile. Rows flag a <b>page</b>, an embeddable <b>sidebar</b> (with a live <i>preview</i>), a <b>chat profile</b>, and scenario <b>health</b>.",
    "apps", function () { renderApps(host); });
  var count = el("div", { class: "g-sub", style: "margin-bottom:8px" }, "Loading…");
  wrap.appendChild(count);
  var filterRow = el("div", { class: "g-row", style: "margin:0 0 8px" });
  var filt = el("input", { type: "text", placeholder: "🔍 filter by id / title / group…", class: "g-filter" });
  var healthAll = btn("▶ Run health (all with scenarios)", function () {
    confirmAsync("Run the direct-mode scenarios of every app that declares them? This calls each app's ops (write ops are preview-only) and can take a while.").then(function (ok) {
      if (!ok) return;
      healthAll.disabled = true; healthAll.textContent = "running…";
      api("apps", { health: true }).then(function (r) {
        dropCache("apps");
        healthAll.disabled = false; healthAll.textContent = "▶ Run health (all with scenarios)";
        if (r.ok) draw(r); else count.textContent = r._error || "health failed";
      });
    });
  });
  filterRow.appendChild(filt); filterRow.appendChild(healthAll);
  wrap.appendChild(filterRow);
  var detailBox = el("div", { class: "g-card g-detail", style: "display:none" });
  wrap.appendChild(detailBox);
  var listCard = el("div", { class: "g-card", style: "padding:0;overflow:auto" });
  wrap.appendChild(listCard);
  host.appendChild(wrap);
  var owner = window.AppUILifecycle.createViewScope({host: wrap});

  var collapsed = {};
  var appRows = [], grpRows = [];
  function apply() {
    var q = (filt.value || "").toLowerCase().trim();
    var seen = {};
    appRows.forEach(function (tr) {
      var g = tr.getAttribute("data-group");
      var match = !q || tr.getAttribute("data-key").indexOf(q) >= 0;
      if (match) seen[g] = true;
      tr.style.display = (match && (q || !collapsed[g])) ? "" : "none";   // a filter shows matches even in a collapsed group
    });
    grpRows.forEach(function (tr) {
      var g = tr.getAttribute("data-group");
      tr.style.display = seen[g] ? "" : "none";
      tr.querySelector(".g-caret").textContent = (collapsed[g] && !q) ? "▸" : "▾";
    });
  }
  function draw(r) {
    if (!owner.current()) return;
    var all = r.apps || [];
    var s = r.summary || {};
    count.innerHTML = "<b>" + (r.count || 0) + "</b> app(s) in " + Object.keys(r.groups || {}).length + " groups · " +
      (s.with_page || 0) + " with a page · " + (s.with_sidebar || 0) + " supply a sidebar · " +
      (s.with_chat_profile || 0) + " with a chat profile · " + (s.with_scenarios || 0) + " with scenarios" +
      (s.health_checked ? " · health: " + (s.health_checked - (s.health_failing || 0)) + "/" + s.health_checked + " passing" : "");
    if (!all.length) { listCard.innerHTML = '<div class="g-sub" style="padding:14px">No apps.</div>'; return; }
    listCard.innerHTML = appsTableHtml(all);   // built once per payload; filter only hides rows (#19)
    appRows = Array.prototype.slice.call(listCard.querySelectorAll("tr.g-app"));
    grpRows = Array.prototype.slice.call(listCard.querySelectorAll("tr.g-grp"));
    grpRows.forEach(function (tr) {
      tr.onclick = function () { var g = tr.getAttribute("data-group"); collapsed[g] = !collapsed[g]; apply(); };
    });
    listCard.querySelectorAll("a.g-detail-link").forEach(function (a) {
      a.onclick = function (e) { e.preventDefault(); renderAppDetail(detailBox, a.getAttribute("data-app")); detailBox.scrollIntoView({ block: "nearest" }); };
    });
    listCard.querySelectorAll("a.g-sbprev").forEach(function (a) {
      a.onclick = function (e) { e.preventDefault(); previewSidebar(a.getAttribute("data-app")); };
    });
    apply();
  }
  var filterLater = debounce(apply, 120);
  owner.add(filterLater.destroy);
  owner.listen(filt, "input", filterLater);
  cachedApi("apps", {}).then(function (r) {
    if (!r.ok) { count.textContent = r._error || "apps failed"; return; }
    draw(r);
  });
}

export { groupApps, healthCell, appsTableHtml, filterApps, renderAppDetail, previewSidebar, renderApps };
