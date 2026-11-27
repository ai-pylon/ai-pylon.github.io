// file/drive_share — owner view: is the public share side wired to DriveManager, and where do links point.
(function () {
  "use strict";
  function node(tag, text, attrs) {
    var e = document.createElement(tag);
    if (text != null) e.textContent = text;
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    return e;
  }
  function row(t, k, v, cls) {
    var tr = node("tr"); tr.appendChild(node("th", k));
    var td = node("td"); td.appendChild(node("span", v, cls ? {"class": cls} : {})); tr.appendChild(td); t.appendChild(tr);
  }
  function render(host) {
    var main = node("div", null, {style: "padding:16px 20px;max-width:900px"});
    host.appendChild(main);
    main.appendChild(node("h2", "Drive Share"));
    main.appendChild(node("p", "Public, read-only share links for DriveManager folders. Shares are created, limited " +
      "(password, expiry, selected files, download, guest upload) and revoked in DriveManager; this app serves what a " +
      "visitor with a link sees, through DriveManager's internal API. It holds no Google credentials."));
    var t = node("table", null, {style: "border-collapse:collapse;font-size:14px"});
    main.appendChild(t);
    var css = node("style"); css.textContent = "th{text-align:left;padding:6px 14px 6px 0;opacity:.75;font-weight:600}td{padding:6px 0}.ok{color:#2f9e44}.bad{color:#d0453a}";
    document.head.appendChild(css);
    fetch("/v1/apps/file/drive_share/status", {method: "POST", headers: {"Content-Type": "application/json"}, body: "{}"})
      .then(function (r) { return r.json(); }).then(function (s) {
        row(t, "DriveManager", s.manager || s.error, s.ok_wired ? "ok" : "bad");
        row(t, "Internal key", s.configured ? "configured" : "missing", s.configured ? "ok" : "bad");
        row(t, "Manager URL", s.manager_url || "");
        // root-relative literals: the pylon-server bootstrap adds its prefix (ai-web) to them
        row(t, "Share links", location.origin + "/share/s/" + "<token>");
        main.appendChild(node("p", "Open DriveManager to create a share: ", {style: "margin-top:16px"}))
          .appendChild(node("a", "DriveManager", {href: "/drive"}));
      }).catch(function (e) { row(t, "Error", e.message, "bad"); });
  }
  window.AppUIReady.then(function () {
    AppUI.createApp({id: "file-drive_share", title: "Drive Share", content: {render: render}});
  });
})();
