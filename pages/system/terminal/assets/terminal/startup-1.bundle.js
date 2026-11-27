/** Terminal process inspection, host scanning, and process dialogs. */
window.TerminalProcesses = (() => {
  function create({ esc, aliasFor, aliasOf, attachTmux }) {
    // scan a remote host for shells ACTUALLY running there (via connection.host_scan)
    // and render them under the host section, flagging strays the app doesn't track.
    async function scanHost(hostFqdn, sec) {
      var old = sec.querySelector(".ss-scanres"); if (old) old.remove();
      var panel = document.createElement("div"); panel.className = "ss-scanres";
      panel.innerHTML = '<div class="ss-scan-h">scanning…</div>';
      sec.appendChild(panel);
      var r = await fetch("/v1/apps/platform/auth_ssh/host_scan", {
        method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ host: hostFqdn }) }).then(function (x) { return x.json(); }).catch(function () { return null; });
      if (!r || !r.ok) { panel.innerHTML = '<div class="ss-scan-h bad">scan failed</div>'; return; }
      var procs = r.processes || [];
      var h = '<div class="ss-scan-h">' + procs.length + ' shell(s) running · ' +
              (r.tracked_count || 0) + ' tracked here</div>';
      panel.innerHTML = h;
      procs.forEach(function (p) {
        var row = document.createElement("div"); row.className = "ss-proc" + (p.orphan ? " orphan" : "");
        var short = (p.running && p.running.trim()) ? ("\u25b6 " + p.running.trim()) : "idle at prompt";
        var orphanBadge = p.orphan ? '<span class="ss-orphanb" title="parent died (orphaned)">orphan</span>' : '';
        var top = document.createElement("div"); top.className = "ss-proc-top";
        top.innerHTML = '<span class="ss-pid">' + p.pid + '</span>' +
          '<span class="ss-pmeta">' + esc(p.stat) + ' · ' + esc(p.etime) + '</span>' + orphanBadge +
          (p.note ? '<span class="ss-note">' + esc(p.note) + '</span>' : '');
        var k = document.createElement("button"); k.className = "ss-kill"; k.textContent = "\u2715";
        k.title = "kill pid " + p.pid;
        k.onclick = async function (ev) {
          ev.stopPropagation();
          await fetch("/v1/apps/platform/auth_ssh/host_scan", {
            method: "POST", headers: {"Content-Type": "application/json"},
            body: JSON.stringify({ host: hostFqdn, kill_pid: p.pid }) }).catch(function () {});
          scanHost(hostFqdn, sec);
        };
        top.appendChild(k);
        row.appendChild(top);
        var det = document.createElement("div"); det.className = "ss-proc-det";
        det.innerHTML = '<span class="' + ((p.running && p.running.trim()) ? "ss-run" : "ss-idle") + '">' +
                        esc(short) + '</span>';
        row.appendChild(det);
        // click the row (not the ✕) → full detail dialog
        row.style.cursor = "pointer";
        row.onclick = function (ev) { if (ev.target !== k) showProcDetail(p, hostFqdn, sec); };
        panel.appendChild(row);
      });
      // tmux/screen sessions (attachable) — list them with a one-click Attach that
      // binds a new tab to the EXISTING remote shell (env/cwd/jobs intact, survives
      // disconnects). tmux only for now (screen listed read-only).
      if ((r.tmux && r.tmux.length) || (r.screen && r.screen.length)) {
        var mux = document.createElement("div"); mux.className = "ss-mux";
        var mh = document.createElement("div"); mh.className = "ss-scan-h"; mh.textContent = "attachable:";
        mux.appendChild(mh);
        (r.tmux || []).forEach(function (t) {
          var name = String(t).split(":")[0].trim();
          var row = document.createElement("div"); row.className = "ss-muxrow";
          row.innerHTML = '<span class="ss-muxname">tmux: ' + esc(t) + '</span>';
          var ab = document.createElement("button"); ab.className = "ss-attach"; ab.textContent = "attach";
          ab.title = "open a tab bound to this tmux session";
          ab.onclick = function (ev) { ev.stopPropagation(); attachTmux(hostFqdn, name); };
          row.appendChild(ab);
          mux.appendChild(row);
        });
        (r.screen || []).forEach(function (t) {
          var row = document.createElement("div"); row.className = "ss-muxrow";
          row.innerHTML = '<span class="ss-muxname">screen: ' + esc(t) + '</span>';
          mux.appendChild(row);
        });
        panel.appendChild(mux);
      }
      if (!procs.length && !(r.tmux && r.tmux.length)) panel.innerHTML = '<div class="ss-scan-h">no shells running on host</div>';
    }

    // Raw `ps` output for a host in a dialog (answers "show me ps"). Fetches
    // Process TABLE for a host in a dialog. Fetches connection.host_ps (structured
    // rows), renders a sortable/filterable table; click a row for full detail,
    // ✕ to kill (with confirm). mine/all scope toggle + filter box + refresh.
    function showPs(hostFqdn) {
      var Dialog = window.AppUIDialog || (window.AppUI && AppUI.components && AppUI.components.Dialog);
      var alias = aliasFor(hostFqdn);
      var state = { scope: "mine", rows: [], command: "", sortKey: "cpu", sortDir: -1, filter: "" };

      var COLS = [
        { key: "pid", label: "PID", num: true, w: "72px" },
        { key: "ppid", label: "PPID", num: true, w: "72px" },
        { key: "user", label: "USER", w: "90px" },
        { key: "stat", label: "STAT", w: "56px" },
        { key: "cpu", label: "%CPU", num: true, w: "60px" },
        { key: "mem", label: "%MEM", num: true, w: "60px" },
        { key: "etime", label: "ELAPSED", w: "96px" },
        { key: "command", label: "COMMAND" },
      ];

      var body = document.createElement("div");
      body.style.cssText = "min-width:720px;max-width:88vw;width:980px";
      var bar = document.createElement("div");
      bar.style.cssText = "display:flex;align-items:center;gap:10px;margin-bottom:8px;font-size:12px;color:var(--text-muted);flex-wrap:wrap";
      bar.innerHTML =
        '<span>on <b>' + esc(alias) + '</b> (' + esc(hostFqdn) + ')</span>' +
        '<input class="ps-filter" placeholder="filter…" style="margin-left:auto;width:160px;' +
          'padding:3px 7px;background:var(--bg);border:1px solid var(--border);border-radius:5px;color:var(--text-primary);font-size:12px">' +
        '<label><input type="radio" name="psscope" value="mine" checked> mine</label>' +
        '<label><input type="radio" name="psscope" value="all"> all</label>' +
        '<span class="ps-count" style="min-width:64px;text-align:right"></span>';

      var tableWrap = document.createElement("div");
      tableWrap.style.cssText = "overflow:auto;max-height:62vh;border:1px solid var(--border);border-radius:6px";
      var table = document.createElement("table");
      table.className = "ps-table";
      tableWrap.appendChild(table);
      body.append(bar, tableWrap);

      function cmp(a, b) {
        var k = state.sortKey, num = COLS.filter(function (c) { return c.key === k; })[0];
        num = num && num.num;
        var va = a[k], vb = b[k];
        if (num) { va = parseFloat(va) || 0; vb = parseFloat(vb) || 0; return (va - vb) * state.sortDir; }
        va = String(va == null ? "" : va).toLowerCase(); vb = String(vb == null ? "" : vb).toLowerCase();
        return (va < vb ? -1 : va > vb ? 1 : 0) * state.sortDir;
      }

      function render() {
        var f = state.filter.toLowerCase();
        var rows = state.rows.filter(function (p) {
          if (!f) return true;
          return (p.command || "").toLowerCase().indexOf(f) >= 0 ||
                 String(p.pid).indexOf(f) >= 0 || (p.user || "").toLowerCase().indexOf(f) >= 0 ||
                 (p.stat || "").toLowerCase().indexOf(f) >= 0;
        }).slice().sort(cmp);

        var thead = '<thead><tr>' + COLS.map(function (c) {
          var arrow = state.sortKey === c.key ? (state.sortDir < 0 ? " ▼" : " ▲") : "";
          return '<th data-k="' + c.key + '"' + (c.w ? ' style="width:' + c.w + '"' : '') +
                 ' class="' + (c.num ? "num" : "") + '">' + esc(c.label) + arrow + '</th>';
        }).join("") + '<th style="width:34px"></th></tr></thead>';

        var tbody = rows.map(function (p) {
          var cmdShort = p.command || (p.stat ? "(" + p.stat + ")" : "");
          return '<tr data-pid="' + p.pid + '"' + (p.orphan ? ' class="orphan"' : '') + '>' +
            '<td class="num">' + p.pid + '</td>' +
            '<td class="num">' + p.ppid + '</td>' +
            '<td>' + esc(p.user) + '</td>' +
            '<td>' + esc(p.stat) + '</td>' +
            '<td class="num">' + esc(p.cpu) + '</td>' +
            '<td class="num">' + esc(p.mem) + '</td>' +
            '<td>' + esc(p.etime) + '</td>' +
            '<td class="cmd" title="' + esc(p.command) + '">' + esc(cmdShort) + '</td>' +
            '<td><button class="ps-kill" title="kill ' + p.pid + '">✕</button></td></tr>';
        }).join("");

        table.innerHTML = thead + '<tbody>' + (tbody || '<tr><td colspan="9" class="ps-empty">no processes</td></tr>') + '</tbody>';

        // header sort
        table.querySelectorAll("th[data-k]").forEach(function (th) {
          th.onclick = function () {
            var k = th.getAttribute("data-k");
            if (state.sortKey === k) state.sortDir *= -1;
            else { state.sortKey = k; state.sortDir = (k === "command" || k === "user" || k === "stat") ? 1 : -1; }
            render();
          };
        });
        // row click → detail; kill button → confirm + kill
        table.querySelectorAll("tbody tr[data-pid]").forEach(function (tr) {
          var pid = parseInt(tr.getAttribute("data-pid"), 10);
          var p = state.rows.filter(function (x) { return x.pid === pid; })[0];
          tr.onclick = function (ev) {
            if (ev.target.classList.contains("ps-kill")) return;
            showPsDetail(p, hostFqdn, alias);
          };
          var kb = tr.querySelector(".ps-kill");
          if (kb) kb.onclick = function (ev) { ev.stopPropagation(); killPid(p); };
        });
        var c = bar.querySelector(".ps-count");
        if (c) c.textContent = rows.length + "/" + state.rows.length;
      }

      async function load() {
        table.innerHTML = '<tbody><tr><td class="ps-empty">loading…</td></tr></tbody>';
        var r = await fetch("/v1/apps/platform/auth_ssh/host_ps", {
          method: "POST", headers: {"Content-Type": "application/json"},
          body: JSON.stringify({ host: alias || hostFqdn, scope: state.scope }) })
          .then(function (x) { return x.json(); }).catch(function () { return null; });
        if (!r || !r.ok) { table.innerHTML = '<tbody><tr><td class="ps-empty bad">ps failed: ' +
          esc((r && r.error) || "error") + '</td></tr></tbody>'; return; }
        state.rows = r.processes || [];
        state.command = r.command || "";
        render();
      }

      async function killPid(p) {
        if (!p) return;
        var msg = "Kill pid " + p.pid + " on " + alias + "?\n\n" + (p.command || p.stat || "");
        if (!window.confirm(msg)) return;
        await fetch("/v1/apps/platform/auth_ssh/host_ps", {
          method: "POST", headers: {"Content-Type": "application/json"},
          body: JSON.stringify({ host: alias || hostFqdn, scope: state.scope, kill_pid: p.pid }) })
          .catch(function () {});
        load();
        if (window.__termRefreshSidebar) window.__termRefreshSidebar();
      }

      bar.querySelectorAll('input[name="psscope"]').forEach(function (el) {
        el.addEventListener("change", function () { if (el.checked) { state.scope = el.value; load(); } });
      });
      bar.querySelector(".ps-filter").addEventListener("input", function (e) {
        state.filter = e.target.value || ""; render();
      });

      if (!Dialog) { load(); return; }
      Dialog.show({
        title: "ps · " + alias, body: body, width: "1000px",
        buttons: [
          {text: "Close"},
          {text: "Refresh", primary: true, action: function () { load(); return false; }},
        ],
      });
      load();
    }

    // full per-process detail (from the ps table) in a nested dialog.
    function showPsDetail(p, hostFqdn, alias) {
      var Dialog = window.AppUIDialog || (window.AppUI && AppUI.components && AppUI.components.Dialog);
      if (!p) return;
      var rows = [
        ["pid", p.pid], ["parent (ppid)", p.ppid], ["user", p.user],
        ["state", p.stat], ["cpu", (p.cpu || "0") + "%"], ["mem", (p.mem || "0") + "%"],
        ["elapsed", p.etime], ["tty", p.tty || "?"],
        ["orphaned", p.orphan ? "yes (parent died)" : "no"],
      ];
      var body = document.createElement("div");
      body.style.cssText = "min-width:460px;max-width:70vw;font-size:12px";
      var tbl = rows.map(function (kv) {
        return '<div style="display:flex;gap:10px;padding:3px 0;border-bottom:1px solid var(--border)">' +
          '<div style="flex:0 0 110px;color:var(--text-muted)">' + esc(kv[0]) + '</div>' +
          '<div style="flex:1;color:var(--text-primary);font-family:ui-monospace,Consolas,monospace;word-break:break-all">' +
          esc(String(kv[1])) + '</div></div>';
      }).join("");
      body.innerHTML =
        '<div style="margin-bottom:8px;color:var(--text-muted)">on <b>' + esc(alias) + '</b> (' + esc(hostFqdn) + ')</div>' +
        tbl +
        '<div style="margin-top:10px"><div style="color:var(--text-muted);margin-bottom:3px">command</div>' +
        '<pre style="margin:0;padding:8px;background:var(--bg);border:1px solid var(--border);border-radius:6px;' +
        'white-space:pre-wrap;word-break:break-all;font-size:11.5px;max-height:30vh;overflow:auto">' +
        (p.command ? esc(p.command) : '<span style="color:var(--text-muted)">(no command line)</span>') + '</pre></div>';
      if (!Dialog) { alert("pid " + p.pid + "\n" + (p.command || "")); return; }
      Dialog.show({
        title: "pid " + p.pid, body: body, width: "560px",
        buttons: [
          {text: "Close"},
          {text: "Copy cmd", action: function () { try { AppUI.utils.core.copyText(p.command || "").catch(function () {}); } catch (_) {} }},
          {text: "Kill", primary: true, action: async function () {
            await fetch("/v1/apps/platform/auth_ssh/host_ps", {
              method: "POST", headers: {"Content-Type": "application/json"},
              body: JSON.stringify({ host: alias || hostFqdn, kill_pid: p.pid }) }).catch(function () {});
            if (window.__termRefreshSidebar) window.__termRefreshSidebar();
          }},
        ],
      });
    }

    // full per-process detail in an AppUI dialog (click a scan row).
    function showProcDetail(p, hostFqdn, sec) {
      var Dialog = window.AppUIDialog || (window.AppUI && AppUI.components && AppUI.components.Dialog);
      var rows = [
        ["pid", p.pid], ["parent (ppid)", p.ppid], ["pgid", p.pgid || ""],
        ["tty", p.tty || "?"], ["state", p.stat], ["age", p.etime],
        ["cpu", (p.cpu || "0") + "%"], ["mem", (p.mem || "0") + "%"],
        ["orphaned", p.orphan ? "yes (parent died)" : "no"],
        ["assessment", p.note || ""],
        ["working dir", p.cwd || "(unknown)"],
        ["comm", p.comm || ""],
      ];
      var body = document.createElement("div");
      body.style.cssText = "min-width:460px;max-width:70vw;font-size:12px";
      var tbl = rows.map(function (kv) {
        return '<div style="display:flex;gap:10px;padding:3px 0;border-bottom:1px solid var(--border)">' +
          '<div style="flex:0 0 110px;color:var(--text-muted)">' + esc(kv[0]) + '</div>' +
          '<div style="flex:1;color:var(--text-primary);font-family:ui-monospace,Consolas,monospace;word-break:break-all">' +
          esc(String(kv[1])) + '</div></div>';
      }).join("");
      var running = (p.running && p.running.trim()) || "";
      body.innerHTML =
        '<div style="margin-bottom:8px;color:var(--text-muted)">on <b>' + esc(aliasOf(hostFqdn)) + '</b> (' + esc(hostFqdn) + ')</div>' +
        tbl +
        '<div style="margin-top:10px"><div style="color:var(--text-muted);margin-bottom:3px">running command</div>' +
        '<pre style="margin:0;padding:8px;background:var(--bg);border:1px solid var(--border);border-radius:6px;' +
        'white-space:pre-wrap;word-break:break-all;font-size:11.5px;max-height:30vh;overflow:auto">' +
        (running ? esc(running) : '<span style="color:var(--text-muted)">idle at prompt (no child command)</span>') + '</pre></div>';
      if (!Dialog) { alert("pid " + p.pid + "\n" + (running || "idle")); return; }
      Dialog.show({
        title: "Shell " + p.pid, body: body, width: "560px",
        buttons: [
          {text: "Close"},
          {text: "Copy cmd", action: function () { try { AppUI.utils.core.copyText(running || p.comm || "").catch(function () {}); } catch (_) {} }},
          {text: "Kill", primary: true, action: async function () {
            await fetch("/v1/apps/platform/auth_ssh/host_scan", {
              method: "POST", headers: {"Content-Type": "application/json"},
              body: JSON.stringify({ host: hostFqdn, kill_pid: p.pid }) }).catch(function () {});
            scanHost(hostFqdn, sec);
          }},
        ],
      });
    }
    return { scanHost, showPs };
  }
  return { create };
})();

