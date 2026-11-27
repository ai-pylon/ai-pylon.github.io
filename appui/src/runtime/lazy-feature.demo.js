/* Gallery demo for lazy-feature.js - shown by the AppUI Guide (platform/appui_guide) Components gallery.
 * Kept next to the component; the AppUI catalog (framework/appui_catalog.py) finds it by the .demo.js suffix.
 * demo(host, kit) mounts into host and may return a cleanup (function or {destroy}); kit = {el, btn, esc}. */
(function () {
  var kit = window.AppUIDemos.kit, el = kit.el, btn = kit.btn, esc = kit.esc;
  AppUIDemos.register({
    name: "LazyFeature",
    global: "AppUILazyFeature",
    what: "Load an optional native module on first use. Concurrent calls share initialization; each host keeps its own instance and failed loads can be retried.",
    code: "const feature = AppUILazyFeature.create({src:'features/details.js',\n  initialize: module => module.createDetails({host})});\n// No request until the first action:\nawait feature.call('open', [item]);",
    demo: function (host) {
      var feature = AppUILazyFeature.create({
        src: "/appui/src/runtime/lazy-feature-demo-counter.js",
        initialize: function (module) { return module.createCounter(); }
      });
      var button = document.createElement("button"), result = document.createElement("span");
      button.className = "ai-btn";
      button.textContent = "Load feature / increment";
      result.textContent = " Module not requested yet";
      button.onclick = function () {
        button.disabled = true;
        feature.call("next").then(function (count) {
          result.textContent = " Count: " + count;
        }).catch(function (error) {
          result.textContent = " " + error.message;
        }).finally(function () { button.disabled = false; });
      };
      host.append(button, result);
    },
  });
})();
