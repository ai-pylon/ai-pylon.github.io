// Terminal — AppUI page. Served at /apps/system/terminal/.
// MULTI-SESSION via AppUIContentTabs: each tab is an independent terminal
// session (its own screen + state). A session is one-shot or a persistent shell
// (local ConPTY via cap:system.terminal, or remote SSH via platform/auth_ssh).
var APP = "system/terminal";
var SESSIONS = {};        // sid -> session state (+ its own screen element)
var ACTIVE = null;        // active sid
var SEQ = 0;              // monotonic id source for new tabs
var TABS = null, APPOBJ = null, ROOT = null, SCREENHOST = null;
var RAW_MODE = null;
var ALIAS_FQDN = {};      // alias -> real FQDN (from connection.host_list), for matching

function esc(s) { return AppUITextUtils.esc(s); }

window.addEventListener("error", function (e) {
  try { fetch("/v1/log", { method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ level:"error", source:"terminal.page", message:String(e.message||e) }) }); } catch(_){}
});

async function api(op, body) {
  var response = await window.AppUIApi.requestResponse("/v1/apps/" + APP + "/" + op, body || {}, {
    method: "POST", timeout: null, decode: function (result) { return result.json(); }
  });
  return response.data;
}
// --- per-session model ------------------------------------------------------
function newSession(opts) {
  opts = opts || {};
  var sid = opts.sid || ("web" + (++SEQ));
  var screen = document.createElement("div");
  screen.className = "term-screen";
  screen.style.display = "none";
  SCREENHOST.appendChild(screen);
  var s = { sid: sid, host: opts.host || "", mode: opts.mode || "session",
            shell: opts.shell || "cmd.exe", cwd: "", created: false, cwdNow: "",
            name: opts.name || "", screen: screen };
  SESSIONS[sid] = s;
  return s;
}
function sess(sid) { return SESSIONS[sid || ACTIVE]; }
function append(s, html) {
  var div = document.createElement("div"); div.innerHTML = html;
  while (div.firstChild) s.screen.appendChild(div.firstChild);
  s.screen.scrollTop = s.screen.scrollHeight;
}
function promptStr(s) {
  return s.cwdNow ? (s.cwdNow + " $ ") : (s.host ? (s.host + " $ ") : "$ ");
}
// FILL the current trailing ready-prompt with the command the user ran (it stops
// being "ready" → no cursor), instead of printing a second prompt line.
function echoCmd(s, cmd) {
  var ready = lastEl(s, ".cmd.ready");
  if (ready) {
    ready.classList.remove("ready");
    ready.insertAdjacentHTML("beforeend", esc(cmd));
  } else {
    append(s, '<div class="cmd"><span class="ps">' + esc(promptStr(s)) + '</span>' + esc(cmd) + '</div>');
  }
  s.screen.scrollTop = s.screen.scrollHeight;
}
function lastEl(s, sel) {
  var all = s.screen.querySelectorAll(sel);
  return all.length ? all[all.length - 1] : null;
}
// append a single live "ready" prompt (the ONLY line with a cursor). Removes any
// stray earlier ready prompt first so there's never more than one blinking.
function readyPrompt(s) {
  var old = s.screen.querySelectorAll(".cmd.ready");
  old.forEach(function (el) { el.classList.remove("ready"); });
  append(s, '<div class="cmd ready"><span class="ps">' + esc(promptStr(s)) + '</span></div>');
}
function showActive() {
  Object.keys(SESSIONS).forEach(function (k) {
    SESSIONS[k].screen.style.display = (k === ACTIVE) ? "" : "none";
  });
  syncToolbar();
}

// --- command execution (operates on the ACTIVE session) ---------------------
var execution = null;
function runOneShot(s, cmd) { return execution.runOneShot(s, cmd); }
function ensureSession(s) { return execution.ensureSession(s); }
function runSession(s, cmd) { return execution.runSession(s, cmd); }
function connectHost(s) { return execution.connectHost(s); }
function endSession(s) { return execution.endSession(s); }

async function submit() {
  var s = sess();
  if (!s) return;
  var inp = ROOT.querySelector("#cmd");
  var cmd = inp.value.trim();
  if (!cmd) return;
  inp.value = "";
  clearHint(s);
  if (window.__termHistPush) window.__termHistPush(s, cmd);
  echoCmd(s, cmd);
  if (s.mode === "session") await runSession(s, cmd);
  else await runOneShot(s, cmd);
}

