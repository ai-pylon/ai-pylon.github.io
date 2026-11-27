"""Shared server connectivity runtime for Pylon daemons (Linux & Windows).

Manages:
1. Accessible IP / URL discovery for the current HTTP server (loopback, LAN,
   public/GCE IPv4, configured public origins, DuckDNS, ngrok).
2. DuckDNS periodic & on-demand dynamic DNS updates (token stored in a 0600
   host-local secret file or DUCKDNS_TOKEN env var; never returned in API).
3. Managed ngrok HTTP tunnel lifecycle, modeled after workspace_mcp/tunnel.py
   (loopback agent API discovery, ERR_NGROK_* extraction without credential
   logging, Windows Job Object / Linux process-group cleanup, exponential
   backoff reconnect).

Stdlib-only so both daemons/linux and daemons/windows can import it directly.
"""
from __future__ import annotations

import ipaddress
import json
import logging
import os
import re
import shutil
import socket
import subprocess
import threading
import time
from pathlib import Path
from typing import Any
from urllib.error import URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

LOG = logging.getLogger("pylon-server-conn")

REPO = Path(__file__).resolve().parents[1]
_DOMAIN_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}$")
_HOST_BIND_RE = re.compile(r"^[A-Za-z0-9.:_-]{1,128}$")
_ERR_NGROK_RE = re.compile(rb"ERR_NGROK_\d+")


class TunnelConfigurationError(RuntimeError):
    """A configuration conflict that automatic retries cannot safely repair."""


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def _no_proxy_opener():
    return build_opener(ProxyHandler({}), _NoRedirect())


def default_data_dir() -> Path:
    env_data = os.environ.get("PYLON2_DATA_DIR", "").strip()
    if env_data:
        return Path(env_data).expanduser()
    home_pylon = Path.home() / "pylon-server"
    if os.name == "nt" or (home_pylon / "data").is_dir():
        return home_pylon / "data"
    return REPO / "data"


def default_config_dir() -> Path:
    env_dir = os.environ.get("PYLON_SERVER_CONN_DIR", "").strip()
    if env_dir:
        return Path(env_dir).expanduser()
    return default_data_dir() / "host-config" / "apps" / "system" / "server_conn"


def _default_config(server_host: str = "127.0.0.1", server_port: int = 8910) -> dict[str, Any]:
    return {
        "server": {
            "bind_host": server_host,
            "port": int(server_port),
            "public_base": os.environ.get("PYLON2_PUBLIC_BASE", "").strip(),
        },
        "duckdns": {
            "enabled": False,
            "domain": "",
            "interval_seconds": 300,
            "ip_override": "",
        },
        "ngrok": {
            "enabled": False,
            "url": "",
            "port": int(server_port),
            "executable": "ngrok",
            "agent_api_url": "http://127.0.0.1:4040",
            "startup_timeout_seconds": 30,
            "reconnect_attempts": 5,
            "reconnect_delay_seconds": 1.0,
        },
    }


def validate_https_origin(url: str) -> str:
    val = (url or "").strip().rstrip("/")
    if not val:
        return ""
    parsed = urlsplit(val)
    if parsed.scheme != "https" or not parsed.hostname or parsed.path not in ("", "/") or parsed.query or parsed.fragment:
        raise ValueError("ngrok.url must be an HTTPS origin (e.g. https://example.ngrok-free.app)")
    if parsed.username or parsed.password:
        raise ValueError("ngrok.url must not contain credentials")
    return val


def validate_loopback_http_origin(url: str) -> str:
    val = (url or "http://127.0.0.1:4040").strip().rstrip("/")
    parsed = urlsplit(val)
    if parsed.scheme != "http" or parsed.hostname not in ("127.0.0.1", "localhost", "::1"):
        raise ValueError("ngrok.agent_api_url must be a loopback HTTP origin")
    if parsed.path not in ("", "/") or parsed.query or parsed.fragment or parsed.username or parsed.password:
        raise ValueError("ngrok.agent_api_url must be a clean loopback origin")
    return val


