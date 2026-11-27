/* Gallery demo for article.js - shown by the AppUI Guide (platform/appui_guide) Components gallery.
 * Kept next to the component; the AppUI catalog (framework/appui_catalog.py) finds it by the .demo.js suffix.
 * demo(host, kit) mounts into host and may return a cleanup (function or {destroy}); kit = {el, btn, esc}. */
(function () {
  var kit = window.AppUIDemos.kit, el = kit.el, btn = kit.btn, esc = kit.esc;
  AppUIDemos.register({
    name: "Article",
    global: "AppUIArticle",
    what: "Safe ordered article blocks with text, local images and video metadata",
    code: "await AppUIAssets.load('article');\nAppUIArticle.create({container:host,blocks:[{type:'heading',text:'Saved article'},{type:'paragraph',text:'Source text remains readable in its original order.\\nInline HTML such as <script> is displayed as text.'},{type:'video',title:'Embedded video metadata'}]});",
    demo: function(host){AppUIArticle.create({container:host,blocks:[{type:'heading',text:'Saved article'},{type:'paragraph',text:'Source text remains readable in its original order.\nInline HTML such as <script> is displayed as text.'},{type:'video',title:'Embedded video metadata'}]});},
  });
})();
