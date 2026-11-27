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
