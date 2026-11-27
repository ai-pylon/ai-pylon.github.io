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
    // Wait for provider defaults before applying explicit deep-link values once.
    // Keep users' edits if provider discovery takes time.
    var dirty = false;
    var form = contentEl.querySelector("#f-name").closest(".cred-form");
    form.addEventListener("input", function(){ dirty = true; });
    form.addEventListener("change", function(){ dirty = true; });
    var initial = AppUIUrlFields.read(AppUIUrlFields.credentialSchema);
    loadProviders(contentEl).catch(function(){ }).then(function(){
      if (dirty || !Object.keys(initial).length) return;
      if (initial.service !== "custom" && initial.product && formController.hasProvider(initial.product)) {
        provSel.value=initial.product; applyProvider(contentEl,initial.product);
      }
      var applied=AppUIUrlFields.prefill(form,AppUIUrlFields.credentialSchema,{focus:"#f-token"});
      if(applied.length){
        contentEl.querySelector("#provider-hint").textContent="Prefilled from link. Review the destination and fields before entering your token and saving.";
        form.scrollIntoView({block:"center"});
        app.setStatus("Review prefilled fields; no changes saved.");
      }
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
