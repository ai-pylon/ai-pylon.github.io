/* Gallery demo for feedback.js - shown by the AppUI Guide (platform/appui_guide) Components gallery.
 * Kept next to the component; the AppUI catalog (framework/appui_catalog.py) finds it by the .demo.js suffix.
 * demo(host, kit) mounts into host and may return a cleanup (function or {destroy}); kit = {el, btn, esc}. */
(function () {
  var kit = window.AppUIDemos.kit, el = kit.el, btn = kit.btn, esc = kit.esc;
  AppUIDemos.register({
    name: "Feedback",
    global: "AppUIFeedback",
    what: "An inline feedback / thumbs widget (collect a rating + comment).",
    code: "await AppUIAssets.load('feedback');\nAppUIFeedback.renderTab(host, { kinds: [['bug','Bug'],['feature','Idea']],\\n  submit: function(body){ return Promise.resolve({ ok: true, id: 'demo' }); } });",
    demo: function (host) {
      var box = el("div"); host.appendChild(box);
      try { AppUIFeedback.renderTab(box, { intro: "Demo form - nothing is filed.", kinds: [["bug", "Bug"], ["feature", "Idea / request"], ["other", "Other"]], submit: function (body) { AppUIToast.success("feedback captured (demo, not sent)"); return Promise.resolve({ ok: true, id: "demo" }); } }); }
      catch (e) { box.textContent = "Feedback demo unavailable: " + e; }
    },
  });
})();
