/* Gallery demo for event-bus.js - shown by the AppUI Guide (platform/appui_guide) Components gallery.
 * Kept next to the component; the AppUI catalog (framework/appui_catalog.py) finds it by the .demo.js suffix.
 * demo(host, kit) mounts into host and may return a cleanup (function or {destroy}); kit = {el, btn, esc}. */
(function () {
  var kit = window.AppUIDemos.kit, el = kit.el, btn = kit.btn, esc = kit.esc;
  AppUIDemos.register({
    name: "EventBus",
    global: "AppUIEventBus",
    what: "ONE SSE connection multiplexing live channels (files/jobs/your own).",
    code: "await AppUIAssets.load('runtimeServices');\nvar bus = new AppUIEventBus(['files','jobs']);\nbus.on('files','changed', function(data){ … });\n// publish (server-side): framework.events.publish('files','changed', {…})",
    demo: function (host) {
      host.appendChild(el("div", { class: "g-sub" }, "Live SSE — subscribe to a channel and watch frames arrive (publish from any app via framework.events.publish)."));
    },
  });
})();
