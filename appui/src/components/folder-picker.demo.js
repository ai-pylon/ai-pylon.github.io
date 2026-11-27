/* Gallery demo for folder-picker.js - shown by the AppUI Guide (platform/appui_guide) Components gallery.
 * Kept next to the component; the AppUI catalog (framework/appui_catalog.py) finds it by the .demo.js suffix.
 * demo(host, kit) mounts into host and may return a cleanup (function or {destroy}); kit = {el, btn, esc}. */
(function () {
  var kit = window.AppUIDemos.kit, el = kit.el, btn = kit.btn, esc = kit.esc;
  AppUIDemos.register({
    name: "FolderPicker",
    global: "AppUIFolderPicker",
    what: "Browse + pick a directory (pluggable listDirectories backend).",
    code: "await AppUIAssets.load('folderPicker');\nAppUIFolderPicker.create({ container: host, startPath:'/',\n  listDirectories: function(path){ return fetch(…).then(r=>r.json()); } });",
    demo: function (host) {
      host.appendChild(el("div", { class: "g-sub" }, "Needs a listDirectories backend (e.g. file/vfs). Load the 'folderPicker' bundle and pass your lister."));
    },
  });
})();
