// Provider discovery and credential form editing; vault state stays in the page.
(function (global) {
  "use strict";
  function create(deps) {
    var api = deps.api, apiH = deps.apiH, refresh = deps.refresh;
// --- friendly "known service" picker -------------------------------------
// Loads auth_http.products (each token plugin's label + FIELDS) so a user can
// pick e.g. "Confluence" and get the right type/product pre-filled + the FIELDS'
// placeholders/help, instead of guessing product/type strings. The type a
// product expects is inferred. PREFERRED source is each auth_http plugin's
// declared AUTH_TYPE (surfaced as products[].auth_type) so the page needs zero
// per-product knowledge (#22); this map is only a FALLBACK for a plugin that
// hasn't declared one yet.
var PROVIDERS = {};   // name -> {label, fields, type, product}
var _PROVIDER_TYPE = { gitlab: "private-token", gerrit: "basic",
                       confluence: "bearer", appforge: "bearer" };

async function loadProviders(root) {
  var r = await apiH("products", { kind: "token" });
  var prods = (r.data && r.data.products) || [];
  var sel = root.querySelector("#f-provider");
  if (!sel) return;
  // keep the leading "custom" option; append discovered products
  prods.forEach(function (p) {
    if (!p.name || p.name === "?") return;
    PROVIDERS[p.name] = { label: p.label || p.name, fields: p.fields || [],
                          type: p.auth_type || _PROVIDER_TYPE[p.name] || "bearer", product: p.name };
    var o = document.createElement("option");
    o.value = p.name; o.textContent = p.label || p.name;
    sel.appendChild(o);
  });
}

function applyProvider(root, name) {
  var hint = root.querySelector("#provider-hint");
  var urlIn = root.querySelector("#f-url"), tokIn = root.querySelector("#f-token");
  if (!name || !PROVIDERS[name]) {
    if (hint) hint.textContent = "";
    return;
  }
  var p = PROVIDERS[name];
  // pre-fill the mechanical fields the user shouldn't have to know
  root.querySelector("#f-type").value = p.type;
  root.querySelector("#f-product").value = p.product;
  if (!root.querySelector("#f-name").value) root.querySelector("#f-name").value = name;
  // drive url/token placeholders + help from the product's declared FIELDS
  var urlF = (p.fields || []).filter(function (f) { return f.key === "url"; })[0];
  var tokF = (p.fields || []).filter(function (f) { return f.key === "token"; })[0];
  if (urlF && urlF.placeholder) urlIn.placeholder = urlF.placeholder;
  if (tokF && tokF.placeholder) tokIn.placeholder = tokF.placeholder;
  var help = [];
  if (urlF && urlF.help) help.push(urlF.help);
  if (tokF && tokF.help) help.push(tokF.help);
  if (hint) hint.textContent = help.join("  ·  ") || (p.label + " credential");
}

function readForm(root) {
  var g = function (id) { return root.querySelector("#f-" + id).value.trim(); };
  return { name: g("name"), url: g("url"), token: g("token"),
           type: root.querySelector("#f-type").value, user: g("user"),
           product: g("product"), expires_at: g("expires_at") };
}

function fillForm(root, c) {
  root.querySelector("#f-name").value = c.name || "";
  root.querySelector("#f-url").value = c.url || "";
  root.querySelector("#f-token").value = "";  // never pre-fill the secret
  root.querySelector("#f-type").value = c.type || "bearer";
  root.querySelector("#f-user").value = c.user || "";
  root.querySelector("#f-product").value = c.product || "";
  root.querySelector("#f-expires_at").value = c.expires_at || "";
  // sync the provider picker to the product (or back to custom) + clear the hint
  var sel = root.querySelector("#f-provider");
  if (sel) sel.value = (c.product && PROVIDERS[c.product]) ? c.product : "";
  var hint = root.querySelector("#provider-hint");
  if (hint) hint.textContent = "";
}

function editCred(root, name) {
  var c = deps.getCredentials().filter(function (x) { return x.name === name; })[0];
  if (c) { fillForm(root, c); root.querySelector("#f-token").focus(); }
}

async function saveCred(app, root) {
  var f = readForm(root);
  if (!f.name) { app.setStatus("Name is required."); return; }
  // Keep existing token if the field is blank on an edit.
  var existing = deps.getCredentials().filter(function (x) { return x.name === f.name; })[0];
  if (!f.token && existing) { delete f.token; }
  app.setStatus("Saving " + f.name + " …");
  var r = await api("set", f);
  if (!r.ok || (r.data && r.data.error)) {
    app.setStatus("Error: " + ((r.data && r.data.error) || r.status)); return;
  }
  root.querySelector("#f-token").value = "";
  await refresh(app, root);
}

    return { loadProviders: loadProviders, applyProvider: applyProvider,
      fillForm: fillForm, editCred: editCred, saveCred: saveCred,
      hasProvider: function (name) { return !!PROVIDERS[name]; } };
  }
  global.CredentialForm = { create: create };
})(window);

