/* Gallery demo for statusbar.js - shown by the AppUI Guide (platform/appui_guide) Components gallery.
 * Kept next to the component; the AppUI catalog (framework/appui_catalog.py) finds it by the .demo.js suffix.
 * demo(host, kit) mounts into host and may return a cleanup (function or {destroy}); kit = {el, btn, esc}. */
(function () {
  var kit = window.AppUIDemos.kit, el = kit.el, btn = kit.btn;
  AppUIDemos.register({
    name: "StatusBar", global: "AppUIStatusBar",
    what: "A status bar with named sections and a history log.",
    code: "var bar = AppUIStatusBar.create({ container: host, sections: [{ id: 'msg', initial: 'Ready' }, { id: 'count', title: 'Rows' }] });\nbar.set('msg', 'Loaded'); bar.set('count', '42 rows');",
    demo: function (host) {
      var box = el("div", { style: "width:100%;border:1px solid var(--border);border-radius:6px;padding:2px 8px" });
      host.appendChild(box);
      var bar = AppUIStatusBar.create({ container: box, sections: [{ id: "msg", initial: "Ready" }, { id: "count", title: "Rows", initial: "0 rows" }] });
      var n = 0;
      host.appendChild(btn("update status", function () { n += 7; bar.set("msg", "Loaded"); bar.set("count", n + " rows"); }));
      return bar;
    },
  });
})();
