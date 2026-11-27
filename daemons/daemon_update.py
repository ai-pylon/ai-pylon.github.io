"""Local-only passive daemon release supervisor; never replaces an external process.
Run from a reviewed release checkout, with existing passive agent env/config.
"""
from __future__ import annotations
import argparse,hashlib,io,json,os,re,stat,subprocess,sys,tempfile,time,uuid,zipfile
from pathlib import Path
from release_identity import COMMON,EXTRA,PLATFORMS,identity,sources,valid_digest
MAX=8*1024*1024

def safe_name(name,platform):
    fixed=set(COMMON)|{platform+'/'+n for n in ('agent.py','manifest.json',*EXTRA[platform])}
    return name in fixed or re.fullmatch(platform+r'/caps/[A-Za-z_][A-Za-z0-9_]*[.]py',name) is not None

def verify(path,digest,platform):
    if platform not in PLATFORMS or not valid_digest(digest):raise ValueError('Invalid expected release hash or platform')
    p=Path(path)
    if not p.is_file() or p.stat().st_size>MAX:raise ValueError('Archive unavailable or too large')
    raw=p.read_bytes()
    if hashlib.sha256(raw).hexdigest()!=digest:raise ValueError('Archive SHA-256 mismatch')
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        entries=z.infolist();names=[x.filename for x in entries]
        if len(entries)>129 or len(set(n.casefold() for n in names))!=len(names) or sum(x.file_size for x in entries)>MAX:raise ValueError('Invalid archive inventory')
        if any(x.is_dir() or stat.S_ISLNK(x.external_attr>>16) or x.flag_bits&1 for x in entries):raise ValueError('Invalid archive entry')
        manifest=json.loads(z.read('release.json'))
        if manifest.get('schema')!=1 or manifest.get('platform')!=platform or manifest.get('mode')!='passive':raise ValueError('Wrong release platform or mode')
        listed=manifest.get('files')
        if not isinstance(listed,dict) or set(names)!={'release.json',*('daemons/'+x for x in listed)} or any(not safe_name(x,platform) or not valid_digest(v) for x,v in listed.items()):raise ValueError('Unexpected release content')
        files={x:z.read('daemons/'+x) for x in listed}
        actual=identity(files)
        if actual['files']!=listed or actual['source_sha256']!=manifest.get('source_sha256'):raise ValueError('Source checksum mismatch')
        required=set(COMMON)|{platform+'/'+x for x in ('agent.py','manifest.json',*EXTRA[platform])}
        if not required<=set(files):raise ValueError('Incomplete release')
        for name,content in files.items():
            if name.endswith('.py'):compile(content,name,'exec')
        return actual['source_sha256'],files

def stage(zip_path,digest,platform,state):
    sha,files=verify(zip_path,digest,platform)
    root=Path(state).resolve()/'releases';root.mkdir(mode=0o700,parents=True,exist_ok=True)
    if root.resolve()!=root:raise ValueError('Linked release directory')
    dest=root/sha
    if dest.exists():
        if dest.resolve()!=dest or identity(sources(dest/'daemons',platform))!=identity(files):raise ValueError('Existing release differs')
        return dest
    temp=Path(tempfile.mkdtemp(prefix='.stage-',dir=root))
    try:
        for name,content in files.items():
            p=temp/'daemons'/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(content)
        if identity(sources(temp/'daemons',platform))!=identity(files):raise ValueError('Staged verification failed')
        temp.rename(dest)
    finally:
        if temp.exists():
            import shutil;shutil.rmtree(temp)
    return dest

def atomic(path,text):
    tmp=path.with_name('.'+path.name+'-'+uuid.uuid4().hex)
    with tmp.open('x') as f:f.write(text);f.flush();os.fsync(f.fileno())
    os.replace(tmp,path)