;
// Credential table rendering, token health and visibility-aware refresh.
(function (global) {
  "use strict";
  function create(deps) {
    var STATE = deps.state, api = deps.api, apiH = deps.apiH, esc = deps.esc;
    var delCred = deps.delCred, editCred = deps.editCred;
    var refreshCred = deps.refreshCred, testCred = deps.testCred, poller = null;
function fmtDuration(secs) {
  secs = Math.max(0, Math.round(secs));
  if (secs >= 3600) return Math.floor(secs / 3600) + "h " + Math.round((secs % 3600) / 60) + "m";
  if (secs >= 60) return Math.round(secs / 60) + "m";
  return secs + "s";
}

function healthFor(name) {
  var s = STATE.statuses[name];
  if (!s) return { dot: "gray", text: "unknown", msal: "" };
  var txt = s.health;
  var msal = "";
  // Browser-bound MSAL token: show the live remaining lifetime as its own badge.
  if (s.token_source === "browser-msal") {
    if (s.expires_in != null && s.expires_in > 0) {
      var cls = s.expires_in < 300 ? "exp-soon" : "exp-ok";
      msal = '<span class="msal-exp ' + cls + '" title="MSAL token expires at ' +
             esc(s.expires_at || "") + '">⏱ ' + fmtDuration(s.expires_in) +
             (s.expires_at ? ' · ' + esc(s.expires_at) : '') + '</span>';
    } else if (s.expires_in != null) {
      msal = '<span class="msal-exp exp-soon">⏱ expired</span>';
    } else if (s.token_detail) {
      msal = '<span class="msal-exp exp-none" title="' + esc(s.token_detail) +
             '">no cached token — refresh to mint</span>';
    }
  } else if (s.detail) {
    txt += " · " + s.detail;
  } else if (s.expires_at) {
    txt += " · expires " + s.expires_at;
    if (typeof s.days_left === "number") txt += " (" + s.days_left + "d)";
  }
  return { dot: s.health || "gray", text: txt, msal: msal };
}

function renderTable(root) {
  var box = root.querySelector("#cred-list");
  if (!box) return;
  if (!STATE.creds.length) {
    box.innerHTML = '<div class="empty">No credentials yet. Add one below.</div>';
    return;
  }
  var rows = STATE.creds.map(function (c) {
    var h = healthFor(c.name);
    return '<tr>' +
      '<td><div class="cred-name">' + esc(c.name) + '</div>' +
          '<div class="cred-url">' + esc(c.url || "") + '</div></td>' +
      '<td>' + esc(c.type || "") + (c.product ? " · " + esc(c.product) : "") + '</td>' +
      '<td><span class="cred-hint">' + esc(c.token_hint || (c.has_token ? "set" : "—")) + '</span></td>' +
      '<td data-health="' + esc(c.name) + '"><span class="dot ' + h.dot + '"></span><span class="health-text">' + esc(h.text) + '</span>' +
        (h.msal || "") + '</td>' +
      '<td class="row-actions">' +
        '<button data-test="' + esc(c.name) + '">test</button>' +
        '<button data-rfr="' + esc(c.name) + '">refresh</button>' +
        '<button data-edit="' + esc(c.name) + '">edit</button>' +
        '<button class="danger" data-del="' + esc(c.name) + '">delete</button>' +
      '</td></tr>';
  }).join("");
  box.innerHTML =
    '<table class="cred-table"><thead><tr>' +
      '<th>Credential</th><th>Type</th><th>Token</th><th>Health</th><th></th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table>';

  box.querySelectorAll("[data-del]").forEach(function (b) {
    b.addEventListener("click", function () { delCred(root, b.getAttribute("data-del")); });
  });
  box.querySelectorAll("[data-edit]").forEach(function (b) {
    b.addEventListener("click", function () { editCred(root, b.getAttribute("data-edit")); });
  });
  box.querySelectorAll("[data-rfr]").forEach(function (b) {
    b.addEventListener("click", function () { refreshCred(root.__app, root, b.getAttribute("data-rfr")); });
  });
  box.querySelectorAll("[data-test]").forEach(function (b) {
    b.addEventListener("click", function () { testCred(root.__app, root, b.getAttribute("data-test"), b); });
  });
}

// #24: update ONLY the per-row Health cell (diff), not the whole table. The 30s
// live countdown previously re-rendered the entire table (full innerHTML rebuild
// + re-wiring every row's buttons) every tick. Here we rewrite just each row's
// data-health <td> when its rendered health text actually changed, leaving the
// rest of the DOM (and the wired button handlers) untouched.
function _updateHealthCells(root) {
  var box = root.querySelector("#cred-list");
  if (!box) return;
  (STATE.creds || []).forEach(function (c) {
    var sel = (window.CSS && CSS.escape) ? CSS.escape(c.name) : c.name.replace(/"/g, '\\"');
    var cell = box.querySelector('[data-health="' + sel + '"]');
    if (!cell) return;
    var h = healthFor(c.name);
    var html = '<span class="dot ' + h.dot + '"></span><span class="health-text">' +
      esc(h.text) + '</span>' + (h.msal || "");
    if (cell.innerHTML !== html) cell.innerHTML = html;   // diff: only touch on change
  });
}

async function refresh(app, root) {
  app.setStatus("Loading credentials …");
  var lst = await api("list", {});
  STATE.creds = (lst.data && lst.data.credentials) || [];
  // RENDER the credentials IMMEDIATELY — don't block the table on the (slow,
  // live-probing) auth_http.status call. A stale/failing status must never hide
  // the credential rows (that was the "no entries shown" bug). Load health
  // separately and re-render when it arrives.
  renderTable(root);
  app.setStatus(STATE.creds.length + " credential(s).");
  try {
    var st = await apiH("status", { probe: false });
    STATE.statuses = (st.data && st.data.statuses) || {};
    renderTable(root);
  } catch (e) {
    STATE.statuses = STATE.statuses || {};
  }
}

// Live countdown: tick the MSAL "expires in" every 30s and re-poll status every
// 2 min. #24: PAUSE when the tab/panel isn't visible (document.hidden) so a
// backgrounded workspace tab isn't doing periodic work, and update only the
// changed Health CELLS (diff) instead of rebuilding the whole table every tick.
function startAutoRefresh(app, root) {
  if (poller) poller.destroy();
  var sincePoll = 0;
  poller = deps.polling.create(async function () {
    sincePoll += 30;
    // tick the MSAL countdowns locally
    Object.keys(STATE.statuses).forEach(function (n) {
      var s = STATE.statuses[n];
      if (s && s.token_source === "browser-msal" && typeof s.expires_in === "number")
        s.expires_in = Math.max(0, s.expires_in - 30);
    });
    if (sincePoll >= 120) {
      sincePoll = 0;
      try {
        var st = await apiH("status", { probe: false });
        if (st.data && st.data.statuses) STATE.statuses = st.data.statuses;
      } catch (e) {}
    }
    _updateHealthCells(root);   // per-row diff, not a full renderTable
  }, 30000, { stopWhen: function () { return !root.isConnected; } });
  poller.start();
}

    return { renderTable: renderTable, refresh: refresh, startAutoRefresh: startAutoRefresh,
      destroy: function () { if (poller) poller.destroy(); poller = null; } };
  }
  global.CredentialTable = { create: create };
})(window);

;
// Credential Store — AppUI page. Served at /apps/platform/credential/.
// VAULT ops (list/set/delete/master_*) dispatch at /v1/apps/platform/credential/<op>.
// CONNECTION ops (status/refresh/fetch/products) now live in the auth_http app —
// credential is the sealed vault only; auth_http owns connection logic + plugins.
var APP = "platform/credential";
var AUTH_HTTP = "platform/auth_http";

function esc(s){ return String(s==null?"":s).replace(/[&<>"]/g, function(c){
  return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]; }); }

