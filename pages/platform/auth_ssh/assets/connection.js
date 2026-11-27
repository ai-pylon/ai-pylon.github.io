// Connection (SSH/SFTP) — AppUI page. Served at /apps/platform/auth_ssh/.
var APP = "platform/auth_ssh";

function esc(s){ return String(s==null?"":s).replace(/[&<>"]/g, function(c){
  return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]; }); }

window.addEventListener("error", function (e) {
  try {
    fetch("/v1/log", { method: "POST", headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ level:"error", source:"connection.page",
        message: String(e.message || e), fields:{ at:"window.error" } }) });
  } catch (_) {}
});

async function api(op, body) {
  var r = await window.AppUIApi.requestResponse("/v1/apps/" + APP + "/" + op, body || {}, {
    method: "POST", timeout: null, decode: function (response) { return response.json(); }
  });
  return { ok: r.ok, status: r.status, data: r.data };
}

var STATE = { host: "", path: "." };

async function refreshStatus(app, root) {
  var r = await api("status", {});
  var box = root.querySelector("#conn-list");
  var conns = (r.data && r.data.connections) || [];
  if (!conns.length) { box.innerHTML = '<div class="empty">No active connections.</div>'; return; }
  box.innerHTML = '<ul class="conn-list">' + conns.map(function (c) {
    return '<li><span class="dot ' + (c.connected ? "up" : "down") + '"></span>' +
      '<span>' + esc(c.host) + '</span>' +
      '<span class="meta">idle ' + c.idle_s + 's · cred ' + (c.has_cred ? "yes" : "no") + '</span>' +
      '<button data-dc="' + esc(c.host) + '">disconnect</button></li>';
  }).join("") + '</ul>';
  box.querySelectorAll("[data-dc]").forEach(function (b) {
    b.addEventListener("click", async function () {
      await api("disconnect", { host: b.getAttribute("data-dc") });
      refreshStatus(app, root);
    });
  });
}

async function doConnect(app, root) {
  var host = root.querySelector("#c-host").value.trim();
  if (!host) { app.setStatus("Enter a host."); return; }
  var port = parseInt(root.querySelector("#c-port").value, 10) || 22;
  var mode = root.querySelector("#c-mode").value;
  var body = { host: host, port: port };
  if (mode === "password") body.password = root.querySelector("#c-secret").value;
  else if (mode === "key") { body.mode = "key"; body.key = root.querySelector("#c-key").value;
                             body.passphrase = root.querySelector("#c-secret").value || undefined; }
  else if (mode === "agent") body.mode = "agent";
  else if (mode === "master") body.mode = "master";
  // "auto" leaves mode unset -> server autodetects an on-disk key (or a saved
  // alias's own mode, since the host may be an alias resolved server-side).
  var u = root.querySelector("#c-user").value.trim(); if (u) body.user = u;
  app.setStatus("Connecting to " + host + " …");
  var r = await api("connect", body);
  if (!r.ok || (r.data && r.data.error)) {
    app.setStatus("Connect failed: " + ((r.data && r.data.error) || r.status) +
                  (r.data && r.data.category ? " (" + r.data.category + ")" : ""));
    return;
  }
  app.setStatus("Connected to " + host + " (" + (r.data.mode || "") + ").");
  STATE.host = host; STATE.path = ".";
  root.querySelector("#fs-host").value = host;
  refreshStatus(app, root);
  browse(app, root, ".");
}

var browserController = null;
function browse(app, root, path) { return browserController.browse(app, root, path); }
function readFile(app, root, host, path) { return browserController.readFile(app, root, host, path); }

async function runCmd(app, root) {
  var host = root.querySelector("#x-host").value.trim() || STATE.host;
  var cmd = root.querySelector("#x-cmd").value.trim();
  if (!host || !cmd) { app.setStatus("Need a host and a command."); return; }
  app.setStatus("Running on " + host + " …");
  var r = await api("exec", { host: host, command: cmd });
  var out = root.querySelector("#x-out");
  if (!r.ok || (r.data && r.data.error)) { out.textContent = ""; app.setStatus("Exec failed: " + ((r.data && r.data.error) || r.status)); return; }
  var d = r.data;
  out.innerHTML = '<span class="' + (d.rc === 0 ? "rc-ok" : "rc-bad") + '">rc=' + d.rc + '</span>\n\n' +
    esc(d.stdout || "") + (d.stderr ? "\n[stderr]\n" + esc(d.stderr) : "");
  app.setStatus("Exit " + d.rc);
}

