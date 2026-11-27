/* Gallery demo for log-view.js - shown by the AppUI Guide (platform/appui_guide) Components gallery.
 * Kept next to the component; the AppUI catalog (framework/appui_catalog.py) finds it by the .demo.js suffix.
 * demo(host, kit) mounts into host and may return a cleanup (function or {destroy}); kit = {el, btn, esc}. */
(function () {
  var kit = window.AppUIDemos.kit, el = kit.el, btn = kit.btn, esc = kit.esc;
  AppUIDemos.register({
    name: "LogView",
    global: "AppUILogView",
    what: "A scrolling log panel (append lines, levels).",
    code: "await AppUIAssets.load('logView');\nvar lv = AppUILogView.create({ container: host });\nlv.append('started', {level:'info'}); lv.append('oops', {level:'error'});",
    demo: function (host) {
      var box = el("div"); host.appendChild(box);
      try {
        box.style.cssText = "height:120px;overflow:auto";
        var lv = AppUILogView.create({ container: box });
        lv.append("started", { level: "info" });
        host.appendChild(btn("append line", function () { lv.append("log line @ " + new Date().toLocaleTimeString(), { level: "info" }); }));
      } catch (e) { box.textContent = "LogView demo unavailable: " + e; }
    },
  });
})();
