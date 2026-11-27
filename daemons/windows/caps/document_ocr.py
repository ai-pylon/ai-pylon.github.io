"""Fixed bounded image OCR. No caller-supplied commands, paths or URLs."""
import base64,io,os,shutil,subprocess,threading,re,hashlib
from pathlib import Path

CAPABILITY='cap:document.ocr'
VARIANT='tesseract'
ATTRS={'windows':True}
MAX_INPUT=4*1024*1024
MAX_PIXELS=8_000_000
LOCK=threading.BoundedSemaphore(1)

def executable():
    for p in (shutil.which('tesseract'),r'C:\Program Files\Tesseract-OCR\tesseract.exe',r'C:\Program Files (x86)\Tesseract-OCR\tesseract.exe'):
        if p and Path(p).is_file():return p
    return None

def recognize(args,ctx):
    if not isinstance(args,dict) or set(args)!={'image_b64'}:return {'ok':False,'error':'Only image bytes accepted'}
    encoded=args['image_b64']
    if not isinstance(encoded,str) or not 1<=len(encoded)<=4*((MAX_INPUT+2)//3):return {'ok':False,'error':'Invalid image size'}
    if not LOCK.acquire(blocking=False):return {'ok':False,'error':'OCR busy'}
    try:
        from PIL import Image
        raw=base64.b64decode(encoded,validate=True)
        if not 1<=len(raw)<=MAX_INPUT:raise ValueError()
        with Image.open(io.BytesIO(raw)) as img:
            if img.format not in ('PNG','JPEG','WEBP','TIFF') or img.width*img.height>MAX_PIXELS or getattr(img,'n_frames',1)!=1:raise ValueError()
            # Decode and normalize to pixels; discard metadata and extra content.
            clean=io.BytesIO();img.convert('RGB').save(clean,format='PNG')
        binary=executable()
        if not binary:return {'ok':False,'error':'Tesseract unavailable'}
        env=os.environ.copy();env['OMP_THREAD_LIMIT']='2'
        r=subprocess.run([binary,'stdin','stdout','-l','kor+eng','--psm','3'],input=clean.getvalue(),capture_output=True,timeout=20,env=env,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        if r.returncode:return {'ok':False,'error':'OCR failed'}
        return {'ok':True,'text':r.stdout.decode('utf-8',errors='replace')[:200000]}
    except Exception:return {'ok':False,'error':'OCR unavailable or invalid image'}
    finally:LOCK.release()

def status(args,ctx):
    binary=executable();version=None;languages=[]
    if binary:
        try:
            flags=getattr(subprocess,'CREATE_NO_WINDOW',0)
            v=subprocess.run([binary,'--version'],capture_output=True,timeout=3,creationflags=flags)
            match=re.search(r'tesseract v?([0-9][0-9A-Za-z.\-]{0,39})',v.stdout.decode(errors='replace'))
            if v.returncode==0 and match:version=match[1]
            l=subprocess.run([binary,'--list-langs'],capture_output=True,timeout=3,creationflags=flags)
            if l.returncode==0:languages=[x for x in ('kor','eng') if x in l.stdout.decode(errors='replace').splitlines()]
        except Exception:pass
    try:import PIL;pil=True
    except ImportError:pil=False
    idle=LOCK.acquire(blocking=False)
    if idle:LOCK.release()
    return {'ok':True,'tesseract_available':bool(binary),'version':version,'languages':languages,'pillow_available':pil,'busy':not idle,'capability_revision':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()[:12]}
METHODS={'recognize':recognize,'status':status}
