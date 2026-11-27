/* Gallery demo for sidebar-sections.js - shown by the AppUI Guide (platform/appui_guide) Components gallery.
 * Kept next to the component; the AppUI catalog (framework/appui_catalog.py) finds it by the .demo.js suffix.
 * demo(host, kit) mounts into host and may return a cleanup (function or {destroy}); kit = {el, btn, esc}. */
(function () {
  var kit = window.AppUIDemos.kit, el = kit.el, btn = kit.btn;
  AppUIDemos.register({
    name: "SidebarSections", global: "AppUISidebarSections",
    what: "Vertically stacked, collapsible sections for a docked sidebar; a section may carry header tools (e.g. a + button). Collapsed state is remembered per storageKey.",
    code: "AppUISidebarSections.create({ container: host, storageKey: 'my-page-left', hashRouting: false, sections: [\n  { id: 'files', label: 'Files', render: function (panel) { panel.textContent = 'tree here'; } },\n  { id: 'groups', label: 'Groups', tools: function () { return [addButton]; },\n    render: function (panel) { panel.textContent = 'groups'; } } ] });",
    demo: function (host) {
      var box = el("div", { style: "width:100%;max-width:320px;border:1px solid var(--border);border-radius:6px" });
      host.appendChild(box);
      var inst = AppUISidebarSections.create({ container: box, storageKey: "guide-demo-sections", hashRouting: false, sections: [
        { id: "files", label: "Files", render: function (p) { p.appendChild(el("div", { class: "g-sub", style: "padding:8px" }, "Any content: a tree, a list, a form...")); } },
        { id: "groups", label: "Groups",
          tools: function () { return [btn("+", function () { AppUIToast.info("header tool clicked (section did not collapse)"); })]; },
          render: function (p) { p.appendChild(el("div", { class: "g-sub", style: "padding:8px" }, "A section with a header button.")); } } ] });
      return inst;
    },
  });
})();
