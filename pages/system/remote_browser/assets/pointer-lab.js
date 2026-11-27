'use strict';
(() => {
 const $=id=>document.getElementById(id),img=$('frame');
 const base='/apps/system/cdp/viewer/';
 let sid=null,busy=false,active=null,queue=[],pumping=false,timer=null,sent=0,acked=0,ready=false;
 const post=async(action,data)=>{try{const r=await fetch(base+action,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});return await r.json();}catch(_){return {ok:false,error:'Request failed'};}};
 const status=s=>$('status').textContent=s;
 const sync=()=>{$('start').disabled=busy||!!sid||!$('endpoint').value;$('stop').disabled=busy||!sid;$('endpoint').disabled=busy||!!sid;$('close-existing').disabled=busy||!!sid||!$('endpoint').value;};
 const point=e=>{const r=img.getBoundingClientRect();return {xf:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),yf:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))};};
 function enqueue(kind,payload){
  if(!sid||!ready)return;
  const last=queue.at(-1);
  if(kind==='move'&&last?.kind==='move'&&!last.started)last.payload=payload;
  else queue.push({kind,payload,sid,started:false});
  pump();
 }
 async function pump(){
  if(pumping)return;pumping=true;
  try{while(queue.length){
   const e=queue[0];e.started=true;
   if(e.sid===sid){
    sent++;const r=await post('lab_pointer',{session:sid,kind:e.kind,payload:e.payload});
    if(r.ok&&r.applied)acked++;
    else status('Pointer event not acknowledged. Release and retry.');
    $('counts').textContent='Sent: '+sent+' · Acknowledged: '+acked;
   }
   queue.shift();
  }}finally{pumping=false;}
 }
 img.addEventListener('pointerdown',e=>{
  if(!sid||!ready||active!==null||e.button!==0)return;
  e.preventDefault();active=e.pointerId;img.setPointerCapture(active);enqueue('down',point(e));
 });
 img.addEventListener('pointermove',e=>{if(e.pointerId===active){e.preventDefault();enqueue('move',point(e));}});
 img.addEventListener('pointerup',e=>{
  if(e.pointerId!==active)return;
  e.preventDefault();enqueue('up',point(e));active=null;
 });
 function cancel(){if(active!==null){active=null;enqueue('cancel',{});}}
 img.addEventListener('pointercancel',cancel);img.addEventListener('lostpointercapture',cancel);window.addEventListener('blur',cancel);
 img.addEventListener('wheel',e=>{if(!sid||!ready)return;e.preventDefault();const u=e.deltaMode===1?16:e.deltaMode===2?img.clientHeight:1;enqueue('wheel',{...point(e),deltaX:Math.max(-3000,Math.min(3000,e.deltaX*u)),deltaY:Math.max(-3000,Math.min(3000,e.deltaY*u))});},{passive:false});
 async function poll(s){
  if(s!==sid)return;
  const r=await post('shot',{session:s});
  if(s!==sid)return;
  if(r.ok&&r.img){img.src='data:image/jpeg;base64,'+r.img;img.hidden=false;$('placeholder').hidden=true;ready=true;}
  else if(!r.ok){status(r.error||'Frame unavailable. Close the lab and reopen.');}
  timer=setTimeout(()=>poll(s),600);
 }
 $('start').addEventListener('click',async()=>{
  if(busy||sid||!$('endpoint').value)return;
  if(!confirm('Start a disposable browser containing only the local lab fixture?'))return;
  busy=true;sync();status('Starting lab…');
  const r=await post('lab_open',{endpoint:$('endpoint').value,confirm:true});
  if(r.ok&&typeof r.session==='string'){sid=r.session;sent=acked=0;ready=false;status('Lab connected. Wait for the first frame.');poll(sid);}
  else status(r.error||'Lab could not start.');
  busy=false;sync();
 });
 $('close-existing').addEventListener('click',async()=>{
  if(busy||sid||!$('endpoint').value)return;
  if(!confirm('Close your existing Remote Browser workspace? Open tabs and temporary browsing data will be lost.'))return;
  busy=true;sync();
  const r=await post('close_existing',{endpoint:$('endpoint').value,confirm:true});
  status(r.ok?'Workspace closed. Start lab.':(r.error||'Workspace close failed.')+' If the browser is already closed, try Start lab again.');
  busy=false;sync();
 });
 $('stop').addEventListener('click',async()=>{
  if(busy||!sid)return;busy=true;sync();cancel();
  const s=sid,r=await post('stop',{session:s});
  if(r.ok){sid=null;ready=false;clearTimeout(timer);queue.length=0;img.hidden=true;img.removeAttribute('src');$('placeholder').hidden=false;status('Lab closed.');}
  else status(r.error||'Close failed. Retry.');
  busy=false;sync();
 });
 window.addEventListener('pagehide',()=>{if(sid){try{fetch(base+'stop',{method:'POST',credentials:'same-origin',keepalive:true,headers:{'Content-Type':'application/json'},body:JSON.stringify({session:sid})});}catch(_){}}});
 $('endpoint').addEventListener('change',sync);
 (async()=>{busy=true;sync();const r=await post('endpoints',{});for(const ep of r.endpoints||[]){const o=document.createElement('option');o.value=ep.id;o.textContent=ep.id;$('endpoint').append(o);}status(r.ok?'Select an endpoint and start lab.':r.error||'Endpoint discovery failed.');busy=false;sync();})();
})();