def validate_duckdns_domain(domain: str) -> str:
    val = (domain or "").strip().lower()
    if val.endswith(".duckdns.org"):
        val = val[: -len(".duckdns.org")]
    if not val:
        return ""
    if not _DOMAIN_RE.match(val):
        raise ValueError("Invalid DuckDNS subdomain (lowercase letters, digits, hyphens; 1-63 chars)")
    return val


def discover_lan_ipv4s() -> list[str]:
    ips: set[str] = set()
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if ip and not ip.startswith("127.") and not ip.startswith("169.254."):
                ips.add(ip)
    except OSError:
        pass
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            ip = s.getsockname()[0]
            if ip and not ip.startswith("127."):
                ips.add(ip)
    except OSError:
        pass
    return sorted(ips)


def detect_public_ipv4() -> tuple[str, str]:
    """Return (ip, source) trying GCE metadata first, then ipify."""
    opener = _no_proxy_opener()
    try:
        req = Request(
            "http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip",
            headers={"Metadata-Flavor": "Google"},
        )
        with opener.open(req, timeout=2) as resp:
            raw = resp.read(64).decode("utf-8", errors="replace").strip()
            ip = ipaddress.IPv4Address(raw)
            if ip.is_global:
                return str(ip), "gce_metadata"
    except Exception:
        pass
    try:
        with opener.open("https://api.ipify.org", timeout=3) as resp:
            raw = resp.read(64).decode("utf-8", errors="replace").strip()
            ip = ipaddress.IPv4Address(raw)
            if ip.is_global:
                return str(ip), "ipify"
    except Exception:
        pass
    return "", ""


def resolve_ipv4(hostname: str) -> list[str]:
    try:
        return sorted({x[4][0] for x in socket.getaddrinfo(hostname, None, socket.AF_INET)})
    except OSError:
        return []


def _windows_kill_on_close_job():
    import ctypes
    from ctypes import wintypes

    k32 = ctypes.WinDLL("kernel32", use_last_error=True)

    class BASIC(ctypes.Structure):
        _fields_ = [
            ("PerProcessUserTimeLimit", ctypes.c_int64),
            ("PerJobUserTimeLimit", ctypes.c_int64),
            ("LimitFlags", wintypes.DWORD),
            ("MinimumWorkingSetSize", ctypes.c_size_t),
            ("MaximumWorkingSetSize", ctypes.c_size_t),
            ("ActiveProcessLimit", wintypes.DWORD),
            ("Affinity", ctypes.c_size_t),
            ("PriorityClass", wintypes.DWORD),
            ("SchedulingClass", wintypes.DWORD),
        ]

    class IO(ctypes.Structure):
        _fields_ = [(n, ctypes.c_uint64) for n in ("r", "w", "o", "rb", "wb", "ob")]

    class EXTENDED(ctypes.Structure):
        _fields_ = [
            ("BasicLimitInformation", BASIC),
            ("IoInfo", IO),
            ("ProcessMemoryLimit", ctypes.c_size_t),
            ("JobMemoryLimit", ctypes.c_size_t),
            ("PeakProcessMemoryUsed", ctypes.c_size_t),
            ("PeakJobMemoryUsed", ctypes.c_size_t),
        ]

    k32.CreateJobObjectW.restype = wintypes.HANDLE
    job = k32.CreateJobObjectW(None, None)
    if not job:
        return None
    info = EXTENDED()
    info.BasicLimitInformation.LimitFlags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    if not k32.SetInformationJobObject(wintypes.HANDLE(job), 9, ctypes.byref(info), ctypes.sizeof(info)):
        k32.CloseHandle(wintypes.HANDLE(job))
        return None
    return job


def _windows_assign_job(job, proc) -> None:
    import ctypes
    from ctypes import wintypes

    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    k32.OpenProcess.restype = wintypes.HANDLE
    h = k32.OpenProcess(0x0101, False, proc.pid)
    if h:
        k32.AssignProcessToJobObject(wintypes.HANDLE(job), wintypes.HANDLE(h))
        k32.CloseHandle(wintypes.HANDLE(h))


def _windows_close_job(job) -> None:
    import ctypes
    from ctypes import wintypes

    ctypes.WinDLL("kernel32", use_last_error=True).CloseHandle(wintypes.HANDLE(job))


