import { previewSidebar } from "./apps.js";
import { cachedApi, sectionHead } from "./helpers.js";
import { app, el, esc } from "./state.js";

// ===================================================== SIDEBARS ===========
function renderSidebars(host) {
  host.innerHTML = "";
  var wrap = el("div", { class: "g-wrap" });
  sectionHead(wrap, "🧰 Sidebar gallery",
    "Every loaded app that declares a <code>sidebar</code> block — the embeddable sidebars (the set <code>AppUIPanelApp.openGallery</code> / <code>GET /v1/sidebars</code> expose). Each is listed with its type, owning app, and the assets a host page loads to embed it.",
    "sidebars", function () { renderSidebars(host); });
  var count = el("div", { class: "g-sub", style: "margin-bottom:8px" }, "Loading…");
  wrap.appendChild(count);
  var listCard = el("div", { class: "g-card", style: "padding:0;overflow:auto" });
  wrap.appendChild(listCard);
  host.appendChild(wrap);
  cachedApi("sidebars", {}).then(function (r) {
    if (!r.ok) { count.textContent = r._error || "sidebars failed"; return; }
    var items = r.sidebars || [];
    var profiles = r.profiles || [];
    count.innerHTML = "<b>" + items.length + "</b> embeddable sidebar(s) + <b>" + profiles.length +
      "</b> AI assistant(s) (declared chat profiles) - the same set the View → Sidebar Gallery dialog offers.";
    if (!items.length) {
      listCard.innerHTML = '<div class="g-sub" style="padding:14px">No app currently declares a sidebar block.</div>';
      return;
    }
    var h = '<table class="ai-table" style="width:100%;font-size:12px"><tr><th>Sidebar</th><th>Type</th><th>App</th><th>Assets</th><th></th></tr>';
    items.forEach(function (s) {
      var assets = s.assets || [];
      if (!Array.isArray(assets)) assets = [assets];
      if (s.bundle) assets = ["bundle:" + s.bundle].concat(assets);
      h += '<tr><td><b>' + esc((s.icon ? s.icon + " " : "") + (s.label || s.type || "(sidebar)")) + '</b></td>' +
           '<td>' + esc(s.type || "—") + '</td>' +
           '<td class="g-sub">' + esc(s.app_id || "—") + '</td>' +
           '<td class="g-sub">' + esc(assets.join(", ") || "—") + '</td>' +
           '<td>' + (s.local ? '<span class="g-sub">local</span>' : '<a href="#" class="g-sbprev" data-app="' + esc(s.app_id) + '">preview</a>') + '</td></tr>';
    });
    listCard.innerHTML = h + '</table>';
    if (profiles.length) {
      var p = '<div class="g-grp-title" style="padding:8px 10px 0">🤖 AI assistants (chat profiles)</div>' +
        '<table class="ai-table" style="width:100%;font-size:12px"><tr><th>Assistant</th><th>App</th><th>Backend</th><th>Tools in scope</th><th>Actions</th></tr>';
      profiles.forEach(function (pr) {
        p += '<tr><td><b>🤖 ' + esc(pr.label || pr.id) + '</b><div class="g-sub">' + esc(pr.id || "") + '</div></td>' +
             '<td class="g-sub">' + esc(pr.app_id || "—") + '</td>' +
             '<td>' + esc(pr.backend || "default") + '</td>' +
             '<td class="g-sub">' + esc((pr.scope || []).join(", ") || "—") + '</td>' +
             '<td class="g-sub">' + esc((pr.actions || []).join(", ") || "—") + '</td></tr>';
      });
      listCard.innerHTML += p + '</table>';
    }
    listCard.querySelectorAll("a.g-sbprev").forEach(function (a) {
      a.onclick = function (e) { e.preventDefault(); previewSidebar(a.getAttribute("data-app")); };
    });
  });
}

export { renderSidebars };
