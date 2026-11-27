/* Gallery demo for page-utils.js - shown by the AppUI Guide (platform/appui_guide) Components gallery.
 * Kept next to the component; the AppUI catalog (framework/appui_catalog.py) finds it by the .demo.js suffix.
 * demo(host, kit) mounts into host and may return a cleanup (function or {destroy}); kit = {el, btn, esc}. */
(function () {
  var kit = window.AppUIDemos.kit, el = kit.el, btn = kit.btn, esc = kit.esc;
  AppUIDemos.register({
    name: "withLoading",
    global: "AppUIPageUtils",
    what: "Overlay a spinner on an element for the duration of a promise.",
    code: "await AppUIAssets.load('runtimeServices');\nawait AppUIPageUtils.withLoading(host, fetch('/v1/…').then(r=>r.json()));",
    demo: function (host) {
      var target = el("div", { class: "g-card", style: "min-height:60px;position:relative;margin:0" }, "<span class='g-sub'>result area</span>");
      host.appendChild(target);
      host.appendChild(btn("run with spinner", function () {
        var p = new Promise(function (res) { setTimeout(res, 1400); });
        AppUIPageUtils.withLoading(target, p).then(function () { target.innerHTML = "<span class='g-sub'>done ✓</span>"; });
      }));
    },
  });
})();
