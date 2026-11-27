/* Gallery demo for resizer.js - shown by the AppUI Guide (platform/appui_guide) Components gallery.
 * Kept next to the component; the AppUI catalog (framework/appui_catalog.py) finds it by the .demo.js suffix.
 * demo(host, kit) mounts into host and may return a cleanup (function or {destroy}); kit = {el, btn, esc}. */
(function () {
  var kit = window.AppUIDemos.kit, el = kit.el, btn = kit.btn;
  AppUIDemos.register({
    name: "Resizer", global: "AppUIResizer",
    what: "A generic drag-to-resize handle with min/max and an end callback.",
    code: "AppUIResizer.create({ handle: handleEl, direction: 'horizontal', min: 120, max: 480,\n  onResize: function (size) { panel.style.width = size + 'px'; } });",
    demo: function (host) {
      var row = el("div", { style: "display:flex;width:100%;height:90px;border:1px solid var(--border);border-radius:6px;overflow:hidden" });
      var left = el("div", { class: "g-sub", style: "width:160px;padding:8px;flex:none" }, "drag the bar"), handle = el("div", { style: "width:6px;cursor:col-resize;background:var(--border);flex:none" });
      var right = el("div", { class: "g-sub", style: "padding:8px;flex:1" }, "");
      row.append(left, handle, right); host.appendChild(row);
      var r = AppUIResizer.create({ handle: handle, direction: "horizontal", min: 80, max: 360, onResize: function (n) { left.style.width = n + "px"; right.textContent = "width " + Math.round(n) + " px"; } });
      return r;
    },
  });
})();
