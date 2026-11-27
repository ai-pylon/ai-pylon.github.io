"""Daemon modes: `client` (connects to a central Pylon HTTP server) or `server` (runs the HTTP server locally).

Shared by daemons/<os>/agent.py (stdlib only).

client (default)    connect to the configured central framework URL (a remote
                    pylon-server: the VM, an ai-web pod, or another host) and
                    serve capabilities. Sends ``Authorization: Bearer <agent
                    token>`` when one is configured. (Legacy aliases: passive,
                    standalone.)
server              start pylon-server from the checkout this daemon lives in
                    (``python -m uvicorn main:app``), keep it running, and
                    connect to it as this machine's capability endpoint. A fresh
                    agent token is made for each start; the server only gets its
                    SHA-256 (``PYLON_AGENT_TOKEN_SHA256``). (Legacy alias: full.)

Settings (env wins over the daemon's config.json):
    PYLON2_DAEMON_MODE / "mode"            client | server (aliases: passive, standalone, full)
    PYLON2_FRAMEWORK_URL / "framework_url" passive: ws(s)://host[/prefix]/agent
    PYLON2_AGENT_TOKEN                     passive: the agent token itself
    "agent_token_file"                     passive: file holding it
                                           (default ~/.config/pylon-server/agent-token)
    PYLON2_SERVER_HOST / "server_host"     server: bind address (default 127.0.0.1)
    PYLON2_SERVER_PORT / "server_port"     server: port (default 8910)
    "server_env"                           server: extra env for the server (dict)
    "local_owner"                          server: true = requests made on this machine are
                                           the owner, no sign-in (loopback-bound server only)
"""
import hashlib
import json
import os
import secrets
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit

REPO = Path(__file__).resolve().parents[1]
DEFAULT_TOKEN_FILE = Path.home() / '.config' / 'pylon-server' / 'agent-token'
ENROLLED_TOKEN_FILE = Path.home() / '.config' / 'pylon-server' / 'enrolled-agent-token'
DEFAULT_CENTRAL_HOST = 'pylon-server.duckdns.org'
DEFAULT_CENTRAL_ORIGIN = 'https://' + DEFAULT_CENTRAL_HOST
DEFAULT_CENTRAL_WS_URL = 'wss://' + DEFAULT_CENTRAL_HOST + '/agent'

_BOOTSTRAP_LOCK = threading.Lock()
_BOOTSTRAP_CACHE = {'ts': 0.0, 'data': None}


def fetch_central_bootstrap(origin=DEFAULT_CENTRAL_ORIGIN, timeout=4.0, max_age_s=60.0):
    """Fetch public central server metadata (central URL, gateway/stack version, build) from pylon-server.duckdns.org."""
    now = time.time()
    with _BOOTSTRAP_LOCK:
        cached = _BOOTSTRAP_CACHE['data']
        if cached is not None and (now - _BOOTSTRAP_CACHE['ts']) < max_age_s and cached.get('central_origin') == origin:
            return dict(cached)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    base = origin.rstrip('/')
    fw_url = normalize_framework_url(base)
    last_err = ''
    for ep in ('/_pylon/status', '/health'):
        try:
            req = urllib.request.Request(base + ep, headers={'Accept': 'application/json'})
            with opener.open(req, timeout=timeout) as resp:
                raw = resp.read(65536).decode('utf-8', errors='replace')
            data = json.loads(raw or '{}')
            if isinstance(data, dict) and data.get('ok'):
                result = {
                    'ok': True,
                    'central_origin': base,
                    'framework_url': fw_url,
                    'service': data.get('service') or 'pylon-server',
                    'gateway_version': data.get('gateway') or '',
                    'stack_version': data.get('stack') or '',
                    'build': data.get('build'),
                    'ready': bool(data.get('ready', True)),
                    'source_endpoint': ep,
                    'fetched_at': time.time(),
                }
                with _BOOTSTRAP_LOCK:
                    _BOOTSTRAP_CACHE['ts'] = result['fetched_at']
                    _BOOTSTRAP_CACHE['data'] = result
                return dict(result)
        except Exception as exc:
            last_err = str(exc)
    fallback = {
        'ok': False,
        'central_origin': base,
        'framework_url': fw_url,
        'service': 'pylon-server',
        'gateway_version': '',
        'stack_version': '',
        'build': None,
        'ready': False,
        'error': last_err or 'unreachable',
        'fetched_at': time.time(),
    }
    with _BOOTSTRAP_LOCK:
        _BOOTSTRAP_CACHE['ts'] = fallback['fetched_at']
        _BOOTSTRAP_CACHE['data'] = fallback
    return dict(fallback)


