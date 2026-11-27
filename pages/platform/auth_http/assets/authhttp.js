// Connection (HTTP) — auth_http page. The HTTP-connection app's dashboard:
// per-credential health, token lifetime, plugin info, plus Test / Refresh and
// an ad-hoc credential-injected fetch probe. Served at /apps/platform/auth_http/.
var APP = "platform/auth_http";

function esc(s){ return String(s==null?"":s).replace(/[&<>"]/g, function(c){
  return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]; }); }

window.addEventListener("error", function (e) {
  try {
    fetch("/v1/log", { method: "POST", headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ level:"error", source:"auth_http.page",
        message: String(e.message || e), fields:{ at:"window.error" } }) });
  } catch (_) {}
});

async function callOp(op, body) {
  try {
    var r = await fetch("/v1/apps/" + APP + "/" + op, {
      method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(body||{}) });
    var data = await r.json();
    if (!r.ok && !data.error) data.error = "HTTP " + r.status;
    return data;
  } catch (e) { return { error: String(e) }; }
}

var HEALTH = { green: "#2e9e40", yellow: "#d2a106", red: "#d92d3a", gray: "#9aa0a6" };
function dot(h) { return '<span class="ah-dot" style="background:' + (HEALTH[h] || HEALTH.gray) + '"></span>'; }

function renderTable(root, statuses) {
  var box = root.querySelector("#ah-rows");
  var names = Object.keys(statuses || {}).sort();
  if (!names.length) { box.innerHTML = '<div class="ah-empty">No credentials registered. Apps register browser-bound creds on first use.</div>'; return; }
  box.innerHTML = names.map(function (n) {
    var s = statuses[n] || {};
    var exp = s.expires_at ? esc(s.expires_at) : (s.expires_in != null ? (s.expires_in + "s") : "—");
    var life = (s.days_left != null ? (s.days_left + "d") : (s.expires_in != null ? Math.round(s.expires_in/60) + "m" : ""));
    var src = s.token_source || (s.plugin ? s.plugin : "");
    return '<div class="ah-row" data-name="' + esc(n) + '">' +
      '<div class="ah-c ah-name">' + dot(s.health) + ' <b>' + esc(n) + '</b></div>' +
      '<div class="ah-c ah-url" title="' + esc(s.url||"") + '">' + esc(s.url || "") + '</div>' +
      '<div class="ah-c ah-type">' + esc(s.type || "") + (src ? ' <span class="ah-sub">· ' + esc(src) + '</span>' : '') + '</div>' +
      '<div class="ah-c ah-tok">' + (s.has_token ? '✓' : '—') + '</div>' +
      '<div class="ah-c ah-exp" title="' + esc(exp) + '">' + (life || exp) + '</div>' +
      '<div class="ah-c ah-act">' +
        '<button class="ah-btn" data-act="test">Test</button>' +
        '<button class="ah-btn" data-act="refresh">Refresh</button>' +
      '</div></div>';
  }).join("");
  box.querySelectorAll(".ah-row").forEach(function (row) {
    var name = row.dataset.name;
    row.querySelectorAll(".ah-btn").forEach(function (b) {
      b.addEventListener("click", function () { rowAction(root, name, b.dataset.act, b); });
    });
  });
}

async function rowAction(root, name, act, btn) {
  var old = btn.textContent; btn.disabled = true; btn.textContent = act === "test" ? "testing…" : "…";
  var r = await callOp(act, { name: name });
  btn.disabled = false; btn.textContent = old;
  var line = root.querySelector("#ah-result");
  if (r.error) { line.className = "ah-result err"; line.textContent = name + " " + act + ": " + r.error; }
  else if (act === "test") {
    line.className = "ah-result " + (r.verified || r.ok ? "ok" : "err");
    line.textContent = name + " test: " + (r.verified ? "✓ verified" : (r.ok ? "ok" : "failed")) +
      (r.detail ? " — " + r.detail : "") + (r.status ? " (HTTP " + r.status + ")" : "");
  } else {
    line.className = "ah-result ok";
    line.textContent = name + " refreshed" + (r.aud ? " · aud " + r.aud : "") +
      (r.expires_in != null ? " · expires in " + Math.round(r.expires_in/60) + "m" : "") +
      (r.source_url ? " · from " + r.source_url : "");
  }
  loadStatus(root);   // refresh the table (health may change)
}

