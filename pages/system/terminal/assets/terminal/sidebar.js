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
