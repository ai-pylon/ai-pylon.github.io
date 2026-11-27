/* Gallery demo for data-view.js - shown by the AppUI Guide (platform/appui_guide) Components gallery.
 * Kept next to the component; the AppUI catalog (framework/appui_catalog.py) finds it by the .demo.js suffix.
 * demo(host, kit) mounts into host and may return a cleanup (function or {destroy}); kit = {el, btn, esc}. */
(function () {
  var kit = window.AppUIDemos.kit, el = kit.el, btn = kit.btn;
  AppUIDemos.register({
    name: "DataView", global: "AppUIDataView",
    what: "A selectable list or table with a standard empty state.",
    code: "AppUIDataView.create({ container: host, mode: 'table', columns: [{ id: 'name', label: 'Name' }, { id: 'size', label: 'Size' }],\n  items: rows, getId: function (r) { return r.name; }, onSelectionChange: function (ids) { ... } });",
    demo: function (host) {
      var box = el("div", { style: "width:100%" }), out = el("div", { class: "g-sub", style: "margin-top:4px" }, "click a row");
      host.appendChild(box); host.appendChild(out);
      return AppUIDataView.create({ container: box, mode: "table", multi: true,
        columns: [{ id: "name", label: "Name" }, { id: "size", label: "Size" }],
        items: [{ name: "alpha.zip", size: "12 MB" }, { name: "beta.gpb", size: "3 MB" }, { name: "gamma.pcap", size: "88 MB" }],
        getId: function (r) { return r.name; },
        onSelectionChange: function (ids) { out.textContent = "selected: " + (ids.join(", ") || "none") + " (Ctrl for several)"; } });
    },
  });
})();