async function loadStatus(root) {
  var r = await callOp("status", {});
  if (r.error) { root.querySelector("#ah-rows").innerHTML = '<div class="ah-empty err">' + esc(r.error) + '</div>'; return; }
  renderTable(root, r.statuses || {});
}

async function loadProducts(root) {
  var r = await callOp("products", {});
  var box = root.querySelector("#ah-products");
  if (r.error || !(r.products || r.plugins)) { box.innerHTML = ""; return; }
  var list = r.products || r.plugins || [];
  box.innerHTML = '<div class="ah-ph">Supported products</div>' +
    list.map(function (p) {
      var nm = (typeof p === "string") ? p : (p.name || p.product || JSON.stringify(p));
      return '<span class="ah-chip">' + esc(nm) + '</span>';
    }).join("");
}

async function doProbe(root) {
  var url = root.querySelector("#ah-url-in").value.trim();
  var name = root.querySelector("#ah-name-in").value.trim();
  if (!url) { return; }
  var out = root.querySelector("#ah-probe-out");
  out.textContent = "fetching…";
  var r = await callOp("fetch", { url: url, name: name || undefined, no_cache: true });
  if (r.error) { out.className = "ah-probe-out err"; out.textContent = "error: " + r.error; return; }
  out.className = "ah-probe-out";
  var body = String(r.body || "");
  out.textContent = "HTTP " + r.status + " · " + body.length + " bytes" +
    (r.credential ? " · as " + r.credential : "") + "\n" + body.slice(0, 1200);
}

function mountContent(el) {
  el.classList.add("ah-content");
  el.innerHTML =
    '<div class="ah-head">' +
      '<div class="ah-title">HTTP connection credentials</div>' +
      '<button id="ah-reload" class="ah-btn">↻ Reload</button>' +
    '</div>' +
    '<div class="ah-tablehead">' +
      '<div class="ah-c ah-name">Name</div><div class="ah-c ah-url">URL</div>' +
      '<div class="ah-c ah-type">Type</div><div class="ah-c ah-tok">Token</div>' +
      '<div class="ah-c ah-exp">Expiry</div><div class="ah-c ah-act">Actions</div>' +
    '</div>' +
    '<div id="ah-rows"><div class="ah-empty">loading…</div></div>' +
    '<div id="ah-result" class="ah-result"></div>' +
    '<div id="ah-products" class="ah-products"></div>' +
    '<div class="ah-probe">' +
      '<div class="ah-ph">Ad-hoc credential-injected fetch (the client never holds the secret)</div>' +
      '<div class="ah-probe-row">' +
        '<input id="ah-url-in" placeholder="https://graph.microsoft.com/v1.0/me">' +
        '<input id="ah-name-in" placeholder="credential name (optional)">' +
        '<button id="ah-probe-go" class="ah-btn primary">Fetch</button>' +
      '</div>' +
      '<pre id="ah-probe-out" class="ah-probe-out"></pre>' +
    '</div>';
  return el;
}

window.AppUIReady.then(function () {
  var contentEl = null, app = null;
  app = AppUI.createApp({
    id: "system-auth-http", title: "Connection (HTTP)",
    menu: { View: [ { id: "reload", label: "Reload" } ] },
    onAction: function (_m, id) { if (id === "reload" && contentEl) { loadStatus(contentEl); loadProducts(contentEl); } },
    content: { render: function (el) { contentEl = mountContent(el); } },
    statusbar: {},
  });
  function wire() {
    if (!contentEl) { setTimeout(wire, 20); return; }
    contentEl.querySelector("#ah-reload").addEventListener("click", function () { loadStatus(contentEl); loadProducts(contentEl); });
    contentEl.querySelector("#ah-probe-go").addEventListener("click", function () { doProbe(contentEl); });
    contentEl.querySelector("#ah-url-in").addEventListener("keydown", function (e) { if (e.key === "Enter") doProbe(contentEl); });
    loadStatus(contentEl); loadProducts(contentEl);
    app.setStatus("HTTP connection dashboard");
  }
  wire();
}).catch(function (e) {
  document.getElementById("app-content-body").innerHTML =
    '<div style="padding:18px">AppUI failed to load: ' + esc(e) + '</div>';
});
