/* Gallery demo for text-diff.js - shown by the AppUI Guide (platform/appui_guide) Components gallery.
 * Kept next to the component; the AppUI catalog (framework/appui_catalog.py) finds it by the .demo.js suffix.
 * demo(host, kit) mounts into host and may return a cleanup (function or {destroy}); kit = {el, btn, esc}. */
(function () {
  var kit = window.AppUIDemos.kit, el = kit.el, btn = kit.btn, esc = kit.esc;
  AppUIDemos.register({
    name: "TextDiff",
    global: "AppUITextDiff",
    what: "A side-by-side / inline text diff view.",
    code: "await AppUIAssets.load('textDiff');\nvar rows = AppUITextDiff.lines(['a','b'], ['a','B','c']);   // [{type:'equal'|'add'|'remove', text, leftNum, rightNum}]\\nvar stats = AppUITextDiff.stats(rows);        // {added, removed, changed}",
    demo: function (host) {
      var box = el("div"); host.appendChild(box);
      try {
        var rows = AppUITextDiff.lines("line one\nline two\nline three".split("\n"), "line one\nLINE TWO\nline three\nline four".split("\n"));
        var color = { add: "var(--color-success)", remove: "var(--color-error)", equal: "var(--text-secondary)" };
        var mark = { add: "+ ", remove: "- ", equal: "  " };
        rows.forEach(function (r) { box.appendChild(el("div", { style: "font-family:var(--font-mono,monospace);font-size:12px;white-space:pre;color:" + color[r.type] }, mark[r.type] + r.text)); });
        var st = AppUITextDiff.stats(rows);
        box.appendChild(el("div", { class: "g-sub", style: "margin-top:4px" }, "+" + st.added + " / -" + st.removed));
      } catch (e) { box.textContent = "TextDiff demo unavailable: " + e; }
    },
  });
})();
