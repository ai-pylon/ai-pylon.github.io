/* Gallery demo for grid-view.js - shown by the AppUI Guide (platform/appui_guide) Components gallery.
 * Kept next to the component; the AppUI catalog (framework/appui_catalog.py) finds it by the .demo.js suffix.
 * demo(host, kit) mounts into host and may return a cleanup (function or {destroy}); kit = {el, btn, esc}. */
(function () {
  var kit = window.AppUIDemos.kit, el = kit.el, btn = kit.btn, esc = kit.esc;
  AppUIDemos.register({
    name: "GridView",
    global: "AppUIGridView",
    what: "A responsive card grid of items with a renderer.",
    code: "await AppUIAssets.load('collections');\nvar g = AppUIGridView.create({ container: host, viewMode: 'grid',\n  renderItem: function(it){ var d = document.createElement('div'); d.textContent = it.name; return d; } });\ng.setItems([{name:'Alpha'}, {name:'Beta'}]);",
    demo: function (host) {
      var box = el("div"); host.appendChild(box);
      try {
        var g = AppUIGridView.create({ container: box, persistKey: false, viewMode: "grid", renderItem: function (it) { var d = el("div", { style: "padding:8px" }); d.appendChild(el("b", null, it.name)); return d; } });
        g.setItems([{ name: "Alpha" }, { name: "Beta" }, { name: "Gamma" }]);
      }
      catch (e) { box.textContent = "GridView demo unavailable: " + e; }
    },
  });
})();