window.addEventListener("error", function (e) {
  try {
    fetch("/v1/log", { method: "POST", headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ level:"error", source:"credential.page",
        message: String(e.message || e), fields:{ at:"window.error" } }) });
  } catch (_) {}
});

async function _post(app, op, body) {
  var response = await window.AppUIApi.requestResponse("/v1/apps/" + app + "/" + op, body || {}, {
    method: "POST", timeout: null, decode: function (result) { return result.json(); }
  });
  return { ok: response.ok, status: response.status, data: response.data };
}

// Vault ops → credential; connection ops → auth_http.
async function api(op, body) { return _post(APP, op, body); }
async function apiH(op, body) { return _post(AUTH_HTTP, op, body); }

var STATE = { creds: [], statuses: {} };

var tableController = null;
function renderTable(root) { return tableController.renderTable(root); }
function refresh(app, root) { return tableController.refresh(app, root); }
function startAutoRefresh(app, root) { return tableController.startAutoRefresh(app, root); }

var formController = null;
function loadProviders(root) { return formController.loadProviders(root); }
function applyProvider(root, name) { return formController.applyProvider(root, name); }
function fillForm(root, credential) { return formController.fillForm(root, credential); }
function editCred(root, name) { return formController.editCred(root, name); }
function saveCred(app, root) { return formController.saveCred(app, root); }

