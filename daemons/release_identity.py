"""Deterministic source identity for passive daemon packages (no host configuration)."""
import hashlib,json,re
from pathlib import Path

PLATFORMS=('windows','linux')
COMMON=('release_identity.py','update_runtime.py','daemon_update.py','serve_mode.py','server_conn_runtime.py','status_http.py','logging_bridge.py','ssh_bridge.py','work_sdk.py','workload_runtime.py')
EXTRA={'windows':(), 'linux':('downloader.py','requirements.txt')}
def sources(root,platform):
    root=Path(root).resolve()
    if platform not in PLATFORMS:raise ValueError('Unknown platform')
    names=list(COMMON)+[platform+'/'+x for x in ('agent.py','manifest.json',*EXTRA[platform])]
    caps=root/platform/'caps'
    if caps.is_symlink():raise ValueError('Linked capability directory')
    names.extend(platform+'/caps/'+p.name for p in caps.glob('*.py'))
    result={}
    for name in sorted(names):
        p=root/name
        if p.resolve()!=p or not p.is_file() or p.stat().st_size>2*1024*1024:raise ValueError('Missing, linked or oversized release source: '+name)
        result[name]=p.read_bytes()
    if len(result)>128 or sum(map(len,result.values()))>8*1024*1024:raise ValueError('Release too large')
    return result
def identity(files):
    hashes={name:hashlib.sha256(raw).hexdigest() for name,raw in sorted(files.items())}
    digest=hashlib.sha256(json.dumps(hashes,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    return {'source_sha256':digest,'files':hashes}
def startup_identity(root,platform):
    try:return identity(sources(root,platform))['source_sha256']
    except (OSError,ValueError):return None
def valid_digest(value):
    return isinstance(value,str) and re.fullmatch('[a-f0-9]{64}',value) is not None
