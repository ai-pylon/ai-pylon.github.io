/* Gallery demo for floating-panel.js - shown by the AppUI Guide (platform/appui_guide) Components gallery.
 * Kept next to the component; the AppUI catalog (framework/appui_catalog.py) finds it by the .demo.js suffix.
 * demo(host, kit) mounts into host and may return a cleanup (function or {destroy}); kit = {el, btn, esc}. */
(function () {
  var kit = window.AppUIDemos.kit, el = kit.el, btn = kit.btn, esc = kit.esc;
  AppUIDemos.register({
    name: "FloatingPanel",
    global: "AppUIFloatingPanel",
    what: "A draggable floating panel / popover window.",
    code: "await AppUIAssets.load('floatingPanel');\nAppUIFloatingPanel.create({ title:'Inspector', body:'…', x:120, y:80 });",
    demo: function (host) {
      host.appendChild(btn("open floating panel", function () {
        try { (AppUIFloatingPanel.create || AppUIFloatingPanel)({ title: "Inspector", body: "A draggable floating panel.", x: 160, y: 120, width: 240 }); }
        catch (e) { AppUIToast.error("FloatingPanel unavailable: " + e); }
      }));
    },
  });
})();