;
/** Terminal live session sidebar; session and tab ownership stay with the page. */
window.TerminalSidebar = (() => {
  function create({ SESSIONS, getHost, getActive, setActive, getTabs,
    api, esc, aliasOf, aliasFor, showActive, reviveSession, renameSession,
    addNewTab, scanHost, showPs }) {
    // --- sessions sidebar: a LIVE list of every session (local + remote) with
    // revive / kill, so stale/old sessions are always visible and manageable. ---
    var _sidebarSig = "";
    async function renderSidebar(force) {
      if (!getHost()) return;
      var host = getHost();
      var r;
      try { r = await api("sessions", {}); } catch (_) { r = null; }
      var remote = (r && r.remote_shells) ? r.remote_shells : [];
      var local = (r && r.sessions) ? r.sessions : [];

      // UNION the server list with the client's OPEN TABS so an open tab never
      // disappears on a transient fetch hiccup or before its first command
      // (which is when it gets created server-side). Keyed by sid.
      var merged = {};   // sid -> {id, host(''=local), alias, origin, idle, uptime, stale, opened, server}
      function put(sid, rec) {
        var ex = merged[sid] || {};
        merged[sid] = Object.assign(ex, rec);
      }
      remote.forEach(function (sh) { put(sh.id, { id: sh.id, host: sh.host, origin: sh.origin,
        idle: sh.idle, uptime: sh.uptime, stale: sh.stale, server: true, local: false }); });
      local.forEach(function (ls) { put(ls.id, { id: ls.id, host: "", origin: ls.origin,
        idle: ls.idle, uptime: ls.uptime, stale: ls.stale, server: true, local: true }); });
      Object.keys(SESSIONS).forEach(function (sid) {
        var s = SESSIONS[sid];
        put(sid, { id: sid, host: s.host || "", local: !s.host, opened: true,
                   name: s.name, origin: merged[sid] ? merged[sid].origin : "browser" });
        if (!merged[sid].server) { merged[sid].idle = 0; merged[sid].uptime = 0; merged[sid].stale = false; }
      });

      // PERF: skip the full DOM rebuild when nothing meaningful changed. Build a
      // signature of the merged state (ids + active + stale + idle bucket); only
      // nuke+rebuild #sidebar when it differs (or an explicit refresh forced it).
      // This stops the 5s poll from thrashing layout + dropping transient UI.
      var sig = Object.keys(merged).sort().map(function (sid) {
        var m = merged[sid];
        return sid + ":" + (m.id === getActive() ? 1 : 0) + ":" + (m.stale ? 1 : 0) +
               ":" + (m.opened ? 1 : 0) + ":" + Math.floor((m.idle || 0) / 5) + ":" + (m.name || "");
      }).join("|");
      if (!force && sig === _sidebarSig && host.querySelector(".ss-wrap")) return;
      _sidebarSig = sig;

      host.innerHTML = "";
      var wrap = document.createElement("div"); wrap.className = "ss-wrap";
      var hdr = document.createElement("div"); hdr.className = "ss-hdr";
      hdr.innerHTML = '<span>Sessions</span>';
      var rb = document.createElement("button"); rb.className = "ss-ref"; rb.textContent = "\u21bb";
      rb.title = "refresh"; rb.onclick = function () { renderSidebar(true); };
      var nb = document.createElement("button"); nb.className = "ss-new"; nb.textContent = "+ new";
      nb.onclick = function () { addNewTab(); renderSidebar(true); };
      hdr.append(rb, nb);
      wrap.appendChild(hdr);

      function rowFor(m) {
        var row = document.createElement("div");
        row.className = "ss-row" + (m.id === getActive() ? " active" : "") + (m.stale ? " stale" : "");
        var dot = m.stale ? '<span class="ss-dot bad"></span>' : '<span class="ss-dot ok"></span>';
        var orig = (m.origin && m.origin !== "browser") ? '<span class="ss-orig">' + esc(m.origin) + '</span>' : '';
        var base = m.name || (m.host ? aliasOf(m.host) : "local");
        var labelHtml = esc(base) + (!m.name ? ' <span class="ss-sid">' + esc(m.id) + '</span>' : '');
        var meta = (!m.server ? "new" : ((m.stale ? "stale · " : "") + "idle " + (m.idle || 0) + "s"));
        var nameSpan = '<span class="ss-id" title="' + esc(m.id) + '">' + labelHtml + '</span>';
        row.innerHTML = dot + nameSpan + orig + '<span class="ss-meta">' + esc(meta) + '</span>';
        row.onclick = function () {
          if (m.opened) { setActive(m.id); getTabs().switch(m.id); showActive(); }
          else { reviveSession({ id: m.id, host: m.host, alive: true, stale: m.stale, idle: m.idle, uptime: m.uptime, _local: m.local }); renderSidebar(); }
        };
        // rename (✎) + kill (✕)
        var ren = document.createElement("button"); ren.className = "ss-ren"; ren.textContent = "\u270e";
        ren.title = "rename"; ren.onclick = function (ev) { ev.stopPropagation(); renameSession(m.id); };
        var kill = document.createElement("button"); kill.className = "ss-kill"; kill.textContent = "\u2715";
        kill.title = "kill session";
        kill.onclick = async function (ev) {
          ev.stopPropagation();
          var kb = { id: m.id }; if (m.host) kb.host = m.host;
          try { await api("kill", kb); } catch (_) {}
          var s = SESSIONS[m.id];
          if (s) { if (s.screen) s.screen.remove(); delete SESSIONS[m.id];
                   if (getActive() === m.id) { var ids = Object.keys(SESSIONS); setActive(ids[0] || null); showActive(); } }
          renderSidebar();
        };
        row.append(ren, kill);
        return row;
      }

      // group by host ('' = local)
      var byHost = {};
      Object.keys(merged).forEach(function (sid) { var m = merged[sid]; (byHost[m.host || ""] = byHost[m.host || ""] || []).push(m); });
      var keys = Object.keys(byHost).sort(function (a, b) { return (a === "" ? "~" : a).localeCompare(b === "" ? "~" : b); });
      keys.forEach(function (h) {
        var sec = document.createElement("div"); sec.className = "ss-sec";
        var secHdr = document.createElement("div"); secHdr.className = "ss-sec-t";
        secHdr.innerHTML = '<span>' + esc(h ? (aliasFor(h) + " (" + h + ")") : "local") + '</span>';
        if (h) {   // remote host: offer a "scan" for untracked strays
          var scan = document.createElement("button"); scan.className = "ss-scan"; scan.textContent = "scan";
          scan.title = "list shells actually running on this host (find strays)";
          scan.onclick = function (ev) { ev.stopPropagation(); scanHost(h, sec); };
          secHdr.appendChild(scan);
          var psb = document.createElement("button"); psb.className = "ss-scan"; psb.textContent = "ps";
          psb.title = "show raw ps output for this host in a dialog";
          psb.onclick = function (ev) { ev.stopPropagation(); showPs(h); };
          secHdr.appendChild(psb);
        }
        sec.appendChild(secHdr);
        byHost[h].sort(function (a, b) { return a.id.localeCompare(b.id); }).forEach(function (m) { sec.appendChild(rowFor(m)); });
        wrap.appendChild(sec);
      });
      if (!keys.length) {
        var e = document.createElement("div"); e.className = "ss-empty";
        e.textContent = "No sessions. + new to start one.";
        wrap.appendChild(e);
      }
      host.appendChild(wrap);
    }
    return { renderSidebar };
  }
  return { create };
})();

