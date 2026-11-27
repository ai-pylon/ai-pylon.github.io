/* Gallery demo for header.js - shown by the AppUI Guide (platform/appui_guide) Components gallery.
 * Kept next to the component; the AppUI catalog (framework/appui_catalog.py) finds it by the .demo.js suffix.
 * demo(host, kit) mounts into host and may return a cleanup (function or {destroy}); kit = {el, btn, esc}. */
(function () {
  var kit = window.AppUIDemos.kit, el = kit.el, btn = kit.btn, esc = kit.esc;
  AppUIDemos.register({
    name: "Header",
    global: "AppUIHeader",
    what: "A page/section header with a title, state, breadcrumbs, and contextual actions.",
    code: "await AppUIAssets.load('workspaceComponents');\nAppUIHeader.create({ container: host, title:'Settings', state:'Your preferences' });",
    demo: function (host) {
      var box = el("div"); host.appendChild(box);
      try { return (AppUIHeader.create || AppUIHeader)({ container: box, title: "Settings", state: "Your preferences" }); }
      catch (e) { box.textContent = "Header demo unavailable: " + e; }
    },
  });
})();
