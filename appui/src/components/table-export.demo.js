/* Gallery demo for table-export.js - shown by the AppUI Guide (platform/appui_guide) Components gallery.
 * Kept next to the component; the AppUI catalog (framework/appui_catalog.py) finds it by the .demo.js suffix.
 * demo(host, kit) mounts into host and may return a cleanup (function or {destroy}); kit = {el, btn, esc}. */
(function () {
  var kit = window.AppUIDemos.kit, el = kit.el, btn = kit.btn, esc = kit.esc;
  AppUIDemos.register({
    name: "Table Export",
    global: "AppUITableExport",
    what: "Export filtered and sorted DataTable rows as CSV or XLSX, with typed numbers, multiline text and clickable spreadsheet links.",
    code: "const table = AppUIDataTable.create({container: host, columns:[\n  {id:'name', label:'Product', exportLink:row=>row.url},\n  {id:'price', label:'Price', sortable:true}], items});\ntable.exportXlsx({filename:'products', sheetName:'Products'});\ntable.exportCsv({filename:'products'});",
    demo(host) {
      const controls = document.createElement('div'), grid = document.createElement('div');
      host.append(controls, grid);
      const table = AppUIDataTable.create({container: grid, columns: [
        {id:'name', label:'Product', sortable:true, exportLink:row=>row.url},
        {id:'portion', label:'Portion / sale price'},
        {id:'price', label:'Price', sortable:true},
      ], items:[{name:'Example product', portion:'Small 500 g\nSale 61000 KRW', price:61000, url:'https://example.com/product'}]});
      const toolbar = AppUIToolbar.create({container: controls, items:[
        {label:'Export XLSX', action:()=>table.exportXlsx({filename:'appui-table-demo'})},
        {label:'Export CSV', action:()=>table.exportCsv({filename:'appui-table-demo'})},
      ]});
      return {destroy(){toolbar.destroy();table.destroy();}};
    },
  });
})();