def _data_root():
    env_data = os.environ.get('PYLON2_DATA_DIR', '').strip()
    if env_data:
        return Path(env_data).expanduser()
    home_pylon = Path.home() / 'pylon-server'
    if os.name == 'nt' or (home_pylon / 'data').is_dir():
        return home_pylon / 'data'
    return REPO / 'data'


def client_config_path():
    return _data_root() / 'host-config' / 'daemons' / 'client.json'


def client_token_path():
    return _data_root() / 'host-config' / 'daemons' / '.client-agent-token'


def normalize_framework_url(raw):
    """Normalize user input like 'pylon-server.duckdns.org' or 'https://host' into ws(s)://.../agent."""
    val = (raw or '').strip()
    if not val:
        raise ValueError('Central server address is required')
    if '://' not in val:
        host_part = val.split('/', 1)[0].lower()
        is_local = (
            host_part.startswith('127.')
            or host_part.startswith('localhost')
            or host_part.startswith('[::1]')
        )
        scheme = 'ws' if is_local else 'wss'
        val = f'{scheme}://{val}'
    parsed = urlsplit(val)
    scheme = parsed.scheme.lower()
    if scheme == 'https':
        scheme = 'wss'
    elif scheme == 'http':
        scheme = 'ws'
    elif scheme not in ('ws', 'wss'):
        raise ValueError(f'Unsupported scheme: {parsed.scheme!r} (use https/wss/http/ws or hostname)')
    if not parsed.hostname:
        raise ValueError(f'Invalid central server address: {raw!r}')
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError('Central server address must not contain credentials, query, or fragment')
    netloc = parsed.netloc
    path = (parsed.path or '').rstrip('/')
    if not path:
        path = '/agent'
    elif not path.endswith('/agent'):
        path = path + '/agent'
    return f'{scheme}://{netloc}{path}'


def load_client_config():
    p = client_config_path()
    if not p.is_file():
        return {}
    try:
        data = json.loads(p.read_text(encoding='utf-8'))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def save_client_config(central_server, *, endpoint_id=None, token=None):
    url = normalize_framework_url(central_server)
    p = client_config_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    existing = load_client_config()
    existing['framework_url'] = url
    if endpoint_id is not None:
        eid = endpoint_id.strip()
        if eid:
            existing['endpoint_id'] = eid
        else:
            existing.pop('endpoint_id', None)
    tmp = p.with_suffix('.tmp')
    tmp.write_text(json.dumps(existing, indent=2) + '\n', encoding='utf-8')
    tmp.replace(p)
    if token is not None and token.strip():
        tp = client_token_path()
        tp.write_text(token.strip() + '\n', encoding='utf-8')
        if os.name != 'nt':
            try:
                os.chmod(tp, 0o600)
            except OSError:
                pass
    return existing


def mode(cfg):
    m = (os.environ.get('PYLON2_DAEMON_MODE') or cfg.get('mode') or 'client').strip().lower()
    if m in ('client', 'passive', 'standalone'):
        return 'client'
    if m in ('server', 'full'):
        return 'server'
    raise SystemExit('daemon mode must be client or server, not %r' % m)


def profile(cfg):
    """Return canonical daemon mode: 'server' or 'client'."""
    return mode(cfg)


def passive_token(cfg):
    tok = os.environ.get('PYLON2_AGENT_TOKEN', '').strip()
    if tok:
        return tok
    if cfg.get('agent_token_file'):
        try:
            return Path(cfg['agent_token_file']).expanduser().read_text(encoding='utf-8').strip()
        except OSError:
            return ''
    for path in (client_token_path(), ENROLLED_TOKEN_FILE, DEFAULT_TOKEN_FILE):
        try:
            text = path.read_text(encoding='utf-8').strip()
            if text:
                return text
        except OSError:
            continue
    return ''


def auth_headers(token):
    return {'Authorization': 'Bearer ' + token} if token else {}


