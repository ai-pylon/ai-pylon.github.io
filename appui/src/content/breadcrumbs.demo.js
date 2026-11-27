/* Gallery demo for breadcrumbs.js - shown by the AppUI Guide (platform/appui_guide) Components gallery.
 * Kept next to the component; the AppUI catalog (framework/appui_catalog.py) finds it by the .demo.js suffix.
 * demo(host, kit) mounts into host and may return a cleanup (function or {destroy}); kit = {el, btn, esc}. */
(function () {
  var kit = window.AppUIDemos.kit, el = kit.el, btn = kit.btn, esc = kit.esc;
  AppUIDemos.register({
    name: "Breadcrumbs",
    global: "AppUIBreadcrumbs",
    what: "A path trail with clickable crumbs.",
    code: "await AppUIAssets.load('breadcrumbs');\nAppUIBreadcrumbs.create({ container: host,\n  items: [{label:'Home', onSelect(){…}}, {label:'Reports'}] });",
    demo: function (host) {
      var box = el("div"); host.appendChild(box);
      try { AppUIBreadcrumbs.create({ container: box, items: [{ label: "Home", onSelect: function () { AppUIToast.info("Home"); } }, { label: "Reports", onSelect: function () { AppUIToast.info("Reports"); } }, { label: "Q4" }] }); }
      catch (e) { box.textContent = "Breadcrumbs demo unavailable: " + e; }
    },
  });
})();
