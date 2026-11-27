/* Gallery demo for logging.js - shown by the AppUI Guide (platform/appui_guide) Components gallery.
 * Kept next to the component; the AppUI catalog (framework/appui_catalog.py) finds it by the .demo.js suffix.
 * demo(host, kit) mounts into host and may return a cleanup (function or {destroy}); kit = {el, btn, esc}. */
(function () {
  var kit = window.AppUIDemos.kit, el = kit.el, btn = kit.btn, esc = kit.esc;
  AppUIDemos.register({
    name: "Structured Logger",
    global: "AppUILogger",
    what: "Send structured records to platform/log. Uncaught errors are captured automatically.",
    code: "AppUILogger.create('my/app').info('Work completed', {job_id: 'example'});",
    demo: function (host) {
      host.appendChild(btn("Write gallery log", function () {
        AppUILogger.create('platform/appui_guide').info('Logger gallery example');
      }));
    },
  });
})();
