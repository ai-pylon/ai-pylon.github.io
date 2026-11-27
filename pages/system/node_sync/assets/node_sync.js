// Node Sync (HTTP) — AppUI management page for system/node_sync.
(function () {
  var APP = "system/node_sync";
  var state = { status: null, diff: null };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function fmtSize(n) {
    if (n == null) return "—";
    if (n < 1024) return n + " B";
    if (n < 1048576) return (n / 1024).toFixed(1) + " KiB";
    return (n / 1048576).toFixed(2) + " MiB";
  }

  async function callOp(op, body, confirm) {
    var payload = Object.assign({}, body || {});
    if (confirm) payload.confirm = true;
    var response = await window.AppUIApi.requestResponse(
      "/v1/apps/" + APP + "/" + op,
      payload,
      {
        method: "POST",
        timeout: null,
        decode: function (r) { return r.json(); }
      }
    );
    return response.data;
  }

  function mountShell(el) {
    el.innerHTML =
      '<div class="ns-wrap">' +
        '<div class="ns-banner" id="ns-banner">Loading Node Sync...</div>' +

        '<section class="ns-card">' +
          '<div class="ns-head">' +
            '<h2>HTTP Peers</h2>' +
            '<button class="ns-btn" id="ns-refresh" type="button">Refresh</button>' +
          '</div>' +
          '<div class="ns-table-wrap" id="ns-peers-table"></div>' +
          '<form class="ns-form" id="ns-peer-form">' +
            '<label class="ns-field">Peer Name<input name="name" required placeholder="gce-vm"></label>' +
            '<label class="ns-field">Base URL<input name="base_url" required placeholder="https://pylon-server.duckdns.org"></label>' +
            '<label class="ns-field">Bearer Token (optional, write-only)<input name="bearer_token" type="password" autocomplete="off"></label>' +
            '<label class="ns-field">Cookie Header (optional, write-only)<input name="cookie" type="password" autocomplete="off"></label>' +
            '<label class="ns-check"><input name="use_auth_http" type="checkbox" checked> Use platform/auth_http</label>' +
            '<button class="ns-btn primary" type="submit">Save Peer</button>' +
          '</form>' +
        '</section>' +

        '<section class="ns-card">' +
          '<div class="ns-head"><h2>Compare &amp; Sync (HTTP — No SSH Required)</h2></div>' +
          '<form class="ns-form" id="ns-diff-form">' +
            '<label class="ns-field">Peer<select name="peer" id="ns-diff-peer"></select></label>' +
            '<label class="ns-field">Scope<select name="scope">' +
              '<option value="code" selected>Code (apps, daemons, framework)</option>' +
              '<option value="data">Data (data/, excluding host-config)</option>' +
              '<option value="all">All (Code + Data)</option>' +
            '</select></label>' +
            '<label class="ns-field">Subpath (optional)<input name="subpath" placeholder="e.g. apps/system or daemons"></label>' +
            '<button class="ns-btn primary" type="submit">Compare (Diff)</button>' +
          '</form>' +
          '<div class="ns-actions ns-hidden" id="ns-sync-bar">' +
            '<span class="ns-pill" id="ns-diff-summary"></span>' +
            '<button class="ns-btn" id="ns-sel-all" type="button">Select All</button>' +
            '<button class="ns-btn" id="ns-sel-none" type="button">Clear Selection</button>' +
            '<button class="ns-btn primary" id="ns-push" type="button">Push Selected (Local → Peer)</button>' +
            '<button class="ns-btn primary" id="ns-pull" type="button">Pull Selected (Peer → Local)</button>' +
          '</div>' +
          '<div class="ns-table-wrap" id="ns-diff-table"></div>' +
          '<pre class="ns-output ns-hidden" id="ns-out"></pre>' +
        '</section>' +
      '</div>';
    return el;
  }

  function showOut(root, data) {
    var el = root.querySelector("#ns-out");
    el.textContent = typeof data === "string" ? data : JSON.stringify(data, null, 2);
    el.classList.remove("ns-hidden");
  }

  function renderStatus(root, s) {
    var b = root.querySelector("#ns-banner");
    if (!s || !s.ok) {
      b.innerHTML = '<span class="ns-pill bad">Error: ' + esc((s && s.error) || "unavailable") + '</span>';
      return;
    }
    var peers = s.peers || [];
    b.innerHTML =
      '<span class="ns-pill ok">Local: ' + esc(s.hostname) + '</span>' +
      '<span class="ns-pill">Peers: ' + esc(peers.length) + '</span>' +
      '<span class="ns-pill">Backups: ' + esc((s.recent_backups || []).length) + '</span>';

    var sel = root.querySelector("#ns-diff-peer");
    sel.innerHTML = peers.map(function (p) {
      return '<option value="' + esc(p.name) + '">' + esc(p.name) + ' (' + esc(p.base_url) + ')</option>';
    }).join("") || '<option value="">(add a peer first)</option>';

    var box = root.querySelector("#ns-peers-table");
    if (!peers.length) {
      box.innerHTML = '<div class="ns-mono" style="opacity:.7">No HTTP peers configured yet.</div>';
      return;
    }
    box.innerHTML =
      '<table class="ns-table"><thead><tr><th>Name</th><th>URL</th><th>Auth</th><th>Actions</th></tr></thead><tbody>' +
      peers.map(function (p) {
        var auth = [];
        if (p.use_auth_http) auth.push("auth_http");
        if (p.has_bearer_token) auth.push("bearer");
        if (p.has_cookie) auth.push("cookie");
        return (
          '<tr>' +
            '<td class="ns-mono">' + esc(p.name) + '</td>' +
            '<td class="ns-mono">' + esc(p.base_url) + '</td>' +
            '<td>' + esc(auth.join(", ") || "none") + '</td>' +
            '<td><button class="ns-btn danger" data-del-peer="' + esc(p.name) + '" type="button">Delete</button></td>' +
          '</tr>'
        );
      }).join("") +
      '</tbody></table>';
  }

  function renderDiff(root, d) {
    var bar = root.querySelector("#ns-sync-bar");
    var tbl = root.querySelector("#ns-diff-table");
    if (!d || !d.ok) {
      bar.classList.add("ns-hidden");
      tbl.innerHTML = "";
      showOut(root, d);
      return;
    }
    var c = d.counts || {};
    root.querySelector("#ns-diff-summary").textContent =
      "Only Local: " + (c.only_local || 0) +
      " · Only Remote: " + (c.only_remote || 0) +
      " · Modified: " + (c.modified || 0) +
      " · Identical: " + (c.same || 0);
    bar.classList.remove("ns-hidden");

    var rows = [];
    (d.modified || []).forEach(function (x) {
      rows.push({ path: x.path, kind: "modified", badge: "warn", info: "newer: " + x.newer + " (" + fmtSize(x.local_size) + " / " + fmtSize(x.remote_size) + ")" });
    });
    (d.only_local || []).forEach(function (x) {
      rows.push({ path: x.path, kind: "only_local", badge: "ok", info: "local only (" + fmtSize(x.local_size) + ")" });
    });
    (d.only_remote || []).forEach(function (x) {
      rows.push({ path: x.path, kind: "only_remote", badge: "", info: "remote only (" + fmtSize(x.remote_size) + ")" });
    });

    if (!rows.length) {
      tbl.innerHTML = '<div class="ns-pill ok">All ' + esc(c.same || 0) + ' files are identical.</div>';
      return;
    }
    tbl.innerHTML =
      '<table class="ns-table"><thead><tr><th></th><th>Path</th><th>Status</th><th>Detail</th></tr></thead><tbody>' +
      rows.map(function (r) {
        return (
          '<tr>' +
            '<td><input type="checkbox" class="ns-path-cb" value="' + esc(r.path) + '" checked></td>' +
            '<td class="ns-mono">' + esc(r.path) + '</td>' +
            '<td><span class="ns-pill ' + r.badge + '">' + esc(r.kind) + '</span></td>' +
            '<td>' + esc(r.info) + '</td>' +
          '</tr>'
        );
      }).join("") +
      '</tbody></table>';
  }

  async function refresh(app, root) {
    app.setStatus("Refreshing Node Sync...");
    var s = await callOp("status", {}, false);
    state.status = s;
    renderStatus(root, s);
    app.setStatus("Ready");
  }

  window.AppUIReady.then(function () {
    var contentEl = null;
    var app = AppUI.createApp({
      id: "system-node-sync",
      title: "Node Sync (HTTP)",
      menu: { View: [{ id: "refresh", label: "Refresh" }] },
      onAction: function (_m, id) { if (id === "refresh" && contentEl) refresh(app, contentEl); },
      content: { render: function (el) { contentEl = mountShell(el); } },
      statusbar: {}
    });

    function selectedPaths(root) {
      return Array.from(root.querySelectorAll(".ns-path-cb:checked")).map(function (el) { return el.value; });
    }

    async function runSync(root, direction) {
      if (!state.diff || !state.diff.ok) return;
      var paths = selectedPaths(root);
      if (!paths.length) {
        showOut(root, "No files selected.");
        return;
      }
      var label = direction === "push" ? "Push (Local → " + state.diff.peer + ")" : "Pull (" + state.diff.peer + " → Local)";
      if (!window.confirm(label + " " + paths.length + " file(s)? Overwritten files are backed up automatically.")) return;
      app.setStatus("Syncing " + paths.length + " file(s)...");
      var res = await callOp("sync", {
        peer: state.diff.peer,
        direction: direction,
        scope: state.diff.scope,
        subpath: state.diff.subpath,
        paths: paths
      }, true);
      showOut(root, res);
      app.setStatus(res.ok ? "Synced " + res.synced_count + " file(s)." : "Sync completed with " + res.error_count + " error(s).");
      var d = await callOp("diff", { peer: state.diff.peer, scope: state.diff.scope, subpath: state.diff.subpath }, false);
      state.diff = d;
      renderDiff(root, d);
    }

    function wire() {
      if (!contentEl) { setTimeout(wire, 20); return; }
      var root = contentEl;

      root.addEventListener("click", async function (ev) {
        var del = ev.target.closest("[data-del-peer]");
        if (del) {
          var name = del.getAttribute("data-del-peer");
          if (!window.confirm("Delete HTTP peer '" + name + "'?")) return;
          await callOp("peers_delete", { name: name }, true);
          await refresh(app, root);
        }
      });

      root.querySelector("#ns-refresh").addEventListener("click", function () { refresh(app, root); });
      root.querySelector("#ns-sel-all").addEventListener("click", function () {
        root.querySelectorAll(".ns-path-cb").forEach(function (c) { c.checked = true; });
      });
      root.querySelector("#ns-sel-none").addEventListener("click", function () {
        root.querySelectorAll(".ns-path-cb").forEach(function (c) { c.checked = false; });
      });
      root.querySelector("#ns-push").addEventListener("click", function () { runSync(root, "push"); });
      root.querySelector("#ns-pull").addEventListener("click", function () { runSync(root, "pull"); });

      root.querySelector("#ns-peer-form").addEventListener("submit", async function (ev) {
        ev.preventDefault();
        var fd = new FormData(ev.target);
        var body = {
          name: fd.get("name"),
          base_url: fd.get("base_url"),
          use_auth_http: !!ev.target.querySelector('input[name="use_auth_http"]').checked
        };
        if ((fd.get("bearer_token") || "").trim()) body.bearer_token = fd.get("bearer_token");
        if ((fd.get("cookie") || "").trim()) body.cookie = fd.get("cookie");
        var res = await callOp("peers_save", body, true);
        ev.target.querySelector('input[name="bearer_token"]').value = "";
        ev.target.querySelector('input[name="cookie"]').value = "";
        showOut(root, res);
        await refresh(app, root);
      });

      root.querySelector("#ns-diff-form").addEventListener("submit", async function (ev) {
        ev.preventDefault();
        var fd = new FormData(ev.target);
        var peer = fd.get("peer");
        if (!peer) { showOut(root, "Add and select a peer first."); return; }
        app.setStatus("Comparing with " + peer + "...");
        var d = await callOp("diff", {
          peer: peer,
          scope: fd.get("scope") || "code",
          subpath: fd.get("subpath") || ""
        }, false);
        state.diff = d;
        renderDiff(root, d);
        app.setStatus(d && d.ok ? "Diff ready." : "Diff failed: " + (d && d.error));
      });

      refresh(app, root);
    }

    wire();
  });
})();
