"""Opt-in local supervisor handshake. No remote update capability."""
import asyncio,json,os,sys,time
from pathlib import Path
DIR=os.environ.get('PYLON2_LOCAL_UPDATE_SESSION')
ROOT=Path(DIR) if DIR else None
active=0
uncertain=False
exiting=False
connected=False
source=None
caps=[]
def mode():
    if ROOT is None:return 'run'
    try:
        v=(ROOT/'control').read_text()
        return v if v in ('run','hold','drain','exit') else 'hold'
    except OSError:return 'hold'
def admit():
    global active
    if mode()!='run':return False
    active+=1;return True
def finish():
    global active
    active=max(0,active-1)
def disconnect():
    global uncertain,connected
    if active:uncertain=True
    connected=False
    if ROOT is not None:
        try:(ROOT/'status.json').unlink(missing_ok=True)
        except OSError:pass
def workloads():
    total=0
    for key in ('workload_runtime','daemons.workload_runtime'):
        mod=sys.modules.get(key)
        if mod is not None:
            with mod.LOCK:total+=len(mod.ACTIVE)
    return total
def idle():
    return not active and not workloads() and not uncertain
def rejected(msg):
    return {'type':'result','id':msg.get('id'),'ok':False,'error':'Endpoint maintenance in progress','error_category':'unavailable'}
async def monitor(ws,sha,capabilities):
    global exiting,connected,source,caps
    if ROOT is None:return
    connected=True;source=sha;caps=sorted(capabilities)
    last_report=None;last_sent=0
    try:
        while True:
            state=mode()
            row={'pid':os.getpid(),'source_sha256':source,'registered':connected,'capabilities':caps,'mode':state,'active':active,'workloads':workloads(),'uncertain':uncertain,'idle':idle(),'at':time.time()}
            temp=ROOT/'status.tmp';temp.write_text(json.dumps(row));os.replace(temp,ROOT/'status.json')
            try:
                path=ROOT.parent/'update-events.json'
                events=json.loads(path.read_text()) if path.stat().st_size<=32768 else []
            except (OSError,ValueError):events=[]
            report={'mode':state,'active':active,'workloads':row['workloads'],'uncertain':uncertain,'events':events[-16:] if isinstance(events,list) else []}
            fingerprint=json.dumps(report,sort_keys=True)
            if fingerprint!=last_report or time.monotonic()-last_sent>=15:
                await ws.send(json.dumps({'type':'heartbeat','update_status':report}))
                last_report=fingerprint;last_sent=time.monotonic()
            if state=='exit' and idle():
                exiting=True;await ws.close();return
            await asyncio.sleep(.2)
    finally:disconnect()
