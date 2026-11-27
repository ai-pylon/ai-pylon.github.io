/* Gallery demo for vis-explorer.js - shown by the AppUI Guide (platform/appui_guide) Components gallery.
 * Kept next to the component; the AppUI catalog (framework/appui_catalog.py) finds it by the .demo.js suffix.
 * demo(host, kit) mounts into host and may return a cleanup (function or {destroy}); kit = {el, btn, esc}. */
(function () {
  var kit = window.AppUIDemos.kit, el = kit.el, btn = kit.btn, esc = kit.esc;
  AppUIDemos.register({
    name: "VIS Explorer",
    global: "AppUIVisExplorer",
    what: "Browse provider hierarchies with cards, breadcrumbs, search and leaf details. Navigation and rendering share one instance with explicit cleanup.",
    code: "await AppUIAssets.load('visExplorer');\nconst explorer = AppUIVisExplorer.create({container: host, uri: 'vis://tool_catalog'});\n// view cleanup:\nexplorer.destroy();",
    demo: function (host) {
      var root = {uri: "vis://demo", kind: "group", title: "Example tools", children: [
        {uri: "vis://demo/read", title: "Read a document", kind: "tool", description: "Open this card to inspect its parameters."}
      ]};
      return AppUIVisExplorer.create({container: host, uri: root.uri, api: function (op, args) {
        if (op === "providers") return Promise.resolve({providers: [{name: "demo", root: root.uri}]});
        if (op === "open") return Promise.resolve(args.uri === root.uri ? Object.assign({ok: true}, root) : {
          ok: true, uri: args.uri, kind: "tool", title: "Read a document", ancestors: [root],
          attributes: {params: {path: "Workspace document path"}}
        });
        return Promise.resolve({ok: true, children: [], hits: [], neighbors: []});
      }});
    },
  });
})();
