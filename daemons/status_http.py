"""Lightweight loopback-only HTTP status server for standalone Pylon daemons.

Simple, self-contained HTML without AppUI (stdlib-only, GET /, GET /api/status,
GET /health). Runs automatically in `standalone` (passive) mode; disabled by
default in `full` (server) mode where `platform/daemon_manager` serves the UI.

Also hosts the process-global active snapshot provider so `cap:system.daemon_stat`
returns live daemon runtime & connectivity status to `platform/daemon_manager`.
"""
from __future__ import annotations

import getpass
import json
import os
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable

_STANDALONE_HTML = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pylon Daemon (Client Mode)</title>
<style>
  :root{--bg:#13161b;--panel:#1c2128;--row:#222831;--border:#343c46;--text:#e6edf3;--muted:#8b949e;--accent:#2f81f7;}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:14px}
  header{position:sticky;top:0;background:var(--panel);border-bottom:1px solid var(--border);padding:12px 18px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  header h1{margin:0;font-size:16px;font-weight:600;flex:1}
  main{max-width:980px;margin:0 auto;padding:16px;display:flex;flex-direction:column;gap:12px}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}
  .card{background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:13px;display:flex;flex-direction:column;gap:8px}
  .card h2{margin:0;font-size:14px;font-weight:600}
  .pills{display:flex;flex-wrap:wrap;gap:6px}
  .pill{display:inline-flex;padding:2px 9px;border-radius:999px;font-size:12px;border:1px solid var(--border);background:var(--bg)}
  .pill.ok{border-color:rgba(63,185,80,.55);color:#7ee787}
  .pill.warn{border-color:rgba(210,153,34,.55);color:#e3b341}
  .pill.bad{border-color:rgba(248,81,73,.55);color:#ff7b72}
  .kv{display:grid;grid-template-columns:120px 1fr;gap:5px 10px;font-size:13px}
  .kv .k{color:var(--muted)}
  .mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;word-break:break-all}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--border)}
  th{font-size:11px;text-transform:uppercase;color:var(--muted)}
  button,a.btn{background:var(--row);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:5px 10px;font-size:12px;cursor:pointer;text-decoration:none}
  button:hover,a.btn:hover{border-color:var(--accent)}
  button.primary{background:var(--accent);border-color:var(--accent);color:#fff}
  .form{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;align-items:end}
  .field{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--muted)}
  .field input{background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:6px 8px;font-size:13px}
  .muted{color:var(--muted);font-size:12px}
</style>
</head>
<body>
<header>
  <h1 id="title">Pylon Daemon (Client Mode)</h1>
  <span class="muted" id="updated">Loading...</span>
  <label class="muted"><input type="checkbox" id="auto" checked> Auto (5s)</label>
  <button id="refresh" type="button">Refresh</button>
  <a class="btn" href="/api/status" target="_blank" rel="noopener">JSON</a>
</header>
<main>
  <div class="pills" id="summary"></div>
  <section class="card" id="central-card">
    <h2>Central Server (Client Mode)</h2>
    <form class="form" id="central-form">
      <label class="field">Central Server Host / URL<input id="f-server" name="central_server" required placeholder="pylon-server.duckdns.org"></label>
      <label class="field">Endpoint ID (optional)<input id="f-endpoint" name="endpoint_id" placeholder="win-local"></label>
      <label class="field">Agent Token (optional, write-only)<input id="f-token" name="token" type="password" autocomplete="off" placeholder="leave blank to keep existing"></label>
      <button class="primary" type="submit">Save &amp; Reconnect</button>
    </form>
    <div class="muted" id="central-msg">Enter a hostname (e.g. pylon-server.duckdns.org) or full wss://.../agent URL.</div>
  </section>
  <div class="grid">
    <section class="card"><h2>Daemon</h2><div class="kv" id="daemon-kv"></div></section>
    <section class="card"><h2>Channel</h2><div class="kv" id="channel-kv"></div></section>
  </div>
  <section class="card"><h2>Connectivity</h2><div id="urls"></div><div class="pills" id="conn-pills"></div></section>
  <section class="card"><h2>Capabilities <span class="muted" id="cap-count"></span></h2><div id="caps"></div></section>
</main>
<script>
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function fmtUp(s){s=Math.max(0,Math.floor(s||0));var h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=s%60;return (h?h+'h ':'')+(m?m+'m ':'')+sec+'s';}
function kv(rows){return rows.map(function(r){return '<div class="k">'+esc(r[0])+'</div><div class="mono">'+esc(r[1])+'</div>';}).join('');}
async function load(){
  try{
    var d=await (await fetch('/api/status',{cache:'no-store'})).json();
    var dm=d.daemon||{}, ch=d.channel||{}, cb=d.central_bootstrap||{}, sc=d.server_conn||{}, net=sc.network||{}, dk=sc.duckdns||{}, ng=sc.ngrok||{};
    document.getElementById('title').textContent='Pylon Daemon — '+(dm.endpoint||'unknown')+' ('+(dm.profile||dm.mode)+')';
    document.getElementById('updated').textContent='Updated '+new Date().toLocaleTimeString();
    document.getElementById('summary').innerHTML=
      '<span class="pill ok">Mode: '+esc(dm.mode)+'</span>'+
      '<span class="pill '+(ch.connected?'ok':'warn')+'">Channel: '+(ch.connected?'connected':'reconnecting')+'</span>'+
      '<span class="pill '+(cb.ok?'ok':'warn')+'">Central: '+esc(cb.service||'pylon-server')+(cb.gateway_version?' v'+esc(cb.gateway_version):'')+(cb.stack_version?' ('+esc(cb.stack_version)+')':'')+'</span>'+
      '<span class="pill">Caps: '+esc((d.capabilities||[]).length)+'</span>'+
      '<span class="pill '+(ng.status==='running'?'ok':(ng.status==='failed'?'bad':''))+'">Ngrok: '+esc(ng.status||'stopped')+'</span>'+
      '<span class="pill '+(dk.enabled?'ok':'')+'">DuckDNS: '+esc(dk.fqdn||'unset')+'</span>';
    document.getElementById('daemon-kv').innerHTML=kv([
      ['Endpoint',dm.endpoint],['Platform',dm.platform],['PID',dm.pid],
      ['Host / User',(dm.hostname||'')+' / '+(dm.user||'')],['Uptime',fmtUp(dm.uptime_seconds)],['Status URL',dm.status_url||'—']
    ]);
    document.getElementById('channel-kv').innerHTML=kv([
      ['Connected',ch.connected?'yes':'no'],['Framework',ch.framework_url||'—'],
      ['Central Host',cb.central_origin||'https://pylon-server.duckdns.org'],
      ['Central Ver',(cb.gateway_version||'—')+(cb.stack_version?' / '+cb.stack_version:'')+(cb.build?' ('+cb.build+')':'')],
      ['Reconnects',ch.reconnects||0],['Last Error',ch.last_error||'—']
    ]);
    var fs=document.getElementById('f-server'), fe=document.getElementById('f-endpoint');
    if(fs && !fs.dataset.dirty && ch.framework_url){ fs.value=ch.framework_url; }
    if(fe && !fe.dataset.dirty && dm.endpoint){ fe.value=dm.endpoint; }
    var urls=net.accessible_urls||[];
    document.getElementById('urls').innerHTML=urls.length?
      '<table><thead><tr><th>Type</th><th>URL</th></tr></thead><tbody>'+urls.map(function(u){
        return '<tr><td>'+esc(u.label)+'</td><td class="mono">'+esc(u.url)+'</td></tr>';
      }).join('')+'</tbody></table>':'<div class="muted">No URLs reported.</div>';
    document.getElementById('conn-pills').innerHTML=
      (net.public_ipv4?'<span class="pill">Public IP: '+esc(net.public_ipv4)+'</span>':'')+
      '<span class="pill">LAN: '+esc((net.lan_ipv4s||[]).join(', ')||'none')+'</span>'+
      (ng.public_url?'<span class="pill ok">Ngrok: '+esc(ng.public_url)+'</span>':'');
    var caps=d.capabilities||[];
    document.getElementById('cap-count').textContent='('+caps.length+')';
    document.getElementById('caps').innerHTML=caps.length?
      '<table><thead><tr><th>Capability</th><th>Methods</th></tr></thead><tbody>'+caps.map(function(c){
        return '<tr><td class="mono">'+esc(c.name)+'</td><td class="mono">'+esc((c.methods||[]).join(', '))+'</td></tr>';
      }).join('')+'</tbody></table>':'<div class="muted">None</div>';
  }catch(e){document.getElementById('updated').textContent='Error: '+e;}
}
document.getElementById('refresh').addEventListener('click',load);
['f-server','f-endpoint'].forEach(function(id){var el=document.getElementById(id);if(el)el.addEventListener('input',function(){el.dataset.dirty='1';});});
document.getElementById('central-form').addEventListener('submit',async function(ev){
  ev.preventDefault();
  var msg=document.getElementById('central-msg');
  var body={central_server:document.getElementById('f-server').value.trim(), endpoint_id:document.getElementById('f-endpoint').value.trim()};
  var tok=document.getElementById('f-token').value.trim();
  if(tok) body.token=tok;
  msg.textContent='Saving and reconnecting...';
  try{
    var r=await fetch('/api/client-config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    var d=await r.json();
    if(!r.ok||!d.ok){msg.textContent='Error: '+(d.error||('HTTP '+r.status));return;}
    document.getElementById('f-token').value='';
    document.getElementById('f-server').dataset.dirty='';
    document.getElementById('f-endpoint').dataset.dirty='';
    msg.textContent='Saved: '+d.framework_url+' — reconnecting...';
    load();
  }catch(e){msg.textContent='Error: '+e;}
});
setInterval(function(){if(document.getElementById('auto').checked)load();},5000);
load();
</script>
</body>
</html>
"""

_ACTIVE_LOCK = threading.RLock()
_ACTIVE_SNAPSHOT_FN: Callable[[], dict[str, Any]] | None = None


def register_active_snapshot(fn: Callable[[], dict[str, Any]] | None) -> None:
    global _ACTIVE_SNAPSHOT_FN
    with _ACTIVE_LOCK:
        _ACTIVE_SNAPSHOT_FN = fn


def get_active_snapshot() -> dict[str, Any] | None:
    with _ACTIVE_LOCK:
        fn = _ACTIVE_SNAPSHOT_FN
    return fn() if fn is not None else None


def resolve_status_port(
    cfg: dict[str, Any] | None,
    *,
    daemon_mode: str = "client",
    default_port: int = 18772,
) -> int | None:
    """Return desired status port, or None if explicitly disabled.

    Enabled by default in both `client` and `server` modes on loopback (default 18772)
    so the static workspace UI can always inspect local daemon status.
    Set PYLON2_DAEMON_STATUS_PORT=0 or status_port=0 to disable.
    """
    raw = os.environ.get("PYLON2_DAEMON_STATUS_PORT")
    if raw is None and isinstance(cfg, dict):
        raw = cfg.get("status_port")
    if raw is None or raw == "":
        return default_port
    s = str(raw).strip().lower()
    if s in ("0", "off", "false", "no", "none", "disabled"):
        return None
    port = int(s)
    return port if 1 <= port <= 65535 else default_port


class DaemonStatusState:
    """Thread-safe live state container updated by the daemon loop."""

    def __init__(self, *, endpoint: str, platform: str, mode: str, framework_url: str = ""):
        self._lock = threading.RLock()
        self.started_at = time.time()
        self.endpoint = endpoint
        self.platform = platform
        self.mode = mode  # 'full' or 'standalone'
        self.framework_url = framework_url
        self.connected = False
        self.last_connected_at: float | None = None
        self.last_disconnect_at: float | None = None
        self.reconnects = 0
        self.last_error = ""
        self.status_url = ""

    def set_connected(self, framework_url: str = "") -> None:
        with self._lock:
            if self.last_connected_at is not None:
                self.reconnects += 1
            self.connected = True
            if framework_url:
                self.framework_url = framework_url
            self.last_connected_at = time.time()
            self.last_error = ""

    def set_disconnected(self, error: str = "") -> None:
        with self._lock:
            self.connected = False
            self.last_disconnect_at = time.time()
            if error:
                self.last_error = str(error)[:300]

    def snapshot(
        self,
        *,
        capabilities_fn: Callable[[], list[dict[str, Any]]] | None = None,
        server: Any = None,
    ) -> dict[str, Any]:
        with self._lock:
            now = time.time()
            daemon_info = {
                "endpoint": self.endpoint,
                "platform": self.platform,
                "profile": self.mode,
                "mode": self.mode,
                "pid": os.getpid(),
                "hostname": socket.gethostname(),
                "user": getpass.getuser(),
                "started_at": self.started_at,
                "uptime_seconds": round(now - self.started_at, 1),
                "status_url": self.status_url,
            }
            channel_info = {
                "connected": self.connected,
                "framework_url": self.framework_url,
                "last_connected_at": self.last_connected_at,
                "last_disconnect_at": self.last_disconnect_at,
                "reconnects": self.reconnects,
                "last_error": self.last_error,
            }

        server_info = None
        if server is not None:
            proc = getattr(server, "proc", None)
            alive = bool(proc and proc.poll() is None)
            healthy = False
            try:
                healthy = bool(server.healthy(timeout=1))
            except Exception:
                healthy = False
            server_info = {
                "host": getattr(server, "host", ""),
                "port": getattr(server, "port", 0),
                "http_url": getattr(server, "http_url", ""),
                "pid": proc.pid if proc else None,
                "alive": alive,
                "healthy": healthy,
                "restarts": getattr(server, "restarts", 0),
            }

        caps = capabilities_fn() if capabilities_fn else []
        central_info: dict[str, Any] = {}
        try:
            import serve_mode

            central_info = serve_mode.fetch_central_bootstrap()
        except Exception:
            central_info = {}
        conn_snap: dict[str, Any] = {}
        try:
            import server_conn_runtime

            conn_snap = server_conn_runtime.get_runtime().status()
        except Exception:
            conn_snap = {}

        return {
            "ok": True,
            "daemon": daemon_info,
            "channel": channel_info,
            "central_bootstrap": central_info,
            "server": server_info,
            "capabilities": caps,
            "server_conn": conn_snap,
        }


class _LoopbackHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = os.name != "nt"
    daemon_threads = True


class DaemonStatusServer:
    """Background ThreadingHTTPServer bound strictly to 127.0.0.1."""

    def __init__(
        self,
        state: DaemonStatusState,
        *,
        capabilities_fn: Callable[[], list[dict[str, Any]]] | None = None,
        server: Any = None,
        port: int | None = 18772,
        on_client_config_update: Callable[[str, dict[str, str], str], None] | None = None,
        log: Callable[[str], Any] = print,
    ):
        self.state = state
        self.capabilities_fn = capabilities_fn
        self.local_server = server
        self.requested_port = port
        self.on_client_config_update = on_client_config_update
        self.log = log
        self._httpd: ThreadingHTTPServer | None = None
        self._thread: threading.Thread | None = None
        self.port: int | None = None

        register_active_snapshot(
            lambda: self.state.snapshot(
                capabilities_fn=self.capabilities_fn,
                server=self.local_server,
            )
        )

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}" if self.port else ""

    def start(self) -> "DaemonStatusServer":
        if self.requested_port is None:
            return self
        parent = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, fmt: str, *args: Any) -> None:
                return

            def _cors_origin(self) -> str:
                origin = (self.headers.get("Origin") or "").strip().rstrip("/")
                if not origin:
                    return ""
                allowed_raw = os.environ.get("PYLON_STATIC_CLIENT_ORIGINS", "https://ai-pylon.github.io")
                allowed = {x.strip().rstrip("/") for x in allowed_raw.split(",") if x.strip()}
                return origin if origin in allowed else ""

            def _send(self, status: int, content_type: str, body: bytes) -> None:
                cors_origin = self._cors_origin()
                self.send_response(status)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                if cors_origin:
                    self.send_header("Access-Control-Allow-Origin", cors_origin)
                    self.send_header("Vary", "Origin")
                self.end_headers()
                self.wfile.write(body)

            def do_OPTIONS(self) -> None:
                cors_origin = self._cors_origin()
                self.send_response(204)
                if cors_origin:
                    self.send_header("Access-Control-Allow-Origin", cors_origin)
                    self.send_header("Vary", "Origin")
                    self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                    self.send_header("Access-Control-Allow-Headers", "Content-Type")
                    self.send_header("Access-Control-Max-Age", "600")
                    if (self.headers.get("Access-Control-Request-Private-Network") or "").strip().lower() == "true":
                        self.send_header("Access-Control-Allow-Private-Network", "true")
                self.send_header("Content-Length", "0")
                self.end_headers()

            def do_GET(self) -> None:
                path = self.path.split("?", 1)[0]
                if path == "/health":
                    payload = json.dumps(
                        {"ok": True, "endpoint": parent.state.endpoint, "profile": parent.state.mode, "pid": os.getpid()}
                    ).encode("utf-8")
                    self._send(200, "application/json; charset=utf-8", payload)
                elif path == "/api/status":
                    snap = parent.state.snapshot(
                        capabilities_fn=parent.capabilities_fn,
                        server=parent.local_server,
                    )
                    self._send(200, "application/json; charset=utf-8", json.dumps(snap, indent=2).encode("utf-8"))
                elif path in ("/", "/index.html"):
                    self._send(200, "text/html; charset=utf-8", _STANDALONE_HTML.encode("utf-8"))
                else:
                    self._send(404, "application/json; charset=utf-8", b'{"ok":false,"error":"not_found"}')

            def do_POST(self) -> None:
                path = self.path.split("?", 1)[0]
                if path != "/api/client-config":
                    self._send(404, "application/json; charset=utf-8", b'{"ok":false,"error":"not_found"}')
                    return
                if parent.state.mode != "client":
                    self._send(400, "application/json; charset=utf-8", b'{"ok":false,"error":"Only available in client mode"}')
                    return
                try:
                    length = min(int(self.headers.get("Content-Length") or 0), 65536)
                    raw = self.rfile.read(length).decode("utf-8", errors="replace") if length > 0 else "{}"
                    body = json.loads(raw or "{}")
                    import serve_mode

                    saved = serve_mode.save_client_config(
                        body.get("central_server") or "",
                        endpoint_id=body.get("endpoint_id"),
                        token=body.get("token"),
                    )
                    new_url = saved["framework_url"]
                    new_endpoint = saved.get("endpoint_id") or parent.state.endpoint
                    new_headers = serve_mode.auth_headers(serve_mode.passive_token({}))
                    with parent.state._lock:
                        parent.state.framework_url = new_url
                        parent.state.endpoint = new_endpoint
                    if parent.on_client_config_update is not None:
                        parent.on_client_config_update(new_url, new_headers, new_endpoint)
                    reply = {"ok": True, "framework_url": new_url, "endpoint_id": new_endpoint}
                    self._send(200, "application/json; charset=utf-8", json.dumps(reply).encode("utf-8"))
                except Exception as exc:  # noqa: BLE001
                    err = json.dumps({"ok": False, "error": str(exc)}).encode("utf-8")
                    self._send(400, "application/json; charset=utf-8", err)

        candidates = [self.requested_port, self.requested_port + 1, self.requested_port + 2, 0]
        last_err: Exception | None = None
        for cand in candidates:
            if cand > 65535:
                continue
            try:
                httpd = _LoopbackHTTPServer(("127.0.0.1", cand), Handler)
                self._httpd = httpd
                self.port = httpd.server_address[1]
                self.state.status_url = self.url
                self._thread = threading.Thread(
                    target=httpd.serve_forever,
                    name="pylon-daemon-status-http",
                    daemon=True,
                )
                self._thread.start()
                self.log(f"[status-http] standalone status page listening on {self.url}")
                return self
            except OSError as exc:
                last_err = exc
        self.log(f"[status-http] WARN: could not bind daemon status server: {last_err}")
        return self

    def stop(self) -> None:
        if self._httpd is not None:
            try:
                self._httpd.shutdown()
                self._httpd.server_close()
            except Exception:
                pass
            self._httpd = None
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2)
        self._thread = None
