/* Page Automation run-list rendering and successful-response cache. */
window.PageAutomationRuns = (() => {
  function create({api, esc, el, getSelectedCase, showFilmstrip, asyncCache}) {
    var _runsScope = "case";
    var cache = asyncCache.create({ttlMs: 4000, cacheIf: result => !!result && !!result.ok});
    function _runsCached(scopeId) {
      return cache.get(scopeId || "*", function () {
        return api("runs", scopeId ? {id: scopeId} : {});
      });
    }
  function renderRuns(container) {
    // Owned solely by the Runs tab's activate() hook. #pa-runs lives in the LEFT
    // SIDEBAR; find it document-wide (not under _root). If the pane's markup
    // isn't up yet (activate racing render), retry shortly.
    var host = container || document.getElementById("pa-runs");
    if (!host) { setTimeout(function () { renderRuns(); }, 30); return; }
    // Runs are SCOPED to the selected case by default (that's why the list can
    // look empty for a case with no runs). Make the scope EXPLICIT with a header
    // + an "all cases" toggle, so it's never a silent surprise.
    var scoped = (_runsScope !== "all") && getSelectedCase();
    var scopeLabel = scoped
      ? ('Runs for <b>' + esc(getSelectedCase()) + '</b> · <a href="#" id="pa-runs-all" class="pa-link">show all</a>')
      : ('Runs — <b>all cases</b>' + (getSelectedCase() ? ' · <a href="#" id="pa-runs-scoped" class="pa-link">only ' + esc(getSelectedCase()) + '</a>' : ''));
    // NEXT #11: watch (and step into) the managed browser while a run drives it.
    scopeLabel += ' · <a href="#" id="pa-mirror" class="pa-link" title="Live view of the managed browser tab a run is driving">mirror live browser</a>';
    host.innerHTML = '<div class="pa-runs-scope">' + scopeLabel + '</div>'
                   + '<div id="pa-runs-list"><span class="pa-meta">loading…</span></div>';
    var toggleAll = host.querySelector("#pa-runs-all");
    if (toggleAll) toggleAll.onclick = function (e) { e.preventDefault(); _runsScope = "all"; renderRuns(); };
    var toggleScoped = host.querySelector("#pa-runs-scoped");
    if (toggleScoped) toggleScoped.onclick = function (e) { e.preventDefault(); _runsScope = "case"; renderRuns(); };
    var mirror = host.querySelector("#pa-mirror");
    if (mirror) mirror.onclick = function (e) {
      e.preventDefault();
      if (window.PageAutomationMirror) window.PageAutomationMirror.open().catch(function (err) {
        try { AppUI.toast('Mirror failed: ' + ((err && err.message) || err), 'bad'); } catch (_e) {}
      });
    };
    var listHost = host.querySelector("#pa-runs-list");
    _runsCached(scoped ? getSelectedCase() : "").then(function (r) {
      if (!host.isConnected) return;
      if (!r.ok || !r.count) {
        listHost.innerHTML = '<span class="pa-meta">' +
          (scoped ? ("no runs for " + esc(getSelectedCase()) + " yet") : "no runs yet") + "</span>";
        return;
      }
      listHost.innerHTML = "";
      r.runs.forEach(function (run) {
        var extra = run.collected ? " · " + run.collected + " collected" : "";
        var line = el("div", "pa-run",
          '<div><b>' + esc(run.case || "?") + '</b> <span class="pa-tag ' + run.state + '">' + run.state + "</span></div>" +
          '<div class="pa-meta">' + esc(run.id) + "</div>" +
          '<div class="pa-meta">' + run.ticks + " ticks · " + run.shots + " shots" + extra + "</div>");
        line.onclick = function () { showFilmstrip(run.id); };
        listHost.appendChild(line);
      });
    });
  }

    return {renderRuns};
  }
  return {create};
})();
