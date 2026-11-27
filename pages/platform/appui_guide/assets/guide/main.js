import { appsTableHtml, filterApps, groupApps, healthCell, renderApps } from "./apps.js";
import { catalogCoverage, renderCatalog } from "./catalog.js";
import { renderGallery } from "./gallery.js";
import { debounce } from "./helpers.js";
import { renderScaffold } from "./scaffold.js";
import { renderSidebars } from "./sidebars.js";
import { app, btn, bundlesReady, el, esc, load, setApp } from "./state.js";

var docsFeature;
function renderDocs(host) {
  if (!docsFeature) docsFeature = AppUILazyFeature.create({src:new URL('./docs.js', import.meta.url).href});
  return docsFeature.mount('renderDocs', host);
}

// ===================================================== MOUNT ===============
var SECTIONS = [
  { id: "components", label: "🧩 Components", render: renderGallery },
  { id: "catalog", label: "📋 Catalog", render: renderCatalog },
  { id: "apps", label: "📱 Apps", render: renderApps },
  { id: "sidebars", label: "🧰 Sidebars", render: renderSidebars },
  { id: "scaffold", label: "🛠️ Scaffold", render: renderScaffold },
  { id: "docs", label: "📚 Docs", render: renderDocs },
];
var contentHost = null, navHost = null, current = "components";
var sectionMount = null;
function show(id) {
  current = id;
  var sec = SECTIONS.filter(function (s) { return s.id === id; })[0] || SECTIONS[0];
  if (sectionMount) { sectionMount.destroy(); sectionMount = null; }
  if (contentHost) sectionMount = sec.render(contentHost) || null;
  if (navHost) navHost.querySelectorAll("button").forEach(function (b) {
    b.classList.toggle("btn-primary", b.getAttribute("data-id") === id);
  });
}
function renderNav(host) {
  navHost = host;
  host.innerHTML = '<div style="padding:10px 8px;display:flex;flex-direction:column;gap:6px"></div>';
  var col = host.firstChild;
  SECTIONS.forEach(function (s) {
    var b = el("button", { class: "btn", "data-id": s.id, style: "text-align:left" }, esc(s.label));
    b.onclick = function () { show(s.id); };
    col.appendChild(b);
  });
}

// Pure helpers exposed for tests/test_appui_guide_page.js.
window.AppUIGuide = { _test: { groupApps: groupApps, appsTableHtml: appsTableHtml, filterApps: filterApps,
  catalogCoverage: catalogCoverage, debounce: debounce, healthCell: healthCell } };

if (window.AppUIReady) {   // loaded outside the page (node test)
window.AppUIReady.then(function () {
  setApp(AppUI.createApp({
    id: "platform-appui_guide",
    title: "AppUI Guide",
    menubar: { theme: true },
    leftSidebar: { width: 190, render: renderNav },
    content: { render: function (root) { contentHost = root; show(current); } },
    statusBar: {},
  }));
  if (app && app.setStatus) app.setStatus("AppUI Guide — gallery, catalog, apps, scaffolders, and docs for building apps.");
  // the bundle catalog lets the gallery cards show deps → re-render once it lands
  bundlesReady().then(function () { if (current === "components") show("components"); });
}).catch(function (e) {
  var b = document.getElementById("app-content-body");
  if (b) b.innerHTML = '<div style="padding:18px">AppUI failed to load: ' + esc(e) + '</div>';
});
}

export { show, renderNav };
