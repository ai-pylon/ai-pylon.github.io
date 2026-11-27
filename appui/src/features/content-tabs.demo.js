/* Gallery demo for content-tabs.js - shown by the AppUI Guide (platform/appui_guide) Components gallery.
 * Kept next to the component; the AppUI catalog (framework/appui_catalog.py) finds it by the .demo.js suffix.
 * demo(host, kit) mounts into host and may return a cleanup (function or {destroy}); kit = {el, btn, esc}. */
(function () {
  var kit = window.AppUIDemos.kit, el = kit.el, btn = kit.btn;
  AppUIDemos.register({
    name: "ContentTabs", global: "AppUIContentTabs",
    needs: ["tabs"],
    what: "A content-area tab manager: each open document is a tab above a shared body; the page renders the active one.",
    code: "var tabs = AppUIContentTabs.create({ host: el, storageKey: 'my.contentTabs',\n  onActivate: function (key, meta) { render(tabs.body, key, meta); } });\ntabs.ensure(); tabs.open('/a.txt', { name: 'a.txt' });",
    demo: function (host) {
      var box = el("div", { style: "width:100%;height:150px;border:1px solid var(--border);border-radius:6px;display:flex;flex-direction:column" });
      host.appendChild(box);
      var tabs = AppUIContentTabs.create({ host: box, storageKey: "guide-demo-content-tabs", title: function (k, m) { return m.name; },
        onActivate: function (key, meta) { tabs.body.textContent = "document: " + meta.name; } });
      tabs.setEnabled(true);
      if (tabs.ensure()) {
        tabs.open("/docs/a.txt", { name: "a.txt" }); tabs.body.textContent = "document: a.txt";
        tabs.open("/docs/b.txt", { name: "b.txt" }); tabs.body.textContent = "document: b.txt";
      }
      return tabs;
    },
  });
})();
