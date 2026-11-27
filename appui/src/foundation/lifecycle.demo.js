/* Gallery demo for lifecycle.js - shown by the AppUI Guide (platform/appui_guide) Components gallery.
 * Kept next to the component; the AppUI catalog (framework/appui_catalog.py) finds it by the .demo.js suffix.
 * demo(host, kit) mounts into host and may return a cleanup (function or {destroy}); kit = {el, btn, esc}. */
(function () {
  var kit = window.AppUIDemos.kit, el = kit.el, btn = kit.btn, esc = kit.esc;
  AppUIDemos.register({
    name: "Debounce",
    global: "AppUILifecycle",
    what: "Coalesce delayed work, preserve the latest receiver/arguments, and cancel it when its view is destroyed.",
    code: "const searchLater = AppUILifecycle.debounce(search, 220);\ninput.addEventListener('input', () => searchLater(input.value));\n// view cleanup:\nscope.add(searchLater.destroy);",
    demo: function (host) {
      var input = document.createElement("input");
      input.placeholder = "Type a search"; input.setAttribute("aria-label", "Debounced search");
      var status = document.createElement("span"); status.textContent = "Ready";
      var delayed = AppUILifecycle.debounce(function (value) { status.textContent = "Search: " + value; }, 220);
      function changed() { status.textContent = "Waiting..."; delayed(input.value); }
      input.addEventListener("input", changed);
      host.appendChild(input); host.appendChild(status);
      return {destroy: function () { input.removeEventListener("input", changed); delayed.destroy(); }};
    },
  });
})();
