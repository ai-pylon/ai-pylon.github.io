/* Gallery demo for pagination.js - shown by the AppUI Guide (platform/appui_guide) Components gallery.
 * Kept next to the component; the AppUI catalog (framework/appui_catalog.py) finds it by the .demo.js suffix.
 * demo(host, kit) mounts into host and may return a cleanup (function or {destroy}); kit = {el, btn, esc}. */
(function () {
  var kit = window.AppUIDemos.kit, el = kit.el, btn = kit.btn, esc = kit.esc;
  AppUIDemos.register({
    name: "Pagination",
    global: "AppUIPagination",
    what: "Page navigation control (prev/next + page numbers).",
    code: "await AppUIAssets.load('pagination');\nAppUIPagination.create({ container: host, total: 120, pageSize: 10,\n  onPage: function(p){ load(p); } });",
    demo: function (host) {
      var box = el("div"); host.appendChild(box);
      try { (AppUIPagination.create || AppUIPagination)({ container: box, total: 95, pageSize: 10, page: 1, onPage: function (p) { AppUIToast.info("page " + p); } }); }
      catch (e) { box.textContent = "Pagination demo unavailable: " + e; }
    },
  });
})();