;
/** Terminal raw-mode rendering, polling, and key forwarding. */
window.TerminalRawMode = (() => {
  function create({ api, ensureSession, getRoot, setStatus, syncToolbar, readyPrompt, aliasOf, sess }) {
    // --- interactive RAW mode (tmux-backed remote sessions) ---------------------
    // In raw mode the session screen is replaced by a live <pre> that mirrors the
    // tmux pane (polled via terminal.read), and the input box forwards keystrokes
    // straight to the pane via terminal.write (literal text, or named keys for
    // Enter/arrows/Ctrl-C/Esc/etc). This lets vim/top/less/a REPL actually run.
    var RAW_KEYMAP = {
      "Enter": "Enter", "Tab": "Tab", "Escape": "Escape", "Backspace": "BSpace",
      "ArrowUp": "Up", "ArrowDown": "Down", "ArrowLeft": "Left", "ArrowRight": "Right",
      "Home": "Home", "End": "End", "PageUp": "PageUp", "PageDown": "PageDown",
      "Delete": "DC", "Insert": "IC",
      "F1": "F1", "F2": "F2", "F3": "F3", "F4": "F4", "F5": "F5", "F6": "F6",
      "F7": "F7", "F8": "F8", "F9": "F9", "F10": "F10", "F11": "F11", "F12": "F12",
    };

    async function enterRaw(s) {
      if (!s.host) { setStatus("Raw mode is remote-only."); return; }
      if (!(await ensureSession(s))) return;
      s.raw = true;
      s.screen.classList.add("raw");
      var pre = document.createElement("pre");
      pre.className = "raw-pane";
      pre.setAttribute("tabindex", "0");
      s.screen.appendChild(pre);
      s.rawPre = pre;
      var inp = getRoot().querySelector("#cmd");
      inp.placeholder = "raw mode — keystrokes go straight to the shell (Esc-heavy apps: use the input)";
      inp.value = "";
      rawPoll(s);                 // start the live mirror
      syncToolbar();
      pre.focus();
      setStatus("Raw interactive mode on " + aliasOf(s.host) + " — type here; Ctrl-keys via the input. Click 'exit raw' to leave.");
    }

    function exitRaw(s) {
      s.raw = false;
      if (s.rawTimer) { clearTimeout(s.rawTimer); s.rawTimer = null; }
      if (s.rawPre) { s.rawPre.remove(); s.rawPre = null; }
      s.screen.classList.remove("raw");
      var inp = getRoot().querySelector("#cmd");
      inp.placeholder = "type a command, Enter to run";
      readyPrompt(s);
      syncToolbar();
      setStatus("Left raw mode.");
    }

    async function rawPoll(s) {
      if (!s.raw) return;
      try {
        var d = await api("read", { host: s.host, id: s.sid });
        if (s.raw && s.rawPre && d && d.output != null) {
          var atBottom = (s.screen.scrollTop + s.screen.clientHeight) >= (s.screen.scrollHeight - 30);
          s.rawPre.textContent = d.output;
          if (atBottom) s.screen.scrollTop = s.screen.scrollHeight;
        }
      } catch (_) {}
      if (s.raw) s.rawTimer = setTimeout(function () { rawPoll(s); }, 700);
    }

    // map a keydown in raw mode → either literal text or a named tmux key, send it.
    async function rawKey(s, e) {
      if (!s.raw || !s.host) return false;
      var key = e.key;
      // control combos: C-<letter>, C-c etc.
      if (e.ctrlKey && key.length === 1 && /[a-zA-Z0-9\[\]\\\/]/.test(key)) {
        e.preventDefault();
        await api("write", { host: s.host, id: s.sid, data: "C-" + key.toLowerCase(), keys: true });
        return true;
      }
      if (e.altKey && key.length === 1 && /[a-zA-Z0-9]/.test(key)) {
        e.preventDefault();
        await api("write", { host: s.host, id: s.sid, data: "M-" + key.toLowerCase(), keys: true });
        return true;
      }
      if (RAW_KEYMAP[key]) {
        e.preventDefault();
        await api("write", { host: s.host, id: s.sid, data: RAW_KEYMAP[key], keys: true });
        return true;
      }
      if (key.length === 1) {              // printable → literal
        e.preventDefault();
        await api("write", { host: s.host, id: s.sid, data: key, keys: false });
        return true;
      }
      return false;                        // let other keys pass (e.g. browser shortcuts)
    }

    function toggleRaw() {
      var s = sess(); if (!s) return;
      if (s.raw) exitRaw(s); else enterRaw(s);
    }
    return { enterRaw, exitRaw, rawKey, toggleRaw };
  }
  return { create };
})();

