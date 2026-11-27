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
