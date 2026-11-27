// Keep Awake — AppUI page fronting cap:desktop.wakeup. Served at /apps/system/wakeup/.
var APP = "system/wakeup";

function esc(s){ return String(s==null?"":s).replace(/[&<>"]/g, function(c){
  return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]; }); }

async function callOp(op, body) {
  var response = await window.AppUIApi.requestResponse("/v1/apps/" + APP + "/" + op, Object.assign({}, body || {}, op === "status" ? {} : {confirm: true}), {
    method: "POST", timeout: null, decode: function (result) { return result.json(); }
  });
  return response.data;
}

function mountContent(el) {
  el.classList.add("wk-content");
  el.innerHTML =
    '<div class="wk-card">' +
      '<div class="wk-row"><span class="wk-dot" id="wk-dot"></span>' +
        '<span class="wk-state" id="wk-state">…</span></div>' +
      '<div class="wk-actions">' +
        '<button id="wk-pause">Pause (allow sleep)</button>' +
        '<label>Keep awake for <select id="wk-duration"><option value="1800">30 minutes</option><option value="3600" selected>1 hour</option><option value="7200">2 hours</option><option value="0">Until paused</option></select></label>' +
        '<button id="wk-resume">Start / restart timer</button>' +
      '</div>' +
      '<label class="wk-opt"><input type="checkbox" id="wk-jiggle"> Mouse jiggle</label>' +
      '<label class="wk-opt"><input type="checkbox" id="wk-activity"> Idle backoff (allow sleep when away)</label>' +
      '<div class="wk-meta" id="wk-meta"></div>' +
    '</div>';
  return el;
}

function stateLabel(s) {
  if (!s || !s.ok) return 'Capability unavailable' + (s && s.error ? ' — ' + s.error : '');
  if (s.expired) return 'Timer expired — resumes when you return and use the keyboard or mouse';
  if (!s.enabled) return 'Paused (machine may sleep)';
  if (s.session_interactive === false) return 'Suspended (Windows session locked or disconnected)';
  if (s.deep_idle) return 'Idle backoff engaged (machine may sleep)';
  if (s.last_error || s.input_last_error) return 'Keep-awake error — see diagnostics below';
  return s.active ? 'Keeping awake' : 'Starting keep-awake';
}

function paint(root, s) {
  var dot = root.querySelector("#wk-dot");
  var active = s && s.ok && s.active;
  dot.className = "wk-dot " + (active ? "on" : "off");
  root.querySelector("#wk-state").textContent = stateLabel(s);
  if (s && s.ok) {
    root.querySelector("#wk-jiggle").checked = !!s.jiggle;
    root.querySelector("#wk-activity").checked = !!s.activity_detection;
    root.querySelector("#wk-meta").textContent =
      (s.remaining_seconds != null ? "Expires in " + Math.ceil(s.remaining_seconds / 60) + " min \u00b7 " :
       s.expired ? "Timer expired \u00b7 " : s.active ? "No expiry \u00b7 " : "") +
      (s.suspended_reason ? "Suspended: " + s.suspended_reason + " \u00b7 " : "") +
      (s.last_error ? "Error: " + s.last_error + " \u00b7 " : "") +
      "idle " + (s.idle_seconds != null ? Math.round(s.idle_seconds) + "s" : "?") +
      " · deep-idle timeout " + (s.deep_idle_timeout || "?") + "s" +
      (s.stats ? " · keep-awake calls " + (s.stats.keep_awake_calls||0) +
        " · verified activity " + (s.stats.jiggle_calls||0) +
        " · failures " + ((s.stats.keep_awake_failures||0)+(s.stats.activity_failures||0)) : "") +
      (s.input_last_error ? " · Input error: " + s.input_last_error : "") +
      (s.activity_last_success ? " · Last verified activity: " + new Date(s.activity_last_success*1000).toLocaleTimeString() : "");
  }
}

async function refresh(app, root) {
  var s = await callOp("status", {});
  paint(root, s);
  app.setStatus(stateLabel(s));
}

window.AppUIReady.then(function () {
  var contentEl = null;
  var app = AppUI.createApp({
    id: "system-wakeup", title: "Keep Awake",
    menu: { View: [ { id: "refresh", label: "Refresh" } ] },
    onAction: function (_m, id) { if (id === "refresh" && contentEl) refresh(app, contentEl); },
    content: { render: function (el) { contentEl = mountContent(el); } },
    statusbar: {},
  });
  function wire() {
    if (!contentEl) { setTimeout(wire, 20); return; }
    var root = contentEl;
    root.querySelector("#wk-pause").addEventListener("click", async function () { await callOp("pause", {}); refresh(app, root); });
    root.querySelector("#wk-resume").addEventListener("click", async function () { await callOp("resume", {duration_seconds: Number(root.querySelector("#wk-duration").value)}); refresh(app, root); });
    root.querySelector("#wk-jiggle").addEventListener("change", async function (e) { await callOp("configure", { jiggle: e.target.checked }); refresh(app, root); });
    root.querySelector("#wk-activity").addEventListener("change", async function (e) { await callOp("configure", { activity_detection: e.target.checked }); refresh(app, root); });
    var poller = AppUIPollRefresh.start(function () { return refresh(app, root); }, 5000, {
      stopWhen: function () { return !root.isConnected; }
    });
    poller.refresh();
  }
  wire();
}).catch(function (e) {
  document.getElementById("app-content-body").innerHTML =
    '<div style="padding:18px">AppUI failed to load: ' + esc(e) + '</div>';
});
