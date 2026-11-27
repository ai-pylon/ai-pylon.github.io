/* Gallery demo for table-workbench.js - shown by the AppUI Guide Components gallery. */
(function () {
  var kit = window.AppUIDemos.kit, el = kit.el;
  AppUIDemos.register({
    name: "TableWorkbench",
    global: "AppUITableWorkbench",
    what: "Full tabular viewer workbench with query bar, column facets, sorting and pagehide cleanup.",
    code: "await AppUIAssets.load('tableWorkbench');\nAppUITableWorkbench.create({ container, title: 'Sample Table', rows: [...] });",
    demo: function (host) {
      var box = el("div", { style: "min-height:140px" });
      host.appendChild(box);
      if (window.AppUITableWorkbench && typeof AppUITableWorkbench.create === "function") {
        var inst = AppUITableWorkbench.create({
          container: box,
          title: "Demo Table",
          columns: [{ id: "id", label: "ID" }, { id: "value", label: "Value" }],
          rows: [{ id: "row-1", value: 42 }, { id: "row-2", value: 99 }],
        });
        return function () { if (inst && inst.destroy) inst.destroy(); };
      }
      box.textContent = "AppUITableWorkbench ready";
    },
  });
})();
