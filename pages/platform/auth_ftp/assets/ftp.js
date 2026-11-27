// Connection (FTP) — AppUI page. Served at /apps/platform/auth_ftp/.
// Shows the FTP connection app's status + products, and a small tool to probe /
// list an ftp:// directory (anonymous).
var APP = "platform/auth_ftp";

function esc(s){ return String(s==null?"":s).replace(/[&<>"]/g, function(c){
  return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]; }); }
function fmtBytes(b){ if(b==null||b===0)return ""; var u=["B","KB","MB","GB"],i=0,n=b;
  while(n>=1024&&i<u.length-1){n/=1024;i++;} return (n>=10?Math.round(n):Math.round(n*10)/10)+" "+u[i]; }

async function api(op, body) {
  var r = await fetch("/v1/apps/" + APP + "/" + op, {
    method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(body||{}) });
  return await r.json();
}

var _app = null, _root = null;

async function refreshStatus(root) {
  var el = root.querySelector("#ftp-status");
  var s = await api("status", {});
  var p = await api("products", {});
  if (!s.ok) { el.innerHTML = '<div class="empty">' + esc(s._error||"status error") + '</div>'; return; }
  var dot = s.available ? "ok" : "bad";
  var prods = (p.ok && p.products || []).map(function (x) {
    return '<div class="ftp-kv"><span><b>' + esc(x.name) + '</b> — ' + esc(x.mode||"") + '</span></div>' +
      (x.note ? '<div class="ftp-note">' + esc(x.note) + '</div>' : '');
  }).join('');
  el.innerHTML =
    '<div class="ftp-kv"><span class="ftp-dot ' + dot + '"></span>' +
      '<span><b>' + (s.available ? "Available" : "Unavailable") + '</b></span></div>' +
    '<div class="ftp-kv"><span>Mode</span><b>' + esc(s.mode||"") + '</b></div>' +
    '<div class="ftp-kv"><span>Transport</span><b>' + esc(s.transport||"") + '</b></div>' +
    '<div class="ftp-h" style="margin-top:10px">Products</div>' + prods;
}

async function probe(root) {
  var url = root.querySelector("#ftp-url").value.trim();
  var out = root.querySelector("#ftp-out");
  if (!url) { out.innerHTML = '<div class="empty">Enter an ftp:// directory url.</div>'; return; }
  if (!/^ftp:\/\//i.test(url)) { out.innerHTML = '<div class="empty">URL must start with ftp://</div>'; return; }
  out.innerHTML = '<div class="empty">Listing ' + esc(url) + '…</div>';
  var r = await api("list", { url: url });
  if (!r.ok) { out.innerHTML = '<div class="empty">' + esc(r._error||"error") + '</div>'; return; }
  var rows = r.entries || [];
  if (!rows.length) { out.innerHTML = '<div class="empty">Empty directory.</div>'; return; }
  out.innerHTML = '<div class="ftp-list">' + rows.map(function (e) {
    return '<div class="ftp-row"><span class="ic">' + (e.is_dir ? "📁" : "📄") + '</span>' +
      '<span class="nm">' + esc(e.name) + '</span>' +
      '<span class="sz">' + esc(fmtBytes(e.size)) + '</span></div>';
  }).join('') + '</div>' +
  '<div class="ftp-note" style="margin-top:6px">' + rows.length + ' entries' +
    (r.authenticated ? ' · authenticated' : ' · anonymous') + '</div>';
}

function mountContent(el) {
  el.classList.add("ftp-content");
  el.innerHTML =
    '<div class="ftp-card"><div class="ftp-h">FTP connection</div><div id="ftp-status"><div class="empty">loading…</div></div></div>' +
    '<div class="ftp-card"><div class="ftp-h">Probe a directory (anonymous)</div>' +
      '<div class="ftp-bar"><input id="ftp-url" placeholder="ftp://ftp.3gpp.org/Specs/archive/38_series/">' +
        '<button id="ftp-go" class="primary">List</button></div>' +
      '<div id="ftp-out"><div class="empty">List an anonymous FTP directory to verify connectivity.</div></div>' +
    '</div>';
  return el;
}

window.AppUIReady.then(function () {
  _app = AppUI.createApp({
    id: "platform-auth-ftp",
    title: "Connection (FTP)",
    content: { render: function (el) { _root = mountContent(el); } },
    statusbar: {},
  });
  function wire() {
    if (!_root) { setTimeout(wire, 20); return; }
    refreshStatus(_root);
    _root.querySelector("#ftp-go").addEventListener("click", function () { probe(_root); });
    _root.querySelector("#ftp-url").addEventListener("keydown", function (e) { if (e.key === "Enter") probe(_root); });
    if (_app && _app.setStatus) _app.setStatus("Anonymous FTP connection app (stdlib). Credential seam wired for authenticated hosts.");
  }
  wire();
}).catch(function (e) {
  document.getElementById("app-content-body").innerHTML =
    '<div style="padding:18px">AppUI failed to load: ' + esc(e) + '</div>';
});
