// Run filmstrip rendering and run-to-case reconciliation.
(function (global) {
  "use strict";
  function create(deps) {
    var api = deps.api, log = deps.log, urlSet = deps.urlSet, esc = deps.esc, el = deps.el;
    var prefetchShots = deps.prefetchShots, shotURL = deps.shotURL, showCase = deps.showCase;
  function showFilmstrip(runId) {
    log("showFilmstrip", runId);
    urlSet("run", runId);
    var host = deps.getRoot().querySelector("#pa-strip");
    host.innerHTML = "loading…";
    var pre = prefetchShots(runId);
    Promise.all([api("run_detail", { run_id: runId }), pre]).then(function (res) {
      var d = res[0];
      if (!d.ok) { host.innerHTML = '<span class="pa-err">' + esc(d._error) + "</span>"; return; }
      var run = d.run;
      log("showFilmstrip run.case=", run.case, "_selCase=", deps.getSelectedCase());
      if (run.case) { deps.pinRunCase(runId, run.case); }
      // RECONCILE: the run's OWN case is authoritative. If the selected case (or
      // a mismatched ?case= deep-link) disagrees with the run's case, switch to
      // the run's case + correct the URL so the scheme shown matches the run.
      if (run.case && run.case !== deps.getSelectedCase()) {
        log("showFilmstrip RECONCILING scheme", deps.getSelectedCase(), "->", run.case);
        var item = document.querySelector('.pa-side-item[data-case="' + run.case + '"]');
        if (item) { item.click(); }     // selects the right case (updates ?case=)
        else { deps.setSelectedCase(run.case); urlSet("case", run.case); showCase(run.case); }
      }
      host.innerHTML = "";
      // header: which CASE this run exercised + its outcome (maps run -> scheme)
      var hdr = el("div", "pa-run-hdr",
        '<b>' + esc(run.case || "?") + '</b> <span class="pa-tag ' + run.state + '">' + run.state + "</span>" +
        ' <span class="pa-meta">' + esc(run.id) + " · schema v" + (run.schema_version || "?") + "</span>");
      // #15: one-click "Report issue" for THIS run — files to issue_report via
      // AppUI.debug.reportIssue with the run's trace + shot refs attached, so
      // triage gets the full structural context of a bad run without a screenshot
      // paste. (The debug bundle also auto-attaches page/URL/log/errors.)
      if (window.AppUI && AppUI.debug && AppUI.debug.reportIssue) {
        var rptBtn = el("button", "pa-report-btn", "⚑ Report issue");
        rptBtn.title = "File an issue for this run (trace + screenshots attached)";
        rptBtn.addEventListener("click", function () {
          AppUI.debug.reportIssue({
            title: "page_automation run " + run.id + " (" + (run.case || "?") + " → " + run.state + ")",
            kind: "bug",
            extra: {
              run_id: run.id, case: run.case, state: run.state,
              detail: run.detail || "", schema_version: run.schema_version,
              trace: run.trace || [], unmatched: run.unmatched || [],
              shots: (run.shots || []).map(function (s) {
                return { i: s.i, screen: s.screen, t: s.t, file: s.file };
              }),
              collected: run.collected || {},
            },
          });
        });
        hdr.appendChild(document.createTextNode(" "));
        hdr.appendChild(rptBtn);
      }
      host.appendChild(hdr);

      // collected data (gather cases): show the extracted values
      var coll = run.collected || {};
      if (Object.keys(coll).length) {
        var cbox = el("div", "pa-collected", '<div class="pa-side-h">Collected data</div>');
        Object.keys(coll).forEach(function (k) {
          var v = coll[k];
          var disp = Array.isArray(v) ? ("[" + v.length + "] " + v.slice(0, 6).join(", ")) : String(v);
          cbox.appendChild(el("div", "pa-kv", "<b>" + esc(k) + "</b>: " + esc(disp)));
        });
        host.appendChild(cbox);
      }

      // per-SCREEN mapping: screen + verdict + the EXACT actions/selectors + shot
      var strip = el("div", "pa-filmstrip");
      var seenShot = {};
      (run.trace || []).forEach(function (tk) {
        // one card per distinct screen-with-shot (or an actioned screen)
        if (tk.shot == null) {
          if (!(tk.actions && tk.actions.length)) return;   // skip bare poll ticks
        } else if (seenShot[tk.shot]) { return; }
        if (tk.shot != null) seenShot[tk.shot] = true;
        var frame = el("div", "pa-frame");
        frame.appendChild(el("div", "cap",
          "t=" + tk.t + " · " + esc(tk.screen || "—") + ' [' + tk.verdict + "]"));
        // the exact actions/selectors this screen ran (maps screenshot -> what was done)
        var acts = (tk.actions || []).map(function (a) {
          if (!a || typeof a !== "object") return String(a);
          if (a.selector) return a.type + "→" + a.selector;
          if (a.name) return a.type + ":" + a.name + "(" + (a.got != null ? a.got : "") + ")";
          if (a.url) return a.type + "→" + a.url;
          if (a.seconds != null) return "wait " + a.seconds + "s";
          return a.type;
        }).join("  ");
        if (acts) frame.appendChild(el("div", "pa-acts", esc(acts)));
        if (tk.shot != null) {
          var img = el("img");
          shotURL(runId, tk.shot).then(function (u) { if (u) img.src = u; });
          frame.appendChild(img);
        }
        strip.appendChild(frame);
      });
      host.appendChild(strip);
      if (!strip.children.length && !Object.keys(coll).length) {
        host.appendChild(el("div", "pa-meta", "no screenshots or data in this run"));
      }
    });
  }

    return { showFilmstrip: showFilmstrip };
  }
  global.PageAutomationFilmstrip = { create: create };
})(window);