async function testCred(app, root, name, btn) {
  // #23: one-click live check — calls auth_http.test (plugin refresh or an
  // authenticated GET of the product's test URL) and shows 200/401 inline so a
  // freshly-added PAT can be verified before mounting.
  var old = btn ? btn.textContent : "";
  if (btn) { btn.textContent = "…"; btn.disabled = true; }
  app.setStatus("Testing " + name + " …");
  var r = await apiH("test", { name: name });
  var d = r.data || {};
  if (btn) { btn.textContent = old; btn.disabled = false; }
  var ok = !!(d.ok || d.verified);
  var detail = d.detail || (d.status ? ("HTTP " + d.status) : (d.error || "no response"));
  app.setStatus((ok ? "✓ " : "✗ ") + name + " — " + detail +
                (d.test_url ? " (" + d.test_url + ")" : ""));
  if (btn) {
    btn.classList.remove("ok", "bad");
    btn.classList.add(ok ? "ok" : "bad");
    btn.title = detail;
  }
}

async function refreshCred(app, root, name) {
  app.setStatus("Refreshing " + name + " …");
  var r = await apiH("refresh", { name: name });
  var d = r.data || {};
  if (!d.ok) {
    app.setStatus("Refresh failed: " + (d.error || r.status) +
                  (d.category ? " (" + d.category + ")" : ""));
    return;
  }
  var msg;
  if (d.expires_in != null) {
    var mins = Math.round(d.expires_in / 60);
    msg = name + " refreshed · " + (d.aud || d.audience || "") + " · expires in " + mins + " min";
  } else {
    msg = name + " refreshed" + (d.detail ? " · " + d.detail : "");
  }
  await refresh(app, root);     // reload the table first…
  app.setStatus(msg);           // …then show the refresh result (don't clobber it)
}

async function delCred(root, name) {
  if (!window.confirm("Delete credential '" + name + "'?")) return;
  await api("delete", { name: name });
  var app = root.__app;
  await refresh(app, root);
}

async function doFetch(app, root) {
  var url = root.querySelector("#fetch-url").value.trim();
  var out = root.querySelector("#fetch-out");
  if (!url) { app.setStatus("Enter a URL to fetch."); return; }
  app.setStatus("Fetching " + url + " …");
  out.textContent = "";
  var r = await apiH("fetch", { url: url });
  var d = r.data || {};
  app.setStatus("HTTP " + (d.status || r.status) +
                (d.credential ? " · as " + d.credential : " · (no credential matched)"));
  var body = (d.body || "");
  out.textContent = "status " + (d.status || r.status) +
    (d.credential ? "  credential=" + d.credential : "") + "\n\n" +
    body.slice(0, 4000) + (body.length > 4000 ? "\n… (truncated)" : "");
}

