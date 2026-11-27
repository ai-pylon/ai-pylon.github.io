/* Gallery demo for chart.js - shown by the AppUI Guide (platform/appui_guide) Components gallery.
 * Kept next to the component; the AppUI catalog (framework/appui_catalog.py) finds it by the .demo.js suffix.
 * demo(host, kit) mounts into host and may return a cleanup (function or {destroy}); kit = {el, btn, esc}. */
(function () {
  var kit = window.AppUIDemos.kit, el = kit.el, btn = kit.btn;
  AppUIDemos.register({
    name: "Chart", global: "AppUIChart",
    what: "A declarative chart (mark + encoding over columns) drawn with the vendored Plotly; follows the theme.",
    code: "var chart = AppUIChart.create({ container: host });\nchart.render({ chart: { title: 'Throughput', mark: 'line', encoding: { x: { field: 't' }, y: { field: 'mbps' } } },\n  columns: { t: [1, 2, 3, 4], mbps: [10, 40, 25, 60] } });",
    demo: function (host) {
      var box = el("div", { style: "width:100%;height:220px" });
      host.appendChild(box);
      var chart = AppUIChart.create({ container: box });
      chart.render({ chart: { title: "Throughput", mark: "line", encoding: { x: { field: "t", title: "t" }, y: { field: "mbps", title: "Mbit/s" } } },
        columns: { t: [1, 2, 3, 4, 5, 6], mbps: [10, 40, 25, 60, 35, 70] } });
      return chart;
    },
  });
})();
