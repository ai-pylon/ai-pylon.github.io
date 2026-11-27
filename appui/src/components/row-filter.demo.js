/* Gallery demo for row-filter.js - shown by the AppUI Guide (platform/appui_guide) Components gallery.
 * Kept next to the component; the AppUI catalog (framework/appui_catalog.py) finds it by the .demo.js suffix.
 * demo(host, kit) mounts into host and may return a cleanup (function or {destroy}); kit = {el, btn, esc}. */
(function () {
  var kit = window.AppUIDemos.kit, el = kit.el, btn = kit.btn, esc = kit.esc;
  AppUIDemos.register({
    name: "RowFilter",
    global: "AppUIRowFilter",
    what: "Filter existing list or table rows while preserving their markup, handlers, and original display styles.",
    code: "AppUIRowFilter.bind({input, container: table, selector: 'tbody tr', text: row => row.dataset.name});",
    demo: function (host) {
      var input = document.createElement("input");
      input.placeholder = "Filter attributes";
      input.setAttribute("aria-label", "Filter attributes");
      var list = document.createElement("ul");
      ["cellId", "administrativeState", "operationalState"].forEach(function (name) {
        var row = document.createElement("li"); row.textContent = name; list.appendChild(row);
      });
      host.appendChild(input); host.appendChild(list);
      AppUIRowFilter.bind({input: input, container: list, selector: "li"});
    },
  });
})();
