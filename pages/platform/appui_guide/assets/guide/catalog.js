import { cachedApi, debounce, sectionHead } from "./helpers.js";
import { show } from "./main.js";
import { el, esc, load } from "./state.js";

// ===================================================== FULL CATALOG ========
// Pure: catalog rows → {rows, withDemo, gaps} given the demo set (#10).
function catalogCoverage(items, demoSet) {
  var gaps = items.filter(function (it) { return !demoSet[it.global]; });
  return { total: items.length, withDemo: items.length - gaps.length, gaps: gaps };
}
function renderCatalog(host) {
  host.innerHTML = "";
  var wrap = el("div", { class: "g-wrap" });
  sectionHead(wrap, "📋 Full component catalog",
    "EVERY AppUI* global the framework defines (from the framework catalog), its folder, its bundle, and whether this gallery has a live demo. Components with <b>no demo</b> are the gallery's coverage gap — tick the box to list just those. Load any with <code>AppUIAssets.load('&lt;bundle&gt;')</code>.",
    "catalog", function () { renderCatalog(host); });
  var filterRow = el("div", { class: "g-row" });
  var filter = el("input", { placeholder: "🔍 filter by name, folder or bundle…", class: "g-filter" });
  var gapLbl = el("label", { class: "g-sub", style: "display:flex;gap:4px;align-items:center" });
  var gapBox = el("input", { type: "checkbox" });
  gapLbl.appendChild(gapBox); gapLbl.appendChild(document.createTextNode("only components without a demo"));
  filterRow.appendChild(filter); filterRow.appendChild(gapLbl);
  wrap.appendChild(filterRow);
  var count = el("div", { class: "g-sub", style: "margin:6px 0" }, "Loading…");
  wrap.appendChild(count);
  var tableWrap = el("div", { class: "g-card", style: "padding:0;overflow:auto;max-height:66vh" });
  wrap.appendChild(tableWrap);
  host.appendChild(wrap);
  var owner = window.AppUILifecycle.createViewScope({host: wrap});

  cachedApi("catalog", {}).then(function (r) {
    if (!owner.current()) return;
    if (!r.ok) { count.textContent = r._error || "catalog failed"; return; }
    var items = r.items || [];
    var demoSet = {};      // from the framework catalog: a component has a demo when it keeps a <name>.demo.js
    items.forEach(function (it) { if (it.demo) demoSet[it.global] = true; });
    var cov = catalogCoverage(items, demoSet);
    // Build the table ONCE; filtering toggles row visibility (#19).
    var h = '<table class="ai-table" style="width:100%;font-size:12px"><tr><th>Component</th><th>Folder</th><th>Bundle</th><th>Demo</th><th>Source</th></tr>';
    items.forEach(function (it) {
      var key = (it.global + " " + (it.folder || "") + " " + (it.bundle || "")).toLowerCase();
      h += '<tr data-key="' + esc(key) + '" data-demo="' + (demoSet[it.global] ? 1 : 0) + '"><td><code>' + esc(it.global) + '</code></td>' +
           '<td class="g-sub">src/' + esc(it.folder || ".") + '</td>' +
           '<td>' + esc(it.bundle || "(core)") + '</td>' +
           '<td>' + (demoSet[it.global] ? '✅ <a href="#" class="g-try">try</a>' : '<span class="g-gap">no demo</span>') + '</td>' +
           '<td class="g-sub">' + esc((it.file || "").replace("/appui/src/", "")) + '</td></tr>';
    });
    tableWrap.innerHTML = h + '</table>';
    tableWrap.querySelectorAll('a.g-try').forEach(function (a) {
      a.onclick = function (e) { e.preventDefault(); show("components"); };
    });
    var trs = tableWrap.querySelectorAll("tr[data-key]");
    function apply() {
      var q = (filter.value || "").trim().toLowerCase(), onlyGaps = gapBox.checked, n = 0;
      trs.forEach(function (tr) {
        var vis = (!q || tr.getAttribute("data-key").indexOf(q) >= 0) &&
                  (!onlyGaps || tr.getAttribute("data-demo") === "0");
        tr.style.display = vis ? "" : "none";
        if (vis) n++;
      });
      count.innerHTML = "<b>" + n + "</b> shown · " + cov.withDemo + "/" + cov.total +
        " have a live demo · <b>" + cov.gaps.length + "</b> coverage gap(s)";
    }
    apply();
    var filterLater = debounce(apply, 120);
    owner.add(filterLater.destroy);
    owner.listen(filter, "input", filterLater);
    owner.listen(gapBox, "change", apply);
  });
}

export { catalogCoverage, renderCatalog };
