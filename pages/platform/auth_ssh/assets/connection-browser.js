(function (global) {
  "use strict";
  function create(deps) {
    var api = deps.api, esc = deps.esc, STATE = deps.state;
function fmtSize(n) {
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n/1024).toFixed(1) + " K";
  return (n/1048576).toFixed(1) + " M";
}

async function browse(app, root, path) {
  var host = root.querySelector("#fs-host").value.trim() || STATE.host;
  if (!host) { app.setStatus("Connect to a host first."); return; }
  STATE.host = host; STATE.path = path;
  root.querySelector("#fs-path").value = path;
  app.setStatus("Listing " + host + ":" + path + " …");
  var r = await api("list", { host: host, path: path });
  var box = root.querySelector("#fs-out");
  if (!r.ok || (r.data && r.data.error)) {
    box.innerHTML = ""; app.setStatus("List failed: " + ((r.data && r.data.error) || r.status)); return;
  }
  var entries = r.data.entries || [];
  var up = path !== "." && path !== "/" ?
    '<tr data-dir=".."><td><span class="fs-icon">&#8617;</span> ..</td><td class="sz"></td></tr>' : "";
  box.innerHTML = '<table class="fs-table"><tbody>' + up + entries.map(function (e) {
    var icon = e.is_dir ? "📁" : "📄";
    var attr = e.is_dir ? ' data-dir="' + esc(e.name) + '"' : ' data-file="' + esc(e.name) + '"';
    return '<tr' + attr + '><td><span class="fs-icon">' + icon + '</span> ' + esc(e.name) + '</td>' +
           '<td class="sz">' + (e.is_dir ? "" : fmtSize(e.size)) + '</td></tr>';
  }).join("") + '</tbody></table>';
  app.setStatus(host + ":" + path + " · " + entries.length + " item(s)");
  function join(p, name) {
    if (name === "..") { var parts = p.replace(/\/+$/,"").split("/"); parts.pop(); return parts.join("/") || "/"; }
    if (p === "." ) return name;
    return p.replace(/\/+$/,"") + "/" + name;
  }
  box.querySelectorAll("[data-dir]").forEach(function (tr) {
    tr.addEventListener("click", function () { browse(app, root, join(path, tr.getAttribute("data-dir"))); });
  });
  box.querySelectorAll("[data-file]").forEach(function (tr) {
    tr.addEventListener("click", function () { readFile(app, root, host, join(path, tr.getAttribute("data-file"))); });
  });
}

async function readFile(app, root, host, path) {
  app.setStatus("Reading " + path + " …");
  var r = await api("read", { host: host, path: path });
  var out = root.querySelector("#file-out");
  if (!r.ok || (r.data && r.data.error)) { out.textContent = ""; app.setStatus("Read failed: " + ((r.data && r.data.error) || r.status)); return; }
  out.textContent = path + (r.data.truncated ? " (truncated)" : "") + "\n\n" + (r.data.content || "");
  app.setStatus("Read " + r.data.bytes + " bytes from " + path);
}

    return { browse: browse, readFile: readFile };
  }
  global.ConnectionBrowser = { create: create };
})(window);
