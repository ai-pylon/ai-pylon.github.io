/* Gallery demo for folder-picker-flat.js - shown by the AppUI Guide Components gallery. */
(function () {
  var kit = window.AppUIDemos.kit, el = kit.el;
  AppUIDemos.register({
    name: "FlatFolderPicker",
    global: "AppUIFlatFolderPicker",
    what: "Compact flat folder selector with breadcrumb navigation.",
    code: "await AppUIAssets.load('folderPicker');\nAppUIFlatFolderPicker.create({ container, folders: ['docs', 'src', 'tests'], onSelect(f) {} });",
    demo: function (host) {
      var box = el("div", { style: "padding:4px 0" });
      host.appendChild(box);
      if (window.AppUIFlatFolderPicker && typeof AppUIFlatFolderPicker.create === "function") {
        var inst = AppUIFlatFolderPicker.create({
          container: box,
          folders: ["apps", "docs", "framework", "tools"],
          onSelect: function (f) { AppUIToast.info("Folder: " + f); },
        });
        return function () { if (inst && inst.destroy) inst.destroy(); };
      }
      box.textContent = "AppUIFlatFolderPicker ready";
    },
  });
})();