function mountContent(el) {
  el.classList.add("cred-content");
  el.innerHTML =
    '<div class="cred-form master">' +
      '<h3>Shared master account</h3>' +
      '<div class="master-status" id="master-status">Checking…</div>' +
      '<div class="grid">' +
        '<label for="m-user">User</label><input id="m-user" placeholder="AD signum, e.g. ejasung">' +
        '<label for="m-pass">Password</label><input id="m-pass" type="password" placeholder="AD password">' +
      '</div>' +
      '<div class="master-hint">One id+password reused by AD-basic services (SSH password, Eridoc, wiki, Kerberos). ' +
        'Sealed with the store; the password is never shown back or sent to the browser.</div>' +
      '<div class="actions">' +
        '<button id="m-save">Set master</button>' +
        '<button id="m-clear" class="ghost">Clear master</button>' +
      '</div>' +
      '<div class="master-check">' +
        '<label for="m-check">Check a password</label>' +
        '<input id="m-check" type="password" placeholder="type a password to verify it matches the stored master">' +
        '<button id="m-check-go" class="ghost">Check</button>' +
        '<span class="check-result" id="m-check-result"></span>' +
      '</div>' +
    '</div>' +
    '<div class="cred-toolbar">' +
      '<button id="reload" class="ghost">Reload</button>' +
      '<span class="spacer"></span>' +
      '<button id="newcred" class="ghost">Clear form</button>' +
    '</div>' +
    '<div id="cred-list"></div>' +
    '<div class="cred-form">' +
      '<h3>Add / update credential</h3>' +
      '<div class="quick-add">' +
        '<label for="f-provider">Service</label>' +
        '<select id="f-provider"><option value="">— custom (manual) —</option></select>' +
        '<span class="quick-hint" id="provider-hint"></span>' +
      '</div>' +
      '<div class="grid">' +
        '<label for="f-name">Name</label><input id="f-name" placeholder="gitlab-rnd">' +
        '<label for="f-url">URL</label><input id="f-url" placeholder="https://gitlab.example.com">' +
        '<label for="f-token">Token</label><input id="f-token" type="password" placeholder="(leave blank to keep existing)">' +
        '<label for="f-type">Type</label>' +
          '<select id="f-type">' +
            '<option value="bearer">bearer</option>' +
            '<option value="private-token">private-token</option>' +
            '<option value="basic">basic</option>' +
            '<option value="botpassword">botpassword (MediaWiki)</option>' +
            '<option value="cookie">cookie</option>' +
          '</select>' +
        '<label for="f-user">User</label><input id="f-user" placeholder="(basic auth user; botpassword: User@botname)">' +
        '<label for="f-product">Product</label><input id="f-product" placeholder="gitlab | gerrit | confluence">' +
        '<label for="f-expires_at">Expires</label><input id="f-expires_at" placeholder="YYYY-MM-DD">' +
      '</div>' +
      '<div class="actions">' +
        '<button id="save">Save</button>' +
        '<button id="clear" class="ghost">Clear</button>' +
      '</div>' +
    '</div>' +
    '<div class="cred-form">' +
      '<h3>Test a credential-injected fetch</h3>' +
      '<div class="fetch-box">' +
        '<input id="fetch-url" placeholder="https://gitlab.example.com/api/v4/user">' +
        '<button id="fetch-go">Fetch</button>' +
      '</div>' +
      '<div class="fetch-out" id="fetch-out"></div>' +
    '</div>';
  return el;
}

async function loadMaster(app, root) {
  var box = root.querySelector("#master-status");
  var r = await api("master_status", {});
  var d = r.data || {};
  if (d.has_master) {
    box.className = "master-status set";
    box.innerHTML = '<span class="dot green"></span> set for <b>' + esc(d.user) + '</b>';
    root.querySelector("#m-user").value = d.user || "";
  } else {
    box.className = "master-status unset";
    box.innerHTML = '<span class="dot gray"></span> not set';
  }
  root.querySelector("#m-pass").value = "";
}

async function saveMaster(app, root) {
  var user = root.querySelector("#m-user").value.trim();
  var password = root.querySelector("#m-pass").value;
  if (!user || !password) { app.setStatus("Master needs a user and a password."); return; }
  app.setStatus("Setting shared master …");
  var r = await api("master_set", { user: user, password: password });
  if (!r.ok || (r.data && r.data.error)) {
    app.setStatus("Error: " + ((r.data && r.data.error) || r.status)); return;
  }
  app.setStatus("Shared master set for " + user + ".");
  await loadMaster(app, root);
}

