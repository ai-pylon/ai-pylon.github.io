/* Gallery demo for json-editor.js - shown by the AppUI Guide (platform/appui_guide) Components gallery.
 * Kept next to the component; the AppUI catalog (framework/appui_catalog.py) finds it by the .demo.js suffix.
 * demo(host, kit) mounts into host and may return a cleanup (function or {destroy}); kit = {el, btn, esc}. */
(function () {
  var kit = window.AppUIDemos.kit, el = kit.el, btn = kit.btn, esc = kit.esc;
  AppUIDemos.register({
    name: "JsonForm",
    global: "AppUIJsonForm",
    what: "Schema/value form with password fields and optional validated JSON editing for arrays and nested data.",
    code: "await AppUIAssets.load('previewEditors','jsonEditor');\nAppUIJsonForm.create({ container: host,\n  value:{name:'',notify:true,items:[]}, allowRaw:true, onChange(v){…} });",
    demo: function (host) {
      var box = el("div"); host.appendChild(box);
      try { var widget=(AppUIJsonForm.create || AppUIJsonForm)({ container: box, value: { name: "Ann", notify: true, days: 5, items: [], secret: "demo only" }, allowRaw:true,schema:{properties:{secret:{format:'password'}}},onChange: function () {} });AppUIAssets.load('jsonEditor').then(function(){widget.refresh();}).catch(function(){});return widget; }
      catch (e) { box.textContent = "JsonForm demo unavailable: " + e; }
    },
  });
})();
