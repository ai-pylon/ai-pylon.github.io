"""Linux Chromium CDP provider. Private, temporary profile; no public debug port.

Starts lazily, uses an installed browser (no downloads), and retains the browser
only for the daemon lifetime. The owner-authorized capability does not automate
Google login or MFA. No implicit Windows profile/credential reuse.
"""
from __future__ import annotations
import json
import base64
import hashlib
import fcntl
import math
import secrets
import os
import re
import shutil
import signal
import select
import struct
import subprocess
import tempfile
import threading
import time
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit, quote
from websockets.sync.client import connect

CAPABILITY = 'cap:system.cdp'
VARIANT = 'headless'  # retain discovery compatibility; mode is selected per operation
ATTRS = {'managed': True, 'headless': True, 'persistent_profile': True, 'interactive_viewer': True, 'graphical_viewer': True}
_LOCK = threading.RLock()
_PROC = None
_PROFILE = None
_PORT = None
_LAST = 0.0
_ACTIVE_NAME = None
_PROFILE_LOCK = None
_VIEWER = None
_DISPLAY_PROC = None
_DISPLAY_DIR = None
_GRAPHICAL = False
_DISPLAY_CDP = None
_WIDTH,_HEIGHT = 1200,800
_PROFILE_NAME = re.compile(r"[a-z][a-z0-9-]{0,31}")
_RESERVE = 1024**3
_PROFILE_BUDGET = 256*1024**2
_IDLE = 300
_MAX_TABS = 4
_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))
_ID = re.compile(r'[A-Za-z0-9_-]{1,128}')

def _browser(graphical=False):
    override = os.environ.get('PYLON_LINUX_CDP_BROWSER')
    if override:
        p = Path(override)
        return str(p) if p.is_absolute() and p.is_file() and os.access(p, os.X_OK) and (not graphical or 'headless' not in p.name.lower()) else None
    for name in ('chromium', 'chromium-browser', 'google-chrome', 'msedge'):
        p = shutil.which(name)
        if p: return p
    if graphical:return None
    cache = Path(os.environ.get('PLAYWRIGHT_BROWSERS_PATH') or Path.home()/'.cache/ms-playwright')
    if cache.is_absolute():
        candidates = sorted(cache.glob('chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell'), reverse=True)
        return next((str(p) for p in candidates if p.is_file() and os.access(p, os.X_OK)), None)
    return None

def _error(message, category='application'):
    return {'ok':False,'error':message,'error_category':category}

def _http(path, method='GET'):
    if not _PORT: raise RuntimeError('Browser not running')
    request=urllib.request.Request('http://127.0.0.1:'+str(_PORT)+path,method=method)
    with _OPENER.open(request,timeout=4) as r:
        raw=r.read(2*1024*1024+1)
    if len(raw)>2*1024*1024: raise RuntimeError('CDP response exceeds limit')
    return json.loads(raw)

def _profile_name(name):
    if name is None or name=='temporary':return None
    if not isinstance(name,str) or not _PROFILE_NAME.fullmatch(name):raise ValueError('Invalid profile name')
    return name

def _root():
    return Path(os.environ.get('PYLON_LINUX_CDP_PROFILE_ROOT') or Path.home()/'.local/share/pylon-server/cdp-profiles')

def _free(path):
    while not path.exists():path=path.parent
    return shutil.disk_usage(path).free

def _persistent_space(path,starting=False):
    floor=max(_RESERVE,int(float(os.environ.get('PYLON2_DISK_FLOOR_GB','1'))*1024**3))
    return _free(path)>=floor+(_PROFILE_BUDGET if starting else 64*1024**2)

