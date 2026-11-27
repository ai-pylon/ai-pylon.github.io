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
  if (!f.token && existing) {
    if (["url","type","user","product"].some(function(k){return (f[k]||"") !== (existing[k]||"");})) {
      app.setStatus("Enter a token again before changing the destination or authentication metadata of an existing credential."); return;
    }
    delete f.token;
  }
  if (!f.token && !existing) { app.setStatus("Token is required for a new credential."); return; }
  var message=document.createElement("p");message.textContent="Save credential "+f.name+" for "+(f.url || "(no URL)")+"?";
  if (!await AppUIDialog.confirmAsync(message)) return;
  f.confirm=true;
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
