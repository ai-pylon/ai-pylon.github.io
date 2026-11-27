/* Gallery demo for chips.js - shown by the AppUI Guide (platform/appui_guide) Components gallery.
 * Kept next to the component; the AppUI catalog (framework/appui_catalog.py) finds it by the .demo.js suffix.
 * demo(host, kit) mounts into host and may return a cleanup (function or {destroy}); kit = {el, btn, esc}. */
(function () {
  var kit = window.AppUIDemos.kit, el = kit.el, btn = kit.btn, esc = kit.esc;
  AppUIDemos.register({
    name: "Chips",
    global: "AppUIChips",
    what: "Rows of toggleable filter chips (facets): one group per column, single or multi select, live counts per chip; the host applies the filter (e.g. a server-paged AppUIBigTable).",
    code: "AppUIChips.create({container, groups: [{id: 'severity', label: 'Severity', options: [{value: 'major', count: 12}]}],\n  onChange: value => reload(value)});   // chips.setCounts('severity', {major: 3})",
    demo: function (host) {
      var out = document.createElement("div");
      out.style.cssText = "margin-top:8px;font-size:12px;opacity:.8";
      var chips = AppUIChips.create({container: host, groups: [
        {id: "severity", label: "Severity", options: [{value: "critical", count: 2}, {value: "major", count: 14}, {value: "minor", count: 0}]},
        {id: "range", label: "Range", multi: false, options: [{value: "24h", label: "≤ 24 h of the newest crash"}, {value: "trace", label: "traced period"}]}],
        onChange: function (v) { out.textContent = "filter: " + JSON.stringify(v); }});
      host.appendChild(out);
      out.textContent = "filter: " + JSON.stringify(chips.value());
      return {destroy: function () { chips.destroy(); }};
    },
  });
})();