def ws_connect(connect, url, headers, **kw):
    """websockets.connect across versions: >= 14 (and the 13 asyncio client) take
    additional_headers, the legacy client of <= 13 takes extra_headers. The
    legacy client swallows unknown keywords and only fails on connect, so the
    parameter is chosen from the signature, not by trial."""
    import inspect
    if not headers:
        return connect(url, **kw)
    try:
        params = inspect.signature(connect).parameters
    except (TypeError, ValueError):
        params = {}
    key = 'additional_headers' if 'additional_headers' in params else 'extra_headers'
    return connect(url, **{key: headers}, **kw)


def _die_with_parent():
    """Linux: the server gets SIGTERM if this daemon dies, even by SIGKILL."""
    try:
        import ctypes
        import signal
        ctypes.CDLL('libc.so.6', use_errno=True).prctl(1, signal.SIGTERM)   # PR_SET_PDEATHSIG
    except Exception:
        pass


def _windows_kill_on_close_job():
    """Windows: a Job Object that kills every process in it when this daemon's
    handle closes (the daemon exits or is killed). The server's own children
    (framework, services) join the job automatically."""
    import ctypes
    from ctypes import wintypes
    k32 = ctypes.WinDLL('kernel32', use_last_error=True)

    class BASIC(ctypes.Structure):
        _fields_ = [('PerProcessUserTimeLimit', ctypes.c_int64), ('PerJobUserTimeLimit', ctypes.c_int64),
                    ('LimitFlags', wintypes.DWORD), ('MinimumWorkingSetSize', ctypes.c_size_t),
                    ('MaximumWorkingSetSize', ctypes.c_size_t), ('ActiveProcessLimit', wintypes.DWORD),
                    ('Affinity', ctypes.c_size_t), ('PriorityClass', wintypes.DWORD),
                    ('SchedulingClass', wintypes.DWORD)]

    class IO(ctypes.Structure):
        _fields_ = [(n, ctypes.c_uint64) for n in ('r', 'w', 'o', 'rb', 'wb', 'ob')]

    class EXTENDED(ctypes.Structure):
        _fields_ = [('BasicLimitInformation', BASIC), ('IoInfo', IO), ('ProcessMemoryLimit', ctypes.c_size_t),
                    ('JobMemoryLimit', ctypes.c_size_t), ('PeakProcessMemoryUsed', ctypes.c_size_t),
                    ('PeakJobMemoryUsed', ctypes.c_size_t)]
    k32.CreateJobObjectW.restype = wintypes.HANDLE
    job = k32.CreateJobObjectW(None, None)
    if not job:
        return None
    info = EXTENDED()
    info.BasicLimitInformation.LimitFlags = 0x2000          # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    if not k32.SetInformationJobObject(wintypes.HANDLE(job), 9, ctypes.byref(info), ctypes.sizeof(info)):
        return None
    return job


def _windows_assign(job, proc):
    import ctypes
    from ctypes import wintypes
    k32 = ctypes.WinDLL('kernel32', use_last_error=True)
    k32.OpenProcess.restype = wintypes.HANDLE
    h = k32.OpenProcess(0x0101, False, proc.pid)             # PROCESS_SET_QUOTA | PROCESS_TERMINATE
    if h:
        k32.AssignProcessToJobObject(wintypes.HANDLE(job), wintypes.HANDLE(h))
        k32.CloseHandle(wintypes.HANDLE(h))


