/* Gallery demo for context-menu.js - shown by the AppUI Guide (platform/appui_guide) Components gallery.
 * Kept next to the component; the AppUI catalog (framework/appui_catalog.py) finds it by the .demo.js suffix.
 * demo(host, kit) mounts into host and may return a cleanup (function or {destroy}); kit = {el, btn, esc}. */
(function () {
  var kit = window.AppUIDemos.kit, el = kit.el, btn = kit.btn, esc = kit.esc;
  AppUIDemos.register({
    name: "ContextMenu",
    global: "AppUIContextMenu",
    what: "Right-click / anchored menu with viewport-aware placement.",
    code: "await AppUIAssets.load('contextMenu');\nAppUIContextMenu.show(event, [\n  { label:'Rename', action(){…} },\n  { label:'Delete', action(){…} },\n]);",
    demo: function (host) {
      host.appendChild(btn("right-click me ▾", function (ev) {
        AppUIContextMenu.show(ev, [
          { label: "Rename", action: function () { AppUIToast.info("Rename"); } },
          { label: "Duplicate", action: function () { AppUIToast.info("Duplicate"); } },
          { label: "Delete", action: function () { AppUIToast.warn("Delete"); } },
        ]);
      }));
    },
  });
})();
