/* Gallery demo for file-dialog.js - shown by the AppUI Guide Components gallery. */
(function () {
  var kit = window.AppUIDemos.kit, btn = kit.btn;
  AppUIDemos.register({
    name: "FileDialog",
    global: "AppUIFileDialog",
    what: "Modal file / folder chooser with list/details views and search filter.",
    code: "await AppUIAssets.load('fileDialog');\nAppUIFileDialog.open({ title: 'Choose file', onSelect(p) { … } });",
    demo: function (host) {
      host.appendChild(btn("Open FileDialog", function () {
        if (!window.AppUIFileDialog || typeof AppUIFileDialog.open !== "function") {
          AppUIToast.info("AppUIFileDialog loaded");
          return;
        }
        AppUIFileDialog.open({
          title: "Pick a sample file",
          entries: [
            { name: "report.md", kind: "file", size: 4200 },
            { name: "metrics.parquet", kind: "file", size: 128000 },
            { name: "archive", kind: "dir" },
          ],
          onSelect: function (sel) { AppUIToast.success("Selected: " + JSON.stringify(sel)); },
        });
      }));
    },
  });
})();
