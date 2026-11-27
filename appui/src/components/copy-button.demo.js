/* Gallery demo for copy-button.js - shown by the AppUI Guide (platform/appui_guide) Components gallery.
 * Kept next to the component; the AppUI catalog (framework/appui_catalog.py) finds it by the .demo.js suffix.
 * demo(host, kit) mounts into host and may return a cleanup (function or {destroy}); kit = {el, btn, esc}. */
(function () {
  var kit = window.AppUIDemos.kit, el = kit.el, btn = kit.btn, esc = kit.esc;
  AppUIDemos.register({
    name: "CopyButton",
    global: "AppUICopyButton",
    what: "Copy text with success/failure feedback, label restoration, and protection against stale clipboard results.",
    code: "AppUICopyButton.bind(button, () => input.value, {successText: 'Copied', duration: 1200});",
    demo: function (host) {
      var input = document.createElement("input");
      input.value = "Reusable clipboard control";
      input.setAttribute("aria-label", "Text to copy");
      var button = document.createElement("button");
      button.type = "button";
      button.textContent = "Copy text";
      host.appendChild(input);
      host.appendChild(button);
      AppUICopyButton.bind(button, function () { return input.value; });
    },
  });
})();
