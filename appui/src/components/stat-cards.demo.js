/* Gallery demo for stat-cards.js - shown by the AppUI Guide (platform/appui_guide) Components gallery.
 * Kept next to the component; the AppUI catalog (framework/appui_catalog.py) finds it by the .demo.js suffix.
 * demo(host, kit) mounts into host and may return a cleanup (function or {destroy}); kit = {el, btn, esc}. */
(function () {
  var kit = window.AppUIDemos.kit, el = kit.el, btn = kit.btn, esc = kit.esc;
  AppUIDemos.register({
    name: "StatCards",
    global: "AppUIStatCards",
    what: "A row of compact metric cards (label + value).",
    code: "await AppUIAssets.load('collections');\nAppUIStatCards.create({ container: host,\n  items: [{label:'Open', value:12}, {label:'Done', value:48}] });",
    demo: function (host) {
      var box = el("div"); host.appendChild(box);
      try { AppUIStatCards.create({ container: box, items: [{ label: "Open", value: 12 }, { label: "Done", value: 48 }, { label: "Blocked", value: 3 }] }); }
      catch (e) { box.textContent = "StatCards demo unavailable: " + e; }
    },
  });
})();