// --- toolbar reflects / configures the ACTIVE session -----------------------
function syncToolbar() {
  var s = sess(); if (!s || !ROOT) return;
  var remote = !!s.host;
  ROOT.querySelector("#oneshot").checked = (s.mode === "one-shot");
  ROOT.querySelector("#shell").value = s.shell;
  var sel = ROOT.querySelector("#hostsel");
  if (s.host && !Array.prototype.some.call(sel.options, function (o){ return o.value === s.host; })) {
    var o = document.createElement("option"); o.value = s.host; o.textContent = s.host;
    sel.insertBefore(o, sel.lastChild);
  }
  sel.value = s.host || "";
  // shell picker is LOCAL-only (remote uses the host login shell); working dir
  // applies to BOTH (remote tracks cwd, so an initial cwd is valid there too).
  ROOT.querySelector("#shell-lbl").style.display = remote ? "none" : "";
  ROOT.querySelector("#cwd").style.display = "";
  ROOT.querySelector("#cwd").value = s.cwd || "";
  ROOT.querySelector("#cwd").placeholder = remote ? "start dir (optional, e.g. /var/log)" : "working dir (optional)";
  ROOT.querySelector("#conn").style.display = "";   // Connect/Start always available
  ROOT.querySelector("#conn").textContent = s.created ? "Reconnect" : "Connect";
  ROOT.querySelector("#host").style.display = "none";
  // raw mode button: remote + session mode only (needs a tmux-backed shell)
  var rawbtn = ROOT.querySelector("#rawbtn");
  rawbtn.style.display = (remote && s.mode === "session") ? "" : "none";
  rawbtn.classList.toggle("on", !!s.raw);
  rawbtn.textContent = s.raw ? "exit raw" : "raw";
  ROOT.querySelector("#sess").textContent = (s.raw ? "⌨ " : "") + (s.created ? (s.host ? ("● " + s.host) : "● local") : (s.host ? ("○ " + s.host) : "○ local"));
}

async function loadSavedHosts() {
  var sel = ROOT.querySelector("#hostsel");
  try {
    var r = await fetch("/v1/apps/platform/auth_ssh/host_list", {
      method:"POST", headers:{"Content-Type":"application/json"}, body:"{}" });
    var d = await r.json();
    var hosts = (d && d.hosts) || [];
    var opts = '<option value="">local</option>';
    hosts.forEach(function (h) {
      ALIAS_FQDN[h.alias] = h.host;      // remember alias→FQDN for session matching
      opts += '<option value="' + esc(h.alias) + '">' + esc(h.alias) + ' (' + esc(h.host) + ')</option>';
    });
    opts += '<option value="__custom__">custom…</option>';
    sel.innerHTML = opts;
  } catch (_) {}
}

// --- tabs -------------------------------------------------------------------
function openTab(s, label) {
  // add the tab if new, else just switch to it.
  if (TABS.get && TABS.get(s.sid)) TABS.switch(s.sid);
  else { TABS.add({ id: s.sid, title: label || tabLabel(s) }); TABS.switch(s.sid); }
}
function relabelTab(s) { if (TABS.update) TABS.update(s.sid, { title: tabLabel(s) }); }
function tabLabel(s) {
  if (s.name) return s.name;                 // user-renamed
  var base = s.host ? (aliasOf(s.host)) : "local";
  // only disambiguate with a number when >1 tab share the same base label
  var sameBase = Object.keys(SESSIONS).filter(function (k) {
    var o = SESSIONS[k]; return !o.name && ((o.host ? aliasOf(o.host) : "local") === base);
  });
  if (sameBase.length <= 1) return base;
  var n = sameBase.indexOf(s.sid) + 1;
  return base + " " + (n > 0 ? n : sameBase.length);
}
// short host label: a saved alias if known, else the first DNS segment.
function aliasOf(fqdn) {
  for (var a in ALIAS_FQDN) { if (ALIAS_FQDN[a] === fqdn) return a; }
  return String(fqdn).split(".")[0];
}

function addNewTab() {
  var cur = sess();
  var s = newSession({ host: cur ? cur.host : "", mode: cur ? cur.mode : "session",
                       shell: cur ? cur.shell : "cmd.exe" });
  ACTIVE = s.sid;
  openTab(s);
  showActive();
  ROOT.querySelector("#cmd").focus();
  if (window.__termRefreshSidebar) window.__termRefreshSidebar();
  // Do NOT auto-connect. Show an idle hint; the session is established when the
  // user hits Connect / picks a host, or runs the first command.
  append(s, '<div class="out dim" data-hint="1">Not connected. Choose a host and press Connect (or just type a command to start).</div>');
}

