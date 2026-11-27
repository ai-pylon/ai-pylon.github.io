// Clipboard — AppUI page fronting cap:desktop.clipboard. Served at /apps/system/clipboard/.
var APP = "system/clipboard";

function esc(s){ return String(s==null?"":s).replace(/[&<>"]/g, function(c){
  return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]; }); }

async function callOp(op) {
  var r = await fetch("/v1/apps/" + APP + "/" + op, {
    method: "POST", headers: {"Content-Type":"application/json"}, body: "{}" });
  return r.json();
}

function mountContent(el) {
  el.classList.add("cb-content");
  el.innerHTML =
    '<div class="cb-card">' +
      '<div class="cb-head"><span class="cb-kind" id="cb-kind">—</span>' +
        '<button id="cb-refresh">Read clipboard</button>' +
        '<label class="cb-watch"><input type="checkbox" id="cb-live"> Live</label></div>' +
      '<pre class="cb-text" id="cb-text">(nothing read yet)</pre>' +
      '<div class="cb-meta" id="cb-meta"></div>' +
    '</div>';
  return el;
}

function paint(root, r) {
  if (!r || !r.ok) {
    root.querySelector("#cb-kind").textContent = "unavailable";
    root.querySelector("#cb-text").textContent = (r && r.error) || "capability unavailable";
    root.querySelector("#cb-meta").textContent = "";
    return;
  }
  root.querySelector("#cb-kind").textContent = r.kind || "empty";
  root.querySelector("#cb-text").textContent = r.text || "(empty)";
  var md = r.metadata || {};
  root.querySelector("#cb-meta").textContent = Object.keys(md).length
    ? Object.keys(md).map(function (k) { return k + "=" + md[k]; }).join("  ·  ") : "";
}

async function refresh(app, root) {
  var r = await callOp("read");
  paint(root, r);
  app.setStatus(r && r.ok ? ("Read " + (r.kind || "empty") + " (" + (r.text || "").length + " chars)")
                          : "Capability unavailable");
}

window.AppUIReady.then(function () {
  var contentEl = null, lastSeq = null, liveTimer = null;
  var app = AppUI.createApp({
    id: "system-clipboard", title: "Clipboard",
    menu: { View: [ { id: "refresh", label: "Read clipboard" } ] },
    onAction: function (_m, id) { if (id === "refresh" && contentEl) refresh(app, contentEl); },
    content: { render: function (el) { contentEl = mountContent(el); } },
    statusbar: {},
  });
  function wire() {
    if (!contentEl) { setTimeout(wire, 20); return; }
    var root = contentEl;
    root.querySelector("#cb-refresh").addEventListener("click", function () { refresh(app, root); });
    root.querySelector("#cb-live").addEventListener("change", function (e) {
      if (liveTimer) { clearInterval(liveTimer); liveTimer = null; }
      if (e.target.checked) {
        liveTimer = setInterval(async function () {
          var s = await callOp("sequence");
          if (s && s.ok && s.sequence !== lastSeq) { lastSeq = s.sequence; refresh(app, root); }
        }, 1000);
      }
    });
    refresh(app, root);
  }
  wire();
}).catch(function (e) {
  document.getElementById("app-content-body").innerHTML =
    '<div style="padding:18px">AppUI failed to load: ' + esc(e) + '</div>';
});