def _persistent(name):
    root=_root()
    if not root.is_absolute() or root.resolve()!=root:raise ValueError('Invalid private profile root')
    if not _persistent_space(root,True):raise ValueError('Persistent profile needs at least 1 GiB free reserve plus 256 MiB for browser data')
    root.mkdir(mode=0o700,parents=True,exist_ok=True)
    for p in (root,root/name):
        p.mkdir(mode=0o700,exist_ok=True)
        st=p.stat()
        if p.is_symlink() or p.resolve()!=p or st.st_uid!=os.getuid() or st.st_mode&0o077:raise ValueError('Profile must be owner-only and not a symlink')
    path=root/name
    fd=os.open(path/'.pylon-profile.lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
    try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except OSError:os.close(fd);raise ValueError('Profile is already in use') from None
    return path,fd

def _terminate(p):
    if not p:return
    try:os.killpg(p.pid,signal.SIGTERM)
    except ProcessLookupError:pass
    try:p.wait(timeout=3)
    except subprocess.TimeoutExpired:
        try:os.killpg(p.pid,signal.SIGKILL)
        except ProcessLookupError:pass
        p.wait(timeout=3)

def _start_display():
    """Private X11 socket, random per-session cookie, no TCP listener."""
    global _DISPLAY_PROC,_DISPLAY_DIR
    xvfb=shutil.which('Xvfb')
    if not xvfb:raise ValueError('Graphical viewer requires Xvfb')
    base='/dev/shm' if Path('/dev/shm').is_dir() else None
    d=Path(tempfile.mkdtemp(prefix='pylon-x11-',dir=base));_DISPLAY_DIR=d
    auth=d/'Xauthority'
    def field(b):return struct.pack('!H',len(b))+b
    with auth.open('xb') as f:
        os.fchmod(f.fileno(),0o600)
        f.write(struct.pack('!H',65535)+field(b'')+field(b'')+field(b'MIT-MAGIC-COOKIE-1')+field(secrets.token_bytes(16)))
    r,w=os.pipe()
    try:
        _DISPLAY_PROC=subprocess.Popen([xvfb,'-displayfd',str(w),'-auth',str(auth),'-nolisten','tcp','-screen','0','1280x960x24'],pass_fds=(w,),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
        os.close(w);w=None
        if not select.select([r],[],[],5)[0]:raise RuntimeError('Graphical display startup timed out')
        display=os.read(r,32).decode().strip()
        if not display.isdecimal() or _DISPLAY_PROC.poll() is not None:raise RuntimeError('Graphical display unavailable')
        return {**os.environ,'DISPLAY':':'+display,'XAUTHORITY':str(auth)}
    finally:
        os.close(r)
        if w is not None:os.close(w)

def _stop():
    global _PROC,_PROFILE,_PORT,_ACTIVE_NAME,_PROFILE_LOCK,_VIEWER,_DISPLAY_PROC,_DISPLAY_DIR,_GRAPHICAL
    _close_display_cdp()
    display,display_dir=_DISPLAY_PROC,_DISPLAY_DIR
    p, profile, name, lock = _PROC,_PROFILE,_ACTIVE_NAME,_PROFILE_LOCK
    if p and name and p.poll() is None:
        try:
            _command(_http('/json/version'),'Browser.close',{})
        except Exception:pass
        try:p.wait(timeout=4)
        except subprocess.TimeoutExpired:pass
    _PROC=_PROFILE=_PORT=_ACTIVE_NAME=_PROFILE_LOCK=_VIEWER=_DISPLAY_PROC=_DISPLAY_DIR=None
    _GRAPHICAL=False
    try:_terminate(p)
    finally:
        try:_terminate(display)
        finally:
            if display_dir:shutil.rmtree(display_dir,ignore_errors=True)
            if profile and name is None:shutil.rmtree(profile,ignore_errors=True)
            if lock is not None:os.close(lock)

def shutdown():
    with _LOCK:_stop()

def _reap():
    with _LOCK:
        try:
            if _PROC and (_PROC.poll() is not None or time.monotonic()-_LAST>_IDLE or (_ACTIVE_NAME and not _persistent_space(_PROFILE))):_stop()
        except Exception:
            if _PROC:_stop()
    timer=threading.Timer(30,_reap);timer.daemon=True;timer.start()

_STARTUP_FAILURES={
    'Chromium sandbox initialization failed',
    'Chromium could not connect to its graphical display',
    'Chromium system dependency unavailable',
    'Chromium process resources exhausted',
    'Chromium profile initialization failed',
    'Chromium terminated by a signal during startup',
}
class _StartupDiagnostics:
    # Only retain a bounded fragment in memory during startup; never persist
    # or return raw browser stderr. Drain the pipe for the browser lifetime.
    def __init__(self,stream):
        self.stream=stream;self.category=None;self.active=True
        self.done=threading.Event();self.lock=threading.Lock()
        threading.Thread(target=self._read,daemon=True).start()
    @staticmethod
    def classify(data):
        data=data.lower()
        patterns=(
            (('no usable sandbox','failed to move to new namespace','suid sandbox helper','zygote_host_impl_linux','sandbox initialization failed'),'Chromium sandbox initialization failed'),
            (('missing x server','cannot open display','failed to initialize platform','x11 connection rejected'),'Chromium could not connect to its graphical display'),
            (('error while loading shared libraries','cannot open shared object file'),'Chromium system dependency unavailable'),
            (('resource temporarily unavailable','cannot allocate memory','pthread_create:','out of memory','no space left on device'),'Chromium process resources exhausted'),
            (('failed to create a processsingleton','profile appears to be in use','failed to create singletonlock'),'Chromium profile initialization failed'),
        )
        return next((name for terms,name in patterns if any(x in data for x in terms)),None)
    def _read(self):
        tail=''
        try:
            while True:
                raw=os.read(self.stream.fileno(),4096)
                if not raw:break
                with self.lock:
                    if not self.active:tail='';continue
                    data=tail+raw.decode('utf-8','replace')
                    category=self.classify(data)
                    if category and not self.category:self.category=category
                    tail=data[-512:]
        except (OSError,ValueError):pass
        finally:
            self.stream.close();self.done.set()
    def finish(self):
        with self.lock:self.active=False
    def failure(self,code):
        self.done.wait(.4)
        with self.lock:category=self.category
        if category:return category
        if isinstance(code,int) and code<0:return 'Chromium terminated by a signal during startup'
        return 'Chromium exited; check browser sandbox and dependencies'

def _ensure(profile=None,graphical=False):
    global _PROC,_PROFILE,_PORT,_LAST,_ACTIVE_NAME,_PROFILE_LOCK,_GRAPHICAL
    name=_profile_name(profile)
    if _PROC and _PROC.poll() is None and _ACTIVE_NAME!=name:raise ValueError("Another browser profile is active; stop it explicitly first")
    if _PROC and _PROC.poll() is None and _GRAPHICAL!=graphical:raise ValueError('Another browser mode is active; stop the idle browser before switching')
    if _PROC and _PROC.poll() is None:
        try:
            if graphical and (not _DISPLAY_PROC or _DISPLAY_PROC.poll() is not None):raise RuntimeError('Graphical display disconnected')
            _http('/json/version');_LAST=time.monotonic();return
        except Exception: _stop()
    elif _PROC:_stop()
    executable=_browser(graphical)
    if not executable:raise ValueError('Full Chromium is required for the graphical viewer' if graphical else 'Install Chromium or configure PYLON_LINUX_CDP_BROWSER')
    # Keep volatile browser data out of the VM's critically small boot disk.
    if name:
        profile,lock=_persistent(name);_PROFILE_LOCK=lock
    else:
        base='/dev/shm' if Path('/dev/shm').is_dir() else None
        if base and shutil.disk_usage(base).free<128*1024*1024:raise RuntimeError('Insufficient temporary browser storage')
        profile=Path(tempfile.mkdtemp(prefix='pylon-linux-cdp-',dir=base))
    _PROFILE=profile;_ACTIVE_NAME=name
    try:
        env=_start_display() if graphical else os.environ.copy()
        _GRAPHICAL=graphical
        flags=[] if graphical else ['--headless']
        diagnostics=None
        _PROC=subprocess.Popen([executable,*flags,'--remote-debugging-address=127.0.0.1',
          '--remote-debugging-port=0','--user-data-dir='+str(profile),'--disk-cache-size=16777216',
          '--window-size=1200,800','--disable-background-networking','--no-first-run','--no-default-browser-check','about:blank'],
          env=env,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,start_new_session=True)
        diagnostics=_StartupDiagnostics(_PROC.stderr)
        deadline=time.monotonic()+(35 if graphical else 12)
        while time.monotonic()<deadline:
            if _PROC.poll() is not None:raise RuntimeError(diagnostics.failure(_PROC.returncode))
            try:
                port=int((profile/'DevToolsActivePort').read_text().splitlines()[0])
                if not 1<=port<=65535:raise ValueError()
                _PORT=port;_http('/json/version');_LAST=time.monotonic();diagnostics.finish();return
            except (OSError,ValueError,IndexError):time.sleep(.15)
        raise RuntimeError('Chromium startup timed out')
    except BaseException:_stop();raise

def _tabs():
    return [t for t in _http('/json/list') if t.get('type')=='page']

def _target(id):
    if not isinstance(id,str) or not _ID.fullmatch(id):raise ValueError('Explicit tab_id required')
    t=next((t for t in _tabs() if t.get('id')==id),None)
    if not t:raise ValueError('Selected tab unavailable')
    return t

def _command(t,method,params):
    u=urlsplit(t['webSocketDebuggerUrl'])
    if u.scheme!='ws' or u.hostname!='127.0.0.1' or u.port!=_PORT or u.username or u.password:
        raise RuntimeError('Unexpected browser debug target')
    with connect(t['webSocketDebuggerUrl'],open_timeout=4,close_timeout=1,max_size=2*1024*1024,proxy=None) as ws:
        ws.send(json.dumps({'id':1,'method':method,'params':params}))
        deadline=time.monotonic()+12
        while True:
            remaining=deadline-time.monotonic()
            if remaining<=0:raise RuntimeError('Browser operation timed out')
            r=json.loads(ws.recv(timeout=remaining))
            if r.get('id')==1:
                if r.get('error'):raise RuntimeError('Browser rejected CDP command')
                return r.get('result',{})

def _close_display_cdp():
    global _DISPLAY_CDP
    state,_DISPLAY_CDP=_DISPLAY_CDP,None
    if state:
        try:state['socket'].close()
        except Exception:pass

def _display_command(t,method,params):
    # Only display reads, for the current workspace tab. All callers hold _LOCK.
    global _DISPLAY_CDP
    if method not in ('Page.getLayoutMetrics','Page.captureScreenshot','Emulation.setDeviceMetricsOverride'):
        raise ValueError('Display command required')
    if not _VIEWER or _VIEWER.get('purpose')!='workspace' or t.get('id')!=_VIEWER.get('tab'):
        return _command(t,method,params)
    url=t['webSocketDebuggerUrl'];u=urlsplit(url)
    if u.scheme!='ws' or u.hostname!='127.0.0.1' or u.port!=_PORT or u.username or u.password:
        raise RuntimeError('Unexpected browser debug target')
    if not _DISPLAY_CDP or _DISPLAY_CDP['url']!=url:
        _close_display_cdp()
        _DISPLAY_CDP={'url':url,'socket':connect(url,open_timeout=4,close_timeout=1,max_size=2*1024*1024,proxy=None),'seq':0}
        if method!='Emulation.setDeviceMetricsOverride' and _VIEWER.get('viewport'):
            w,h=_VIEWER['viewport']
            _display_command(t,'Emulation.setDeviceMetricsOverride',{'width':w,'height':h,'deviceScaleFactor':1,'mobile':False})
    state=_DISPLAY_CDP;state['seq']+=1;seq=state['seq'];ws=state['socket']
    try:
        ws.send(json.dumps({'id':seq,'method':method,'params':params}))
        deadline=time.monotonic()+8
        while True:
            remaining=deadline-time.monotonic()
            if remaining<=0:raise RuntimeError('Display operation timed out')
            r=json.loads(ws.recv(timeout=remaining))
            if r.get('id')==seq:
                if r.get('error'):raise RuntimeError('Browser rejected display command')
                return r.get('result',{})
    except BaseException:
        _close_display_cdp()
        raise

def _url(value):
    if not isinstance(value,str) or len(value)>8192:raise ValueError('HTTP(S) URL required')
    u=urlsplit(value)
    if u.scheme not in ('http','https') or not u.hostname or u.username or u.password:raise ValueError('HTTP(S) URL required')
    return value

def status(args,ctx):
    with _LOCK:
        available=bool(_browser())
        running=bool(_PROC and _PROC.poll() is None)
        return {'ok':True,'available':available,'running':running,'managed':True,'headless':not _GRAPHICAL,'graphical_ready':bool(_browser(True) and shutil.which('Xvfb')),'viewer_active':bool(_VIEWER),'persistent_profile':True,'profile':_ACTIVE_NAME or 'temporary','persistent_ready':_persistent_space(_root(),True),'browser':'Chromium','detail':'Starts on demand; temporary or named profile; interactive viewer available' if available else 'Chromium executable not found'}

def _automation(args):
    if _VIEWER:raise ValueError("Interactive viewer active; close it before automation")
    _ensure(args.get("profile"))

def tabs(args,ctx):
    with _LOCK:
        _automation(args)
        return {'ok':True,'tabs':[{k:t.get(k,'') for k in ('id','type','title','url')} for t in _tabs()]}

def navigate(args,ctx):
    url=_url(args.get('url'))
    with _LOCK:
        _automation(args)
        if args.get('tab_id'):
            t=_target(args['tab_id'])
            r=_command(t,'Page.navigate',{'url':url})
            if r.get('errorText'):return _error('Browser navigation failed')
        else:
            if len(_tabs())>=_MAX_TABS-1:return _error('Automation tab limit reached; one slot reserved for the interactive viewer')
            t=_http('/json/new?'+quote(url,safe=''),method='PUT')
        return {'ok':True,'tab_id':t['id']}

def evaluate(args,ctx):
    expr=args.get('expr')
    if not isinstance(expr,str) or not expr.strip() or len(expr)>65536:return _error('Invalid expression')
    with _LOCK:
        _automation(args)
        t=_target(args.get('tab_id'))
        r=_command(t,'Runtime.evaluate',{'expression':expr,'returnByValue':True,'awaitPromise':True,'timeout':10000})
        if 'exceptionDetails' in r:return _error('Browser evaluation failed')
        return {'ok':True,'value':r.get('result',{}).get('value')}

def close(args,ctx):
    global _LAST
    with _LOCK:
        if _VIEWER: return _error('Interactive viewer active')
        if not _PROC or _PROC.poll() is not None:return _error('Browser not running')
        if _profile_name(args.get('profile'))!=_ACTIVE_NAME:return _error('Profile selection required')
        t=_target(args.get('tab_id'))
        request=urllib.request.Request('http://127.0.0.1:'+str(_PORT)+'/json/close/'+t['id'])
        with _OPENER.open(request,timeout=4) as r:r.read(1024)
        _LAST=time.monotonic()
        return {'ok':True}

def stop(args,ctx):
    if args.get('confirm') is not True:return {'ok':True,'dry_run':True}
    with _LOCK:
        if _VIEWER:return _error('Close the active viewer first')
        _stop()
    return {'ok':True}

def _viewer(args,ctx):
    if not _VIEWER or not isinstance(args.get('session'),str) or not secrets.compare_digest(args['session'],_VIEWER['session']) or ctx.get('user')!=_VIEWER['owner']:
        raise ValueError('Viewer session expired')
    _ensure(_VIEWER['profile'],graphical=_VIEWER.get('graphical',False))
    if not _VIEWER:raise ValueError('Viewer browser restarted; reopen viewer')
    return _target(_VIEWER['tab'])

def viewer_open(args,ctx):
    global _VIEWER
    if args.get('confirm') is not True or not ctx.get('user'):raise ValueError('Explicit owner confirmation required')
    url=_url(args.get('url'));name=_profile_name(args.get('profile'))
    with _LOCK:
        if _VIEWER:raise ValueError('A viewer is already active')
        graphical=args.get('graphical') is True
        purpose=args.get('purpose','workspace')
        if purpose not in ('workspace','setup'):raise ValueError('Invalid viewer purpose')
        try:_ensure(name,graphical=graphical)
        except ValueError:raise
        except Exception as exc:
            known=_STARTUP_FAILURES|{'Graphical display startup timed out','Graphical display unavailable','Chromium exited; check browser sandbox and dependencies','Chromium startup timed out','Insufficient temporary browser storage'}
            raise ValueError(str(exc) if str(exc) in known else 'Chromium startup failed') from None
        try:tabs=_tabs()
        except Exception:raise ValueError('Browser debugging connection unavailable') from None
        # Reuse only a blank startup page; never discard a real user's page.
        tab=next((t for t in tabs if t.get('url')=='about:blank'),None)
        if not tab and len(tabs)>=_MAX_TABS:raise ValueError('Browser tab limit reached')
        try:
            if tab:
                r=_command(tab,'Page.navigate',{'url':url})
                if r.get('errorText'):raise ValueError('Browser navigation failed')
            else:
                tab=_http('/json/new?'+quote(url,safe=''),method='PUT')
        except Exception:raise ValueError('Browser navigation failed') from None
        try:_command(tab,'Emulation.setDeviceMetricsOverride',{'width':_WIDTH,'height':_HEIGHT,'deviceScaleFactor':1,'mobile':False})
        except Exception:raise ValueError('Browser viewport setup failed') from None
        sid=secrets.token_urlsafe(32)
        _VIEWER={'session':sid,'owner':ctx['user'],'tab':tab['id'],'profile':name,'graphical':graphical,'initial_url':url,'purpose':purpose}
        return {'ok':True,'session':sid,'profile':name or 'temporary','graphical':graphical}

def _lab_document():
    # Fixed installed fixture only; no request-supplied HTML, URL or scripts.
    assets=Path(__file__).resolve().parents[3]/'apps/system/remote_browser/page/assets'
    html=(assets/'interaction-demo.html').read_text()
    css=(assets/'interaction-demo.css').read_text()
    js=(assets/'interaction-demo.js').read_text()
    html=html.replace('<link rel="stylesheet" href="interaction-demo.css">','<style>'+css+'</style>')
    html=html.replace('<script src="interaction-demo.js" defer></script>','')
    html=html.replace('<head>','<head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; connect-src \'none\'; form-action \'none\'; base-uri \'none\'">',1)
    html=html.replace('</body>','<script>'+js+'</script></body>')
    return 'data:text/html;base64,'+base64.b64encode(html.encode()).decode('ascii')

def viewer_lab_open(args,ctx):
    global _VIEWER
    if args.get('confirm') is not True or not ctx.get('user'):raise ValueError('Explicit owner confirmation required')
    if set(args)-{'confirm'}:raise ValueError('Lab accepts no browser address or profile')
    with _LOCK:
        if _VIEWER or (_PROC and _PROC.poll() is None):raise ValueError('Close the existing browser before starting the lab')
        url=_lab_document()
        try:
            _ensure(None,graphical=False)
            tab=next((t for t in _tabs() if t.get('url')=='about:blank'),None)
            if not tab:raise ValueError('Lab startup page unavailable')
            _command(tab,'Emulation.setDeviceMetricsOverride',{'width':_WIDTH,'height':_HEIGHT,'deviceScaleFactor':1,'mobile':False})
            r=_command(tab,'Page.navigate',{'url':url})
            if r.get('errorText'):raise ValueError('Lab page unavailable')
            sid=secrets.token_urlsafe(32)
            _VIEWER={'session':sid,'owner':ctx['user'],'tab':tab['id'],'profile':None,'graphical':False,'purpose':'lab','lab_url':url,'pressed':False}
            return {'ok':True,'session':sid}
        except BaseException:
            _stop();raise

def _lab_target(args,ctx):
    t=_viewer(args,ctx)
    if _VIEWER.get('purpose')!='lab':raise ValueError('Pointer lab requires its isolated fixture')
    # The fixture uses an opaque data origin and contains no links or external resources.
    # Validate the exact document again before dispatching an input event.
    r=_command(t,'Runtime.evaluate',{'expression':'location.href','returnByValue':True})
    if r.get('result',{}).get('value')!=_VIEWER['lab_url']:raise ValueError('Lab document changed')
    return t

def viewer_lab_pointer(args,ctx):
    with _LOCK:
        t=_lab_target(args,ctx)
        return _dispatch_pointer(t,args.get('kind'),args.get('payload'))

def _dispatch_pointer(t,kind,p):
    if kind not in ('down','move','up','wheel','cancel') or not isinstance(p,dict):raise ValueError('Invalid pointer event')
    frame=_VIEWER.get('frame_size')
    if not frame:return _error('Wait for the first viewer frame')
    if kind=='cancel':
        if not _VIEWER.get('pressed',False):return {'ok':True,'applied':True}
        x,y=_VIEWER['last_pointer']
    else:
        x=_number(p.get('xf'),0,1)*(frame[0]-1);y=_number(p.get('yf'),0,1)*(frame[1]-1)
    q={'x':x,'y':y}
    pressed=_VIEWER.get('pressed',False)
    if kind=='down':
        if pressed:return _error('Pointer already pressed')
        if _viewport(t)!=frame:return _error('Wait for a fresh viewer frame')
        _command(t,'Page.bringToFront',{})
        _command(t,'Input.dispatchMouseEvent',dict(q,type='mousePressed',button='left',buttons=1,clickCount=1))
        _VIEWER['pressed']=True
    elif kind in ('up','cancel'):
        if pressed:_command(t,'Input.dispatchMouseEvent',dict(q,type='mouseReleased',button='left',buttons=0,clickCount=1))
        _VIEWER['pressed']=False
    elif kind=='move':
        _command(t,'Input.dispatchMouseEvent',dict(q,type='mouseMoved',button='left' if pressed else 'none',buttons=1 if pressed else 0))
    elif not pressed:
        _command(t,'Input.dispatchMouseEvent',dict(q,type='mouseWheel',deltaX=_number(p.get('deltaX',0),-3000,3000),deltaY=_number(p.get('deltaY',0),-3000,3000)))
    else:return _error('Release pointer before scrolling')
    _VIEWER['last_pointer']=(x,y)
    return {'ok':True,'applied':True}

def viewer_resume(args,ctx):
    """Rebind only the same authenticated owner, original URL, profile and mode.
    Rotate the private session ID so an older viewer cannot keep controlling it.
    Never infer owner or project from the current login page.
    """
    if args.get('confirm') is not True or not ctx.get('user'):raise ValueError('Explicit owner confirmation required')
    url=_url(args.get('url'));name=_profile_name(args.get('profile'));graphical=args.get('graphical') is True
    with _LOCK:
        if not _VIEWER:raise ValueError('Viewer session expired')
        if (ctx['user']!=_VIEWER['owner'] or _VIEWER.get('initial_url')!=url or
                _VIEWER['profile']!=name or _VIEWER.get('graphical',False)!=graphical):
            raise ValueError('Viewer does not match the requested owner or setup')
        if not _PROC or _PROC.poll() is not None:
            _stop();raise ValueError('Viewer session expired')
        _viewer({'session':_VIEWER['session']},ctx)
        sid=secrets.token_urlsafe(32);_VIEWER['session']=sid
        return {'ok':True,'session':sid,'profile':name or 'temporary','graphical':graphical}

def _recover_workspace(args,ctx):
    if args.get('confirm') is not True or not ctx.get('user'):
        raise ValueError('Explicit owner confirmation required')
    if not _VIEWER or _VIEWER.get('purpose')!='workspace' or _VIEWER['owner']!=ctx['user']:
        raise ValueError('No recoverable browser for this owner')
    t=_viewer({'session':_VIEWER['session']},ctx)
    if _VIEWER.get('pressed'): _dispatch_pointer(t,'cancel',{})

def viewer_reconnect(args,ctx):
    with _LOCK:
        _recover_workspace(args,ctx)
        sid=secrets.token_urlsafe(32);_VIEWER['session']=sid
        return {'ok':True,'session':sid,'graphical':_VIEWER['graphical'],'profile':_VIEWER['profile'] or 'temporary'}

def viewer_close_existing(args,ctx):
    with _LOCK:
        _recover_workspace(args,ctx)
        _stop()
        return {'ok':True}

def _viewport(t):
    v=_display_command(t,'Page.getLayoutMetrics',{}).get('cssVisualViewport',{})
    w,h=v.get('clientWidth'),v.get('clientHeight')
    if (type(w) not in (int,float) or type(h) not in (int,float) or not 1<=w<=8192 or not 1<=h<=8192
            or v.get('scale',1)!=1):
        raise ValueError('Viewer viewport unavailable')
    return int(w),int(h)

_CLICK_TARGETS={'button','disabled','link','text','password','textarea','editable','frame','other','none','unknown'}
def _click_target(t,x,y):
    # Classify only the target of the user's explicit click, without retrieving
    # values, labels, identifiers, DOM or coordinates in the diagnostic response.
    expression="""((x,y)=>{let e=document.elementFromPoint(x,y);if(!e)return 'none';
      if(e.closest('[disabled],[aria-disabled="true"]'))return 'disabled';
      if(e.closest('button,[role="button"],input[type="submit"],input[type="button"]'))return 'button';
      if(e.closest('a[href]'))return 'link';
      if(e instanceof HTMLInputElement)return e.type==='password'?'password':'text';
      if(e instanceof HTMLTextAreaElement)return 'textarea';
      if(e.isContentEditable)return 'editable';
      if(e.tagName==='IFRAME')return 'frame';
      return 'other';})(%s,%s)"""%(json.dumps(x),json.dumps(y))
    try:
        r=_command(t,'Runtime.evaluate',{'expression':expression,'returnByValue':True,'timeout':3000})
        v=r.get('result',{}).get('value')
        return v if isinstance(v,str) and v in _CLICK_TARGETS else 'unknown'
    except Exception:return 'unknown'

def _display_url(raw):
    """Return a sanitized navigation address, never credentials or OAuth parameters."""
    try:
        u=urlsplit(raw)
        if raw=='about:blank':return raw
        if u.scheme not in ('https','http') or not u.hostname:return 'about:blank'
        host=u.hostname
        origin=u.scheme+'://'+('['+host+']' if ':' in host else host)+((':'+str(u.port)) if u.port else '')
        safe_paths={
          'console.cloud.google.com':('/auth/clients','/auth/branding','/auth/audience','/auth','/'),
          'accounts.google.com':('/v3/signin/identifier','/v3/signin/challenge/pwd','/v3/signin/challenge','/v3/signin/rejected','/v3/signin','/signin/v2/identifier','/signin/v2/challenge','/signin/oauth','/signin','/o/oauth2/v2/auth','/o/oauth2/auth','/ServiceLogin','/AccountChooser','/'),
        }
        path=u.path or '/'
        for prefix in safe_paths.get(host,('/',)):
            if path==prefix:return origin+prefix
            if prefix!='/' and path.startswith(prefix+'/'):return origin+prefix+'/…'
        return origin+'/…'
    except (ValueError,TypeError):return 'about:blank'

def viewer_shot(args,ctx):
    with _LOCK:
        t=_viewer(args,ctx)
        w,h=_viewport(t)
        workspace=_VIEWER.get('purpose')=='workspace'
        quality=args.get('quality',55) if workspace else 55
        if type(quality) is not int or quality not in (35,55,75):raise ValueError('Unsupported display quality')
        started=time.monotonic()
        r=_display_command(t,'Page.captureScreenshot',{'format':'jpeg','quality':quality,'captureBeyondViewport':False})
        address=_display_url(t.get('url',''))
        _VIEWER['frame_size']=(w,h)
        result={'ok':True,'w':w,'h':h,'url':address,'url_redacted':True}
        if workspace:
            etag=hashlib.sha256(r['data'].encode('ascii')).hexdigest()
            result.update(etag=etag,capture_ms=round((time.monotonic()-started)*1000))
            if args.get('etag')==etag:
                result['unchanged']=True
                return result
        result['img']=r['data']
        return result

def _number(value,low,high):
    if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or not low<=value<=high:raise ValueError('Invalid viewer input')
    return value

def viewer_input(args,ctx):
    with _LOCK:
        t=_viewer(args,ctx);kind=args.get('kind');p=args.get('payload')
        if _VIEWER.get('purpose')=='lab':raise ValueError('Use the isolated lab pointer protocol')
        if not isinstance(p,dict):raise ValueError('Invalid viewer input')
        if kind in ('pointer_down','pointer_move','pointer_up','pointer_cancel'):
            if _VIEWER.get('purpose')!='workspace':raise ValueError('Workspace pointer input required')
            return _dispatch_pointer(t,kind.removeprefix('pointer_'),p)
        if _VIEWER.get('pressed') and kind in ('click','move','wheel'):
            return _error('Release pointer before other mouse input')
        if kind=='type':
            text=p.get('text')
            if not isinstance(text,str) or len(text)>2048:raise ValueError('Invalid text input')
            _command(t,'Input.insertText',{'text':text})
        elif kind in ('click','move','wheel'):
            xf=_number(p.get('xf'),0,1);yf=_number(p.get('yf'),0,1)
            frame=_VIEWER.get('frame_size')
            if not frame:return _error('Wait for the first viewer frame')
            if kind=='click':
                _command(t,'Page.bringToFront',{})
                if _viewport(t)!=frame:return _error('Viewport changed; wait for a fresh frame before clicking')
            w,h=frame;x=xf*(w-1);y=yf*(h-1)
            q={'x':x,'y':y}
            if kind=='click':
                target=_click_target(t,x,y)
                _command(t,'Input.dispatchMouseEvent',dict(q,type='mousePressed',button='left',buttons=1,clickCount=1))
                _command(t,'Input.dispatchMouseEvent',dict(q,type='mouseReleased',button='left',buttons=0,clickCount=1))
                return {'ok':True,'applied':True,'click_target':target,'press_ack':True,'release_ack':True}
            elif kind=='move':_command(t,'Input.dispatchMouseEvent',dict(q,type='mouseMoved'))
            else:_command(t,'Input.dispatchMouseEvent',dict(q,type='mouseWheel',deltaX=_number(p.get('deltaX',0),-3000,3000),deltaY=_number(p.get('deltaY',0),-3000,3000)))
        elif kind=='key':
            key=p.get('key');mod=p.get('modifiers',0)
            allowed={'Backspace':8,'Tab':9,'Enter':13,'Escape':27,'PageUp':33,'PageDown':34,'End':35,'Home':36,'ArrowLeft':37,'ArrowUp':38,'ArrowRight':39,'ArrowDown':40,'Delete':46}
            if key not in allowed or not isinstance(mod,int) or not 0<=mod<=15:raise ValueError('Unsupported viewer key')
            q={'key':key,'windowsVirtualKeyCode':allowed[key],'modifiers':mod}
            _command(t,'Input.dispatchKeyEvent',dict(q,type='keyDown',**({'text':'\r'} if key=='Enter' else {})))
            _command(t,'Input.dispatchKeyEvent',dict(q,type='keyUp'))
        else:raise ValueError('Unsupported viewer input')
        return {'ok':True,'applied':True}

# Fixed, read-only focus classification. Do not inspect field values, names,
# identifiers, page text, DOM snapshots, key contents, or credentials.
_FOCUS_EXPRESSION = """(() => {
 const e=document.activeElement;
 let field='none';
 if(e){
   if(e instanceof HTMLInputElement){
     const type=e.type;
     field=type==='password'?'password':(['text','email','tel','url','search','number'].includes(type)?'text':'other');
     if(e.disabled||e.readOnly)field='readonly';
   }else if(e instanceof HTMLTextAreaElement)field=e.disabled||e.readOnly?'readonly':'textarea';
   else if(e.isContentEditable)field='editable';
   else if(e.tagName==='IFRAME')field='frame';
   else if(e.tagName==='BUTTON')field='button';
   else field='other';
 }
 return {field,focused:document.hasFocus(),viewport_width:innerWidth,viewport_height:innerHeight};
})()"""
_FOCUS_FIELDS={'none','password','text','other','readonly','textarea','editable','frame','button','unknown'}

def viewer_navigate(args,ctx):
    # Human-entered address, same owner and active tab; no arbitrary CDP commands.
    url=_url(args.get('url'))
    with _LOCK:
        t=_viewer(args,ctx)
        if _VIEWER.get('purpose')!='workspace':return _error('Setup viewer navigation is fixed')
        if _VIEWER.get('pressed'): _dispatch_pointer(t,'cancel',{})
        r=_command(t,'Page.navigate',{'url':url})
        if r.get('errorText'):return _error('Browser navigation failed')
        return {'ok':True}

def viewer_controls(args,ctx):
    with _LOCK:
        t=_viewer(args,ctx)
        if _VIEWER.get('purpose')!='workspace':return _error('Workspace controls required')
        action=args.get('action')
        if action not in ('back','forward','reload','tabs','new_tab','switch_tab','close_tab','viewport'):
            return _error('Unknown browser control')
        if action!='tabs' and _VIEWER.get('pressed'):
            r=_dispatch_pointer(t,'cancel',{})
            if not r.get('ok'):return r
        if action in ('back','forward'):
            history=_command(t,'Page.getNavigationHistory',{})
            i=history.get('currentIndex',-1)+(-1 if action=='back' else 1);entries=history.get('entries',[])
            if 0<=i<len(entries):_command(t,'Page.navigateToHistoryEntry',{'entryId':entries[i]['id']})
            else:return {'ok':True,'boundary':True}
        elif action=='reload':_command(t,'Page.reload',{})
        elif action=='viewport':
            size=args.get('size')
            presets={'small':(960,640),'standard':(1200,800),'large':(1440,900)}
            if size not in presets:return _error('Unsupported viewport')
            w,h=presets[size]
            _display_command(t,'Emulation.setDeviceMetricsOverride',{'width':w,'height':h,'deviceScaleFactor':1,'mobile':False})
            _VIEWER['viewport']=(w,h);_VIEWER.pop('frame_size',None)
        else:
            tabs=_tabs()
            handles=_VIEWER.setdefault('tab_handles',{})
            live={x['id'] for x in tabs}
            for k,v in list(handles.items()):
                if v not in live:handles.pop(k,None)
            if _VIEWER['tab'] not in handles.values():handles[secrets.token_urlsafe(12)]=_VIEWER['tab']
            if action=='new_tab':
                if len(tabs)>=_MAX_TABS:return _error('Browser tab limit reached')
                dest=_http('/json/new?about%3Ablank',method='PUT')
                handles[secrets.token_urlsafe(12)]=dest['id']
            elif action in ('switch_tab','close_tab'):
                selected=handles.get(args.get('tab')) if isinstance(args.get('tab'),str) else None
                if not selected:return _error('Tab unavailable')
                _target(selected)
                if action=='close_tab':
                    if len(handles)<=1:return _error('Cannot close the last workspace tab')
                    req=urllib.request.Request('http://127.0.0.1:'+str(_PORT)+'/json/close/'+selected)
                    with _OPENER.open(req,timeout=4) as r:r.read(1024)
                    if selected==_VIEWER['tab']:
                        dest=next(x for x in tabs if x['id']!=selected and x['id'] in handles.values())
                    else:dest=t
                    handles.pop(args['tab'],None)
                else:dest=_target(selected)
            else:dest=t
            if dest['id']!=_VIEWER['tab']:
                _close_display_cdp()
                _command(dest,'Page.bringToFront',{})
                w,h=_VIEWER.get('viewport',(_WIDTH,_HEIGHT))
                _VIEWER['tab']=dest['id'];_VIEWER.pop('frame_size',None)
                _display_command(dest,'Emulation.setDeviceMetricsOverride',{'width':w,'height':h,'deviceScaleFactor':1,'mobile':False})
            tabs=_tabs();byid={x['id']:x for x in tabs}
            return {'ok':True,'tabs':[{'id':k,'label':_display_url(byid[v].get('url','')),'active':v==_VIEWER['tab']} for k,v in handles.items() if v in byid]}
        return {'ok':True}

def viewer_diagnostics(args,ctx):
    with _LOCK:
        t=_viewer(args,ctx)
        r=_command(t,'Runtime.evaluate',{'expression':_FOCUS_EXPRESSION,'returnByValue':True,'timeout':5000})
        v=r.get('result',{}).get('value')
        if 'exceptionDetails' in r or not isinstance(v,dict):return _error('Focus diagnostic unavailable')
        return {'ok':True,'field':v.get('field') if isinstance(v.get('field'),str) and v.get('field') in _FOCUS_FIELDS else 'unknown',
                'focused':v.get('focused') is True,'graphical':_GRAPHICAL,
                **{k:v[k] for k in ('viewport_width','viewport_height') if type(v.get(k)) is int and 0<v[k]<=8192}}

def viewer_recipe(args,ctx):
    """Trusted server supplies a fixed recipe, never a UI-provided expression.
    Session ownership and the same tab are checked before evaluation.
    Only whitelisted status/field names cross the viewer boundary.
    """
    expr=args.get('expr')
    if args.get('confirm') is not True or not isinstance(expr,str) or not 1<=len(expr)<=65536:
        return _error('Recipe confirmation required')
    with _LOCK:
        t=_viewer(args,ctx)
        if _VIEWER.get('purpose')=='lab':raise ValueError('Recipe unavailable in the lab')
        r=_command(t,'Runtime.evaluate',{'expression':expr,'returnByValue':True,'awaitPromise':True,'timeout':10000})
        v=r.get('result',{}).get('value')
        states={'sign_in_required','outside_setup','open_create_form','review_required','existing_values','select_web_type','form_ready','prepared','login_email','login_password','login_verification','login_denied','login_unknown','login_returned'}
        if 'exceptionDetails' in r or not isinstance(v,dict) or v.get('state') not in states:
            return _error('Setup page not recognized')
        fields=v.get('fields',[])
        return {'ok':True,'state':v['state'],'fields':[f for f in fields if isinstance(f,str) and f in ('name','redirect_uri','web_type')] if isinstance(fields,list) else []}

def viewer_stop(args,ctx):
    with _LOCK:
        _viewer(args,ctx)
        _stop() # Flush persistent profile by normal Chromium shutdown. Temporary profile is removed.
        return {'ok':True}

def _guard(fn):
    def run(args,ctx):
        try:return fn(args,ctx)
        except ValueError as e:return _error('Invalid or expired viewer input' if fn is viewer_input else str(e))
        except Exception:return _error('Linux Chromium unavailable or browser operation failed')
    return run

METHODS={k:_guard(v) for k,v in {'status':status,'tabs':tabs,'navigate':navigate,'eval':evaluate,'close':close,'stop':stop,'viewer_open':viewer_open,'viewer_lab_open':viewer_lab_open,'viewer_lab_pointer':viewer_lab_pointer,'viewer_resume':viewer_resume,'viewer_reconnect':viewer_reconnect,'viewer_close_existing':viewer_close_existing,'viewer_shot':viewer_shot,'viewer_input':viewer_input,'viewer_diagnostics':viewer_diagnostics,'viewer_controls':viewer_controls,'viewer_navigate':viewer_navigate,'viewer_stop':viewer_stop,'viewer_recipe':viewer_recipe}.items()}
# Start only the inexpensive idle monitor, not Chromium, on daemon import.
_timer=threading.Timer(30,_reap);_timer.daemon=True;_timer.start()
