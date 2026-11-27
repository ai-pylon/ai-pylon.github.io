/* Gallery demo for sidebar-tabs.js - shown by the AppUI Guide (platform/appui_guide) Components gallery.
 * Kept next to the component; the AppUI catalog (framework/appui_catalog.py) finds it by the .demo.js suffix.
 * demo(host, kit) mounts into host and may return a cleanup (function or {destroy}); kit = {el, btn, esc}. */
(function () {
  var kit = window.AppUIDemos.kit, el = kit.el, btn = kit.btn;
  AppUIDemos.register({
    name: "SidebarTabs", global: "AppUISidebarTabs",
    what: "A tabbed sidebar host: lazy panel render, keyboard navigation, drag-to-reorder and remembered selection.",
    code: "AppUISidebarTabs.create({ container: host, storageKey: 'my-tabs', tabs: [\n  { id: 'a', label: 'One', render: function (panel) { panel.textContent = 'one'; } },\n  { id: 'b', label: 'Two', render: function (panel) { panel.textContent = 'two'; } } ] });",
    demo: function (host) {
      var box = el("div", { style: "width:100%;max-width:340px;height:160px;display:flex;flex-direction:column;border:1px solid var(--border);border-radius:6px" });
      host.appendChild(box);
      return AppUISidebarTabs.create({ container: box, storageKey: "guide-demo-sidebar-tabs", tabs: [
        { id: "a", label: "Chat", render: function (p) { p.appendChild(el("div", { class: "g-sub", style: "padding:8px" }, "First panel (rendered when first opened).")); } },
        { id: "b", label: "Memo", render: function (p) { p.appendChild(el("div", { class: "g-sub", style: "padding:8px" }, "Second panel.")); } } ] });
    },
  });
})();
