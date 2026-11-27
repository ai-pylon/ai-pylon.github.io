/* Gallery demo for tree.js - shown by the AppUI Guide (platform/appui_guide) Components gallery.
 * Kept next to the component; the AppUI catalog (framework/appui_catalog.py) finds it by the .demo.js suffix.
 * demo(host, kit) mounts into host and may return a cleanup (function or {destroy}); kit = {el, btn, esc}. */
(function () {
  var kit = window.AppUIDemos.kit, el = kit.el, btn = kit.btn, esc = kit.esc;
  AppUIDemos.register({
    name: "Tree",
    global: "AppUITree",
    what: "Lazy, keyboard-navigable tree with independent checkboxes, selection and in-place decoration refresh.",
    code: "await AppUIAssets.load('tree');\nvar t = AppUITree.create({container:host, checkable:true, onCheck(node,checked,paths){ console.log(paths); }});\nt.setRoots([{path:'fruit',name:'Fruit',hasChildren:false}]);",
    demo: function (host) {
      var box = el("div", {style:"max-height:180px;overflow:auto;border:1px solid var(--border);border-radius:6px"});
      host.appendChild(box);
      var tree = AppUITree.create({container:box,checkable:true,
        onCheck:function(n,checked,paths){AppUIToast.info(paths.length+" checked");},
        onExpand:function(n,done){done([{path:n.path+'/apple',name:'Apple',hasChildren:false},{path:n.path+'/pear',name:'Pear',hasChildren:false}]);}});
      tree.setRoots([{path:'fruit',name:'Fruit',hasChildren:true}]);return tree;
    },
  });
})();
