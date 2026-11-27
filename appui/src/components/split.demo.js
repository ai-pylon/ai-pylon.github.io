/* Gallery demo for split.js - shown by the AppUI Guide (platform/appui_guide) Components gallery.
 * Kept next to the component; the AppUI catalog (framework/appui_catalog.py) finds it by the .demo.js suffix.
 * demo(host, kit) mounts into host and may return a cleanup (function or {destroy}); kit = {el, btn, esc}. */
(function () {
  var kit = window.AppUIDemos.kit, el = kit.el, btn = kit.btn, esc = kit.esc;
  AppUIDemos.register({
    name: "Splitter",
    global: "AppUISplit",
    what: "A draggable divider between two panes.",
    code: "await AppUIAssets.load('splitter');\nAppUISplit.bind(handleEl, { container, direction:'horizontal', min:15, max:85 });",
    demo: function (host) {
      host.appendChild(el("div", { class: "g-sub" }, "Binds a handle element to resize two panes (the Workspace source/preview divider uses it, 15–85%)."));
    },
  });
})();
