/* Gallery demo for disclosure.js - shown by the AppUI Guide (platform/appui_guide) Components gallery.
 * Kept next to the component; the AppUI catalog (framework/appui_catalog.py) finds it by the .demo.js suffix.
 * demo(host, kit) mounts into host and may return a cleanup (function or {destroy}); kit = {el, btn, esc}. */
(function () {
  var kit = window.AppUIDemos.kit, el = kit.el, btn = kit.btn, esc = kit.esc;
  AppUIDemos.register({
    name: "Disclosure",
    global: "AppUIDisclosure",
    what: "A collapsible show/hide section.",
    code: "AppUIDisclosure.bind({ trigger: headerEl, panel: panelEl, expanded: false,\n  onToggle: function(open){ … } });   // markup stays yours",
    demo: function (host) {
      var box = el("div"); host.appendChild(box);
      try {
        var trigger = el("button", { class: "ai-btn" }, "Show details"), panel = el("div", { class: "g-sub", style: "padding:6px 0" }, "Revealed content.");
        box.appendChild(trigger); box.appendChild(panel);
        AppUIDisclosure.bind({ trigger: trigger, panel: panel, expanded: false });
      }
      catch (e) { box.textContent = "Disclosure demo unavailable: " + e; }
    },
  });
})();
