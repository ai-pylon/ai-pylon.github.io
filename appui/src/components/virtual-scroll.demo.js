/* Gallery demo for virtual-scroll.js - shown by the AppUI Guide (platform/appui_guide) Components gallery.
 * Kept next to the component; the AppUI catalog (framework/appui_catalog.py) finds it by the .demo.js suffix.
 * demo(host, kit) mounts into host and may return a cleanup (function or {destroy}); kit = {el, btn, esc}. */
(function () {
  var kit = window.AppUIDemos.kit, el = kit.el, btn = kit.btn, esc = kit.esc;
  AppUIDemos.register({
    name: "VirtualScroll",
    global: "AppUIVirtualScroll",
    what: "A windowed list that renders only visible rows (huge lists stay fast).",
    code: "await AppUIAssets.load('virtualScroll');\nvar vs = AppUIVirtualScroll.create({ container: scrollEl, content: rowsEl, rowHeight: 24,\\n  renderRow: function(item, i){ var d = document.createElement('div'); d.textContent = item; return d; } });\\nvs.setItems(bigArray);",
    demo: function (host) {
      var box = el("div", { style: "height:160px;border:1px solid var(--border);border-radius:6px;overflow:auto" });
      host.appendChild(box);
      try {
        var rowsEl = el("div"), items = [];
        box.appendChild(rowsEl);
        for (var i = 0; i < 10000; i++) items.push("row #" + i);
        var vs = AppUIVirtualScroll.create({ container: box, content: rowsEl, rowHeight: 24,
          renderRow: function (item) { return el("div", { style: "padding:3px 8px;font-size:12px;height:24px;box-sizing:border-box" }, item); } });
        vs.setItems(items);
      } catch (e) { box.textContent = "VirtualScroll demo unavailable: " + e; }
    },
  });
})();
