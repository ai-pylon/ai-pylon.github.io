/* Gallery demo for preview-table.js - shown by the AppUI Guide (platform/appui_guide) Components gallery.
 * Kept next to the component; the AppUI catalog (framework/appui_catalog.py) finds it by the .demo.js suffix.
 * demo(host, kit) mounts into host and may return a cleanup (function or {destroy}); kit = {el, btn, esc}. */
(function () {
  var kit = window.AppUIDemos.kit, el = kit.el, btn = kit.btn;
  AppUIDemos.register({
    name: "PreviewTable", global: "AppUIPreviewTable",
    what: "The shared sortable table the file previewers use for rows: click a header to sort; long tables render the first rows with a show-all control.",
    code: "var box = document.createElement('div');\nAppUIPreviewTable.mountTable({ box: box }, AppUIPreviewTable.tableHtml(['name', 'size'], rows, 'caption'));\nAppUIPreviewTable.wireTable(box, ['name', 'size'], rows);",
    demo: function (host) {
      var box = el("div", { style: "width:100%;height:200px;overflow:auto;border:1px solid var(--border);border-radius:6px" });
      host.appendChild(box);
      var header = ["name", "size", "type"], rows = [];
      for (var i = 0; i < 40; i++) rows.push(["file-" + (40 - i) + ".dat", (i * 7919) % 1000, i % 3 ? "pcap" : "gpb"]);
      AppUIPreviewTable.mountTable({ box: box }, AppUIPreviewTable.tableHtml(header, rows, "40 rows - click a header to sort"));
      AppUIPreviewTable.wireTable(box, header, rows);
    },
  });
})();
