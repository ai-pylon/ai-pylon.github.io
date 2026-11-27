/* Gallery demo for table-controls.js - shown by the AppUI Guide (platform/appui_guide) Components gallery.
 * Kept next to the component; the AppUI catalog (framework/appui_catalog.py) finds it by the .demo.js suffix.
 * demo(host, kit) mounts into host and may return a cleanup (function or {destroy}); kit = {el, btn, esc}. */
(function () {
  var kit = window.AppUIDemos.kit, el = kit.el, btn = kit.btn, esc = kit.esc;
  AppUIDemos.register({
    name: "Shared table controls",
    global: "AppUITableControls",
    what: "Renderer-independent find, header context menu, text/range filters, column chooser and drag/drop. DataTable and BigTable use the same controls and AppUITableColumns state; row loading and query execution stay in adapters.",
    code: "await AppUIAssets.load('dataTable');\nconst table=AppUIDataTable.create({container:host,stateKey:'my-table',columns:[{id:'name',label:'Name'},{id:'score',label:'Score',sortable:true}],items:[{name:'Cafe',score:20},{name:'Food',score:100}]});\n// BigTable uses the same controls; supply onSearch/onFilter/onSort and columnStats.",
    needs: ["dataTable"],
    demo(host){const box=document.createElement('div');box.style.height='220px';host.append(box);return AppUIDataTable.create({container:box,columns:[{id:'name',label:'Name'},{id:'score',label:'Score',sortable:true}],items:[{name:'Cafe',score:20},{name:'Food',score:100}]});},
  });
})();
