// Server Connectivity — AppUI management page for system/server_conn.
(function () {
  var APP = "system/server_conn";
  var state = { data: null };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
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
        decode: function (result) { return result.json(); }
      }
    );
    return response.data;
  }

  async function copyText(text, app) {
    try {
      if (window.AppUIClipboard && typeof window.AppUIClipboard.writeText === "function") {
        await window.AppUIClipboard.writeText(text);
      } else if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      }
      app.setStatus("Copied: " + text);
    } catch (err) {
      app.setStatus("Copy failed: " + err);
    }
  }

  function mountShell(el) {
    el.innerHTML =
      '<div class="sc-wrap">' +
        '<div class="sc-banner" id="sc-banner">Loading server connectivity...</div>' +

        '<section class="sc-card">' +
          '<div class="sc-card-head">' +
            '<h2>Accessible IPs &amp; HTTP Server</h2>' +
            '<button class="sc-btn" id="sc-refresh" type="button">Refresh</button>' +
          '</div>' +
          '<div class="sc-table-wrap" id="sc-urls-table"></div>' +
          '<form class="sc-form" id="sc-server-form">' +
            '<label class="sc-field">Bind Host<input name="bind_host" placeholder="127.0.0.1 or 0.0.0.0"></label>' +
            '<label class="sc-field">HTTP Port<input name="port" type="number" min="1" max="65535" placeholder="8771"></label>' +
            '<label class="sc-field">Public Base URL (optional)<input name="public_base" placeholder="https://pylon-server.duckdns.org"></label>' +
            '<button class="sc-btn primary" type="submit">Save Server Bind</button>' +
          '</form>' +
          '<div class="sc-meta" id="sc-server-meta"></div>' +
        '</section>' +

        '<section class="sc-card">' +
          '<div class="sc-card-head">' +
            '<h2>DuckDNS Dynamic DNS</h2>' +
            '<div class="sc-actions">' +
              '<button class="sc-btn" id="sc-duck-update" type="button">Update DuckDNS Now</button>' +
            '</div>' +
          '</div>' +
          '<div class="sc-meta" id="sc-duck-meta"></div>' +
          '<form class="sc-form" id="sc-duck-form">' +
            '<label class="sc-field">Subdomain<input name="domain" placeholder="pylon-server"></label>' +
            '<label class="sc-field">Interval (s)<input name="interval_seconds" type="number" min="60" max="86400" value="300"></label>' +
            '<label class="sc-field">IP Override (optional)<input name="ip_override" placeholder="auto-detect public IP"></label>' +
            '<label class="sc-field">DuckDNS Token (write-only)<input name="token" type="password" autocomplete="off" placeholder="leave blank to keep existing"></label>' +
            '<label class="sc-check"><input name="enabled" type="checkbox"> Enable periodic DuckDNS updates</label>' +
            '<button class="sc-btn primary" type="submit">Save DuckDNS</button>' +
          '</form>' +
          '<pre class="sc-output sc-hidden" id="sc-duck-out"></pre>' +
        '</section>' +

        '<section class="sc-card">' +
          '<div class="sc-card-head">' +
            '<h2>Ngrok Tunnel (Daemon Managed)</h2>' +
            '<div class="sc-actions">' +
              '<button class="sc-btn primary" id="sc-ngrok-start" type="button">Start Tunnel</button>' +
              '<button class="sc-btn danger" id="sc-ngrok-stop" type="button">Stop Tunnel</button>' +
            '</div>' +
          '</div>' +
          '<div class="sc-meta" id="sc-ngrok-meta"></div>' +
          '<form class="sc-form" id="sc-ngrok-form">' +
            '<label class="sc-field">Static HTTPS URL (optional)<input name="url" placeholder="https://my-host.ngrok-free.app"></label>' +
            '<label class="sc-field">Target Local Port<input name="port" type="number" min="1" max="65535"></label>' +
            '<label class="sc-field">Executable<input name="executable" value="ngrok"></label>' +
            '<label class="sc-field">Agent API URL<input name="agent_api_url" value="http://127.0.0.1:4040"></label>' +
            '<label class="sc-field">Reconnect Attempts<input name="reconnect_attempts" type="number" min="0" max="20" value="5"></label>' +
            '<label class="sc-check"><input name="enabled" type="checkbox"> Auto-start ngrok with daemon</label>' +
            '<button class="sc-btn primary" type="submit">Save Ngrok Config</button>' +
          '</form>' +
          '<pre class="sc-output sc-hidden" id="sc-ngrok-out"></pre>' +
        '</section>' +
      '</div>';
    return el;
  }

  function showOut(root, selector, data) {
    var el = root.querySelector(selector);
    el.textContent = typeof data === "string" ? data : JSON.stringify(data, null, 2);
    el.classList.remove("sc-hidden");
  }

  function paint(root, d) {
    var banner = root.querySelector("#sc-banner");
    if (!d || !d.ok) {
      banner.innerHTML = '<span class="sc-pill bad">Error: ' + esc((d && d.error) || "unavailable") + '</span>';
      return;
    }
    var srv = d.server || {};
    var net = d.network || {};
    var duck = d.duckdns || {};
    var ng = d.ngrok || {};

    var ngCls = ng.status === "running" ? "ok" : (ng.status === "failed" ? "bad" : "warn");
    var duckCls = duck.enabled ? (duck.last_result === "OK" ? "ok" : "warn") : "";
    var viaCls = d.via === "daemon_cap" ? "ok" : "warn";

    banner.innerHTML =
      '<span class="sc-pill ok">HTTP: ' + esc(srv.runtime_bind_host) + ':' + esc(srv.runtime_port) + '</span>' +
      (net.public_ipv4 ? '<span class="sc-pill">Public IP: ' + esc(net.public_ipv4) + '</span>' : '<span class="sc-pill warn">Public IP: unknown</span>') +
      '<span class="sc-pill ' + duckCls + '">DuckDNS: ' + esc(duck.fqdn || "unset") + (duck.enabled ? " (on)" : " (off)") + '</span>' +
      '<span class="sc-pill ' + ngCls + '">Ngrok: ' + esc(ng.status || "stopped") + '</span>' +
      '<span class="sc-pill ' + viaCls + '">Control: ' + esc(d.via || "local") + '</span>';

    var urls = net.accessible_urls || [];
    root.querySelector("#sc-urls-table").innerHTML =
      '<table class="sc-table"><thead><tr><th>Type</th><th>URL</th><th>Actions</th></tr></thead><tbody>' +
      urls.map(function (u) {
        return (
          '<tr>' +
            '<td><span class="sc-pill">' + esc(u.label) + '</span></td>' +
            '<td class="sc-mono">' + esc(u.url) + '</td>' +
            '<td><div class="sc-actions">' +
              '<button class="sc-btn" data-copy="' + esc(u.url) + '" type="button">Copy</button>' +
              '<a class="sc-btn" href="' + esc(u.url) + '" target="_blank" rel="noopener">Open</a>' +
            '</div></td>' +
          '</tr>'
        );
      }).join("") +
      '</tbody></table>';

    var sf = root.querySelector("#sc-server-form");
    sf.querySelector('input[name="bind_host"]').value = srv.configured_bind_host || srv.runtime_bind_host || "";
    sf.querySelector('input[name="port"]').value = srv.configured_port || srv.runtime_port || "";
    sf.querySelector('input[name="public_base"]').value = srv.public_base || "";
    root.querySelector("#sc-server-meta").innerHTML =
      '<span>LAN IPs: <code class="sc-mono">' + esc((net.lan_ipv4s || []).join(", ") || "none") + '</code></span>' +
      (srv.restart_required ? '<span class="sc-pill warn">Restart daemon to apply new bind_host/port</span>' : "");

    var df = root.querySelector("#sc-duck-form");
    df.querySelector('input[name="domain"]').value = duck.domain || "";
    df.querySelector('input[name="interval_seconds"]').value = duck.interval_seconds || 300;
    df.querySelector('input[name="ip_override"]').value = duck.ip_override || "";
    df.querySelector('input[name="enabled"]').checked = !!duck.enabled;
    var dnsList = (duck.dns_ipv4 || []).join(", ") || "unresolved";
    var dnsMatch = net.public_ipv4 && (duck.dns_ipv4 || []).indexOf(net.public_ipv4) >= 0;
    root.querySelector("#sc-duck-meta").innerHTML =
      '<span class="sc-pill ' + (duck.token_configured ? "ok" : "warn") + '">Token: ' + (duck.token_configured ? "configured" : "not set") + '</span>' +
      '<span class="sc-pill ' + (dnsMatch ? "ok" : "") + '">DNS: ' + esc(dnsList) + '</span>' +
      (duck.last_result ? '<span class="sc-pill">Last: ' + esc(duck.last_result) + (duck.last_ip ? " (" + esc(duck.last_ip) + ")" : "") + '</span>' : "") +
      (duck.last_error ? '<span class="sc-pill bad">' + esc(duck.last_error) + '</span>' : "");

    var nf = root.querySelector("#sc-ngrok-form");
    nf.querySelector('input[name="url"]').value = ng.url || "";
    nf.querySelector('input[name="port"]').value = ng.port || srv.runtime_port || "";
    nf.querySelector('input[name="executable"]').value = ng.executable || "ngrok";
    nf.querySelector('input[name="agent_api_url"]').value = ng.agent_api_url || "http://127.0.0.1:4040";
    nf.querySelector('input[name="reconnect_attempts"]').value = ng.reconnect_attempts != null ? ng.reconnect_attempts : 5;
    nf.querySelector('input[name="enabled"]').checked = !!ng.enabled;
    root.querySelector("#sc-ngrok-meta").innerHTML =
      '<span class="sc-pill ' + (ng.executable_found ? "ok" : "warn") + '">Binary: ' + (ng.executable_found ? "found" : "not in PATH") + '</span>' +
      '<span class="sc-pill ' + ngCls + '">Status: ' + esc(ng.status || "stopped") + '</span>' +
      (ng.public_url ? '<span class="sc-pill ok">URL: ' + esc(ng.public_url) + '</span>' : "") +
      (ng.error_code ? '<span class="sc-pill bad">' + esc(ng.error_code) + '</span>' : "") +
      (ng.error ? '<span class="sc-pill bad">' + esc(ng.error) + '</span>' : "");
  }

  async function refresh(app, root) {
    app.setStatus("Refreshing server connectivity...");
    var res = await callOp("status", {}, false);
    state.data = res;
    paint(root, res);
    app.setStatus(res && res.ok ? "Ready" : "Failed to load status");
  }

  window.AppUIReady.then(function () {
    var contentEl = null;
    var app = AppUI.createApp({
      id: "system-server-conn",
      title: "Server Connectivity",
      menu: { View: [{ id: "refresh", label: "Refresh" }] },
      onAction: function (_m, id) {
        if (id === "refresh" && contentEl) refresh(app, contentEl);
      },
      content: { render: function (el) { contentEl = mountShell(el); } },
      statusbar: {}
    });

    function wire() {
      if (!contentEl) { setTimeout(wire, 20); return; }
      var root = contentEl;

      root.addEventListener("click", async function (ev) {
        var copyBtn = ev.target.closest("[data-copy]");
        if (copyBtn) {
          await copyText(copyBtn.getAttribute("data-copy") || "", app);
        }
      });

      root.querySelector("#sc-refresh").addEventListener("click", function () { refresh(app, root); });

      root.querySelector("#sc-server-form").addEventListener("submit", async function (ev) {
        ev.preventDefault();
        var fd = new FormData(ev.target);
        var res = await callOp("configure_server", {
          bind_host: fd.get("bind_host") || undefined,
          port: fd.get("port") ? Number(fd.get("port")) : undefined,
          public_base: fd.get("public_base") || ""
        }, true);
        if (res && res.ok) paint(root, res);
        app.setStatus(res && res.ok ? "Saved server bind settings." : "Error: " + (res && res.error));
      });

      root.querySelector("#sc-duck-form").addEventListener("submit", async function (ev) {
        ev.preventDefault();
        var fd = new FormData(ev.target);
        var body = {
          domain: fd.get("domain") || "",
          interval_seconds: Number(fd.get("interval_seconds") || 300),
          ip_override: fd.get("ip_override") || "",
          enabled: !!ev.target.querySelector('input[name="enabled"]').checked
        };
        var tok = (fd.get("token") || "").trim();
        if (tok) body.token = tok;
        var res = await callOp("duckdns_configure", body, true);
        ev.target.querySelector('input[name="token"]').value = "";
        showOut(root, "#sc-duck-out", res);
        await refresh(app, root);
      });

      root.querySelector("#sc-duck-update").addEventListener("click", async function () {
        app.setStatus("Updating DuckDNS...");
        var res = await callOp("duckdns_update", {}, true);
        showOut(root, "#sc-duck-out", res);
        await refresh(app, root);
      });

      root.querySelector("#sc-ngrok-form").addEventListener("submit", async function (ev) {
        ev.preventDefault();
        var fd = new FormData(ev.target);
        var res = await callOp("ngrok_configure", {
          url: fd.get("url") || "",
          port: fd.get("port") ? Number(fd.get("port")) : undefined,
          executable: fd.get("executable") || "ngrok",
          agent_api_url: fd.get("agent_api_url") || "http://127.0.0.1:4040",
          reconnect_attempts: Number(fd.get("reconnect_attempts") || 5),
          enabled: !!ev.target.querySelector('input[name="enabled"]').checked
        }, true);
        showOut(root, "#sc-ngrok-out", res);
        await refresh(app, root);
      });

      root.querySelector("#sc-ngrok-start").addEventListener("click", async function () {
        app.setStatus("Starting ngrok tunnel...");
        var res = await callOp("ngrok_start", {}, true);
        showOut(root, "#sc-ngrok-out", res);
        await refresh(app, root);
      });

      root.querySelector("#sc-ngrok-stop").addEventListener("click", async function () {
        app.setStatus("Stopping ngrok tunnel...");
        var res = await callOp("ngrok_stop", {}, true);
        showOut(root, "#sc-ngrok-out", res);
        await refresh(app, root);
      });

      refresh(app, root);
    }

    wire();
  });
})();