;
// Shell execution is independent of the page's tabs and input controls.
(function (global) {
  "use strict";
  function create(deps) {
    var api = deps.api, esc = deps.esc, append = deps.append, readyPrompt = deps.readyPrompt;
    var APPOBJ = { setStatus: deps.setStatus };
function stripAnsi(s) {
  return String(s).replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "").replace(/\u001b[=>]/g, "");
}

async function runOneShot(s, cmd) {
  var body = { cmd: cmd };
  if (s.host) body.host = s.host;
  else { body.cwd = s.cwd || undefined; body.shell = s.shell; }
  var d = await api("run", body);
  if (d.ok) {
    if (d.stdout) append(s, '<div class="out">' + esc(d.stdout) + '</div>');
    if (d.stderr) append(s, '<div class="err">' + esc(d.stderr) + '</div>');
    append(s, '<div class="code' + (d.exit_code !== 0 ? ' bad' : '') + '">exit ' + d.exit_code +
           (d.duration_ms != null ? ' · ' + d.duration_ms + 'ms' : '') + '</div>');
    APPOBJ.setStatus((s.host ? s.host + ' · ' : '') + "exit " + d.exit_code);
  } else {
    append(s, '<div class="err">' + esc(d.error || "error") +
           (d.error_category ? " (" + esc(d.error_category) + ")" : "") + '</div>');
    APPOBJ.setStatus("Error: " + (d.error || "failed"));
  }
}

async function ensureSession(s) {
  if (s.created) return true;
  var body = { id: s.sid, origin: "browser" };
  if (s.host) body.host = s.host;
  else { body.shell = s.shell; body.cwd = s.cwd || undefined; }
  var d = await api("create", body);
  if (!d.ok) { append(s, '<div class="err">create failed: ' + esc(d.error || "") + '</div>'); return false; }
  s.created = true;
  APPOBJ.setStatus("session " + s.sid + (s.host ? " @ " + s.host : " (" + (d.shell || s.shell) + ")"));
  if (s.host) {                     // remote: apply initial cwd, then prime prompt
    try {
      if (s.cwd) { var cd = await api("exec", { host: s.host, id: s.sid, cmd: "cd " + s.cwd }); if (cd.ok && cd.cwd) s.cwdNow = cd.cwd; }
      if (!s.cwdNow) { var pw = await api("exec", { host: s.host, id: s.sid, cmd: "pwd" });
                       if (pw.ok && pw.cwd) s.cwdNow = pw.cwd; }
    } catch (_) {}
  }
  deps.refreshSidebar();
  return true;}

async function runSession(s, cmd) {
  if (!(await ensureSession(s))) return;
  var body = { id: s.sid, cmd: cmd };
  if (s.host) body.host = s.host;
  var d = await api("exec", body);
  if (d.ok) {
    var out = stripAnsi(d.output || "");
    if (out) append(s, '<div class="out">' + esc(out) + '</div>');
    if (d.cwd) s.cwdNow = d.cwd;
    if (d.rc !== undefined && d.rc !== null && d.rc !== 0) append(s, '<div class="code bad">exit ' + d.rc + '</div>');
  } else {
    append(s, '<div class="err">' + esc(d.error || "error") + '</div>');
  }
  // trailing prompt: show the (updated) prompt on its own line so the user sees
  // the shell is READY again (command finished) and where they now are.
  readyPrompt(s);
}

async function connectHost(s) {
  if (!s.host) { APPOBJ.setStatus("Pick a host first."); return; }
  append(s, '<div class="out">Connecting to ' + esc(s.host) + ' …</div>');
  var d = await api("connect", { host: s.host });
  if (d && d.ok !== false) { append(s, '<div class="code">connected · ' + esc(s.host) + '</div>'); APPOBJ.setStatus("Connected to " + s.host); }
  else { append(s, '<div class="err">connect failed: ' + esc((d && d.error) || "") + '</div>'); APPOBJ.setStatus("Connect failed"); }
}

async function endSession(s) {
  if (s && s.created) {
    var body = { id: s.sid };
    if (s.host) body.host = s.host;
    try { await api("kill", body); } catch(_){}
    s.created = false; s.cwdNow = "";
  }
}

    return { runOneShot: runOneShot, ensureSession: ensureSession,
      runSession: runSession, connectHost: connectHost, endSession: endSession };
  }
  global.TerminalExecution = { create: create };
})(window);

