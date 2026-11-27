/* Gallery demo for menu.js - shown by the AppUI Guide (platform/appui_guide) Components gallery. */
(function () {
  var kit = window.AppUIDemos.kit, btn = kit.btn;
  AppUIDemos.register({
    name: "Menu",
    global: "AppUIMenu",
    what: "Keyboard-navigable popup menu with icons, shortcuts, separators and nested submenus.",
    code: "await AppUIAssets.load('menu');\nAppUIMenu.show(anchorEl, [\n  { label: 'New file', shortcut: 'Ctrl+N', action() {} },\n  { separator: true },\n  { label: 'Export', submenu: [{ label: 'PDF' }, { label: 'Markdown' }] },\n]);",
    demo: function (host) {
      var trigger = btn("Open menu ▾", function (ev) {
        if (!window.AppUIMenu || typeof AppUIMenu.show !== "function") {
          AppUIToast.info("AppUIMenu loaded");
          return;
        }
        AppUIMenu.show(trigger, [
          { label: "New file", shortcut: "Ctrl+N", action: function () { AppUIToast.info("New file"); } },
          { label: "Refresh", shortcut: "F5", action: function () { AppUIToast.info("Refresh"); } },
          { separator: true },
          { label: "Export", submenu: [
            { label: "PDF", action: function () { AppUIToast.info("Export PDF"); } },
            { label: "Markdown", action: function () { AppUIToast.info("Export Markdown"); } },
          ] },
        ], { event: ev });
      });
      host.appendChild(trigger);
    },
  });
})();