class NgrokTunnelSupervisor:
    """Thread-supervised ngrok HTTP tunnel with loopback agent API discovery."""

    def __init__(self, cfg: dict[str, Any], default_port: int):
        self._lock = threading.RLock()
        self._stop_ev = threading.Event()
        self._thread: threading.Thread | None = None
        self._proc: subprocess.Popen | None = None
        self._job = None
        self._reader: threading.Thread | None = None
        self._http = _no_proxy_opener()

        self.status = "stopped"
        self.error: str | None = None
        self.error_code: str | None = None
        self.owned = False
        self.retries = 0
        self.next_retry_at: float | None = None
        self.last_connected_at: float | None = None
        self.public_url = ""

        self.apply_config(cfg, default_port)

    def apply_config(self, cfg: dict[str, Any], default_port: int) -> None:
        with self._lock:
            self.enabled = bool(cfg.get("enabled"))
            self.url = validate_https_origin(cfg.get("url", ""))
            port_val = cfg.get("port")
            self.port = int(port_val) if port_val else int(default_port)
            if not (1 <= self.port <= 65535):
                raise ValueError("ngrok.port must be between 1 and 65535")
            self.executable = (cfg.get("executable") or "ngrok").strip()
            self.api_url = validate_loopback_http_origin(cfg.get("agent_api_url", "http://127.0.0.1:4040"))
            self.timeout = max(1.0, min(float(cfg.get("startup_timeout_seconds", 30)), 120.0))
            self.max_retries = max(0, min(int(cfg.get("reconnect_attempts", 5)), 20))
            self.retry_base = max(0.1, min(float(cfg.get("reconnect_delay_seconds", 1.0)), 60.0))

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return {
                "enabled": self.enabled,
                "status": self.status,
                "url": self.url,
                "public_url": self.public_url or self.url,
                "port": self.port,
                "executable": self.executable,
                "executable_found": bool(shutil.which(self.executable)),
                "agent_api_url": self.api_url,
                "owned": self.owned,
                "error": self.error,
                "error_code": self.error_code,
                "retries": self.retries,
                "next_retry_at": self.next_retry_at,
                "last_connected_at": self.last_connected_at,
                "reconnect_attempts": self.max_retries,
                "startup_timeout_seconds": self.timeout,
            }

    def _json(self, url: str) -> dict[str, Any] | None:
        try:
            with self._http.open(url, timeout=1.5) as resp:
                body = resp.read(262145)
                if len(body) > 262144:
                    raise RuntimeError("ngrok discovery response exceeds size limit")
                return json.loads(body)
        except (URLError, OSError, ValueError):
            return None

    def _discover_matching_url(self) -> tuple[bool | None, str]:
        """Return (True, url) if matching tunnel is live, (False, '') if agent is up without it, (None, '') if agent not reachable."""
        data = self._json(self.api_url + "/api/endpoints")
        if isinstance(data, dict) and isinstance(data.get("endpoints"), list):
            for ep in data["endpoints"]:
                if not isinstance(ep, dict):
                    continue
                ep_url = str(ep.get("url", "")).rstrip("/")
                if self.url and ep_url != self.url:
                    continue
                upstream = ep.get("upstream", {})
                target = urlsplit(upstream.get("url", "") if isinstance(upstream, dict) else "")
                if (
                    target.scheme == "http"
                    and target.hostname in ("localhost", "127.0.0.1")
                    and target.port == self.port
                    and target.path in ("", "/")
                ):
                    return True, ep_url
                if self.url and ep_url == self.url:
                    raise TunnelConfigurationError(
                        f"Existing ngrok domain points to a different upstream; expected local port {self.port}"
                    )
            return False, ""

        tdata = self._json(self.api_url + "/api/tunnels")
        if isinstance(tdata, dict) and isinstance(tdata.get("tunnels"), list):
            for tun in tdata["tunnels"]:
                if not isinstance(tun, dict):
                    continue
                pub = str(tun.get("public_url", "")).rstrip("/")
                if not pub.startswith("https://"):
                    continue
                if self.url and pub != self.url:
                    continue
                addr = str((tun.get("config") or {}).get("addr", ""))
                if addr.endswith(f":{self.port}") or addr == str(self.port):
                    return True, pub
            return False, ""
        return None, ""

    def _launch(self) -> None:
        exe = shutil.which(self.executable)
        if not exe:
            raise TunnelConfigurationError(
                f"ngrok executable '{self.executable}' not found in PATH; install ngrok or set executable path"
            )
        argv = [exe, "http", str(self.port)]
        if self.url:
            argv.extend(["--url", self.url])
        argv.extend(["--inspect=false", "--log=stdout", "--log-format=json"])
        opts: dict[str, Any] = (
            {"creationflags": subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP}
            if os.name == "nt"
            else {"start_new_session": True}
        )
        proc = subprocess.Popen(
            argv,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            **opts,
        )
        self._proc = proc
        self.owned = True
        if os.name == "nt":
            try:
                self._job = _windows_kill_on_close_job()
                if self._job:
                    _windows_assign_job(self._job, proc)
            except Exception:
                self._job = None

        def drain() -> None:
            if not proc.stdout:
                return
            try:
                while True:
                    chunk = proc.stdout.read1(4096) if hasattr(proc.stdout, "read1") else proc.stdout.read(4096)
                    if not chunk:
                        break
                    m = _ERR_NGROK_RE.search(chunk)
                    if m:
                        self.error_code = m.group(0).decode("ascii")
            finally:
                try:
                    proc.stdout.close()
                except OSError:
                    pass

        self._reader = threading.Thread(target=drain, name="pylon-ngrok-output", daemon=True)
        self._reader.start()

    def _close_proc(self) -> None:
        if self.owned and self._proc:
            proc = self._proc
            if self._job:
                try:
                    _windows_close_job(self._job)
                except Exception:
                    pass
                self._job = None
            elif proc.poll() is None:
                if os.name == "nt":
                    subprocess.run(
                        ["taskkill", "/PID", str(proc.pid), "/T", "/F"],
                        capture_output=True,
                        timeout=5,
                        creationflags=subprocess.CREATE_NO_WINDOW,
                    )
                else:
                    import signal

                    try:
                        os.killpg(proc.pid, signal.SIGTERM)
                    except ProcessLookupError:
                        pass
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                if os.name == "nt":
                    proc.kill()
                else:
                    import signal

                    try:
                        os.killpg(proc.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    pass
            if self._reader:
                self._reader.join(timeout=2)
        self._proc = None
        self._reader = None
        self.owned = False

    def _start_once(self) -> str:
        self.status = "starting"
        self.error_code = None
        found, pub_url = self._discover_matching_url()
        if found is True:
            self.public_url = pub_url
            self.status = "running"
            return pub_url
        if found is False:
            raise TunnelConfigurationError(
                "An ngrok agent is already running on this machine without the requested endpoint"
            )
        self._launch()
        deadline = time.monotonic() + self.timeout
        while time.monotonic() < deadline and not self._stop_ev.is_set():
            if self._proc and self._proc.poll() is not None:
                if self._reader:
                    self._reader.join(timeout=1)
                detail = f"; {self.error_code}" if self.error_code else ""
                raise RuntimeError(
                    f"ngrok exited with code {self._proc.returncode}{detail}; check ngrok installation and authtoken"
                )
            found, pub_url = self._discover_matching_url()
            if found is True:
                self.public_url = pub_url
                self.status = "running"
                return pub_url
            time.sleep(0.2)
        raise RuntimeError("ngrok did not publish an endpoint before the startup timeout")

    def _run_loop(self) -> None:
        try:
            while not self._stop_ev.is_set():
                try:
                    self._start_once()
                    self.error = None
                    self.next_retry_at = None
                    self.last_connected_at = time.time()
                    connected = time.monotonic()
                    while not self._stop_ev.wait(2.0):
                        found, pub_url = self._discover_matching_url()
                        if (self._proc and self._proc.poll() is not None) or found is not True:
                            raise RuntimeError("The ngrok tunnel stopped")
                        if pub_url:
                            self.public_url = pub_url
                        if time.monotonic() - connected >= 60:
                            self.retries = 0
                except Exception as exc:  # noqa: BLE001
                    self.error = str(exc)
                    self._close_proc()
                    if (
                        self._stop_ev.is_set()
                        or isinstance(exc, TunnelConfigurationError)
                        or self.error_code
                        or self.retries >= self.max_retries
                    ):
                        if not self._stop_ev.is_set():
                            self.status = "failed"
                            self.next_retry_at = None
                            LOG.error("[server_conn] ngrok failed: %s", self.error)
                        return
                    self.retries += 1
                    delay = min(30.0, self.retry_base * (2 ** (self.retries - 1)))
                    self.status = "reconnecting"
                    self.next_retry_at = time.time() + delay
                    LOG.warning("[server_conn] ngrok reconnect %s/%s in %.1fs: %s", self.retries, self.max_retries, delay, self.error)
                    if self._stop_ev.wait(delay):
                        return
        finally:
            self._close_proc()
            if self.status != "failed":
                self.status = "stopped"

    def start(self) -> dict[str, Any]:
        with self._lock:
            if self._thread and self._thread.is_alive():
                return self.snapshot()
            self._stop_ev.clear()
            self.retries = 0
            self.error = None
            self.error_code = None
            self.status = "starting"
            self._thread = threading.Thread(target=self._run_loop, name="pylon-ngrok-supervisor", daemon=True)
            self._thread.start()
        # Brief wait so immediate failures or fast starts reflect in the response
        deadline = time.monotonic() + min(4.0, self.timeout)
        while time.monotonic() < deadline:
            snap = self.snapshot()
            if snap["status"] in ("running", "failed", "stopped"):
                return snap
            time.sleep(0.15)
        return self.snapshot()

    def stop(self) -> dict[str, Any]:
        with self._lock:
            self._stop_ev.set()
            t = self._thread
        if t and t.is_alive():
            t.join(timeout=8)
        with self._lock:
            self._close_proc()
            self._thread = None
            self.public_url = ""
            self.next_retry_at = None
            self.status = "stopped"
            return self.snapshot()


class ServerConnRuntime:
    """Host-level runtime owned by the daemon (and importable as standalone fallback)."""

    def __init__(self, config_dir: Path | None = None, server_host: str = "", server_port: int = 0):
        self._lock = threading.RLock()
        self.config_dir = Path(config_dir) if config_dir else default_config_dir()
        self.config_path = self.config_dir / "config.json"
        self.token_path = self.config_dir / ".duckdns-token"

        self.runtime_host = (server_host or os.environ.get("PYLON2_SERVER_HOST") or "127.0.0.1").strip()
        self.runtime_port = int(server_port or os.environ.get("PYLON2_SERVER_PORT") or 8910)

        self.cfg = self._load_config()
        self._duck_stop = threading.Event()
        self._duck_thread: threading.Thread | None = None
        self.duck_last_update_at: float | None = None
        self.duck_last_result: str = ""
        self.duck_last_ip: str = ""
        self.duck_last_error: str = ""

        self.ngrok = NgrokTunnelSupervisor(self.cfg["ngrok"], self.runtime_port)

    def _load_config(self) -> dict[str, Any]:
        base = _default_config(self.runtime_host, self.runtime_port)
        if self.config_path.is_file():
            try:
                raw = json.loads(self.config_path.read_text(encoding="utf-8"))
                if isinstance(raw, dict):
                    for section in ("server", "duckdns", "ngrok"):
                        if isinstance(raw.get(section), dict):
                            base[section].update(raw[section])
            except Exception as exc:
                LOG.warning("[server_conn] ignoring invalid config %s: %s", self.config_path, exc)
        return base

    def _save_config(self) -> None:
        self.config_dir.mkdir(parents=True, exist_ok=True)
        tmp = self.config_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.cfg, indent=2) + "\n", encoding="utf-8")
        tmp.replace(self.config_path)

    def _read_duckdns_token(self) -> str:
        env_tok = os.environ.get("DUCKDNS_TOKEN", "").strip()
        if env_tok:
            return env_tok
        try:
            if self.token_path.is_file():
                return self.token_path.read_text(encoding="utf-8").strip()
        except OSError:
            pass
        return ""

    def _write_duckdns_token(self, token: str) -> None:
        self.config_dir.mkdir(parents=True, exist_ok=True)
        tok = (token or "").strip()
        if not tok:
            return
        self.token_path.write_text(tok + "\n", encoding="utf-8")
        if os.name != "nt":
            try:
                os.chmod(self.token_path, 0o600)
            except OSError:
                pass

    def start_background(self) -> None:
        if self.cfg["duckdns"].get("enabled"):
            self._ensure_duckdns_thread()
        if self.cfg["ngrok"].get("enabled"):
            self.ngrok.start()

    def shutdown(self) -> None:
        self._duck_stop.set()
        if self._duck_thread and self._duck_thread.is_alive():
            self._duck_thread.join(timeout=3)
        self._duck_thread = None
        self.ngrok.stop()

    def _ensure_duckdns_thread(self) -> None:
        with self._lock:
            if self._duck_thread and self._duck_thread.is_alive():
                return
            self._duck_stop.clear()
            self._duck_thread = threading.Thread(target=self._duckdns_loop, name="pylon-duckdns-updater", daemon=True)
            self._duck_thread.start()

    def _duckdns_loop(self) -> None:
        while not self._duck_stop.is_set():
            if self.cfg["duckdns"].get("enabled") and self.cfg["duckdns"].get("domain"):
                try:
                    self.duckdns_update()
                except Exception as exc:
                    self.duck_last_error = str(exc)
            interval = max(60, int(self.cfg["duckdns"].get("interval_seconds") or 300))
            if self._duck_stop.wait(interval):
                return

    def network_info(self) -> dict[str, Any]:
        lan_ips = discover_lan_ipv4s()
        pub_ip, pub_src = detect_public_ipv4()
        port = self.runtime_port
        bind_host = self.runtime_host
        urls: list[dict[str, str]] = [
            {"kind": "loopback", "label": "Loopback", "url": f"http://127.0.0.1:{port}"}
        ]
        for ip in lan_ips:
            urls.append({"kind": "lan", "label": f"LAN ({ip})", "url": f"http://{ip}:{port}"})
        if pub_ip:
            urls.append({"kind": "public_ip", "label": f"Public IP ({pub_src})", "url": f"http://{pub_ip}:{port}"})
        for env_key, label in (
            ("PYLON2_PUBLIC_BASE", "Configured Public Base"),
            ("PYLON_UPSTREAM_ORIGIN", "Upstream Origin"),
            ("PYLON_FRONTEND_API_ORIGIN", "Frontend API Origin"),
        ):
            val = os.environ.get(env_key, "").strip().rstrip("/")
            if val and not any(u["url"] == val for u in urls):
                urls.append({"kind": "public_origin", "label": label, "url": val})
        custom_base = (self.cfg["server"].get("public_base") or "").strip().rstrip("/")
        if custom_base and not any(u["url"] == custom_base for u in urls):
            urls.append({"kind": "configured", "label": "Saved Public Base", "url": custom_base})

        domain = self.cfg["duckdns"].get("domain") or ""
        if domain:
            fqdn = f"{domain}.duckdns.org"
            urls.append({"kind": "duckdns", "label": "DuckDNS", "url": f"https://{fqdn}"})

        ng = self.ngrok.snapshot()
        if ng.get("public_url"):
            urls.append({"kind": "ngrok", "label": f"Ngrok ({ng['status']})", "url": ng["public_url"]})

        return {
            "ok": True,
            "hostname": socket.gethostname(),
            "runtime_bind_host": bind_host,
            "runtime_port": port,
            "configured_bind_host": self.cfg["server"].get("bind_host", bind_host),
            "configured_port": int(self.cfg["server"].get("port") or port),
            "restart_required": (
                self.cfg["server"].get("bind_host", bind_host) != bind_host
                or int(self.cfg["server"].get("port") or port) != port
            ),
            "lan_ipv4s": lan_ips,
            "public_ipv4": pub_ip,
            "public_ipv4_source": pub_src,
            "accessible_urls": urls,
        }

    def duckdns_snapshot(self) -> dict[str, Any]:
        d = self.cfg["duckdns"]
        domain = d.get("domain") or ""
        fqdn = f"{domain}.duckdns.org" if domain else ""
        return {
            "enabled": bool(d.get("enabled")),
            "domain": domain,
            "fqdn": fqdn,
            "interval_seconds": int(d.get("interval_seconds") or 300),
            "ip_override": d.get("ip_override") or "",
            "token_configured": bool(self._read_duckdns_token()),
            "dns_ipv4": resolve_ipv4(fqdn) if fqdn else [],
            "last_update_at": self.duck_last_update_at,
            "last_result": self.duck_last_result,
            "last_ip": self.duck_last_ip,
            "last_error": self.duck_last_error,
        }

    def status(self) -> dict[str, Any]:
        net = self.network_info()
        return {
            "ok": True,
            "config_path": str(self.config_path),
            "server": {
                "runtime_bind_host": net["runtime_bind_host"],
                "runtime_port": net["runtime_port"],
                "configured_bind_host": net["configured_bind_host"],
                "configured_port": net["configured_port"],
                "public_base": self.cfg["server"].get("public_base", ""),
                "restart_required": net["restart_required"],
            },
            "network": net,
            "duckdns": self.duckdns_snapshot(),
            "ngrok": self.ngrok.snapshot(),
        }

    def configure_server(
        self,
        *,
        bind_host: str | None = None,
        port: int | None = None,
        public_base: str | None = None,
    ) -> dict[str, Any]:
        with self._lock:
            if bind_host is not None:
                val = bind_host.strip()
                if not _HOST_BIND_RE.match(val):
                    raise ValueError("Invalid bind_host")
                self.cfg["server"]["bind_host"] = val
            if port is not None:
                p = int(port)
                if not (1 <= p <= 65535):
                    raise ValueError("port must be between 1 and 65535")
                self.cfg["server"]["port"] = p
            if public_base is not None:
                pb = public_base.strip().rstrip("/")
                if pb and not (pb.startswith("http://") or pb.startswith("https://")):
                    raise ValueError("public_base must start with http:// or https://")
                self.cfg["server"]["public_base"] = pb
            self._save_config()
            return self.status()

    def duckdns_configure(
        self,
        *,
        enabled: bool | None = None,
        domain: str | None = None,
        interval_seconds: int | None = None,
        ip_override: str | None = None,
        token: str | None = None,
    ) -> dict[str, Any]:
        with self._lock:
            if domain is not None:
                self.cfg["duckdns"]["domain"] = validate_duckdns_domain(domain)
            if interval_seconds is not None:
                self.cfg["duckdns"]["interval_seconds"] = max(60, min(86400, int(interval_seconds)))
            if ip_override is not None:
                ov = ip_override.strip()
                if ov:
                    ipaddress.IPv4Address(ov)
                self.cfg["duckdns"]["ip_override"] = ov
            if token is not None and token.strip():
                self._write_duckdns_token(token.strip())
            if enabled is not None:
                self.cfg["duckdns"]["enabled"] = bool(enabled)
            self._save_config()
            if self.cfg["duckdns"]["enabled"]:
                self._ensure_duckdns_thread()
            else:
                self._duck_stop.set()
            return {"ok": True, "duckdns": self.duckdns_snapshot()}

    def duckdns_update(self) -> dict[str, Any]:
        d = self.cfg["duckdns"]
        domain = validate_duckdns_domain(d.get("domain") or "")
        if not domain:
            raise ValueError("DuckDNS domain is not configured")
        token = self._read_duckdns_token()
        if not token:
            raise ValueError("DuckDNS token is not configured")
        ip_override = (d.get("ip_override") or "").strip()
        ip_to_set = ip_override
        if not ip_to_set:
            ip_to_set, _ = detect_public_ipv4()
        params = {"domains": domain, "token": token}
        if ip_to_set:
            params["ip"] = ip_to_set
        url = "https://www.duckdns.org/update?" + urlencode(params)
        opener = _no_proxy_opener()
        try:
            with opener.open(url, timeout=10) as resp:
                body = resp.read(128).decode("utf-8", errors="replace").strip()
        except Exception as exc:
            self.duck_last_error = str(exc)
            self.duck_last_result = "ERROR"
            raise RuntimeError(f"DuckDNS update request failed: {exc}") from exc

        self.duck_last_update_at = time.time()
        self.duck_last_result = body
        self.duck_last_ip = ip_to_set
        self.duck_last_error = "" if body == "OK" else f"DuckDNS returned {body!r}"
        return {"ok": body == "OK", "result": body, "duckdns": self.duckdns_snapshot()}

    def ngrok_configure(
        self,
        *,
        enabled: bool | None = None,
        url: str | None = None,
        port: int | None = None,
        executable: str | None = None,
        agent_api_url: str | None = None,
        reconnect_attempts: int | None = None,
        startup_timeout_seconds: float | None = None,
    ) -> dict[str, Any]:
        with self._lock:
            ng = self.cfg["ngrok"]
            if url is not None:
                ng["url"] = validate_https_origin(url)
            if port is not None:
                p = int(port)
                if not (1 <= p <= 65535):
                    raise ValueError("ngrok.port must be between 1 and 65535")
                ng["port"] = p
            if executable is not None:
                ng["executable"] = executable.strip() or "ngrok"
            if agent_api_url is not None:
                ng["agent_api_url"] = validate_loopback_http_origin(agent_api_url)
            if reconnect_attempts is not None:
                ng["reconnect_attempts"] = max(0, min(20, int(reconnect_attempts)))
            if startup_timeout_seconds is not None:
                ng["startup_timeout_seconds"] = max(1.0, min(120.0, float(startup_timeout_seconds)))
            if enabled is not None:
                ng["enabled"] = bool(enabled)

            was_running = self.ngrok.snapshot()["status"] in ("running", "starting", "reconnecting")
            if was_running:
                self.ngrok.stop()
            self.ngrok.apply_config(ng, self.runtime_port)
            self._save_config()

        if self.cfg["ngrok"].get("enabled"):
            snap = self.ngrok.start()
        else:
            snap = self.ngrok.stop()
        return {"ok": True, "ngrok": snap}