// Ensure the session exists (connect) and render a ready prompt so the screen
// shows the shell is connected + the current directory. Called by an explicit
// user action (Connect / host change), not automatically on tab open.
async function connectAndPrompt(s) {
  if (s.created) { readyPrompt(s); return; }
  if (s.mode === "one-shot") { clearHint(s); append(s, '<div class="code">one-shot mode · each command runs independently</div>'); return; }
  clearHint(s);
  append(s, '<div class="out dim">Connecting' + (s.host ? " to " + esc(s.host) : " (local)") + ' …</div>');
  var ok = await ensureSession(s);
  var dim = s.screen.querySelector(".out.dim"); if (dim) dim.remove();
  if (ok) readyPrompt(s);
}
function clearHint(s) { var h = s.screen.querySelector('[data-hint]'); if (h) h.remove(); }

function mountContent(el) {
  el.classList.add("term-content");
  el.innerHTML =
    '<div class="term-bar">' +
      '<label>host <select id="hostsel" title="local, a saved host, or custom">' +
        '<option value="">local</option><option value="__custom__">custom…</option></select></label>' +
      '<input id="host" class="cwd" placeholder="host / alias" style="width:140px;display:none">' +
      '<label id="shell-lbl">shell <select id="shell"><option value="cmd.exe">cmd</option>' +
        '<option value="powershell">powershell</option></select></label>' +
      '<input id="cwd" class="cwd" placeholder="working dir (optional)">' +
      '<button id="conn" style="display:none">Connect</button>' +
      '<span class="sp"></span>' +
      '<label class="chk"><input type="checkbox" id="oneshot"> one-shot</label>' +
      '<button id="rawbtn" title="interactive raw mode (vim/top/REPL) — remote tmux only" style="display:none">raw</button>' +
      '<span class="pill" id="sess">local</span>' +
      '<button id="clear">Clear</button>' +
      '<a class="xterm-link" href="xterm.htm" target="_blank" rel="noopener" title="a full terminal emulator (xterm): SSH with host-key check, or a local shell">xterm \u2197</a>' +
    '</div>' +
    '<div class="term-tabs" id="tabhost"></div>' +
    '<div class="term-screens" id="screens"></div>' +
    '<div class="term-input"><input id="cmd" placeholder="type a command, Enter to run" autofocus>' +
      '<button id="run">Run</button></div>';
  return el;
}

