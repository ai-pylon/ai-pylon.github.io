/* Gallery demo for workspace-folder-picker.js - shown by the AppUI Guide Components gallery. */
(function () {
  var kit = window.AppUIDemos.kit, btn = kit.btn;
  AppUIDemos.register({
    name: "WorkspaceFolderPicker",
    global: "AppUIWorkspaceFolderPicker",
    what: "Workspace-aware folder picker with registered workspace roots.",
    code: "await AppUIAssets.load('workspaceFolderPicker');\nAppUIWorkspaceFolderPicker.open({ onSelect(path) {} });",
    demo: function (host) {
      host.appendChild(btn("Pick workspace folder", function () {
        if (window.AppUIWorkspaceFolderPicker && typeof AppUIWorkspaceFolderPicker.open === "function") {
          AppUIWorkspaceFolderPicker.open({ onSelect: function (p) { AppUIToast.success("Picked: " + p); } });
        } else {
          AppUIToast.info("AppUIWorkspaceFolderPicker loaded");
        }
      }));
    },
  });
})();
