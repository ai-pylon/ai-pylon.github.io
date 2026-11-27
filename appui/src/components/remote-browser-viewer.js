/* AppUIRemoteBrowserViewer — mirror a SERVER-SIDE browser tab (JPEG frames over
 * SSE) in an AppUIDialog (or any container) and relay pointer / keyboard input.
 * Extracted from the gkeep Google sign-in viewer so any app that drives a remote
 * browser tab (login/MFA/captcha hand-off, page-automation "needs human") can use it.
 *
 *   await AppUIAssets.load('remoteBrowserViewer');
 *   const v = AppUIRemoteBrowserViewer.create({
 *     baseUrl: '/apps/personal/gkeep/signin',   // mount exposing open/input/stop/shot/stream
 *     session: 'abc',                           // OR attachTabId:'<tab>' (opens/attaches first)
 *     title: 'Sign in', why: 'optional first status line',
 *     detectStep: url => 'label for this page',  // live status line (pure policy, per app)
 *     onFrame: (meta, viewer) => {},             // every frame/meta {url,w,h,left_login,...}
 *     onDone: viewer => {},                      // server says finished (left_login / done)
 *     onClose: viewer => {},                     // user closed the dialog
 *     debugger: {readFocus: session => Promise, boundedInput: true}, // optional sanitized diagnostics
 *     transport: {...}                           // optional (mock / other protocol), see below
 *   });
 *   v.setProgress('Working…', 'sub', done?);  v.stop();  v.destroy();
 *
 * Server contract (default transport, all under baseUrl):
 *   POST /open {attach_tab_id|session,headful} -> {ok,session,tab_id}
 *   POST /input {session,kind:move|click|wheel|key|type,payload} -> {ok,applied}
 *   POST /stop {session};  GET /shot?session= -> {img,url,w,h,needs_headful,left_login}
 *   GET  /stream?session= (SSE: frame | meta | done)
 * Custom transport: {open(body), input(session,kind,payload), stop(session),
 *   shot(session), stream(session) -> {addEventListener(name,fn), close()}}.
 * Pointer coords are sent as normalized fractions (xf,yf in 0..1) so the server maps
 * them to its own CSS viewport independent of frame/device pixel size.
 */
const AppUIRemoteBrowserViewer = (() => {
  const PX = 'appui-rbv';
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c])); }

  function defaultTransport(baseUrl) {
    const post = (path, body) => fetch(baseUrl + path, {method: 'POST', credentials: 'same-origin',
      headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body || {})})
      .then(r => r.json().catch(() => ({}))).catch(() => ({}));
    return {
      open: body => post('/open', body),
      input: (session, kind, payload) => post('/input', {session, kind, payload}),
      stop: session => post('/stop', {session}),
      shot: session => fetch(`${baseUrl}/shot?session=${encodeURIComponent(session)}`, {credentials: 'same-origin'}).then(r => r.json()),
      // binary=1: frames arrive as {seq}; the JPEG is fetched as image/jpeg from /frame (no base64 in JSON).
      stream: session => new EventSource(`${baseUrl}/stream?session=${encodeURIComponent(session)}&binary=1`),
    };
  }

  // WebSocket transport: ONE socket per session carries frames as raw JPEG bytes
  // (binary messages -> Blob object URLs, no base64/JSON) + meta/done text messages,
  // and input as text messages acked by id. Falls back to the HTTP transport
  // (POST input, SSE stream) if the socket can't open.
  function wsTransport(baseUrl) {
    const http = defaultTransport(baseUrl);
    const socks = {};   // session -> {ws, open, pending:{id:resolve}, seq, listeners}
    function sock(session) {
      if (socks[session]) return socks[session];
      const loc = window.location || {};
      const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = /^wss?:/.test(baseUrl) ? baseUrl : `${proto}//${loc.host}${baseUrl}`;
      const s = {ws: new WebSocket(`${url}/ws?session=${encodeURIComponent(session)}`), open: false, failed: false,
                 pending: {}, seq: 0, listeners: {}, lastUrl: null};
      s.ws.binaryType = 'blob';
      s.ready = new Promise(res => {
        s.ws.onopen = () => { s.open = true; res(true); };
        s.ws.onerror = () => { s.failed = true; res(false); };
      });
      const emit = (name, data) => (s.listeners[name] || []).forEach(f => f({data: JSON.stringify(data)}));
      s.ws.onmessage = ev => {
        if (typeof ev.data !== 'string') {
          if (s.lastUrl) { try { URL.revokeObjectURL(s.lastUrl); } catch (e) { /* ignore */ } }
          s.lastUrl = URL.createObjectURL(ev.data);
          emit('frame', {src: s.lastUrl, url: s.meta && s.meta.url});
          return;
        }
        let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m.type === 'ack') { const r = s.pending[m.id]; delete s.pending[m.id]; if (r) r({ok: m.ok, error: m.error}); }
        else if (m.type === 'meta') { s.meta = m; emit('meta', m); }
        else if (m.type === 'done') emit('done', m);
      };
      s.ws.onclose = () => { s.open = false; Object.values(s.pending).forEach(r => r({ok: false, error: 'socket closed'})); s.pending = {}; delete socks[session]; };
      socks[session] = s;
      return s;
    }
    return {
      kind: 'ws',
      open: http.open, shot: http.shot,
      stop: session => { const s = socks[session]; if (s) { try { s.ws.close(); } catch (e) { /* ignore */ } } return http.stop(session); },
      input: async (session, kind, payload) => {
        const s = sock(session);
        if (!(await s.ready) || !s.open) return http.input(session, kind, payload);
        const id = ++s.seq;
        return new Promise(res => { s.pending[id] = res; s.ws.send(JSON.stringify({id, kind, payload})); });
      },
      stream: session => {
        const s = sock(session);
        let fallback = null;
        const handle = {
          addEventListener(name, fn) { (s.listeners[name] = s.listeners[name] || []).push(fn); if (fallback) fallback.addEventListener(name, fn); },
          close() { if (fallback) fallback.close(); try { s.ws.close(); } catch (e) { /* ignore */ } if (s.lastUrl) { try { URL.revokeObjectURL(s.lastUrl); } catch (e) { /* ignore */ } } },
        };
        s.ready.then(ok => {
          if (ok) return;
          fallback = http.stream(session);   // socket failed -> SSE
          Object.entries(s.listeners).forEach(([n, fs]) => fs.forEach(f => fallback.addEventListener(n, f)));
        });
        return handle;
      },
    };
  }

  // A transport may mark its URL as already sanitized by its trusted backend.
  // Always strip query, fragment and userinfo; other transports show origin only.
  function displayUrl(d) {
    if (!d || typeof d.url !== 'string') return 'unavailable';
    if (d.url === 'about:blank') return d.url;
    try {
      const u = new URL(d.url);
      if (!['https:', 'http:'].includes(u.protocol)) return 'unavailable';
      return u.origin + (d.url_redacted === true ? u.pathname : (u.pathname === '/' ? '/' : '/…'));
    } catch (_) { return 'unavailable'; }
  }
  const node = (tag,text) => { const e=document.createElement(tag); if(text) e.textContent=text; return e; };

