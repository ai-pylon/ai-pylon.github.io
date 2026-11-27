// page_automation — full AppUI page. Left sidebar lists cases + recent runs;
// content shows each screen's SCHEME next to a successful screenshot; selecting
// a run shows its filmstrip. Canonical AppUI.createApp pattern.
(function () {
  "use strict";
  var PA_VERSION = "pa-g6-editor";   // version stamp — printed to __palog at start
  var API = "/v1/apps/platform/page_automation/";
  function api(op, args) {
    return window.AppUIApi.requestResponse(API + op, args || {}, {
      method: "POST", timeout: null, headers: {"content-type": "application/json"},
      decode: function (response) { return response.json(); }
    }).then(function (response) { return response.data; });
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  var _app = null, _root = null, _selCase = null, _runCase = null, _runCaseByUrl = null;
  var shots = PageAutomationShots.create({
    api: api, asyncCache: window.AppUIAsyncCache,
    getSession: function () {
      return (window.AppUI && AppUI.utils && AppUI.utils.storage && AppUI.utils.storage.session) || null;
    }
  });
  // --- debug logging (so we can SEE the selection/reconcile sequence in the
  // browser console instead of guessing). Toggle with window.PA_DEBUG=false.
  // Debug logging: OFF by default in production (perf/#8). Enable with
  // ?debug=1 in the URL or window.PA_DEBUG=true in the console. The __palog
  // ring buffer is always kept (cheap) for AppUI.debug.reportIssue.
  window.PA_DEBUG = (window.PA_DEBUG === true) ||
    (typeof location !== "undefined" && /[?&]debug=1\b/.test(location.search));
  window.__palog = window.__palog || [];
  function log() {
    var args = [].slice.call(arguments);
    try { window.__palog.push(args.map(function (a) {
      return (typeof a === "object") ? JSON.stringify(a) : String(a); }).join(" ")); } catch (e) {}
    if (window.__palog.length > 200) window.__palog.shift();
    if (!window.PA_DEBUG) return;
    try { console.log.apply(console, ["[page_automation]"].concat(args)); } catch (e) {}
  }
  // URL params via the framework router (createApp facade .router):
  //   ?case=<id>&run=<id> (short aliases) or the namespaced
  //   ?appui.platform-page-automation.<key> form. Deep-links a case/run and
  //   back/forward navigation works via onRoute.
  function urlGet(key) {
    var v = null;
    try { v = (_app && _app.router) ? _app.router.get(key) : null; } catch (e) {}
    // Fallback: read straight from the query string if the router returned null
    // (the router/alias may not resolve the short key at init time).
    if (v == null) { try { v = new URLSearchParams(location.search).get(key); } catch (e) {} }
    log("urlGet", key, "=>", v);
    return v;
  }
  function urlSet(key, val) {
    log("urlSet", key, "=>", val);
    try { if (_app && _app.router) _app.router.set(key, val, { replace: true }); } catch (e) {}
  }
  function shotURL(runId, index) { return shots.shotURL(runId, index); }
  function prefetchShots(runId) { return shots.prefetchShots(runId); }

  function screenRow(sc) {
    var row = el("div", "pa-screen");
    var cl = sc.classify || "continue";
    var from = sc._from ? '<span class="pa-tag pa-frm">use ' + esc(sc._from) + "</span>" : "";
    var acts = (sc.do || []).map(function (a) { return a.type; }).join(" → ") || "—";
    row.appendChild(el("div", "pa-scheme",
      '<h4>' + esc(sc.name || "(unnamed)") + ' <span class="pa-tag ' + cl + '">' + cl + "</span> " + from + "</h4>" +
      '<div class="pa-when">when: ' + esc(JSON.stringify(sc.when || {})) + "</div>" +
      '<div class="pa-do">do: ' + esc(acts) + "</div>"));
    var shotBox = el("div", "pa-shot");
    if (sc.success_shot) {
      shotBox.appendChild(el("div", "cap", "✓ successful run"));
      var img = el("img");
      img.alt = (sc.name || "") + " (success)";
      shotURL(sc.success_shot.run_id, sc.success_shot.index).then(function (u) { if (u) img.src = u; });
      shotBox.appendChild(img);
    } else {
      shotBox.appendChild(el("div", "pa-noshot", "no successful screenshot yet"));
    }
    row.appendChild(shotBox);
    return row;
  }

  function showCase(id) {
    // GUARD: the run wins. Reject a contradictory showCase while a run pins a
    // different case. The pin is the in-memory _runCase OR, as a backstop, a
    // ?run in the URL (so a cleared/raced _runCase can't let a stale ?case flip
    // the scheme). Only a trusted sidebar click clears both (see item.onclick).
    var pin = _runCase;
    if (!pin) {
      try {
        var rp = (_app && _app.router) ? _app.router.get("run") : null;
        if (rp && _runCaseByUrl && _runCaseByUrl.run === rp) pin = _runCaseByUrl.case;
      } catch (e) {}
    }
    if (pin && id !== pin) {
      log("showCase IGNORED", id, "— run pins", pin);
      return;
    }
    log("showCase", id, "(prev _selCase=", _selCase, ") caller=",
        ((new Error()).stack || "").split("\n")[2] || "?");
    _selCase = id;
    urlSet("case", id);
    // If the Runs sidebar is already rendered, refresh it so its scope header
    // follows the newly-selected case (it's fine if #pa-runs doesn't exist yet).
    if (document.getElementById("pa-runs")) renderRuns();
    if (!_root) return;
    var host = _root.querySelector("#pa-screens");
    host.innerHTML = "loading…";
    api("get", { id: id }).then(function (r) {
      if (!r.ok) { host.innerHTML = '<span class="pa-err">' + esc(r._error) + "</span>"; return; }
      host.innerHTML = "";
      (r.resolved_screens || []).forEach(function (sc) { host.appendChild(screenRow(sc)); });
      // #16: a case is loaded — enable its JSON editor button.
      var eb = _root && _root.querySelector("#pa-edit-case");
      if (eb) { eb.disabled = false; eb.title = "Edit case '" + id + "' as JSON"; }
      if (_app) _app.setStatus("Case " + id + " — " + (r.resolved_screens || []).length + " screens");
    });
    // NOTE: do NOT drive the Runs sidebar from here. The Runs tab owns its own
    // list via its activate() hook — calling renderRuns() here (while the Runs
    // pane is hidden) raced/clobbered it on Runs->Cases->Runs navigation.
  }

  function renderCasesInto(container) {
    container.innerHTML = '<div class="pa-side-h">Cases</div><div id="pa-cases">loading…</div>';
    api("list", {}).then(function (r) {
      var host = container.querySelector("#pa-cases");
      if (!r.ok) { host.innerHTML = '<span class="pa-err">' + esc(r._error || "list failed") + "</span>"; return; }
      host.innerHTML = "";
      r.cases.forEach(function (c) {
        var item = el("div", "pa-side-item",
          esc(c.title || c.id) + '<div class="pa-meta">' + esc(c.id) + " · " + c.screens + " screens</div>");
        item.setAttribute("data-case", c.id);
        item.onclick = function (ev) {
          log("sidebar-item click", c.id, "trusted=", !!(ev && ev.isTrusted));
          // A real user picking a case is a deliberate switch to viewing THAT
          // case. Fully release the run: clear the pin + the URL ?run + the
          // filmstrip, so you never see a leftover run from a DIFFERENT case
          // next to the newly-selected scheme (that contradiction looked "wrong").
          if (ev && ev.isTrusted) {
            _runCase = null;
            _runCaseByUrl = null;
            urlSet("run", "");
            if (_root) { var strip = _root.querySelector("#pa-strip");
              if (strip) strip.innerHTML = '<span class="pa-meta">pick a run</span>'; }
          }
          Array.prototype.forEach.call(container.querySelectorAll(".pa-side-item"),
            function (x) { x.classList.remove("sel"); });
          item.classList.add("sel");
          showCase(c.id);
        };
        host.appendChild(item);
        if (c.id === _selCase) item.classList.add("sel");   // reflect current selection
      });
    });
  }

  // Startup deep-link / default selection — runs ONCE regardless of which tab is
  // active (the case-selection must NOT live inside a tab's render, since the
  // page may open on the Runs tab and never render the Cases tab). If ?run= is
  // present, the RUN'S OWN case wins (ignoring a mismatched ?case=).
  function initSelection() {
    var wantRun = urlGet("run");
    var wantCase = urlGet("case");
    log("initSelection start — wantRun=", wantRun, "wantCase=", wantCase);
    function pick(caseId) {
      log("initSelection.pick requested case=", caseId);
      api("list", {}).then(function (r) {
        var cases = (r.ok && r.cases) ? r.cases.map(function (c) { return c.id; }) : [];
        var chosen = (caseId && cases.indexOf(caseId) >= 0) ? caseId : (cases[0] || "");
        log("initSelection.pick chosen=", chosen, "(from", cases.length, "cases)");
        if (chosen) showCase(chosen);          // draws the scheme in the content area
        var caseItem = document.querySelector('.pa-side-item[data-case="' + chosen + '"]');
        if (caseItem) { Array.prototype.forEach.call(document.querySelectorAll(".pa-side-item"),
          function (x) { x.classList.remove("sel"); }); caseItem.classList.add("sel"); }
        if (wantRun) setTimeout(function () { showFilmstrip(wantRun); }, 100);
      });
    }
    if (wantRun) {
      api("run_detail", { run_id: wantRun }).then(function (d) {
        var rc = (d.ok && d.run && d.run.case) ? d.run.case : wantCase;
        _runCase = (d.ok && d.run && d.run.case) ? d.run.case : null;  // pin: run wins
        if (_runCase) _runCaseByUrl = { run: wantRun, case: _runCase };
        log("initSelection resolved run's case=", rc, "(run ok=", d.ok, ") pin=", _runCase);
        pick(rc);
      });
    } else {
      pick(wantCase);
    }
  }

  var filmstrip = PageAutomationFilmstrip.create({
    api: api, log: log, urlSet: urlSet, esc: esc, el: el,
    prefetchShots: prefetchShots, shotURL: shotURL, showCase: showCase,
    getRoot: function () { return _root; },
    getSelectedCase: function () { return _selCase; },
    setSelectedCase: function (id) { _selCase = id; },
    pinRunCase: function (run, id) { _runCase = id; _runCaseByUrl = { run: run, case: id }; }
  });

  var renderRuns = PageAutomationRuns.create({api, esc, el, getSelectedCase: function () { return _selCase; }, showFilmstrip, asyncCache: window.AppUIAsyncCache}).renderRuns;

  function showFilmstrip(runId) { return filmstrip.showFilmstrip(runId); }

  function mountContent(elm) {
    elm.classList.add("pa-content");
    elm.innerHTML =
      '<div class="pa-h pa-h-row"><span>Screens — scheme + successful screenshot</span>' +
      '<span class="pa-h-tools">' +
      '<button id="pa-edit-case" class="pa-tbtn" disabled title="Edit this case as JSON (schema-validated, version-snapshotted)">✎ Edit case</button>' +
      '<button id="pa-edit-frag" class="pa-tbtn" title="Edit a shared screen fragment">✎ Edit fragment</button>' +
      '</span></div>' +
      '<div id="pa-screens"><span class="pa-meta">pick a case</span></div>' +
      '<div class="pa-h">Run filmstrip</div>' +
      '<div id="pa-strip" class="pa-filmstrip"><span class="pa-meta">pick a run</span></div>';
    _root = elm;
    var eb = elm.querySelector("#pa-edit-case");
    if (eb) eb.addEventListener("click", function () { if (_selCase) openCaseEditor(_selCase); });
    var fb = elm.querySelector("#pa-edit-frag");
    if (fb) fb.addEventListener("click", function () { openFragmentPicker(); });
    return elm;
  }

  var _editors = PageAutomationEditors.create({api, esc, getApp: function () { return _app; }, getSelectedCase: function () { return _selCase; }, showCase});
  var openCaseEditor = _editors.openCaseEditor, openFragmentPicker = _editors.openFragmentPicker;

  window.AppUIReady.then(function () {
    // Register SHORT url aliases so the address bar shows ?case=/?run= instead
    // of the verbose appui.<id>.<key> form (framework AppUIRouter.alias).
    try {
      if (window.AppUIRouter && AppUIRouter.alias) {
        AppUIRouter.alias("platform-page-automation", "case", "case");
        AppUIRouter.alias("platform-page-automation", "run", "run");
      }
    } catch (e) { /* aliases optional */ }

    _app = AppUI.createApp({
      id: "platform-page-automation",
      title: "Page Automation",
      menu: { View: [{ id: "toggle-left", label: "Toggle sidebar" },
                     { id: "refresh", label: "Refresh" }] },
      onAction: function (menuName, id) {
        if (id === "toggle-left") _app.toggleLeftSidebar();
        else if (id === "refresh" && _selCase) showCase(_selCase);
      },
      onRoute: function () {
        var wantRun = urlGet("run");
        log("onRoute fired — run=", wantRun, "case=", urlGet("case"), "_selCase=", _selCase);
        if (wantRun) { log("onRoute: run pinned, not overriding"); return; }
        var want = urlGet("case");
        if (want && want !== _selCase) {
          var item = document.querySelector('.pa-side-item[data-case="' + want + '"]');
          if (item) item.click(); else showCase(want);
        }
      },
      leftSidebar: {
        width: 250,
        tabs: [
          { id: "cases", label: "Cases", active: true,
            render: function (c) { renderCasesInto(c); } },
          { id: "runs", label: "Runs",
            render: function (c) { c.innerHTML = '<div class="pa-side-h">Recent runs</div><div id="pa-runs">loading…</div>'; },
            activate: function () { renderRuns(); } },
        ],
      },
      content: { render: function (elm) { mountContent(elm); } },
      statusBar: {},
    });
    _app.setStatus("Page automation cases + run filmstrips.");
    log("VERSION", PA_VERSION, "createApp done; calling initSelection. url=", location.href);
    initSelection();   // deep-link / default selection, once, tab-independent
  }).catch(function (e) {
    document.getElementById("app-content-body").innerHTML =
      '<div style="padding:18px">AppUI failed to load: ' + esc(e) + "</div>";
  });
})();