class Supervisor:
    def __init__(self,state,platform,timeout=40,drain_timeout=90):
        self.state=Path(state).resolve();self.platform=platform;self.timeout=timeout;self.drain_timeout=drain_timeout
        self.state.mkdir(mode=0o700,parents=True,exist_ok=True);self.child=None;self.session=None;self.current=None;self.current_sha=None;self.operation=uuid.uuid4().hex;self.target_sha=None
        self.lock=self.state/'supervisor.lock'
        fd=os.open(self.lock,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
        with os.fdopen(fd,'w') as f:f.write(str(os.getpid()))
    def event(self,phase):
        path=self.state/'update-events.json'
        try:rows=json.loads(path.read_text())
        except (OSError,ValueError):rows=[]
        if not isinstance(rows,list):rows=[]
        rows.append({'id':uuid.uuid4().hex,'operation':self.operation,'phase':phase,'source_sha256':self.current_sha,'target_sha256':self.target_sha,'at':int(time.time())})
        atomic(path,json.dumps(rows[-32:],separators=(',',':')))
    def command(self,mode):atomic(self.session/'control',mode)
    def status(self):
        try:
            d=json.loads((self.session/'status.json').read_text())
            if d.get('pid')==self.child.pid and abs(time.time()-d.get('at',0))<3:return d
        except (OSError,ValueError,TypeError,AttributeError):pass
        return {}
    def wait(self,predicate,seconds):
        until=time.monotonic()+seconds
        while time.monotonic()<until and self.child.poll() is None:
            row=self.status()
            if predicate(row):return row
            time.sleep(.1)
        return None
    def start(self,root,required=()):
        root=Path(root).resolve()
        sha=identity(sources(root/'daemons',self.platform))['source_sha256']
        self.session=self.state/('session-'+uuid.uuid4().hex);self.session.mkdir(mode=0o700)
        self.command('hold')
        env={**os.environ,'PYLON2_DAEMON_MODE':'passive','PYLON2_LOCAL_UPDATE_SESSION':str(self.session),'PYLON2_CAP_HOTRELOAD':'0'}
        # No alternate endpoint or config injected; use existing environment / host config.
        self.child=subprocess.Popen([sys.executable,str(root/'daemons'/self.platform/'agent.py')],cwd=root,env=env,stdin=subprocess.DEVNULL)
        self.current=root;self.current_sha=sha
        good=self.wait(lambda r:r.get('registered') is True and r.get('source_sha256')==sha and r.get('mode')=='hold' and set(required)<=set(r.get('capabilities',[])),self.timeout)
        if not good:return False
        # Require a fresh second report, not a one-shot registration.
        good=self.wait(lambda r:r.get('registered') is True and r.get('source_sha256')==sha and r.get('at',0)>good['at']+.5 and set(required)<=set(r.get('capabilities',[])),3)
        if not good:return False
        atomic(self.state/'current.json',json.dumps({'path':str(root),'source_sha256':sha,'platform':self.platform}));self.command('run')
        return True
    def stop_trial(self):
        # Trial held all invokes. Only terminate our own uncommitted child.
        if self.child is not None and self.child.poll() is None:
            self.command('exit')
            try:self.child.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self.child.terminate()
                try:self.child.wait(timeout=5)
                except subprocess.TimeoutExpired:raise RuntimeError('Trial did not stop; no rollback started')
    def drain(self):
        self.event('draining');self.command('drain')
        row=self.wait(lambda r:r.get('registered') is True and r.get('mode')=='drain' and r.get('idle') is True,self.drain_timeout)
        if not row:
            self.event('drain_timeout');self.command('run');return None
        self.event('stopping');self.command('exit')
        try:self.child.wait(timeout=20)
        except subprocess.TimeoutExpired:raise RuntimeError('Old daemon did not exit; inspect locally before retry')
        return row
    def update(self,root):
        old=self.current
        if identity(sources(old/'daemons',self.platform))['source_sha256']!=self.current_sha:raise ValueError('Current source changed; rollback cannot be guaranteed')
        if Path(root).resolve()==old:return 'already_current'
        # Check candidate integrity/compatibility before stopping the current child.
        self.operation=uuid.uuid4().hex;self.target_sha=identity(sources(Path(root)/'daemons',self.platform))['source_sha256']
        self.event('staged')
        row=self.drain()
        if row is None:return 'drain_timeout_old_retained'
        required=row['capabilities']
        try:
            self.event('trial')
            if self.start(root,required):self.event('updated');return 'updated'
        except (OSError,ValueError):pass
        self.stop_trial();self.event('rolling_back')
        try:
            if self.start(old,required):self.event('rolled_back');return 'rolled_back'
        except (OSError,ValueError):pass
        self.stop_trial();self.event('rollback_failed');return 'rollback_failed'
    def close(self):
        if self.child is not None and self.child.poll() is None:return False
        self.lock.unlink(missing_ok=True);return True

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--state',required=True);p.add_argument('--platform',choices=PLATFORMS,required=True)
    p.add_argument('--initial',required=True,help='Reviewed, lifecycle-enabled release directory (contains daemons/)');p.add_argument('--initial-source-sha256',required=True,help='Full source SHA-256 from authenticated release catalog');p.add_argument('--confirm-maintenance',action='store_true',help='Confirm other daemon is stopped; persistent browser/terminal sessions are closed')
    a=p.parse_args()
    if not a.confirm_maintenance:p.error('Explicit local maintenance confirmation required')
    if a.platform!=('windows' if os.name=='nt' else 'linux'):p.error('Platform mismatch')
    if not os.environ.get('PYLON2_ENDPOINT_ID') or not os.environ.get('PYLON2_FRAMEWORK_URL') or not os.environ.get('PYLON2_DATA_DIR'):p.error('Set existing endpoint ID, framework URL and stable PYLON2_DATA_DIR in local environment first')
    if not valid_digest(a.initial_source_sha256) or identity(sources(Path(a.initial)/'daemons',a.platform))['source_sha256']!=a.initial_source_sha256:p.error('Initial source checksum mismatch')
    s=Supervisor(a.state,a.platform)
    try:
        if not s.start(a.initial):
            s.stop_trial();raise RuntimeError('Initial release did not register')
        while True:
            cmd=input('Daemon supervisor [status/update/stop]: ').strip()
            if cmd=='status':print(json.dumps(s.status()))
            elif cmd=='update':
                path=input('Reviewed ZIP path: ').strip();digest=input('Expected ZIP SHA-256 from owner UI: ').strip()
                if input('Confirm persistent sessions closed and apply update? Type UPDATE: ')!='UPDATE':continue
                try:print(s.update(stage(path,digest,a.platform,a.state)))
                except (OSError,ValueError,zipfile.BadZipFile):print('Package rejected; current release retained')
            elif cmd=='stop':
                if input('Confirm maintenance stop? Type STOP: ')=='STOP' and s.drain():break
            if s.child.poll() is not None:break
    finally:
        if not s.close():print('Child still running. Lock retained; inspect locally. No process was force-stopped.')
if __name__=='__main__':main()
