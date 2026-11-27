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
