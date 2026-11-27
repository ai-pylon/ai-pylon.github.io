(function (global) {
  "use strict";
  function create(deps) {
    var api = deps.api, esc = deps.esc;
async function refreshSaved(app, root) {
  var r = await api("host_list", {});
  var hosts = (r.data && r.data.hosts) || [];
  // fill the datalist for the connect/sftp/exec host fields
  var dl = root.querySelector("#saved-aliases");
  if (dl) dl.innerHTML = hosts.map(function (h) {
    return '<option value="' + esc(h.alias) + '">' + esc(h.host) + ':' + h.port + '</option>'; }).join("");
  var box = root.querySelector("#saved-list");
  if (!hosts.length) { box.innerHTML = '<div class="empty">No saved hosts. Save one above so terminal / vfs / git can use its alias.</div>'; return; }
  box.innerHTML = '<ul class="conn-list">' + hosts.map(function (h) {
    return '<li><span class="alias">' + esc(h.alias) + '</span>' +
      '<span>' + esc(h.host) + ':' + h.port + (h.user ? " · " + esc(h.user) : "") +
        (h.mode ? " · " + esc(h.mode) : "") + '</span>' +
      '<span class="meta" data-test-result="' + esc(h.alias) + '">' + (h.label ? esc(h.label) : "") + '</span>' +
      '<button data-test="' + esc(h.alias) + '">test</button>' +
      '<button data-use="' + esc(h.alias) + '">use</button>' +
      '<button data-del="' + esc(h.alias) + '">delete</button></li>';
  }).join("") + '</ul>';
  box.querySelectorAll("[data-test]").forEach(function (b) {
    b.addEventListener("click", async function () {
      var alias = b.getAttribute("data-test");
      var cell = box.querySelector('[data-test-result="' + alias + '"]');
      var prev = b.textContent; b.textContent = "testing…"; b.disabled = true;
      if (cell) { cell.textContent = "testing…"; cell.className = "meta testing"; }
      var r = await api("host_test", { alias: alias });
      var d = r.data || {};
      if (cell) {
        if (d.ok) { cell.className = "meta ok"; cell.textContent = "✓ reachable · " + (d.latency_ms != null ? d.latency_ms + "ms" : "") + (d.mode ? " · " + d.mode : ""); }
        else if (d.reachable) { cell.className = "meta warn"; cell.textContent = "⚠ connected but probe failed: " + (d.error || ""); }
        else { cell.className = "meta bad"; cell.textContent = "✗ " + (d.error || "unreachable"); }
      }
      app.setStatus("test " + alias + ": " + (d.ok ? "reachable" : (d.error || "failed")));
      b.textContent = prev; b.disabled = false;
    });
  });
  box.querySelectorAll("[data-use]").forEach(function (b) {
    b.addEventListener("click", function () {
      var h = hosts.find(function (x) { return x.alias === b.getAttribute("data-use"); });
      if (!h) return;
      root.querySelector("#c-host").value = h.alias;
      root.querySelector("#c-port").value = h.port;
      if (h.user) root.querySelector("#c-user").value = h.user;
      if (h.mode) root.querySelector("#c-mode").value = (h.mode === "master" ? "master" : h.mode);
      app.setStatus("Loaded alias '" + h.alias + "' into the connect form.");
    });
  });
  box.querySelectorAll("[data-del]").forEach(function (b) {
    b.addEventListener("click", async function () {
      await api("host_delete", { alias: b.getAttribute("data-del") });
      refreshSaved(app, root);
    });
  });
}

async function saveHost(app, root) {
  var alias = root.querySelector("#s-alias").value.trim();
  var host = root.querySelector("#s-host").value.trim();
  if (!alias || !host) { app.setStatus("Alias and host are required."); return; }
  var body = { alias: alias, host: host,
    port: parseInt(root.querySelector("#s-port").value, 10) || 22,
    user: root.querySelector("#s-user").value.trim(),
    mode: root.querySelector("#s-mode").value,
    label: root.querySelector("#s-label").value.trim() };
  var r = await api("host_save", body);
  if (!r.ok || (r.data && r.data.ok === false)) {
    app.setStatus("Save failed: " + ((r.data && r.data.error) || r.status)); return;
  }
  app.setStatus("Saved alias '" + alias + "' → " + host);
  ["s-alias","s-host","s-user","s-label"].forEach(function (id) { root.querySelector("#" + id).value = ""; });
  root.querySelector("#s-port").value = "22";
  refreshSaved(app, root);
}

    return { refreshSaved: refreshSaved, saveHost: saveHost };
  }
  global.ConnectionHosts = { create: create };
})(window);