async function clearMaster(app, root) {
  if (!window.confirm("Forget the shared master account?")) return;
  await api("master_clear", {});
  app.setStatus("Shared master cleared.");
  await loadMaster(app, root);
}

async function checkMaster(app, root) {
  var pw = root.querySelector("#m-check").value;
  var out = root.querySelector("#m-check-result");
  if (!pw) { out.textContent = ""; app.setStatus("Type a password to check."); return; }
  out.textContent = "checking…"; out.className = "check-result";
  var r = await api("master_check", { password: pw });
  var d = r.data || {};
  if (!d.ok) { out.textContent = esc(d.error || "error"); out.className = "check-result bad"; return; }
  if (!d.has_master) { out.textContent = "no master set"; out.className = "check-result bad"; }
  else if (d.match) { out.textContent = "✓ matches the stored master"; out.className = "check-result ok"; }
  else { out.textContent = "✗ does NOT match"; out.className = "check-result bad"; }
  app.setStatus(d.has_master ? ("password " + (d.match ? "matches" : "does not match")) : "no master set");
}

window.AppUIReady.then(function () {
  tableController = CredentialTable.create({
    state: STATE, api: api, apiH: apiH, esc: esc, polling: AppUIPollRefresh,
    delCred: delCred, editCred: editCred, refreshCred: refreshCred, testCred: testCred
  });
  formController = CredentialForm.create({
    api: api, apiH: apiH, refresh: refresh,
    getCredentials: function () { return STATE.creds; }
  });
  var contentEl = null;
  var app = AppUI.createApp({
    id: "system-credential",
    title: "Credential Store",
    menu: { View: [ { id: "reload", label: "Reload" } ] },
    onAction: function (_menu, id) { if (id === "reload" && contentEl) refresh(app, contentEl); },
    content: { render: function (el) { contentEl = mountContent(el); el.__app = app; } },
    statusbar: {},
  });
  function wire() {
    if (!contentEl) { setTimeout(wire, 20); return; }
    contentEl.__app = app;
    contentEl.querySelector("#reload").addEventListener("click", function () { refresh(app, contentEl); loadMaster(app, contentEl); });
    contentEl.querySelector("#newcred").addEventListener("click", function () { fillForm(contentEl, {}); });
    contentEl.querySelector("#clear").addEventListener("click", function () { fillForm(contentEl, {}); });
    contentEl.querySelector("#save").addEventListener("click", function () { saveCred(app, contentEl); });
    var provSel = contentEl.querySelector("#f-provider");
    if (provSel) provSel.addEventListener("change", function () { applyProvider(contentEl, provSel.value); });
    loadProviders(contentEl).then(function () {
      // #16: a "sign-in needed" banner elsewhere deep-links here with ?product=
      // (e.g. ?product=cpistore). Pre-select that provider in the add form so the
      // user lands ready to enter the missing credential.
      try {
        var _wantP = new URLSearchParams(window.location.search).get("product");
        if (_wantP && formController.hasProvider(_wantP) && provSel) {
          provSel.value = _wantP; applyProvider(contentEl, _wantP);
          var nf = contentEl.querySelector("#f-name"); if (nf && !nf.value) nf.value = _wantP;
        }
      } catch (e) {}
    });
    contentEl.querySelector("#fetch-go").addEventListener("click", function () { doFetch(app, contentEl); });
    contentEl.querySelector("#m-save").addEventListener("click", function () { saveMaster(app, contentEl); });
    contentEl.querySelector("#m-clear").addEventListener("click", function () { clearMaster(app, contentEl); });
    contentEl.querySelector("#m-check-go").addEventListener("click", function () { checkMaster(app, contentEl); });
    contentEl.querySelector("#m-check").addEventListener("keydown", function (e) { if (e.key === "Enter") checkMaster(app, contentEl); });
    loadMaster(app, contentEl);
    refresh(app, contentEl);
    startAutoRefresh(app, contentEl);
  }
  wire();
}).catch(function (e) {
  document.getElementById("app-content-body").innerHTML =
    '<div style="padding:18px">AppUI failed to load: ' + esc(e) + '</div>';
});
