/* Gallery demo for tabs.js - shown by the AppUI Guide (platform/appui_guide) Components gallery.
 * Kept next to the component; the AppUI catalog (framework/appui_catalog.py) finds it by the .demo.js suffix.
 * demo(host, kit) mounts into host and may return a cleanup (function or {destroy}); kit = {el, btn, esc}. */
(function () {
  var kit = window.AppUIDemos.kit, el = kit.el, btn = kit.btn, esc = kit.esc;
  AppUIDemos.register({
    name: "Tabs",
    global: "AppUITabs",
    what: "A tab bar bound to panels (keyboard + ARIA).",
    code: "await AppUIAssets.load('tabs');\nconst tabs = AppUITabs.create({ container: bar, newTabButton: false,\n  onSwitch: tab => { panel.textContent = tab.title + ' panel'; } });\ntabs.add({id: 'a', title: 'Overview', pinned: true});\ntabs.add({id: 'b', title: 'Details'});\ntabs.switch('a');",
    demo: function (host) {
      var box = el("div", { style: "width:100%" }), bar = el("div"), panel = el("p", { class: "g-sub" });
      box.appendChild(bar); box.appendChild(panel); host.appendChild(box);
      var tabs = AppUITabs.create({ container: bar, newTabButton: false,
        onSwitch: function (tab) { panel.textContent = tab.title + " panel"; } });
      tabs.add({ id: "a", title: "Overview", pinned: true });
      tabs.add({ id: "b", title: "Details" });
      tabs.switch("a");
      return tabs.destroy ? function () { tabs.destroy(); } : undefined;
    },
  });
})();
