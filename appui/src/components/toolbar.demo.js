/* Gallery demo for toolbar.js - shown by the AppUI Guide (platform/appui_guide) Components gallery.
 * Kept next to the component; the AppUI catalog (framework/appui_catalog.py) finds it by the .demo.js suffix.
 * demo(host, kit) mounts into host and may return a cleanup (function or {destroy}); kit = {el, btn, esc}. */
(function () {
  var kit = window.AppUIDemos.kit, el = kit.el, btn = kit.btn, esc = kit.esc;
  AppUIDemos.register({
    name: "Toolbar",
    global: "AppUIToolbar",
    what: "A content-top title + controls/actions region (the standard page toolbar).",
    code: "await AppUIAssets.load('toolbar');\nAppUIToolbar.create({ container: host, title:'Reports', subtitle:'Q4',\n  items:[{type:'button',label:'New',onClick(){…}}],\n  right:[{type:'button',label:'Refresh',onClick(){…}}] });",
    demo: function (host) {
      var box = el("div"); host.appendChild(box);
      try {
        AppUIToolbar.create({ container: box, title: "Reports", subtitle: "Q4 2026",
          items: [{ type: "button", label: "New", onClick: function () { AppUIToast.info("New"); } },
                  { type: "button", label: "Filter", onClick: function () { AppUIToast.info("Filter"); } }],
          right: [{ type: "button", label: "Refresh", onClick: function () { AppUIToast.info("Refresh"); } }] });
      } catch (e) { box.textContent = "Toolbar demo unavailable: " + e; }
    },
  });
})();
