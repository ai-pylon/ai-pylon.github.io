// Node Sync (HTTP) — Clean AppUI management page for system/node_sync.
(function () {
  var APP = "system/node_sync";
  var state = {
    status: null,
    selectedPeer: "",
    scope: "code",
    diff: null,
    filterKind: "all",
    busy: false
  };

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

  function authBadge(p) {
    if (p.username && p.has_password) return '<span class="ns-pill ok">🔑 ' + esc(p.username) + '</span>';
    if (p.has_bearer_token) return '<span class="ns-pill ok">🔐 Bearer</span>';
    if (p.has_cookie) return '<span class="ns-pill ok">🍪 Cookie</span>';
    return '<span class="ns-pill warn">⚠ Auth needed</span>';
  }

  function renderSidebar(sb) {
    var peers = (state.status && state.status.peers) || [];
    if (!state.selectedPeer && peers.length) state.selectedPeer = peers[0].name;
    if (state.selectedPeer && !peers.some(function (p) { return p.name === state.selectedPeer; })) {
      state.selectedPeer = peers.length ? peers[0].name : "";
    }
    var list = sb.querySelector("#ns-peer-list");
    if (!peers.length) {
      list.innerHTML = '<div class="ns-empty" style="padding:18px 8px">No peers yet.<br>Click <b>+ Add Peer</b> to connect your VM.</div>';
      return;
    }
    list.innerHTML = peers.map(function (p) {
      var active = p.name === state.selectedPeer ? " active" : "";
      return (
        '<div class="ns-peer-card' + active + '" data-sel-peer="' + esc(p.name) + '">' +
          '<div class="ns-peer-top">' +
            '<span class="ns-peer-name">' + esc(p.name) + '</span>' +
            authBadge(p) +
          '</div>' +
          '<div class="ns-peer-url" title="' + esc(p.base_url) + '">' + esc(p.base_url) + '</div>' +
          '<div class="ns-peer-foot">' +
            '<span style="font-size:11px;color:var(--text-muted)">HTTP Peer</span>' +
            '<div class="ns-peer-acts">' +
              '<button class="ns-btn sm" data-edit-peer="' + esc(p.name) + '" type="button">Edit</button>' +
              '<button class="ns-btn sm danger" data-del-peer="' + esc(p.name) + '" type="button">Delete</button>' +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }).join("");
  }

  function renderHero(root) {
    var s = state.status;
    var hero = root.querySelector("#ns-hero");
    if (!s || !s.ok) {
      hero.innerHTML = '<span class="ns-pill bad">Error: ' + esc((s && s.error) || "unavailable") + '</span>';
      return;
    }
    var peer = (s.peers || []).find(function (p) { return p.name === state.selectedPeer; });
    hero.innerHTML =
      '<div class="ns-hero-title">' +
        '<span class="ns-node-badge">💻 ' + esc(s.hostname || "Local") + '</span>' +
        '<span class="ns-arrow">⇄</span>' +
        (peer
          ? '<span class="ns-node-badge">☁️ ' + esc(peer.name) + ' <span class="ns-mono" style="font-weight:400;color:var(--text-muted)">' + esc(peer.base_url) + '</span></span>' + authBadge(peer)
          : '<span class="ns-pill warn">Select or add a peer</span>') +
      '</div>' +
      '<div class="ns-hero-meta">' +
        '<span class="ns-pill">Backups: ' + esc((s.recent_backups || []).length) + '</span>' +
        (peer ? '<button class="ns-btn sm" id="ns-hero-edit" type="button">Peer Settings</button>' : '') +
        '<button class="ns-btn sm" id="ns-refresh" type="button">Refresh</button>' +
      '</div>';
  }

  function showAlert(root, msg, kind) {
    var el = root.querySelector("#ns-alert");
    if (!msg) { el.classList.add("ns-hidden"); return; }
    el.className = "ns-alert" + (kind ? " " + kind : "");
    el.textContent = msg;
  }

  function renderDiff(root) {
    var d = state.diff;
    var kpis = root.querySelector("#ns-kpis");
    var card = root.querySelector("#ns-diff-card");
    var tbl = root.querySelector("#ns-diff-table");

    if (!d) {
      kpis.classList.add("ns-hidden");
      card.classList.add("ns-hidden");
      return;
    }
    if (!d.ok) {
      kpis.classList.add("ns-hidden");
      card.classList.add("ns-hidden");
      showAlert(root, d.error || "Diff failed", "bad");
      return;
    }

    var c = d.counts || {};
    var modN = c.modified || 0, locN = c.only_local || 0, remN = c.only_remote || 0, sameN = c.same || 0;
    var totalDiff = modN + locN + remN;

    kpis.classList.remove("ns-hidden");
    kpis.innerHTML =
      '<button type="button" class="ns-kpi' + (state.filterKind === "all" ? " on" : "") + '" data-fk="all"><div class="k">All Changes</div><div class="v">' + totalDiff + '</div></button>' +
      '<button type="button" class="ns-kpi warn' + (state.filterKind === "modified" ? " on" : "") + '" data-fk="modified"><div class="k">Modified</div><div class="v">' + modN + '</div></button>' +
      '<button type="button" class="ns-kpi ok' + (state.filterKind === "only_local" ? " on" : "") + '" data-fk="only_local"><div class="k">Local Only</div><div class="v">' + locN + '</div></button>' +
      '<button type="button" class="ns-kpi info' + (state.filterKind === "only_remote" ? " on" : "") + '" data-fk="only_remote"><div class="k">Remote Only</div><div class="v">' + remN + '</div></button>' +
      '<div class="ns-kpi" style="cursor:default"><div class="k">Identical</div><div class="v">' + sameN + '</div></div>';

    var rows = [];
    (d.modified || []).forEach(function (x) {
      rows.push({ path: x.path, kind: "modified", badge: "warn", label: "Modified", info: (x.newer === "local" ? "Local newer" : x.newer === "remote" ? "Remote newer" : "Same time") + " · " + fmtSize(x.local_size) + " / " + fmtSize(x.remote_size) });
    });
    (d.only_local || []).forEach(function (x) {
      rows.push({ path: x.path, kind: "only_local", badge: "ok", label: "Local only", info: fmtSize(x.local_size) });
    });
    (d.only_remote || []).forEach(function (x) {
      rows.push({ path: x.path, kind: "only_remote", badge: "info", label: "Remote only", info: fmtSize(x.remote_size) });
    });

    var shown = state.filterKind === "all" ? rows : rows.filter(function (r) { return r.kind === state.filterKind; });
    card.classList.remove("ns-hidden");

    if (!shown.length) {
      tbl.innerHTML = '<div class="ns-empty">' + (totalDiff === 0 ? '✅ All ' + sameN + ' files are identical.' : 'No files match this filter.') + '</div>';
      return;
    }
    tbl.innerHTML =
      '<table class="ns-table"><thead><tr><th style="width:32px"></th><th>File Path</th><th style="width:110px">Status</th><th>Detail</th></tr></thead><tbody>' +
      shown.map(function (r) {
        return (
          '<tr>' +
            '<td><input type="checkbox" class="ns-path-cb" value="' + esc(r.path) + '" checked></td>' +
            '<td class="ns-mono">' + esc(r.path) + '</td>' +
            '<td><span class="ns-pill ' + r.badge + '">' + esc(r.label) + '</span></td>' +
            '<td style="color:var(--text-muted);font-size:12px">' + esc(r.info) + '</td>' +
          '</tr>'
        );
      }).join("") +
      '</tbody></table>';
  }

  function mountSidebar(el) {
    el.innerHTML =
      '<div class="ns-sidebar">' +
        '<div class="ns-sb-head">' +
          '<h2>HTTP Peers</h2>' +
          '<button class="ns-btn sm primary" id="ns-add-peer" type="button">+ Add Peer</button>' +
        '</div>' +
        '<div class="ns-peer-list" id="ns-peer-list"></div>' +
      '</div>';
    return el;
  }

  function mountContent(el) {
    el.innerHTML =
      '<div class="ns-wrap">' +
        '<div class="ns-hero" id="ns-hero">Loading Node Sync…</div>' +
        '<div class="ns-toolbar">' +
          '<div class="ns-seg" id="ns-scope-seg">' +
            '<button type="button" data-scope="code" class="on">Code</button>' +
            '<button type="button" data-scope="data">Data</button>' +
            '<button type="button" data-scope="all">All</button>' +
          '</div>' +
          '<input class="ns-subpath" id="ns-subpath" placeholder="Optional subpath (e.g. apps/personal)">' +
          '<button class="ns-btn primary" id="ns-compare" type="button">Compare (Diff)</button>' +
        '</div>' +
        '<div class="ns-alert ns-hidden" id="ns-alert"></div>' +
        '<div class="ns-kpis ns-hidden" id="ns-kpis"></div>' +
        '<section class="ns-card ns-hidden" id="ns-diff-card">' +
          '<div class="ns-card-bar">' +
            '<div class="ns-actions">' +
              '<button class="ns-btn sm" id="ns-sel-all" type="button">Select All</button>' +
              '<button class="ns-btn sm" id="ns-sel-none" type="button">Clear</button>' +
            '</div>' +
            '<div class="ns-actions">' +
              '<button class="ns-btn primary" id="ns-push" type="button">↑ Push Selected (Local → Remote)</button>' +
              '<button class="ns-btn primary" id="ns-pull" type="button">↓ Pull Selected (Remote → Local)</button>' +
            '</div>' +
          '</div>' +
          '<div class="ns-table-wrap" id="ns-diff-table"></div>' +
        '</section>' +
        '<dialog class="ns-dialog" id="ns-peer-dialog">' +
          '<form id="ns-peer-form">' +
            '<div class="ns-dlg-head">' +
              '<h3 id="ns-dlg-title">Add HTTP Peer</h3>' +
              '<button class="ns-btn sm" id="ns-dlg-close" type="button">✕</button>' +
            '</div>' +
            '<div class="ns-dlg-body">' +
              '<label class="ns-field">Peer Name<input name="name" required placeholder="vm"></label>' +
              '<label class="ns-field">Server URL<input name="base_url" required placeholder="https://pylon-server.duckdns.org"></label>' +
              '<label class="ns-field">Admin ID (/_pylon/auth/login)<input name="username" autocomplete="username" placeholder="admin"></label>' +
              '<label class="ns-field">Admin Password (write-only)<input name="password" type="password" autocomplete="current-password" placeholder="Leave blank to keep existing"></label>' +
              '<details class="ns-adv"><summary>Advanced (Bearer Token / Cookie)</summary>' +
                '<div class="ns-adv-inner">' +
                  '<label class="ns-field">Bearer Token (optional)<input name="bearer_token" type="password" autocomplete="off"></label>' +
                  '<label class="ns-field">Cookie Header (optional)<input name="cookie" type="password" autocomplete="off"></label>' +
                  '<label class="ns-check"><input name="use_auth_http" type="checkbox" checked> Use platform/auth_http</label>' +
                '</div>' +
              '</details>' +
            '</div>' +
            '<div class="ns-dlg-foot">' +
              '<button class="ns-btn" id="ns-dlg-cancel" type="button">Cancel</button>' +
              '<button class="ns-btn primary" type="submit">Save Peer</button>' +
            '</div>' +
          '</form>' +
        '</dialog>' +
      '</div>';
    return el;
  }

  window.AppUIReady.then(function () {
    var contentEl = null, sidebarEl = null;
    var app = AppUI.createApp({
      id: "system-node-sync",
      title: "Node Sync (HTTP)",
      menu: { View: [{ id: "refresh", label: "Refresh" }] },
      onAction: function (_m, id) { if (id === "refresh") refresh(); },
      leftSidebar: { width: 280, tabs: [{ id: "peers", label: "Peers", active: true, render: function (el) { sidebarEl = mountSidebar(el); } }] },
      content: { render: function (el) { contentEl = mountContent(el); } },
      statusbar: {}
    });

    async function refresh() {
      app.setStatus("Refreshing peers…");
      var s = await callOp("status", {}, false);
      state.status = s;
      if (sidebarEl) renderSidebar(sidebarEl);
      if (contentEl) renderHero(contentEl);
      app.setStatus("Ready");
    }

    function openPeerDialog(peer) {
      var dlg = contentEl.querySelector("#ns-peer-dialog");
      var form = contentEl.querySelector("#ns-peer-form");
      contentEl.querySelector("#ns-dlg-title").textContent = peer ? "Edit Peer · " + peer.name : "Add HTTP Peer";
      form.querySelector('input[name="name"]').value = peer ? peer.name : "";
      form.querySelector('input[name="base_url"]').value = peer ? peer.base_url : "https://pylon-server.duckdns.org";
      form.querySelector('input[name="username"]').value = peer ? (peer.username || "") : "";
      form.querySelector('input[name="password"]').value = "";
      form.querySelector('input[name="bearer_token"]').value = "";
      form.querySelector('input[name="cookie"]').value = "";
      form.querySelector('input[name="use_auth_http"]').checked = peer ? !!peer.use_auth_http : true;
      dlg.showModal();
      (peer ? form.querySelector('input[name="password"]') : form.querySelector('input[name="name"]')).focus();
    }

    async function runDiff() {
      if (!state.selectedPeer) { showAlert(contentEl, "Add and select a peer first.", "bad"); return; }
      var btn = contentEl.querySelector("#ns-compare");
      btn.disabled = true;
      showAlert(contentEl, "");
      app.setStatus("Comparing with " + state.selectedPeer + "…");
      try {
        var subpath = (contentEl.querySelector("#ns-subpath").value || "").trim();
        var d = await callOp("diff", { peer: state.selectedPeer, scope: state.scope, subpath: subpath }, false);
        state.diff = d;
        state.filterKind = "all";
        renderDiff(contentEl);
        app.setStatus(d && d.ok ? "Diff ready." : "Diff failed.");
      } finally {
        btn.disabled = false;
      }
    }

    async function runSync(direction) {
      if (!state.diff || !state.diff.ok) return;
      var paths = Array.from(contentEl.querySelectorAll(".ns-path-cb:checked")).map(function (el) { return el.value; });
      if (!paths.length) { showAlert(contentEl, "Select at least one file to sync.", "bad"); return; }
      var label = direction === "push" ? "Push (Local → " + state.diff.peer + ")" : "Pull (" + state.diff.peer + " → Local)";
      if (!window.confirm(label + " " + paths.length + " file(s)? Overwritten files are backed up automatically.")) return;
      app.setStatus("Syncing " + paths.length + " file(s)…");
      var res = await callOp("sync", {
        peer: state.diff.peer,
        direction: direction,
        scope: state.diff.scope,
        subpath: state.diff.subpath,
        paths: paths
      }, true);
      if (res && res.ok) {
        showAlert(contentEl, "✅ Synced " + (res.synced_count || 0) + " file(s) (" + direction + ").", "ok");
      } else {
        showAlert(contentEl, "Sync error: " + ((res && res.error) || JSON.stringify(res)), "bad");
      }
      await runDiff();
    }

    function wire() {
      if (!contentEl || !sidebarEl) { setTimeout(wire, 20); return; }
      var dlg = contentEl.querySelector("#ns-peer-dialog");

      sidebarEl.addEventListener("click", async function (ev) {
        if (ev.target.closest("#ns-add-peer")) { openPeerDialog(null); return; }
        var ed = ev.target.closest("[data-edit-peer]");
        if (ed) {
          ev.stopPropagation();
          var nm = ed.getAttribute("data-edit-peer");
          var peer = ((state.status && state.status.peers) || []).find(function (p) { return p.name === nm; });
          if (peer) openPeerDialog(peer);
          return;
        }
        var del = ev.target.closest("[data-del-peer]");
        if (del) {
          ev.stopPropagation();
          var dnm = del.getAttribute("data-del-peer");
          if (!window.confirm("Delete HTTP peer '" + dnm + "'?")) return;
          await callOp("peers_delete", { name: dnm }, true);
          state.diff = null;
          renderDiff(contentEl);
          await refresh();
          return;
        }
        var card = ev.target.closest("[data-sel-peer]");
        if (card) {
          state.selectedPeer = card.getAttribute("data-sel-peer");
          state.diff = null;
          renderSidebar(sidebarEl);
          renderHero(contentEl);
          renderDiff(contentEl);
          showAlert(contentEl, "");
        }
      });

      contentEl.addEventListener("click", function (ev) {
        if (ev.target.closest("#ns-refresh")) { refresh(); return; }
        if (ev.target.closest("#ns-hero-edit")) {
          var peer = ((state.status && state.status.peers) || []).find(function (p) { return p.name === state.selectedPeer; });
          if (peer) openPeerDialog(peer);
          return;
        }
        var sc = ev.target.closest("#ns-scope-seg button[data-scope]");
        if (sc) {
          state.scope = sc.getAttribute("data-scope");
          contentEl.querySelectorAll("#ns-scope-seg button").forEach(function (b) {
            b.classList.toggle("on", b.getAttribute("data-scope") === state.scope);
          });
          return;
        }
        var fk = ev.target.closest(".ns-kpi[data-fk]");
        if (fk) {
          state.filterKind = fk.getAttribute("data-fk");
          renderDiff(contentEl);
          return;
        }
        if (ev.target.closest("#ns-compare")) { runDiff(); return; }
        if (ev.target.closest("#ns-sel-all")) {
          contentEl.querySelectorAll(".ns-path-cb").forEach(function (c) { c.checked = true; });
          return;
        }
        if (ev.target.closest("#ns-sel-none")) {
          contentEl.querySelectorAll(".ns-path-cb").forEach(function (c) { c.checked = false; });
          return;
        }
        if (ev.target.closest("#ns-push")) { runSync("push"); return; }
        if (ev.target.closest("#ns-pull")) { runSync("pull"); return; }
        if (ev.target.closest("#ns-dlg-close") || ev.target.closest("#ns-dlg-cancel")) { dlg.close(); }
      });

      contentEl.querySelector("#ns-subpath").addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") { ev.preventDefault(); runDiff(); }
      });

      contentEl.querySelector("#ns-peer-form").addEventListener("submit", async function (ev) {
        ev.preventDefault();
        var fd = new FormData(ev.target);
        var body = {
          name: fd.get("name"),
          base_url: fd.get("base_url"),
          use_auth_http: !!ev.target.querySelector('input[name="use_auth_http"]').checked
        };
        if ((fd.get("username") || "").trim()) body.username = fd.get("username");
        if ((fd.get("password") || "").trim()) body.password = fd.get("password");
        if ((fd.get("bearer_token") || "").trim()) body.bearer_token = fd.get("bearer_token");
        if ((fd.get("cookie") || "").trim()) body.cookie = fd.get("cookie");
        var res = await callOp("peers_save", body, true);
        dlg.close();
        if (res && res.ok) {
          state.selectedPeer = res.peer.name;
          showAlert(contentEl, "✅ Saved peer '" + res.peer.name + "'.", "ok");
        } else {
          showAlert(contentEl, (res && res.error) || "Failed to save peer.", "bad");
        }
        await refresh();
      });

      refresh();
    }

    wire();
  });
})();
