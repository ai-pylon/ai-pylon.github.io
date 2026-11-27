// Terminal controls, per-session history and PTY size observation.
(function (global) {
  "use strict";
  function create(deps) {
    var api = deps.api, sess = deps.sess, submit = deps.submit;
    var connectAndPrompt = deps.connectAndPrompt, changeHost = deps.changeHost;
    var syncToolbar = deps.syncToolbar, endSession = deps.endSession;
    var APPOBJ = { setStatus: deps.setStatus };
    var bindingController = null, observer = null, resizeTimer = null;
    function destroy() {
      if (bindingController) bindingController.abort();
      if (observer) observer.disconnect();
      if (resizeTimer !== null) clearTimeout(resizeTimer);
      bindingController = observer = resizeTimer = null;
      _lastRz = { cols: 0, rows: 0, sid: null, host: null };
    }
    function bind() {
      destroy();
      var ROOT = deps.getRoot();
      var scope = bindingController = new AbortController();
      function on(selector, type, handler) {
        ROOT.querySelector(selector).addEventListener(type, handler, { signal: scope.signal });
      }
    on("#run", "click", submit);
    on("#cmd", "keydown", function (e) {
      var s = sess();
      // RAW MODE: forward keystrokes straight to the remote pane.
      if (s && s.raw) { deps.getRawMode().rawKey(s, e); return; }
      // NORMAL MODE: Enter runs; Up/Down walk per-session command history.
      if (e.key === "Enter") { histReset(s); submit(); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); histNav(s, -1); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); histNav(s, 1); return; }
    });
    on("#clear", "click", function () {
      var s = sess(); if (!s) return;
      if (s.raw && s.rawPre) { s.rawPre.textContent = ""; api("write", { host: s.host, id: s.sid, data: "C-l", keys: true }); }
      else s.screen.innerHTML = "";
    });
    on("#conn", "click", function () { var s = sess(); if (s) connectAndPrompt(s); });
    on("#rawbtn", "click", function () { deps.getRawMode().toggleRaw(); });

    on("#hostsel", "change", function (e) {
      var s = sess(); if (!s) return;
      var v = e.target.value, box = ROOT.querySelector("#host");
      if (v === "__custom__") { box.style.display = ""; box.focus(); return; }
      box.style.display = "none";
      changeHost(s, v);
    });
    on("#host", "change", function (e) {
      var s = sess(); if (s) changeHost(s, e.target.value.trim());
    });
    on("#oneshot", "change", function (e) {
      var s = sess(); if (s) { s.mode = e.target.checked ? "one-shot" : "session";
        if (s.raw) deps.getRawMode().exitRaw(s);
        syncToolbar();
        APPOBJ.setStatus(s.mode === "one-shot" ? "One-shot mode (real exit code)." : "Session mode (state persists)."); }
    });
    on("#shell", "change", function (e) {
      var s = sess(); if (s) { endSession(s).then(function(){ s.shell = e.target.value; }); }
    });
    on("#cwd", "change", function (e) { var s = sess(); if (s) s.cwd = e.target.value.trim(); });

      if (window.ResizeObserver) {
        observer = new ResizeObserver(function () {
          if (scope.signal.aborted) return;
          if (resizeTimer !== null) clearTimeout(resizeTimer);
          resizeTimer = setTimeout(function () {
            if (scope.signal.aborted) return;
            resizeTimer = null; sendResize();
          }, 250);
        });
        observer.observe(ROOT.querySelector("#screens"));
      }
    }
  // --- command history (per session, up/down) -------------------------------
  function histPush(s, cmd) {
    if (!s || !cmd) return;
    s.hist = s.hist || [];
    if (s.hist[s.hist.length - 1] !== cmd) s.hist.push(cmd);
    if (s.hist.length > 500) s.hist.shift();
    s.histIdx = s.hist.length;       // past the end = "current (empty) line"
  }
  function histReset(s) { if (s) s.histIdx = (s.hist || []).length; }
  function histNav(s, dir) {
    if (!s || !s.hist || !s.hist.length) return;
    if (s.histIdx == null) s.histIdx = s.hist.length;
    s.histIdx = Math.max(0, Math.min(s.hist.length, s.histIdx + dir));
    var inp = deps.getRoot().querySelector("#cmd");
    inp.value = (s.histIdx < s.hist.length) ? s.hist[s.histIdx] : "";
    try { inp.setSelectionRange(inp.value.length, inp.value.length); } catch (_) {}
  }

  // --- resize the active session's PTY to the current screen size -----------
  var _lastRz = { cols: 0, rows: 0, sid: null, host: null };
  function sendResize() {
    var s = sess(); if (!s || !s.created) return;
    var box = deps.getRoot().querySelector("#screens"); if (!box) return;
    // crude but effective cell estimate (monospace ~8.5px wide, ~18px line).
    var cols = Math.max(20, Math.floor(box.clientWidth / 8.5));
    var rows = Math.max(6, Math.floor(box.clientHeight / 18));
    if (cols === _lastRz.cols && rows === _lastRz.rows && s.sid === _lastRz.sid && (s.host || "") === _lastRz.host) return;
    _lastRz = { cols: cols, rows: rows, sid: s.sid, host: s.host || "" };
    var body = { id: s.sid, cols: cols, rows: rows };
    if (s.host) body.host = s.host;
    api("resize", body).catch(function () {});
  }

    return { bind: bind, destroy: destroy, histPush: histPush, sendResize: sendResize };
  }
  global.TerminalInput = { create: create };
})(window);
