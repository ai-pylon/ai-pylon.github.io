'use strict';
(() => {
 const $=id=>document.getElementById(id);
 const eventNames=['pointerdown','pointermove','pointerup','pointercancel','click','dblclick','contextmenu','wheel','keydown','keyup','input','change','dragstart','dragover','drop','dragend','touchstart','touchmove','touchend'];
 const counts=Object.fromEntries(eventNames.map(x=>[x,0])),cells={};
 let clicks=0,doubles=0,drops=0,strokes=0,heldMoves=0,active=null,frame=0,last='No events yet';
 for(const name of eventNames){const el=document.createElement('div'),n=document.createElement('strong');n.textContent='0';el.append(name,n);$('counts').append(el);cells[name]=n;
 document.addEventListener(name,()=>{counts[name]++;last='Last event: '+name;if(!frame)frame=requestAnimationFrame(render);},{capture:true,passive:true});}
 function render(){frame=0;for(const name of eventNames)cells[name].textContent=String(counts[name]);$('last').textContent=last;}
 function clicksChanged(){$('click-result').textContent=clicks+' clicks · '+doubles+' double-clicks';}
 $('click').addEventListener('click',()=>{clicks++;clicksChanged();});
 $('double').addEventListener('dblclick',()=>{doubles++;clicksChanged();});
 function rangeChanged(){$('range-value').textContent=$('range').value;$('progress').value=Number($('range').value);}
 $('range').addEventListener('input',rangeChanged);
 const pad=$('pad'),ctx=pad.getContext('2d');
 ctx.strokeStyle='#255ac7';ctx.lineWidth=3;ctx.lineCap='round';ctx.lineJoin='round';
 function point(e){const r=pad.getBoundingClientRect();return [(e.clientX-r.left)*pad.width/r.width,(e.clientY-r.top)*pad.height/r.height];}
 function padChanged(){$('pad-result').textContent=strokes+' strokes · '+heldMoves+' held moves';}
 pad.addEventListener('pointerdown',e=>{if(active!==null||e.button!==0)return;active=e.pointerId;pad.setPointerCapture(active);ctx.beginPath();ctx.moveTo(...point(e));strokes++;padChanged();});
 pad.addEventListener('pointermove',e=>{if(e.pointerId!==active)return;ctx.lineTo(...point(e));ctx.stroke();heldMoves++;padChanged();});
 function finish(e){if(e.pointerId===active){active=null;padChanged();}}
 for(const name of ['pointerup','pointercancel','lostpointercapture'])pad.addEventListener(name,finish);
 for(const tile of document.querySelectorAll('.tile'))tile.addEventListener('dragstart',e=>{e.dataTransfer.setData('text/plain',tile.id);e.dataTransfer.effectAllowed='move';});
 for(const zone of document.querySelectorAll('.zone')){
  zone.addEventListener('dragover',e=>{e.preventDefault();zone.classList.add('over');e.dataTransfer.dropEffect='move';});
  zone.addEventListener('dragleave',()=>zone.classList.remove('over'));
  zone.addEventListener('drop',e=>{e.preventDefault();zone.classList.remove('over');const id=e.dataTransfer.getData('text/plain');if(!['tile-a','tile-b'].includes(id))return;zone.append($(id));drops++;$('drop-result').textContent=drops+' drops';});
 }
 function selection(){const el=document.activeElement;let n=0;if(el===$('typing'))n=Math.abs(el.selectionEnd-el.selectionStart);else n=String(window.getSelection()||'').length;$('text-result').textContent='Selection: '+n+' characters';}
 document.addEventListener('selectionchange',selection);$('typing').addEventListener('select',selection);
 for(let i=1;i<=16;i++){const row=document.createElement('div');row.textContent='Scrollable row '+i;$('scrollbox').append(row);}
 function scrolling(){const el=$('scrollbox');$('scroll-result').textContent='Scroll position: '+Math.round(100*el.scrollTop/Math.max(1,el.scrollHeight-el.clientHeight))+'%';}
 $('scrollbox').addEventListener('scroll',scrolling,{passive:true});
 $('reset').addEventListener('click',()=>{
  clicks=doubles=drops=strokes=heldMoves=0;active=null;for(const k of eventNames)counts[k]=0;last='Reset complete';
  ctx.clearRect(0,0,pad.width,pad.height);padChanged();clicksChanged();$('drop-result').textContent='0 drops';
  document.querySelector('[data-zone="A"]').append($('tile-a'),$('tile-b'));$('range').value='35';rangeChanged();$('check').checked=false;$('typing').value='';$('choice').selectedIndex=0;$('scrollbox').scrollTop=0;scrolling();selection();render();
 });
})();
