/* Gallery demo for json-editor.js - shown by the AppUI Guide (platform/appui_guide) Components gallery.
 * Kept next to the component; the AppUI catalog (framework/appui_catalog.py) finds it by the .demo.js suffix.
 * demo(host, kit) mounts into host and may return a cleanup (function or {destroy}); kit = {el, btn, esc}. */
(function () {
  var kit = window.AppUIDemos.kit, el = kit.el, btn = kit.btn, esc = kit.esc;
  AppUIDemos.register({
    name: "JsonEditor",
    global: "AppUIJsonEditor",
    what: "An editable JSON tree / form.",
    code: "await AppUIAssets.load('jsonEditor');\nAppUIJsonEditor.create({ container: host,\n  value:{name:'x',tags:['a','b']}, onChange(v){…} });",
    demo: function (host) {
      var box = el("div"); host.appendChild(box);
      try { (AppUIJsonEditor.create || AppUIJsonEditor)({ container: box, value: { name: "leave", kinds: ["full", "am", "pm"], days: 5 }, onChange: function () {} }); }
      catch (e) { box.textContent = "JsonEditor demo unavailable: " + e; }
    },
  });
})();
