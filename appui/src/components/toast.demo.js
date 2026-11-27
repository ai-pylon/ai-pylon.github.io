/* Gallery demo for toast.js - shown by the AppUI Guide (platform/appui_guide) Components gallery.
 * Kept next to the component; the AppUI catalog (framework/appui_catalog.py) finds it by the .demo.js suffix.
 * demo(host, kit) mounts into host and may return a cleanup (function or {destroy}); kit = {el, btn, esc}. */
(function () {
  var kit = window.AppUIDemos.kit, el = kit.el, btn = kit.btn, esc = kit.esc;
  AppUIDemos.register({
    name: "Toast",
    global: "AppUIToast",
    what: "Non-blocking corner notifications (success / error / info / warn).",
    code: "AppUIToast.success('Saved!');\nAppUIToast.error('Failed to connect');\nAppUIToast.info('Working…');\nAppUIToast.warn('Heads up');",
    demo: function (host) {
      ["success","info","warn","error"].forEach(function (k) {
        host.appendChild(btn(k, function () { AppUIToast[k](k.toUpperCase() + " toast from the gallery"); }));
      });
    },
  });
})();
