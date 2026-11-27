/* Gallery demo for remote-browser-viewer.js - shown by the AppUI Guide (platform/appui_guide) Components gallery.
 * Kept next to the component; the AppUI catalog (framework/appui_catalog.py) finds it by the .demo.js suffix.
 * demo(host, kit) mounts into host and may return a cleanup (function or {destroy}); kit = {el, btn, esc}. */
(function () {
  var kit = window.AppUIDemos.kit, el = kit.el, btn = kit.btn, esc = kit.esc;
  AppUIDemos.register({
    name: "RemoteBrowserViewer",
    global: "AppUIRemoteBrowserViewer",
    what: "Mirror a server-side browser tab (JPEG frames over SSE) in a dialog and relay pointer/keyboard input (login/MFA/captcha hand-off). Transport is injectable.",
    code: "await AppUIAssets.load('remoteBrowserViewer');\nconst v = AppUIRemoteBrowserViewer.create({\n  baseUrl: '/apps/<group>/<app>/signin', attachTabId: tabId,\n  detectStep: url => /pwd/.test(url) ? 'Password — click Next' : 'Continue here',\n  onDone: v => v.setProgress('Signed in', '', true),\n});",
    demo: function (host) {
      var btn = document.createElement("button");
      btn.textContent = "Open viewer (mock transport)";
      btn.onclick = function () {
        var svg = "<svg xmlns='http://www.w3.org/2000/svg' width='640' height='360'><rect width='640' height='360' fill='#eef'/><text x='30' y='60' font-size='28'>Mock remote page</text></svg>";
        var img = btoa(svg), handlers = {};
        AppUIRemoteBrowserViewer.create({
          title: "Remote browser (mock)", session: "mock",
          detectStep: function (u) { return "Mock step for " + u; },
          transport: {
            open: function () { return Promise.resolve({ ok: true, session: "mock" }); },
            input: function () { return Promise.resolve({ ok: true }); },
            stop: function () {},
            shot: function () { return Promise.resolve({ img: img, url: "https://example.com/login", w: 640, h: 360 }); },
            stream: function () { return { addEventListener: function (n, f) { handlers[n] = f; }, close: function () {} }; },
          },
        });
      };
      host.appendChild(btn);
    },
  });
})();
