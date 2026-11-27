/* Gallery demo for multi-split.js - shown by the AppUI Guide (platform/appui_guide) Components gallery.
 * Kept next to the component; the AppUI catalog (framework/appui_catalog.py) finds it by the .demo.js suffix.
 * demo(host, kit) mounts into host and may return a cleanup (function or {destroy}); kit = {el, btn, esc}. */
(function () {
  var kit = window.AppUIDemos.kit, el = kit.el, btn = kit.btn;
  AppUIDemos.register({
    name: "MultiSplit", global: "AppUIMultiSplit",
    what: "A resizable N-pane layout with ratios, minimum sizes and swap buttons.",
    code: "AppUIMultiSplit.create({ container: host, direction: 'horizontal', swappable: true, panes: [\n  { label: 'Editor', ratio: 0.5, render: function (el) { ... } },\n  { label: 'Preview', ratio: 0.5, render: function (el) { ... } } ] });",
    demo: function (host) {
      var box = el("div", { style: "width:100%;height:150px;border:1px solid var(--border);border-radius:6px" });
      host.appendChild(box);
      function pane(t) { return function (p) { p.appendChild(el("div", { class: "g-sub", style: "padding:8px" }, t)); }; }
      return AppUIMultiSplit.create({ container: box, direction: "horizontal", swappable: true, panes: [
        { label: "Editor", ratio: 0.4, render: pane("Pane 1 - drag the handle") },
        { label: "Preview", ratio: 0.35, render: pane("Pane 2") },
        { label: "Props", ratio: 0.25, minSize: 80, render: pane("Pane 3") } ] });
    },
  });
})();