// Normalize shared viewer events to the bounded Linux input protocol.
function createInputRelay(post,notify,onSkip=()=>{}){
 const keys=new Set(['Backspace','Tab','Enter','Escape','PageUp','PageDown','End','Home','ArrowLeft','ArrowUp','ArrowRight','ArrowDown','Delete']);
 let lastMove=0;
 const clamp=(v,min,max)=>Math.min(max,Math.max(min,v));
 return async(session,kind,payload)=>{
  let events=[];
  const p=payload||{};
  if(kind==='move'){
   if(Date.now()-lastMove<400){onSkip('move','throttled');return {ok:true,applied:true};}
   lastMove=Date.now();
  }
  if(kind==='move'||kind==='click'||kind==='wheel'){
   if(!Number.isFinite(p.xf)||!Number.isFinite(p.yf)){onSkip(kind,'invalid');return {ok:true,applied:true};}
   const q={xf:clamp(p.xf,0,1),yf:clamp(p.yf,0,1)};
   if(kind==='wheel'){q.deltaX=clamp(Number.isFinite(p.deltaX)?p.deltaX:0,-3000,3000);q.deltaY=clamp(Number.isFinite(p.deltaY)?p.deltaY:0,-3000,3000);}
   events.push([kind,q]);
  }else if(kind==='type'){
   const chars=Array.from(typeof p.text==='string'?p.text:'');
   for(let i=0;i<chars.length;i+=1024)events.push(['type',{text:chars.slice(i,i+1024).join('')}]);
  }else if(kind==='key'){
   const m=Number.isInteger(p.modifiers)?p.modifiers&15:0;
   if(keys.has(p.key))events.push(['key',{key:p.key,modifiers:m}]);
   else if(p.key?.toLowerCase()==='a'&&(m===2||m===4)){
    // Select all in a single-line field using already-supported keys.
    events.push(['key',{key:'Home',modifiers:0}],['key',{key:'End',modifiers:8}]);
   }else{
    notify('This keyboard shortcut is not supported in the remote viewer.');
    return {ok:true,applied:true};
   }
  }else return {ok:true,applied:true};
  for(const [k,q] of events){
   const r=await post('input',{session,kind:k,payload:q});
   if(!r?.ok||r.applied===false){notify(r?.error||'Input was not acknowledged. Retry only if the action did not occur.');return r||{ok:false};}
  }
  if(events.length&&kind!=='move')notify('Browser input acknowledged.');
  return {ok:true,applied:true};
 };
}
// Debugger stores only aggregate event categories, acknowledgements and timings.
// No text, key names, coordinates, URLs, field values, sessions or screenshots.
function viewerDebugger(readFocus,getSession,isActive=()=>true){
 const panel=node('details');panel.className=PX+'-debug';panel.open=true;
 const summary=node('summary','Viewer debugger');
 const address=node('p','URL: waiting for frame');address.setAttribute('aria-label','Remote browser URL');
 const state=node('p','Local keyboard: not focused · Remote field: checking…');
 const counts=node('p','');
 const clickInfo=node('p','');clickInfo.setAttribute('aria-label','Mouse click diagnostics');
 const mouse=node('p','');mouse.setAttribute('aria-label','Mouse movement diagnostics');
 const trace=node('pre');trace.setAttribute('aria-label','Sanitized viewer event trace');
 const controls=node('div');controls.className=PX+'-debug-actions';
 let focus=false,remote=readFocus?'checking…':'not supported',frames=0,received=0,ack=0,rejected=0,keys=0,texts=0,clicks=0,checking=false,lastFrame=null;
 let nextCheck=0,dirty=true,focusAge=null;
 let clickRelay=0,clickSent=0,clickAck=0,clickReject=0,clickSkip=0,clickTarget='unchecked',clickPair='unchecked',clickLatency=null,frameSize='waiting',renderPending=false;
 let moveLocal=0,moveRelay=0,moveSent=0,moveAck=0,moveReject=0,moveThrottle=0,moveInvalid=0,moveLast=null,moveLatency=null,moveRender=0;
 const history=[];
 const allowed=new Set(['none','password','text','other','readonly','textarea','editable','frame','button','unknown']);
 const button=(label,fn)=>{const b=node('button',label);b.type='button';b.addEventListener('click',fn);return b;};
 function render(){
  if(renderPending)return;renderPending=true;
  queueMicrotask(()=>{renderPending=false;paint();});
 }
 function paint(){
  state.textContent='Local keyboard: '+(focus?'focused':'not focused')+' · Remote field: '+remote+(focusAge===null?'':' · Checked '+new Date(focusAge).toLocaleTimeString());
  counts.textContent='Local key events: '+keys+' | Text events: '+texts+' | Clicks: '+clicks+' | Sent: '+received+' | ACK: '+ack+' | Rejected: '+rejected+' | Frames: '+frames+(lastFrame===null?'':' | Last frame: '+lastFrame+' ms');
  clickInfo.textContent='Mouse click: local '+clicks+' | Relay '+clickRelay+' | Sent '+clickSent+' | ACK '+clickAck+' | Rejected '+clickReject+' | Skipped '+clickSkip+' | Target '+clickTarget+' | Press/release '+clickPair+(clickLatency===null?'':' | '+clickLatency+' ms')+' | Viewport '+frameSize;
  mouse.textContent='Mouse movement: local '+moveLocal+' | Relay '+moveRelay+' | Sent '+moveSent+' | CDP ACK '+moveAck+' | Rejected '+moveReject+' | Throttled '+moveThrottle+' | Invalid '+moveInvalid+(moveLast===null?'':' | Last ACK '+new Date(moveLast).toLocaleTimeString()+' ('+moveLatency+' ms)');
  trace.textContent=history.join('\n');
 }
 function add(kind,status,ms){
  if(!['click','move','wheel','key','type','Remote focus','Local focus','Frame'].includes(kind))kind='event';
  history.push(new Date().toLocaleTimeString()+'  '+kind+' · '+status+(Number.isFinite(ms)?' · '+Math.round(ms)+' ms':''));
  if(history.length>24)history.shift();render();
 }
 async function check(){
  if(checking||!isActive()||!getSession()||!readFocus)return;checking=true;dirty=false;nextCheck=Date.now()+1500;
  try{
   const start=performance.now(),r=await readFocus(getSession());
   if(!isActive())return;focusAge=Date.now();
   remote=r.ok&&allowed.has(r.field)?r.field+(r.focused?' (page focused)':' (page not focused)'):'unavailable';
   add('Remote focus',r.ok&&allowed.has(r.field)?remote:'not available',performance.now()-start);
  }catch(e){remote='unavailable';add('Remote focus','not available');}finally{checking=false;render();}
 }
 function attach(v){
  const relay=v.el.querySelector('.appui-rbv-key'),image=v.el.querySelector('.appui-rbv-img');
  const focusRelay=()=>{v.focusInput();focus=document.activeElement===relay;add('Local focus',focus?'focused':'not focused');};
  if(relay){
   focus=document.activeElement===relay;
   relay.addEventListener('focus',()=>{focus=true;add('Local focus','focused');});
   relay.addEventListener('blur',()=>{focus=false;add('Local focus','lost');});
   relay.addEventListener('keydown',()=>{keys++;render();},true);
   relay.addEventListener('input',()=>{texts++;render();},true);
  }
  if(image){
   image.addEventListener('click',()=>{clicks++;dirty=true;render();},true);
   image.addEventListener('pointermove',()=>{moveLocal++;if(Date.now()-moveRender>=100){moveRender=Date.now();render();}},true);
  }
  controls.append(button('Focus keyboard',focusRelay));if(readFocus)controls.append(button('Check remote focus',check));controls.append(button('Clear diagnostics',()=>{history.length=0;frames=received=ack=rejected=keys=texts=clicks=0;lastFrame=null;moveLocal=moveRelay=moveSent=moveAck=moveReject=moveThrottle=moveInvalid=0;moveLast=moveLatency=null;clickRelay=clickSent=clickAck=clickReject=clickSkip=0;clickTarget=clickPair='unchecked';clickLatency=null;render();}));
  panel.append(summary,node('p','CDP acknowledgement confirms delivery to Chromium, not insertion into a field. No input contents are recorded.'),address,state,counts,clickInfo,mouse,controls,trace);v.el.append(panel);
  const content=v.el.closest('.ui-dialog-content');if(content)content.style.overflowY='auto';
  if(image){image.style.objectFit='contain';image.style.width='auto';image.style.height='auto';const resize=()=>{image.style.maxHeight=panel.open?'max(180px, calc(90vh - 410px))':'calc(90vh - 180px)';};panel.addEventListener('toggle',resize);resize();}render();
  void check();
 }
 return {attach,check,relay(kind){if(kind==='click'){clickRelay++;render();}if(kind==='move'){moveRelay++;render();}},skip(kind,reason){if(kind==='click'){clickSkip++;render();}if(kind==='move'){if(reason==='throttled')moveThrottle++;else moveInvalid++;render();}},request(kind){if(kind==='click'){clickSent++;render();}if(kind==='move'){moveSent++;render();return;}received++;add(kind,'sent');},response(kind,r,ms){if(kind==='click'){
  if(r?.ok&&r.applied===true)clickAck++;else clickReject++;
  const targets=new Set(['button','disabled','link','text','password','textarea','editable','frame','other','none','unknown']);
  clickTarget=targets.has(r?.click_target)?r.click_target:'unknown';
  clickPair=(r?.press_ack?'ACK':'?')+'/'+(r?.release_ack?'ACK':'?');clickLatency=Math.round(ms);render();
 }if(kind==='move'){if(r?.ok&&r.applied===true){moveAck++;moveLast=Date.now();moveLatency=Math.round(ms);}else moveReject++;render();return;}if(r?.ok&&r.applied!==false){ack++;dirty=true;add(kind,'CDP acknowledged',ms);}else{rejected++;add(kind,'not acknowledged',ms);}},frame(r,ms){if(r?.url)address.textContent='URL: '+displayUrl(r);if(r?.img||r?.src||r?.seq!=null){frames++;lastFrame=Number.isFinite(ms)?Math.round(ms):null;if(Number.isInteger(r.w)&&Number.isInteger(r.h))frameSize=r.w+'×'+r.h;render();if(isActive()&&!checking&&Date.now()>=nextCheck&&(dirty||focusAge===null||Date.now()-focusAge>=5000))void check();}else if(r?.ok===false)add('Frame','unavailable',ms);}};
}

  function create(options = {}) {
    const cfg = {title: 'Remote browser', width: 'min(1000px,92vw)', maxImgVh: 82, boxVh: 94, primeShots: 1, ...options};
    // transport: an object, or 'ws' (default when WebSocket exists) / 'http' (POST input + SSE stream)
    const tsel = cfg.transport || (typeof WebSocket === 'function' && typeof URL !== 'undefined' && URL.createObjectURL ? 'ws' : 'http');
    const transport = typeof tsel === 'object' ? tsel : (tsel === 'ws' ? wsTransport(cfg.baseUrl || '') : defaultTransport(cfg.baseUrl || ''));
    const owner = (window.AppUILifecycle && AppUILifecycle.createScope) ? AppUILifecycle.createScope() : null;
    let session = cfg.session || null, tabId = cfg.attachTabId || null;
    let es = null, dlg = null, body = null, view = null, finished = false, destroyed = false, askedHeadful = false;
    let lastMove = 0, rectCache = null, shown = null, raf = 0;
    let debug = null, boundedRelay = null;
    injectStyles();

    // ---- DOM ---------------------------------------------------------------
    const wrap = document.createElement('div');
    wrap.className = `${PX}-wrap`;
    wrap.innerHTML =
      `<div class="${PX}-status"><div class="${PX}-step"></div>` +
      `<div class="${PX}-urlrow"><span>page:</span><span class="${PX}-url"></span></div></div>` +
      `<img class="${PX}-img" alt="${esc(cfg.title)}" draggable="false">` +
      `<input class="${PX}-key" aria-label="keyboard relay">`;
    const img = wrap.querySelector(`.${PX}-img`), stepEl = wrap.querySelector(`.${PX}-step`);
    const urlEl = wrap.querySelector(`.${PX}-url`), keyIn = wrap.querySelector(`.${PX}-key`);
    // image cap leaves room for the dialog title + status bar so short screens never scroll
    img.style.maxHeight = cfg.maxImgVh ? `calc(${cfg.boxVh}vh - 130px)` : '';
    body = wrap; view = wrap;
    stepEl.textContent = cfg.why ? (cfg.labels?.why ? cfg.labels.why(cfg.why) : cfg.why) : (cfg.labels?.opening || 'Opening the viewer…');

    function setStep(text) { stepEl.textContent = text; }
    function updateUrl(d) {
      if (!d || typeof d.url !== 'string') return;
      urlEl.textContent = displayUrl(d);
      urlEl.title = urlEl.textContent;
      if (cfg.detectStep) { const s = cfg.detectStep(d.url); if (s) setStep(s); }
    }
    // Frames are painted at most once per animation frame, and not at all while the tab is hidden.
    function schedulePaint() {
      if (typeof document.hidden !== 'undefined' && document.hidden) return;
      if (typeof requestAnimationFrame !== 'function') { flushPaint(); return; }
      if (!raf) raf = requestAnimationFrame(flushPaint);
    }
    function flushPaint() { raf = 0; if (shown && !destroyed) { img.src = shown; rectCache = null; shown = null; } }
    function paint(d, latency) {
      if (!d) return;
      if (debug) debug.frame(d,latency);
      updateUrl(d);
      if (d.src) { shown = d.src; schedulePaint(); }
      else if (d.img) { shown = 'data:image/jpeg;base64,' + d.img; schedulePaint(); }
      else if (d.seq != null && session && cfg.baseUrl) { shown = `${cfg.baseUrl}/frame?session=${encodeURIComponent(session)}&seq=${d.seq}`; schedulePaint(); }
      headful(d.needs_headful);
      try { cfg.onFrame && cfg.onFrame(d, api); } catch (e) { /* app callback must not break the stream */ }
      if (d.left_login) done();
    }

    // ---- input relay -------------------------------------------------------
    function position(ev, fresh) {
      const rect = (!fresh && rectCache) || (rectCache = img.getBoundingClientRect());
      const cw = img.clientWidth || rect.width, ch = img.clientHeight || rect.height;
      return {xf: clamp((ev.clientX - rect.left - img.clientLeft) / cw), yf: clamp((ev.clientY - rect.top - img.clientTop) / ch)};
    }
    function clamp(v) { return Math.min(1, Math.max(0, v)); }
    // Input pump: serialized, with COALESCING so a slow link never builds a backlog —
    // consecutive pending `move`s keep only the latest, `wheel`s sum their deltas,
    // `type`s concatenate their text. Clicks/keys are never dropped or reordered.
    const pending = []; let pumping = false, refreshAfterInput = false;
    // Keep a short trail of genuine pointer samples, not an unbounded
    // queue. The endpoint receives only positions observed by the local UI.
    const MAX_PENDING_POINTER = 4;
    function send(kind, payload) {
      if (kind !== 'move') refreshAfterInput = true;
      if (cfg.statefulPointer === true && (kind === 'pointer_move' || kind === 'move')) {
        let first = pending.length;
        while (first > 0) {
          const prev = pending[first - 1];
          if (prev.started || prev.session !== session || prev.kind !== kind) break;
          first--;
        }
        const count = pending.length - first;
        if (count >= MAX_PENDING_POINTER) {
          // Keep the oldest unsent sample and the recent path, including the
          // latest sample. Never cross a press, release or cancellation.
          pending.splice(first + 1, count - MAX_PENDING_POINTER + 1);
        }
        pending.push({kind, payload, session, started: false});
        pump();
        return;
      }
      const last = pending[pending.length - 1];
      if (last && last.kind === kind && !last.started) {
        if (kind === 'move' || kind === 'pointer_move') { last.payload = payload; return; }
        if (kind === 'wheel') { last.payload = {...payload, deltaX: (last.payload.deltaX || 0) + (payload.deltaX || 0), deltaY: (last.payload.deltaY || 0) + (payload.deltaY || 0)}; return; }
        if (kind === 'type') { last.payload = {text: (last.payload.text || '') + (payload.text || '')}; return; }
      }
      pending.push({kind, payload, session, started: false});
      pump();
    }
    async function deliver(s,kind,payload) {
      const start=performance.now();if(debug)debug.request(kind);
      try {const r=await transport.input(s,kind,payload);if(debug)debug.response(kind,r,performance.now()-start);return r;}
      catch(e){if(debug)debug.response(kind,{ok:false},performance.now()-start);throw e;}
    }
    async function pump() {
      if (pumping) return; pumping = true;
      try {
        while (pending.length) {
          const item = pending[0]; item.started = true;
          try {
            if (item.session && item.session === session) {
              if(debug)debug.relay(item.kind);
              const r = boundedRelay ? await boundedRelay(item.session,item.kind,item.payload) : await deliver(item.session,item.kind,item.payload);
              if (!r || !r.ok || r.applied === false) throw new Error((r && r.error) || 'input not applied');
            }
          } catch (e) { setStep(cfg.labels?.inputFailed || 'Input could not reach the browser. Please retry or reopen.'); }
          pending.shift();
        }
      } finally {
        pumping = false;
        if (refreshAfterInput && cfg.statefulPointer === true && session && !destroyed && !finished && !document.hidden && !es) {
          pollDelay = 500;
          if (pollTimer !== null) {
            clearTimeout(pollTimer);
            pollTimer = setTimeout(poll, 80);
          }
        }
        refreshAfterInput = false;
      }
    }    const on = (t, ev, fn, o) => owner ? owner.listen(t, ev, fn, o) : t.addEventListener(ev, fn, o);
    let activePointer = null;
    function cancelPointer() {
      if (activePointer === null) return;
      activePointer = null;
      send('pointer_cancel', {});
    }
    if (cfg.statefulPointer === true) {
      img.style.touchAction = 'none';
      img.style.userSelect = 'none';
      on(img, 'pointerdown', ev => {
        if (!ev.isTrusted || !session || !img.complete || !img.naturalWidth || ev.button !== 0 || activePointer !== null) return;
        ev.preventDefault(); keyIn.focus({preventScroll: true});
        try { img.setPointerCapture(ev.pointerId); } catch (_) { return; }
        activePointer = ev.pointerId;
        send('pointer_down', position(ev,true));
      });
      on(img, 'pointermove', ev => {
        if (!ev.isTrusted || !session) return;
        if (activePointer !== null) {
          if (ev.pointerId !== activePointer) return;
          if (!(ev.buttons & 1)) { cancelPointer(); return; }
          ev.preventDefault();
          // Chromium may deliver several hardware samples in one event.
          // Use those observations where available, then include the actual
          // delivered endpoint if it differs. No generated intermediate path.
          const samples = typeof ev.getCoalescedEvents === 'function' ? ev.getCoalescedEvents() : [];
          let previous = null;
          for (const sample of [...samples.slice(-MAX_PENDING_POINTER), ev]) {
            if (sample.pointerId !== activePointer || !(sample.buttons & 1)) continue;
            const point = position(sample,true);
            if (previous && previous.xf === point.xf && previous.yf === point.yf) continue;
            send('pointer_move',point); previous = point;
          }
        } else {
          if (ev.buttons !== 0 || !img.complete || !img.naturalWidth) return;
          const samples = typeof ev.getCoalescedEvents === 'function' ? ev.getCoalescedEvents() : [];
          let previous = null;
          for (const sample of [...samples.slice(-MAX_PENDING_POINTER), ev]) {
            if (sample.buttons !== 0 || sample.pointerId !== ev.pointerId) continue;
            const point = position(sample,true);
            if (previous && previous.xf === point.xf && previous.yf === point.yf) continue;
            send('move',point); previous = point;
          }
        }
      });
      on(img, 'pointerup', ev => {
        if (!ev.isTrusted || ev.pointerId !== activePointer) return;
        ev.preventDefault(); activePointer = null;
        send('pointer_up',position(ev,true));
      });
      on(img,'pointercancel',cancelPointer);
      on(img,'lostpointercapture',cancelPointer);
      on(window,'blur',cancelPointer);
      on(img,'dragstart',ev=>ev.preventDefault());
      // A native click follows pointerup; do not send a second click.
      on(img,'click',ev=>ev.preventDefault());
    } else {
      on(img, 'pointermove', ev => { if (Date.now() - lastMove < 80) return; lastMove = Date.now(); send('move', position(ev)); });
      on(img, 'click', ev => { const point=position(ev,true); keyIn.focus({preventScroll: true}); send('click', point); });
    }
    on(img, 'wheel', ev => {
      ev.preventDefault();
      if (cfg.statefulPointer === true && activePointer !== null) return;
      const p = position(ev), unit = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? img.clientHeight : 1;
      p.deltaX = ev.deltaX * unit; p.deltaY = ev.deltaY * unit; send('wheel', p);
    }, {passive: false});
    on(keyIn, 'keydown', ev => {
      if (ev.isComposing) return;
      const modifiers = (ev.altKey ? 1 : 0) | (ev.ctrlKey ? 2 : 0) | (ev.metaKey ? 4 : 0) | (ev.shiftKey ? 8 : 0);
      if (ev.key.length > 1 || ((ev.ctrlKey || ev.metaKey) && !/^[cvx]$/i.test(ev.key))) {
        if (['Shift', 'Control', 'Alt', 'Meta'].includes(ev.key)) return;
        ev.preventDefault(); ev.stopPropagation();
        send('key', {key: ev.key, code: ev.code, modifiers});
      }
    });
    const flushText = ev => { if (ev && ev.isComposing) return; const t = keyIn.value; keyIn.value = ''; if (t) send('type', {text: t}); };
    on(keyIn, 'input', flushText);
    on(keyIn, 'compositionend', flushText);

    function headful(needs) {
      if (!needs || askedHeadful || !cfg.allowHeadful) return;
      askedHeadful = true;
      stepEl.textContent = (cfg.labels?.declined || 'The site declined this headless browser. ') ;
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = cfg.labels?.useHeadful || 'Use background headed browser';
      b.onclick = () => { b.disabled = true; Promise.resolve(transport.open({session, headful: true})).then(r => { if (!r || !r.ok) b.disabled = false; }); };
      stepEl.appendChild(b);
    }

    // ---- stream ------------------------------------------------------------
    let captureGeneration = 0, primeTimer = null, pollTimer = null;
    const captureActive = generation => generation === captureGeneration && !destroyed && !finished && !!session && !document.hidden;
    function prime(tries) {
      const generation = captureGeneration;
      if (!captureActive(generation)) return;
      Promise.resolve().then(() => captureActive(generation) ? transport.shot(session) : null).then(d => { if (captureActive(generation)) paint(d); }).catch(() => {})
        .then(() => { if (tries > 0 && captureActive(generation)) primeTimer = setTimeout(() => prime(tries - 1), 700); });
    }
    function connect() {
      closeStream();
      if (!captureActive(captureGeneration)) return;
      try {
        es = transport.stream(session);
        prime(cfg.primeShots);
        es.addEventListener('frame', e => paint(JSON.parse(e.data || '{}')));
        es.addEventListener('meta', e => paint(JSON.parse(e.data || '{}')));
        es.addEventListener('done', () => done());
      } catch (e) { poll(); }
    }
    // poll fallback (no EventSource): back off 0.5s -> 4s while the frame is unchanged, reset on change.
    // ROUND4 #30: the last frame's etag goes back to transport.shot(session, etag) - a transport that supports it
    // (system/cdp signin_shot) answers {unchanged:true} with no image, so an idle sign-in page costs a few bytes.
    let pollDelay = 500, lastPolled = '', lastEtag = '';
    function poll() {
      pollTimer = null;
      const generation = captureGeneration;
      if (!captureActive(generation)) return;
      const started=performance.now();
      Promise.resolve().then(() => captureActive(generation) ? transport.shot(session, lastEtag) : null).then(d => {
        if (!captureActive(generation)) return;
        if (d && d.etag) lastEtag = d.etag;
        if (d && d.unchanged) { pollDelay = Math.min(cfg.statefulPointer === true ? 1000 : 4000, pollDelay * 1.5); return; }
        const sig = d ? (d.etag || ((d.img || '').length + '|' + d.url)) : '';
        pollDelay = sig === lastPolled ? Math.min(cfg.statefulPointer === true ? 1000 : 4000, pollDelay * 1.5) : 500; lastPolled = sig;
        paint(d,performance.now()-started);
      }).catch(() => { if(debug)debug.frame({ok:false},performance.now()-started); pollDelay = Math.min(4000, pollDelay * 2); }).then(() => { if (captureActive(generation)) pollTimer = setTimeout(poll, pollDelay); });
    }
    function onVisibility() {
      if (destroyed || finished || !session) return;
      if (document.hidden) { cancelPointer(); closeStream(); } else if (!es) connect();
    }
    function onPageHide() {
      cancelPointer();
      if (session && cfg.stopOnClose !== false && !cfg.transport && navigator.sendBeacon) {
        try { navigator.sendBeacon((cfg.baseUrl || '') + '/stop', new Blob([JSON.stringify({session})], {type: 'application/json'})); } catch (e) { /* ignore */ }
      }
    }
    if (typeof document.addEventListener === 'function') on(document, 'visibilitychange', onVisibility);
    if (typeof window.addEventListener === 'function') on(window, 'pagehide', onPageHide);
    if (typeof window.addEventListener === 'function') on(window, 'resize', () => { rectCache = null; });
    function closeStream() { captureGeneration++; clearTimeout(primeTimer); clearTimeout(pollTimer); primeTimer = pollTimer = null; try { es && es.close(); } catch (e) { /* ignore */ } es = null; }
    function done() {
      if (finished) return; finished = true;
      closeStream();
      try { cfg.onDone && cfg.onDone(api); } catch (e) { /* ignore */ }
    }

    // ---- dialog ------------------------------------------------------------
    function expandBox() {   // AppUIDialog caps its box at 80vh + scrolls content; lift it so the viewer fits
      try {
        let node = body, box = null, content = null;
        for (let i = 0; node && i < 6; i++, node = node.parentNode) {
          const c = String(node.className || '');
          if (/ui-dialog-box/.test(c)) { box = node; break; }
          if (/ui-dialog-content/.test(c)) content = node;
        }
        if (box) { box.style.maxHeight = cfg.boxVh + 'vh'; box.style.height = 'auto'; }
        if (content) { content.style.overflowY = 'visible'; content.style.overflowX = 'hidden'; }
      } catch (e) { /* best-effort */ }
    }
    function mount() {
      if (cfg.container) cfg.container.appendChild(wrap);
      else if (window.AppUIDialog) {
        dlg = AppUIDialog.show({title: cfg.title, body: wrap, width: cfg.width, closable: true,
          onClose: () => { dlg = null; if (!destroyed) { try { cfg.onClose && cfg.onClose(api); } finally { teardown(false); } } }});
        expandBox();
      } else throw new Error('AppUIRemoteBrowserViewer needs AppUIDialog or a container');
    }

    function setProgress(msg, sub, isDone) {
      closeStream();
      view = null;
      wrap.innerHTML = `<div class="${PX}-progress${isDone ? ' is-done' : ''}"><div class="${PX}-spinner">${isDone ? '✓' : ''}</div>` +
        `<div class="${PX}-pmsg">${esc(msg)}</div><div class="${PX}-psub">${sub || ''}</div></div>`;
    }

    function teardown(closeDialog = true) {
      if (destroyed) return; cancelPointer(); destroyed = true;
      closeStream();
      const s = session; session = null;
      try { owner && owner.destroy(); } catch (e) { /* ignore */ }
      if (closeDialog && dlg && window.AppUIDialog) { try { AppUIDialog.close(dlg); } catch (e) { /* ignore */ } }
      dlg = null;
      if (cfg.container) wrap.remove();
      if (s && cfg.stopOnClose !== false) { try { transport.stop(s); } catch (e) { /* ignore */ } }
    }

    // `stop()` releases the stream+input but keeps the dialog (e.g. to show progress);
    // `release()` additionally tells the server to drop the session.
    function stop() { closeStream(); const s = session; session = null; finished = true; if (s) { try { transport.stop(s); } catch (e) { /* ignore */ } } }

    const api = {
      el: wrap, setStep, setProgress, stop,
      get session() { return session; }, get tabId() { return tabId; },
      get dialog() { return dlg; },
      focusInput() { keyIn.focus({preventScroll: true}); },
      update(next) { Object.assign(cfg, next || {}); },
      destroy() { teardown(true); },
    };

    mount();
    if(cfg.debugger){
      const opt=typeof cfg.debugger==='object'?cfg.debugger:{};
      debug=viewerDebugger(typeof opt.readFocus==='function'?opt.readFocus:null,()=>session,()=>!destroyed&&!finished&&!!session&&(!opt.isActive||opt.isActive()));
      if(opt.boundedInput)boundedRelay=createInputRelay((_,a)=>deliver(a.session,a.kind,a.payload),msg=>{setStep(msg);if(opt.onInputNotice)opt.onInputNotice(msg);},(k,reason)=>debug.skip(k,reason));
      debug.attach(api);
    }
    if (session) connect();
    else {
      Promise.resolve(transport.open(cfg.attachTabId ? {attach_tab_id: cfg.attachTabId} : {})).then(r => {
        if (destroyed) { if (r && r.session) transport.stop(r.session); return; }
        if (r && r.ok && r.session) { session = r.session; tabId = r.tab_id || tabId; connect(); if(debug)void debug.check(); }
        else setStep((cfg.labels?.openFailed || 'Could not open the viewer: ') + ((r && r.error) || '?'));
      });
    }
    return api;
  }

  function injectStyles() {
    if (document.getElementById(`${PX}-styles`)) return;
    const s = document.createElement('style'); s.id = `${PX}-styles`;
    s.textContent = `
.${PX}-wrap{width:100%;display:flex;flex-direction:column;gap:6px;position:relative}
.${PX}-status{display:flex;flex-direction:column;gap:2px;padding:2px 2px 4px}
.${PX}-step{font-size:13px;font-weight:600;color:var(--text,#222)}
.${PX}-urlrow{font-size:11px;color:var(--text-muted,#888);display:flex;gap:6px;align-items:baseline}
.${PX}-urlrow>span:first-child{opacity:.7}
.${PX}-url{font-family:ui-monospace,monospace;word-break:break-all}
.${PX}-img{display:block;max-width:100%;width:auto;height:auto;margin:0 auto;border:1px solid var(--border,#ddd);border-radius:6px;cursor:pointer;background:#fff}
.${PX}-key{position:absolute;opacity:0;pointer-events:none}
.${PX}-debug{border:1px solid var(--border,#888);border-radius:6px;padding:8px;font-size:12px}
.${PX}-debug summary{font-weight:600;cursor:pointer}
.${PX}-debug p{margin:4px 0;line-height:1.4;overflow-wrap:anywhere}
.${PX}-debug-actions{display:flex;gap:6px;flex-wrap:wrap;margin:4px 0}
.${PX}-debug pre{max-height:110px;overflow:auto;white-space:pre-wrap;margin:4px 0;font-size:11px}
.${PX}-progress{display:flex;flex-direction:column;align-items:center;gap:8px;padding:20px 12px;min-width:320px}
.${PX}-spinner{width:34px;height:34px;border:3px solid var(--border,#ddd);border-top-color:var(--accent,#3b82f6);border-radius:50%;animation:${PX}-spin .9s linear infinite;display:flex;align-items:center;justify-content:center;font-size:20px;color:var(--accent,#3b82f6)}
.${PX}-progress.is-done .${PX}-spinner{animation:none;border-color:var(--accent,#3b82f6)}
.${PX}-pmsg{font-weight:600}.${PX}-psub{font-size:12px;color:var(--text-muted,#888);text-align:center}
@keyframes ${PX}-spin{to{transform:rotate(360deg)}}`;
    document.head.appendChild(s);
  }
  return {create, wsTransport, httpTransport: defaultTransport};
})();
window.AppUIRemoteBrowserViewer = AppUIRemoteBrowserViewer;