class LocalServer:
    """Runs and supervises ``uvicorn main:app`` from the repository root."""

    def __init__(self, cfg, log=print):
        self.host = os.environ.get('PYLON2_SERVER_HOST') or cfg.get('server_host') or '127.0.0.1'
        self.port = int(os.environ.get('PYLON2_SERVER_PORT') or cfg.get('server_port') or 8910)
        self.extra_env = dict(cfg.get('server_env') or {})
        data_dir = os.environ.get('PYLON2_DATA_DIR') or cfg.get('data_dir') or ''
        if data_dir:
            resolved_data = str(Path(data_dir).expanduser().resolve())
            Path(resolved_data).mkdir(parents=True, exist_ok=True)
            os.environ.setdefault('PYLON2_DATA_DIR', resolved_data)
            self.extra_env.setdefault('PYLON2_DATA_DIR', resolved_data)
        self.conn_runtime = None
        try:
            import server_conn_runtime
            self.conn_runtime = server_conn_runtime.get_runtime(
                server_host=self.host, server_port=self.port
            )
            # Apply saved server bind_host/port only when env did not override them.
            saved_srv = (self.conn_runtime.cfg or {}).get('server') or {}
            if not os.environ.get('PYLON2_SERVER_HOST') and saved_srv.get('bind_host'):
                self.host = str(saved_srv['bind_host'])
                self.conn_runtime.runtime_host = self.host
            if not os.environ.get('PYLON2_SERVER_PORT') and saved_srv.get('port'):
                self.port = int(saved_srv['port'])
                self.conn_runtime.runtime_port = self.port
        except Exception:
            self.conn_runtime = None
        # A desktop install: whoever sits at this machine is the owner (no sign-in).
        # Only for a loopback-bound server; the bootstrap adds its own checks.
        if cfg.get('local_owner') and self.host in ('127.0.0.1', 'localhost', '::1'):
            self.extra_env.setdefault('PYLON_LOCAL_OWNER', '1')
        self.token = secrets.token_urlsafe(32)
        self.log = log
        self.proc = None
        self._stop = threading.Event()
        self._job = None
        if os.name == 'nt':
            try:
                self._job = _windows_kill_on_close_job()
            except Exception:
                self._job = None
        self.restarts = 0

    @property
    def url(self):
        return 'ws://127.0.0.1:%d/agent' % self.port

    @property
    def http_url(self):
        return 'http://127.0.0.1:%d' % self.port

    def _env(self):
        env = {**os.environ, **{k: str(v) for k, v in self.extra_env.items()},
               'PYLON_AGENT_TOKEN_SHA256': hashlib.sha256(self.token.encode()).hexdigest(),
               'PYLON2_SERVER_HOST': self.host,
               'PYLON2_SERVER_PORT': str(self.port),
               'PYTHONUNBUFFERED': '1'}
        env.pop('PYLON2_AGENT_TOKEN', None)
        return env

    def _spawn(self):
        argv = [sys.executable, '-m', 'uvicorn', 'main:app', '--host', self.host, '--port', str(self.port)]
        extra = {'preexec_fn': _die_with_parent} if sys.platform.startswith('linux') else {}
        self.proc = subprocess.Popen(argv, cwd=str(REPO), env=self._env(), stdin=subprocess.DEVNULL, **extra)
        if self._job:
            try:
                _windows_assign(self._job, self.proc)
            except Exception:
                pass
        self.log('[serve] started pylon-server pid %d on %s:%d' % (self.proc.pid, self.host, self.port))

    def healthy(self, timeout=2):
        try:
            with urllib.request.urlopen('http://127.0.0.1:%d/health' % self.port, timeout=timeout) as r:
                return r.status == 200
        except Exception:
            return False

    def start(self, wait_s=90):
        if self.healthy(1):
            raise SystemExit('port %d already serves something; set server_port' % self.port)
        self._spawn()
        deadline = time.time() + wait_s
        while time.time() < deadline and not self.healthy(1):
            if self.proc.poll() is not None:
                raise SystemExit('pylon-server exited during start (code %s)' % self.proc.returncode)
            time.sleep(0.5)
        threading.Thread(target=self._supervise, name='pylon-server-supervisor', daemon=True).start()
        if self.conn_runtime is not None:
            try:
                self.conn_runtime.start_background()
            except Exception as exc:
                self.log('[serve] server_conn background start warning: %s' % exc)
        return self

    def _supervise(self):
        backoff = 1
        while not self._stop.wait(2):
            if self.proc.poll() is None:
                backoff = 1
                continue
            self.log('[serve] pylon-server exited (code %s); restarting in %ds' % (self.proc.returncode, backoff))
            if self._stop.wait(backoff):
                return
            self.restarts += 1
            self._spawn()
            backoff = min(backoff * 2, 60)

    def stop(self):
        self._stop.set()
        if self.conn_runtime is not None:
            try:
                self.conn_runtime.shutdown()
            except Exception:
                pass
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.proc.kill()


def setup(cfg, default_url=DEFAULT_CENTRAL_WS_URL, log=print):
    """-> (framework_url, headers, LocalServer or None) for this daemon."""
    if mode(cfg) == 'server':
        server = LocalServer(cfg, log).start()
        log('[serve] server mode: this daemon is the bootstrap of %s' % REPO)
        return server.url, auth_headers(server.token), server
    saved = load_client_config()
    raw_url = (
        os.environ.get('PYLON2_FRAMEWORK_URL')
        or saved.get('framework_url')
        or cfg.get('framework_url')
        or default_url
        or DEFAULT_CENTRAL_WS_URL
    )
    url = normalize_framework_url(raw_url)
    return url, auth_headers(passive_token(cfg)), None