;
// Attach, discover and revive remote shells without owning the page's tabs.
(function (global) {
  "use strict";
  function create(deps) {
    var SESSIONS = deps.sessions, api = deps.api, esc = deps.esc;
    var aliasFor = deps.aliasFor, aliasOf = deps.aliasOf, newSession = deps.newSession;
    var append = deps.append, openTab = deps.openTab, showActive = deps.showActive;
    var readyPrompt = deps.readyPrompt;
  // Attach a new tab to an EXISTING remote tmux session (persists across
  // disconnects). Uses terminal.attach → connection.shell_attach, then opens the
  // bound session as a tab and primes its prompt from the live shell.
  async function attachTmux(hostFqdn, tmuxName) {
    var alias = aliasFor(hostFqdn);
    var d = await api("attach", { host: alias || hostFqdn, tmux: tmuxName, origin: "browser" });
    if (!d || d.ok === false) { deps.setStatus("attach failed: " + ((d && d.error) || "")); return; }
    var sid = d.id || tmuxName;
    if (SESSIONS[sid]) { deps.setActive(sid); deps.getTabs().switch(sid); showActive(); return; }
    var s = newSession({ sid: sid, host: alias || hostFqdn, mode: "session",
                         name: "⇆ " + tmuxName });
    s.created = true;
    append(s, '<div class="code">⇆ attached to tmux <b>' + esc(tmuxName) + '</b> on ' + esc(aliasOf(hostFqdn)) + '</div>');
    deps.setActive(s.sid); openTab(s); showActive();
    (async function () {
      try { var pw = await api("exec", { host: s.host, id: s.sid, cmd: "pwd" });
            if (pw.ok && pw.cwd) s.cwdNow = pw.cwd; } catch (_) {}
      readyPrompt(s);
      deps.refreshSidebar();
    })();
  }

  // List pre-existing server-side sessions on `host` that aren't already open as
  // tabs, and offer to REVIVE (open as a tab) or KILL each. Answers "how do I
  // know / manage stale sessions when I connect to a remote".
  async function discoverHostSessions(s, host) {
    try {
      var r = await api("sessions", {});
      if (!r || !r.remote_shells) return;
      // the dropdown value may be an ALIAS; sessions carry the resolved FQDN.
      var fqdn = deps.getAliases()[host] || host;
      var openIds = Object.keys(SESSIONS).map(function (k) { return SESSIONS[k].sid; });
      var olds = (r.remote_shells || []).filter(function (sh) {
        var sameHost = sh.host === host || sh.host === fqdn ||
                       (fqdn && sh.host.indexOf(fqdn) === 0) ||
                       (host && sh.host.indexOf(host) === 0);
        return sameHost && openIds.indexOf(sh.id) < 0;   // not already a tab
      });
      if (!olds.length) return;
      var box = document.createElement("div");
      box.className = "sess-banner";
      box.innerHTML = '<div class="sb-title">' + olds.length +
        ' existing session(s) on ' + esc(host) + ' — revive or kill:</div>';
      olds.forEach(function (sh) {
        var row = document.createElement("div"); row.className = "sb-row";
        var meta = (sh.stale ? '<span class="sb-stale">⚠ stale</span> ' : '') +
          'idle ' + sh.idle + 's · uptime ' + sh.uptime + 's';
        row.innerHTML = '<code>' + esc(sh.id) + '</code> <span class="sb-meta">' + meta + '</span>';
        var revive = document.createElement("button"); revive.textContent = "revive";
        revive.onclick = function () { reviveSession(sh); box.remove(); };
        var kill = document.createElement("button"); kill.textContent = "kill";
        kill.onclick = async function () {
          await api("kill", { host: host, id: sh.id }); row.remove();
          if (!box.querySelector(".sb-row")) box.remove();
        };
        row.append(revive, kill);
        box.appendChild(row);
      });
      s.screen.appendChild(box);
      s.screen.scrollTop = s.screen.scrollHeight;
    } catch (_) {}
  }

  function reviveSession(sh) {
    if (SESSIONS[sh.id]) { deps.setActive(sh.id); deps.getTabs().switch(sh.id); showActive(); return; }
    var s = newSession({ sid: sh.id, host: sh.host, mode: "session" });
    s.created = !sh.stale;
    append(s, '<div class="code' + (sh.stale ? ' bad' : '') + '">↻ revived "' + esc(sh.id) +
           '" on ' + esc(sh.host) + (sh.stale ? ' ⚠ stale (will reconnect)' : '') + '</div>');
    deps.setActive(s.sid); openTab(s); showActive();
    // restore the cwd prompt (silent pwd), then show a ready prompt
    (async function () {
      try { var pw = await api("exec", { host: s.host || undefined, id: s.sid, cmd: "pwd" });
            if (pw.ok && pw.cwd) s.cwdNow = pw.cwd; s.created = true; } catch (_) {}
      readyPrompt(s);
      deps.refreshSidebar();
    })();
  }

    return { attachTmux: attachTmux, discoverHostSessions: discoverHostSessions, reviveSession: reviveSession };
  }
  global.TerminalRemoteSessions = { create: create };
})(window);

