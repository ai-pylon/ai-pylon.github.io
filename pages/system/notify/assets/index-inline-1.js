
var BASE = '/v1/apps/system/notify';
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){
  return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
async function call(op, body){
  var r = await fetch(BASE+'/'+op,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(body||{})});
  return r.json();
}
// Pull a device-code-looking token out of a message so we can render it big + copyable.
function extractCode(msg){
  var m = /code:?\s*([A-Z0-9]{6,})/.exec(msg||'') || /enter\s+([A-Z0-9]{6,})/.exec(msg||'');
  return m ? m[1] : '';
}
function extractUrl(n){
  if(n.url) return n.url;
  var m = /(https?:\/\/[^\s]+)/.exec(n.message||'');
  return m ? m[1] : '';
}
function when(ts){ try{return new Date(ts*1000).toLocaleString();}catch(e){return '';} }
var _lastRev = '';
async function render(opts){
  var r = await call('list', (opts && opts.ifChanged && _lastRev) ? {limit:100, if_rev:_lastRev} : {limit:100});
  if(r && r.unchanged) return;          // NEXT4 #38: safety-net poll, nothing changed -> no payload, no re-render
  _lastRev = (r && r.rev) || '';
  var box = document.getElementById('list');
  document.getElementById('count').textContent =
    (r.unread||0)+' unread · '+(r.count||0)+' total · '+(r.level||'ok');
  var items = (r.notifications)||[];
  if(!items.length){ box.innerHTML='<div class="empty">No notifications.</div>'; return; }
  box.innerHTML='';
  items.forEach(function(n){
    var code = extractCode(n.message), url = extractUrl(n);
    // lifecycle status (#7): only upsert/resolve records carry it; a missing
    // status means a plain post (no lifecycle) — treat as not-done.
    var status = n.status || '';
    var isDone = (status === 'resolved' || status === 'denied' || status === 'expired');
    var el = document.createElement('div');
    el.className = 'card lv-'+(n.level||'ok')+(n.unread?' unread':'')+(isDone?' done':'');
    var statusPill = status ? '<span class="pill st-'+esc(status)+'">'+esc(status)+'</span>' : '';
    var h = '<div class="top"><span class="title">'+esc(n.title)+'</span>'+
            '<span class="pill">'+esc(n.level||'ok')+'</span>'+ statusPill +
            (n.unread?'<span class="pill" style="color:var(--accent)">new</span>':'')+'</div>';
    // message with the code stripped out (we show the code separately, big)
    var msg = esc(n.message);
    h += '<div class="msg">'+msg+'</div>';
    if(code){ h += '<div><span class="code" data-code="'+esc(code)+'" title="click to copy">'+esc(code)+'</span></div>'; }
    h += '<div class="acts">';
    if(url){ h += '<a href="'+esc(url)+'" target="_blank" rel="noopener">Open link ↗</a>'; }
    h += '<a href="#" data-read="'+esc(n.id)+'">Mark read</a>';
    h += '<a href="#" data-dismiss="'+esc(n.id)+'">Dismiss</a>';
    h += '<span class="ts" style="flex:1;text-align:right">'+esc(n.source||'')+' · '+when(n.ts)+'</span>';
    h += '</div>';
    el.innerHTML = h;
    box.appendChild(el);
  });
}
document.addEventListener('click', async function(e){
  var t = e.target;
  if(t.classList && t.classList.contains('code')){
    try{ await navigator.clipboard.writeText(t.getAttribute('data-code')); t.textContent='copied ✓';
      setTimeout(render, 900);}catch(_){}
    return;
  }
  if(t.dataset && t.dataset.read!==undefined){ e.preventDefault(); await call('read',{ids:[t.dataset.read]}); render(); }
  if(t.dataset && t.dataset.dismiss!==undefined){ e.preventDefault(); await call('dismiss',{ids:[t.dataset.dismiss]}); render(); }
});
document.getElementById('refresh').onclick = render;
document.getElementById('readall').onclick = async function(){ await call('read',{ids:'*'}); render(); };
document.getElementById('clearall').onclick = async function(){ await call('clear',{}); render(); };
document.getElementById('closebtn').onclick = function(){
  // In the frameless flyout the pywebview JS API closes the window; as a plain
  // browser tab, fall back to window.close().
  try{ if(window.pywebview && window.pywebview.api && window.pywebview.api.close){ window.pywebview.api.close(); return; } }catch(e){}
  try{ window.close(); }catch(e){}
};
render();
// #30: push-ish refresh via the events long-poll. The pane calls `events`
// (buffer+drain) with a cursor; any new event (or dropped>0) means the center
// changed -> re-render WITHIN a poll (a resolved/denied MFA prompt greys out
// near-instantly, instead of waiting up to 5s). A short poll interval keeps it
// responsive; the drain is cheap. The 15s list poll is kept as a safety net in
// case an event is missed (ring overflow / a restart that reset the cursor).
// NEXT_ROUND #19: the center's app_events stream is mirrored on the EventBus channel 'app:system/notify:center'.
// While the bus is connected the pane only re-renders on its pushes; without it (bus not loaded / disconnected) it
// long-polls `events` with wait=25 (the server holds the call until a change) instead of asking every 1.5 s.
var _evCursor = 0, _evPrimed = false, _busLive = false, _evBusy = false, _evTimer = null, _busTimer = null;
function _armPoll(ms){ clearTimeout(_evTimer); _evTimer = setTimeout(pollEvents, ms); }
async function pollEvents(){
  if (_busLive || _evBusy) return;
  _evBusy = true;
  try{
    var r = await call('events', _evPrimed ? {cursor: _evCursor, wait: 25} : {cursor: _evCursor});
    _evBusy = false;
    if(r && r.ok){
      var changed = (r.events && r.events.length) || (r.dropped && r.dropped > 0);
      _evCursor = (typeof r.cursor === 'number') ? r.cursor : _evCursor;
      if(changed && _evPrimed) render();
      _evPrimed = true;
      _armPoll(300);
      return;
    }
  }catch(e){ /* transient - try again shortly */ }
  _evBusy = false;
  _armPoll(5000);
}
function _startBus(){
  try{
    var ch = 'app:system/notify:center';
    var bus = new window.AppUIEventBus([ch]);
    bus.onAny(function(channel){
      if(channel !== ch) return;
      clearTimeout(_busTimer);
      _busTimer = setTimeout(render, 150);           // a burst of changes = one render
    });
    bus.onStatus(function(state){
      var live = state === 'connected';
      if(live === _busLive) return;
      _busLive = live;
      if(live){ clearTimeout(_evTimer); render(); }  // catch up on anything missed while switching
      else _armPoll(300);
    });
    window.addEventListener('pagehide', function(){ try{ bus.close(); }catch(e){} });
  }catch(e){ _busLive = false; }
}
pollEvents();
Promise.resolve(window.AppUIReady).then(function(){ if(typeof window.AppUIEventBus === 'function') _startBus(); },
                                         function(){ /* no AppUI: the long-poll stays */ });
setInterval(function(){ render({ifChanged: true}); }, 15000);  // safety-net refresh (events drive the fast path)
