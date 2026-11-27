/* Gallery demo for big-table.js - shown by the AppUI Guide (platform/appui_guide) Components gallery.
 * Kept next to the component; the AppUI catalog (framework/appui_catalog.py) finds it by the .demo.js suffix.
 * demo(host, kit) mounts into host and may return a cleanup (function or {destroy}); kit = {el, btn, esc}. */
(function () {
  var kit = window.AppUIDemos.kit, el = kit.el, btn = kit.btn;
  AppUIDemos.register({
    name: "BigTable", global: "AppUIBigTable",
    what: "A grid over a REMOTE row source of any size: it keeps a few row blocks and asks the host for the window on screen (here a generated 5 million rows).",
    code: "var grid = AppUIBigTable.create({ container: el, fetch: function (offset, limit) { return api('rows', { offset: offset, limit: limit }).then(function (r) { return r.rows; }); } });\ngrid.setView({ columns: [{ name: 'id', type: 'int' }, { name: 'name', type: 'text' }], total: 5000000 });",
    demo: function (host) {
      var box = el("div", { style: "width:100%;height:220px;border:1px solid var(--border);border-radius:6px" });
      host.appendChild(box);
      var grid = AppUIBigTable.create({ container: box,
        fetch: function (offset, limit) { var rows = []; for (var i = 0; i < limit; i++) rows.push([offset + i, "row " + (offset + i), ((offset + i) * 37 % 1000) / 10]); return Promise.resolve(rows); } });
      grid.setView({ columns: [{ name: "id", type: "int" }, { name: "name", type: "text" }, { name: "value", type: "double" }], total: 5000000 });
      return grid;
    },
  });
})();