;
// Terminal controls, per-session history and PTY size observation.
(function (global) {
  "use strict";
  function create(deps) {
    var api = deps.api, sess = deps.sess, submit = deps.submit;
    var connectAndPrompt = deps.connectAndPrompt, changeHost = deps.changeHost;
    var syncToolbar = deps.syncToolbar, endSession = deps.endSession;
    var APPOBJ = { setStatus: deps.setStatus };
    var bindingController = null, observer = null, resizeTimer = null;
    function destroy() {
      if (bindingController) bindingController.abort();
      if (observer) observer.disconnect();
      if (resizeTimer !== null) clearTimeout(resizeTimer);
      bindingController = observer = resizeTimer = null;
      _lastRz = { cols: 0, rows: 0, sid: null, host: null };
    }
    function bind() {
      destroy();
      var ROOT = deps.getRoot();
      var scope = bindingController = new AbortController();
      function on(selector, type, handler) {
        ROOT.querySelector(selector).addEventListener(type, handler, { signal: scope.signal });
      }
    on("#run", "click", submit);
    on("#cmd", "keydown", function (e) {
      var s = sess();
      // RAW MODE: forward keystrokes straight to the remote pane.
      if (s && s.raw) { deps.getRawMode().rawKey(s, e); return; }
      // NORMAL MODE: Enter runs; Up/Down walk per-session command history.
      if (e.key === "Enter") { histReset(s); submit(); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); histNav(s, -1); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); histNav(s, 1); return; }
    });
    on("#clear", "click", function () {
      var s = sess(); if (!s) return;
      if (s.raw && s.rawPre) { s.rawPre.textContent = ""; api("write", { host: s.host, id: s.sid, data: "C-l", keys: true }); }
      else s.screen.innerHTML = "";
    });
    on("#conn", "click", function () { var s = sess(); if (s) connectAndPrompt(s); });
    on("#rawbtn", "click", function () { deps.getRawMode().toggleRaw(); });

    on("#hostsel", "change", function (e) {
      var s = sess(); if (!s) return;
      var v = e.target.value, box = ROOT.querySelector("#host");
      if (v === "__custom__") { box.style.display = ""; box.focus(); return; }
      box.style.display = "none";
      changeHost(s, v);
    });
    on("#host", "change", function (e) {
      var s = sess(); if (s) changeHost(s, e.target.value.trim());
    });
    on("#oneshot", "change", function (e) {
      var s = sess(); if (s) { s.mode = e.target.checked ? "one-shot" : "session";
        if (s.raw) deps.getRawMode().exitRaw(s);
        syncToolbar();
        APPOBJ.setStatus(s.mode === "one-shot" ? "One-shot mode (real exit code)." : "Session mode (state persists)."); }
    });
    on("#shell", "change", function (e) {
      var s = sess(); if (s) { endSession(s).then(function(){ s.shell = e.target.value; }); }
    });
    on("#cwd", "change", function (e) { var s = sess(); if (s) s.cwd = e.target.value.trim(); });

      if (window.ResizeObserver) {
        observer = new ResizeObserver(function () {
          if (scope.signal.aborted) return;
          if (resizeTimer !== null) clearTimeout(resizeTimer);
          resizeTimer = setTimeout(function () {
            if (scope.signal.aborted) return;
            resizeTimer = null; sendResize();
          }, 250);
        });
        observer.observe(ROOT.querySelector("#screens"));
      }
    }
  // --- command history (per session, up/down) -------------------------------
  function histPush(s, cmd) {
    if (!s || !cmd) return;
    s.hist = s.hist || [];
    if (s.hist[s.hist.length - 1] !== cmd) s.hist.push(cmd);
    if (s.hist.length > 500) s.hist.shift();
    s.histIdx = s.hist.length;       // past the end = "current (empty) line"
  }
  function histReset(s) { if (s) s.histIdx = (s.hist || []).length; }
  function histNav(s, dir) {
    if (!s || !s.hist || !s.hist.length) return;
    if (s.histIdx == null) s.histIdx = s.hist.length;
    s.histIdx = Math.max(0, Math.min(s.hist.length, s.histIdx + dir));
    var inp = deps.getRoot().querySelector("#cmd");
    inp.value = (s.histIdx < s.hist.length) ? s.hist[s.histIdx] : "";
    try { inp.setSelectionRange(inp.value.length, inp.value.length); } catch (_) {}
  }

  // --- resize the active session's PTY to the current screen size -----------
  var _lastRz = { cols: 0, rows: 0, sid: null, host: null };
  function sendResize() {
    var s = sess(); if (!s || !s.created) return;
    var box = deps.getRoot().querySelector("#screens"); if (!box) return;
    // crude but effective cell estimate (monospace ~8.5px wide, ~18px line).
    var cols = Math.max(20, Math.floor(box.clientWidth / 8.5));
    var rows = Math.max(6, Math.floor(box.clientHeight / 18));
    if (cols === _lastRz.cols && rows === _lastRz.rows && s.sid === _lastRz.sid && (s.host || "") === _lastRz.host) return;
    _lastRz = { cols: cols, rows: rows, sid: s.sid, host: s.host || "" };
    var body = { id: s.sid, cols: cols, rows: rows };
    if (s.host) body.host = s.host;
    api("resize", body).catch(function () {});
  }

    return { bind: bind, destroy: destroy, histPush: histPush, sendResize: sendResize };
  }
  global.TerminalInput = { create: create };
})(window);
