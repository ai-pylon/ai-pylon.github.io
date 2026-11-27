/* Gallery demo for data-table.js - shown by the AppUI Guide (platform/appui_guide) Components gallery.
 * Kept next to the component; the AppUI catalog (framework/appui_catalog.py) finds it by the .demo.js suffix.
 * demo(host, kit) mounts into host and may return a cleanup (function or {destroy}); kit = {el, btn, esc}. */
(function () {
  var kit = window.AppUIDemos.kit, el = kit.el, btn = kit.btn, esc = kit.esc;
  AppUIDemos.register({
    name: "DataTable",
    global: "AppUIDataTable",
    what: "Built-in find, per-column text/numeric-range filters with min/max inputs and sliders, right-click header menus, column visibility and drag/drop ordering (optional stateKey persistence); per-row detail, onRowHover(row|null), and setHighlighted(id,{scroll:true}) for linked views.",
    code: "await AppUIAssets.load('dataTable');\nAppUIDataTable.create({ container: host,\n  columns:[{id:'name',label:'Name'},{id:'role',label:'Role'}],\n  items:[{name:'Ann',role:'Dev'},{name:'Bo',role:'PM'}] });",
    demo: function (host) {
      var box = el("div"); host.appendChild(box);
      try {
        (AppUIDataTable.create || AppUIDataTable)({ container: box,
          columns: [{ id: "name", label: "Name" }, { id: "role", label: "Role" }, { id: "team", label: "Team" }],
          items: [{ name: "Ann", role: "Dev", team: "PEG4" }, { name: "Bo", role: "PM", team: "PEG4" }, { name: "Cy", role: "QA", team: "Tiger" }] });
      } catch (e) { box.textContent = "DataTable demo unavailable: " + e; }
    },
  });
})();
