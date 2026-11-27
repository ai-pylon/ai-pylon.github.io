/* Gallery demo for suggestions.js - shown by the AppUI Guide (platform/appui_guide) Components gallery.
 * Kept next to the component; the AppUI catalog (framework/appui_catalog.py) finds it by the .demo.js suffix.
 * demo(host, kit) mounts into host and may return a cleanup (function or {destroy}); kit = {el, btn, esc}. */
(function () {
  var kit = window.AppUIDemos.kit, el = kit.el, btn = kit.btn, esc = kit.esc;
  AppUIDemos.register({
    name: "Suggestions",
    global: "AppUISuggestions",
    what: "An autocomplete suggestion dropdown for an input.",
    code: "await AppUIAssets.load('suggestions');\nconst view = AppUISuggestions.bind({input, container, onSelect: item => {input.value = item;}});\ninput.addEventListener('input', () => view.setItems(['apple', 'apricot'].filter(x => x.includes(input.value))));",
    demo: function (host) {
      var input = el("input", {placeholder: "Type a fruit", "aria-label": "Fruit suggestions"});
      var list = el("div");
      host.appendChild(input); host.appendChild(list);
      var view = AppUISuggestions.bind({input: input, container: list, selectFirst: false,
        onSelect: function (item) { input.value = item; }});
      input.addEventListener("input", function () {
        view.setItems(["apple", "apricot", "banana"].filter(function (item) {
          return item.indexOf(input.value.trim().toLowerCase()) >= 0;
        }));
      });
    },
  });
})();
