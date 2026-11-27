/* Gallery demo for document-layout.js - shown by the AppUI Guide (platform/appui_guide) Components gallery.
 * Kept next to the component; the AppUI catalog (framework/appui_catalog.py) finds it by the .demo.js suffix.
 * demo(host, kit) mounts into host and may return a cleanup (function or {destroy}); kit = {el, btn, esc}. */
(function () {
  var kit = window.AppUIDemos.kit, el = kit.el, btn = kit.btn, esc = kit.esc;
  AppUIDemos.register({
    name: "DocumentLayout",
    global: "AppUIDocumentLayout",
    what: "Measure declared document page boxes (px or pt) and fit cached natural dimensions to a preview pane.",
    code: "const box = AppUIDocumentLayout.declaredDimensions(page);\nAppUIDocumentLayout.fit(placeholder, page, paneWidth, true);",
    demo: function (host) {
      const placeholder = document.createElement('div');
      placeholder.style.cssText = 'position:relative;overflow:hidden;border:1px solid var(--border)';
      const page = document.createElement('div');
      page.style.cssText = 'width:640px;height:160px;padding:20px;box-sizing:border-box;background:var(--bg-elevated);color:var(--text-primary)';
      page.textContent = 'A 640px document page fitted into a 320px preview pane.';
      placeholder.append(page);host.append(placeholder);
      AppUIDocumentLayout.fit(placeholder, page, 320, false);
    },
  });
})();
