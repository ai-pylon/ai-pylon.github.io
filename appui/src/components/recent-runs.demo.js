/* Gallery demo for recent-runs.js - shown by the AppUI Guide (platform/appui_guide) Components gallery.
 * Kept next to the component; the AppUI catalog (framework/appui_catalog.py) finds it by the .demo.js suffix.
 * demo(host, kit) mounts into host and may return a cleanup (function or {destroy}); kit = {el, btn, esc}. */
(function () {
  var kit = window.AppUIDemos.kit, el = kit.el, btn = kit.btn;
  AppUIDemos.register({
    name: "RecentRuns", global: "AppUIRecentRuns",
    what: "A compact, selectable list of recent runs with status dots; the page owns fetching and navigation.",
    code: "var runs = AppUIRecentRuns.create(host, { title: 'Recent', onSelect: function (rec) { open(rec.name); } });\nruns.update(AppUIRecentRuns.merge(running, completed, 10));",
    demo: function (host) {
      var box = el("div", { style: "width:100%;max-width:300px" });
      host.appendChild(box);
      var runs = AppUIRecentRuns.create(box, { title: "Recent runs", onSelect: function (rec) { AppUIToast.info("open " + rec.name); } });
      runs.update(AppUIRecentRuns.merge([{ name: "node-A dcgm", subtitle: "converting" }], [{ name: "cell trace 0518" }, { name: "bb pcap", status: "failed" }], 10));
      return runs;
    },
  });
})();