function mountContent(el) {
  el.classList.add("conn-content");
  el.innerHTML =
    '<div class="conn-section"><h3>Saved hosts</h3>' +
      '<div class="conn-form">' +
        '<input id="s-alias" class="narrow" placeholder="alias">' +
        '<input id="s-host" class="host" placeholder="host / FQDN / IP">' +
        '<input id="s-port" class="narrow" value="22">' +
        '<input id="s-user" class="narrow" placeholder="ssh user">' +
        '<select id="s-mode">' +
          '<option value="">auto</option>' +
          '<option value="agent">agent</option>' +
          '<option value="key">key</option>' +
          '<option value="password">password</option>' +
          '<option value="master">master</option>' +
        '</select>' +
        '<input id="s-label" placeholder="label (optional)" style="flex:1.5">' +
        '<button id="s-save">Save</button>' +
      '</div>' +
      '<div id="saved-list"></div>' +
    '</div>' +
    '<div class="conn-section"><h3>Connect</h3>' +
      '<div class="conn-form">' +
        '<input id="c-host" class="host" placeholder="host or saved alias" list="saved-aliases">' +
        '<datalist id="saved-aliases"></datalist>' +
        '<input id="c-port" class="narrow" value="22">' +
        '<input id="c-user" class="narrow" placeholder="user">' +
        '<select id="c-mode">' +
          '<option value="auto">auto key</option>' +
          '<option value="agent">agent</option>' +
          '<option value="password">password</option>' +
          '<option value="key">private key</option>' +
          '<option value="master">master</option>' +
        '</select>' +
        '<input id="c-secret" type="password" placeholder="password / passphrase">' +
        '<button id="c-go">Connect</button>' +
        '<div class="keyrow" id="c-keyrow" style="display:none"><textarea id="c-key" placeholder="-----BEGIN OPENSSH PRIVATE KEY----- …"></textarea></div>' +
      '</div>' +
    '</div>' +
    '<div class="conn-section"><h3>Connections</h3><div id="conn-list"></div></div>' +
    '<div class="conn-section"><h3>Remote files (SFTP)</h3>' +
      '<div class="fs-bar"><input id="fs-host" placeholder="host or alias" list="saved-aliases"><input id="fs-path" placeholder="." value=".">' +
        '<button class="go" id="fs-go">List</button></div>' +
      '<div id="fs-out"></div>' +
      '<div class="out" id="file-out"></div>' +
    '</div>' +
    '<div class="conn-section"><h3>Run a command</h3>' +
      '<div class="fs-bar"><input id="x-host" placeholder="host or alias" list="saved-aliases"><input id="x-cmd" placeholder="uname -a" style="flex:2">' +
        '<button class="go" id="x-go">Run</button></div>' +
      '<div class="out" id="x-out"></div>' +
    '</div>';
  return el;
}

var hostsController = null;
function refreshSaved(app, root) { return hostsController.refreshSaved(app, root); }
function saveHost(app, root) { return hostsController.saveHost(app, root); }

window.AppUIReady.then(function () {
  hostsController = ConnectionHosts.create({ api: api, esc: esc });
  browserController = ConnectionBrowser.create({ api: api, esc: esc, state: STATE });
  var contentEl = null;
  var app = AppUI.createApp({
    id: "system-connection",
    title: "Connection",
    menu: { View: [ { id: "refresh", label: "Refresh connections" } ] },
    onAction: function (_menu, id) { if (id === "refresh" && contentEl) refreshStatus(app, contentEl); },
    content: { render: function (el) { contentEl = mountContent(el); } },
    statusbar: {},
  });
  function wire() {
    if (!contentEl) { setTimeout(wire, 20); return; }
    var r = contentEl;
    r.querySelector("#c-mode").addEventListener("change", function (e) {
      r.querySelector("#c-keyrow").style.display = e.target.value === "key" ? "block" : "none";
    });
    r.querySelector("#c-go").addEventListener("click", function () { doConnect(app, r); });
    r.querySelector("#s-save").addEventListener("click", function () { saveHost(app, r); });
    r.querySelector("#fs-go").addEventListener("click", function () { browse(app, r, r.querySelector("#fs-path").value.trim() || "."); });
    r.querySelector("#x-go").addEventListener("click", function () { runCmd(app, r); });
    r.querySelector("#x-cmd").addEventListener("keydown", function (e) { if (e.key === "Enter") runCmd(app, r); });
    refreshStatus(app, r);
    refreshSaved(app, r);
    app.setStatus("Save a host alias, or connect to an SSH host to begin.");
  }
  wire();
}).catch(function (e) {
  document.getElementById("app-content-body").innerHTML =
    '<div style="padding:18px">AppUI failed to load: ' + esc(e) + '</div>';
});
