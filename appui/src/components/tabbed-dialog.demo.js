/* Gallery demo for tabbed-dialog.js - shown by the AppUI Guide (platform/appui_guide) Components gallery.
 * Kept next to the component; the AppUI catalog (framework/appui_catalog.py) finds it by the .demo.js suffix.
 * demo(host, kit) mounts into host and may return a cleanup (function or {destroy}); kit = {el, btn, esc}. */
(function () {
  var kit = window.AppUIDemos.kit, el = kit.el, btn = kit.btn, esc = kit.esc;
  AppUIDemos.register({
    name: "TabbedDialog",
    global: "AppUITabbedDialog",
    what: "A modal dialog whose body is a set of tabs (settings-style).",
    code: "await AppUIAssets.load('foundation');\nAppUITabbedDialog.open({ title:'Settings', tabs:[\n  {id:'gen',label:'General',render(el){…}},\n  {id:'adv',label:'Advanced',render(el){…}} ] });",
    demo: function (host) {
      host.appendChild(btn("open tabbed dialog", function () {
        try {
          AppUITabbedDialog.open({ title: "Settings", tabs: [
            { id: "gen", label: "General", render: function (e) { e.innerHTML = "<p class='g-sub'>General settings</p>"; } },
            { id: "adv", label: "Advanced", render: function (e) { e.innerHTML = "<p class='g-sub'>Advanced settings</p>"; } },
          ] });
        } catch (e) { AppUIToast.error("TabbedDialog unavailable: " + e); }
      }));
    },
  });
})();