window.AppUIReady.then(function () {
  execution = TerminalExecution.create({
    api: api, esc: esc, append: append, readyPrompt: readyPrompt,
    setStatus: function (message) { APPOBJ.setStatus(message); },
    refreshSidebar: function () { if (window.__termRefreshSidebar) window.__termRefreshSidebar(); }
  });
  var input = TerminalInput.create({
    api: api, sess: sess, getRoot: function () { return ROOT; },
    getRawMode: function () { return RAW_MODE; }, submit: submit,
    connectAndPrompt: connectAndPrompt, changeHost: changeHost,
    syncToolbar: syncToolbar, endSession: endSession,
    setStatus: function (message) { APPOBJ.setStatus(message); }
  });
  window.__termHistPush = input.histPush;

  var SIDEBAR_HOST = null;
  RAW_MODE = window.TerminalRawMode.create({
    api: api, ensureSession: ensureSession, getRoot: function () { return ROOT; },
    setStatus: function (text) { APPOBJ.setStatus(text); },
    syncToolbar: syncToolbar, readyPrompt: readyPrompt, aliasOf: aliasOf, sess: sess,
  });

  var remoteSessions = TerminalRemoteSessions.create({
    sessions: SESSIONS, api: api, esc: esc, aliasFor: aliasFor, aliasOf: aliasOf,
    getAliases: function () { return ALIAS_FQDN; }, getTabs: function () { return TABS; },
    setActive: function (id) { ACTIVE = id; }, newSession: newSession,
    append: append, openTab: openTab, showActive: showActive, readyPrompt: readyPrompt,
    setStatus: function (message) { APPOBJ.setStatus(message); },
    refreshSidebar: function () { if (window.__termRefreshSidebar) window.__termRefreshSidebar(); }
  });

  var processes = window.TerminalProcesses.create({ esc: esc, aliasFor: aliasFor, aliasOf: aliasOf, attachTmux: attachTmux });
  var scanHost = processes.scanHost, showPs = processes.showPs;
  var sidebar = window.TerminalSidebar.create({
    SESSIONS: SESSIONS, getHost: function () { return SIDEBAR_HOST; },
    getActive: function () { return ACTIVE; }, setActive: function (id) { ACTIVE = id; },
    getTabs: function () { return TABS; }, api: api, esc: esc, aliasOf: aliasOf, aliasFor: aliasFor,
    showActive: showActive, reviveSession: reviveSession, renameSession: renameSession,
    addNewTab: addNewTab, scanHost: scanHost, showPs: showPs,
  });
  var renderSidebar = sidebar.renderSidebar;

  var app = AppUI.createApp({
    id: "system-terminal", title: "Terminal",
    leftSidebar: { tabs: [ { id: "sessions", label: "Sessions",
      render: function (el) { SIDEBAR_HOST = el; renderSidebar(); } } ] },
    content: { render: function (el) { ROOT = mountContent(el); } },
    statusbar: {},
  });
  APPOBJ = app;

  function attachTmux(hostFqdn, tmuxName) { return remoteSessions.attachTmux(hostFqdn, tmuxName); }

  function renameSession(sid) {
    var s = SESSIONS[sid];
    var cur = (s && s.name) || sid;
    var name = window.prompt("Rename session", cur);
    if (name == null) return;
    name = name.trim();
    if (!s) return;             // can only rename an opened tab (client-side label)
    s.name = name || sid;
    TABS.update(sid, { title: s.name });   // relabel the tab
    renderSidebar();
  }

  function aliasFor(fqdn) {
    for (var a in ALIAS_FQDN) { if (ALIAS_FQDN[a] === fqdn) return a; }
    return fqdn.split(".")[0];
  }
  window.__termRefreshSidebar = renderSidebar;

  function wire() {
    if (!ROOT) { setTimeout(wire, 20); return; }
    SCREENHOST = ROOT.querySelector("#screens");

    // Tab STRIP only (AppUITabs) — we manage the screens ourselves in #screens.
    // (AppUIContentTabs owns its own body, which conflicted with our per-session
    // screens and made the tabs behave oddly; the plain strip is the right fit.)
    TABS = window.AppUITabs.create({
      container: ROOT.querySelector("#tabhost"),
      newTabButton: true,
      draggable: true,
      onNewTab: function () { addNewTab(); },
      onSwitch: function (tab) { if (SESSIONS[tab.id]) { ACTIVE = tab.id; showActive(); ROOT.querySelector("#cmd").focus(); } },
      onClose: function (tab) {
        var s = SESSIONS[tab.id];
        if (s) { endSession(s); if (s.screen) s.screen.remove(); delete SESSIONS[tab.id]; }
        var ids = Object.keys(SESSIONS);
        if (!ids.length) { addNewTab(); } else if (tab.id === ACTIVE) { ACTIVE = ids[0]; TABS.switch(ACTIVE); showActive(); }
        if (window.__termRefreshSidebar) window.__termRefreshSidebar();
      },
    });

    input.bind();

    loadSavedHosts().then(function () { bootstrap(); });
  }

  function changeHost(s, host) {
    // changing a tab's host ends its old session + relabels the tab; it does NOT
    // auto-connect — the user presses Connect (or types a command) to start.
    endSession(s).then(function () {
      s.host = host; s.cwdNow = "";
      s.screen.innerHTML = "";          // fresh screen for the new host
      TABS.update(s.sid, { title: tabLabel(s) });   // relabel
      syncToolbar();
      APPOBJ.setStatus(host ? ("Host: " + host + " — press Connect or type a command.") : "Local — press Connect or type a command.");
      append(s, '<div class="out dim" data-hint="1">Not connected to ' + esc(host || "local") +
             '. Press Connect (or type a command to start).</div>');
      if (window.__termRefreshSidebar) window.__termRefreshSidebar();
    });
  }

  function discoverHostSessions(s, host) { return remoteSessions.discoverHostSessions(s, host); }
  function reviveSession(sh) { return remoteSessions.reviveSession(sh); }

  async function bootstrap() {
    // Open ONE fresh tab; the SIDEBAR lists any pre-existing sessions (revive/kill).
    addNewTab();
    // Deep links select a host without running commands or opening a shell.
    var requestedHost = new URLSearchParams(window.location.search).get('host');
    if (requestedHost && requestedHost.length <= 255 && !/[\x00-\x20]/.test(requestedHost)) {
      var initial = sess();
      initial.host = requestedHost;
      initial.screen.innerHTML = '';
      append(initial, '<div class="out dim" data-hint="1">Not connected to ' + esc(requestedHost) + '. Press Connect to start.</div>');
      relabelTab(initial);
      showActive();
    }
    renderSidebar();
    // keep the session list live (idle/stale) — but DON'T blow away a scan panel
    // the user is looking at (the periodic rebuild was wiping it instantly).
    setInterval(function () {
      if (SIDEBAR_HOST && SIDEBAR_HOST.querySelector(".ss-scanres")) return;
      renderSidebar();
    }, 5000);
    APPOBJ.setStatus("Run commands locally or on a remote/saved host. Sessions are in the left sidebar.");
  }

  wire();
}).catch(function (e) {
  var host = document.getElementById("app-content-body");
  if (host) {
    var message = document.createElement("div");
    message.style.padding = "18px";
    message.textContent = "AppUI failed to load: " + String(e);
    host.replaceChildren(message);
  }
});
