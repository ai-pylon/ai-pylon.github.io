/* Gallery demo for core.js - shown by the AppUI Guide (platform/appui_guide) Components gallery.
 * Kept next to the component; the AppUI catalog (framework/appui_catalog.py) finds it by the .demo.js suffix.
 * demo(host, kit) mounts into host and may return a cleanup (function or {destroy}); kit = {el, btn, esc}. */
(function () {
  var kit = window.AppUIDemos.kit, el = kit.el, btn = kit.btn, esc = kit.esc;
  AppUIDemos.register({
    name: "Notifications",
    global: "AppUINotifications",
    what: "A notification center (history of toasts/messages).",
    code: "await AppUIAssets.load('notifications');\nAppUINotifications.success('Done');  AppUINotifications.error('Oops');",
    demo: function (host) {
      host.appendChild(btn("push notification", function () {
        if (window.AppUINotifications) AppUINotifications.info("Gallery notification");
        else AppUIToast.info("notifications bundle not loaded");
      }));
    },
  });
})();