_SINGLETON_LOCK = threading.Lock()
_SINGLETON: ServerConnRuntime | None = None


def get_runtime(
    *,
    server_host: str = "",
    server_port: int = 0,
    config_dir: Path | None = None,
) -> ServerConnRuntime:
    global _SINGLETON
    with _SINGLETON_LOCK:
        if _SINGLETON is None:
            _SINGLETON = ServerConnRuntime(
                config_dir=config_dir,
                server_host=server_host,
                server_port=server_port,
            )
        else:
            if server_host:
                _SINGLETON.runtime_host = server_host
            if server_port:
                _SINGLETON.runtime_port = int(server_port)
        return _SINGLETON


def dispatch_method(method: str, args: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    rt = get_runtime()
    if method == "status":
        return rt.status()
    if method == "network_info":
        return rt.network_info()
    if method == "configure_server":
        return rt.configure_server(
            bind_host=args.get("bind_host"),
            port=args.get("port"),
            public_base=args.get("public_base"),
        )
    if method == "duckdns_configure":
        return rt.duckdns_configure(
            enabled=args.get("enabled"),
            domain=args.get("domain"),
            interval_seconds=args.get("interval_seconds"),
            ip_override=args.get("ip_override"),
            token=args.get("token"),
        )
    if method == "duckdns_update":
        return rt.duckdns_update()
    if method == "ngrok_configure":
        return rt.ngrok_configure(
            enabled=args.get("enabled"),
            url=args.get("url"),
            port=args.get("port"),
            executable=args.get("executable"),
            agent_api_url=args.get("agent_api_url"),
            reconnect_attempts=args.get("reconnect_attempts"),
            startup_timeout_seconds=args.get("startup_timeout_seconds"),
        )
    if method == "ngrok_start":
        return {"ok": True, "ngrok": rt.ngrok.start()}
    if method == "ngrok_stop":
        return {"ok": True, "ngrok": rt.ngrok.stop()}
    return {"ok": False, "error": f"Unknown server_conn method: {method}"}
