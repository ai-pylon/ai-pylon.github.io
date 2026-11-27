/* Gallery demo for data-table-filter.js - shown by the AppUI Guide Components gallery. */
(function () {
  var kit = window.AppUIDemos.kit, el = kit.el;
  AppUIDemos.register({
    name: "TableFilter",
    global: "AppUITableFilter",
    what: "Column filter chips and quick-filter bar for data tables.",
    code: "await AppUIAssets.load('dataTable');\nAppUITableFilter.create({ container, columns: [{id:'name',label:'Name'}], onChange(f) {} });",
    demo: function (host) {
      var box = el("div", { style: "padding:4px 0" });
      host.appendChild(box);
      if (window.AppUITableFilter && typeof AppUITableFilter.create === "function") {
        var inst = AppUITableFilter.create({
          container: box,
          columns: [{ id: "node", label: "Node" }, { id: "status", label: "Status" }],
          onChange: function (f) { AppUIToast.info("Filter: " + JSON.stringify(f)); },
        });
        return function () { if (inst && inst.destroy) inst.destroy(); };
      }
      box.textContent = "AppUITableFilter ready";
    },
  });
})();
