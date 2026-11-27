/* Shared map route overlays, playback and export; only source geometry is drawn. */
window._AppUIMapRoute=(()=>{
  function create({map,canvas,rows=()=>[],onProgress,presentation=()=>null}){
    let route=null,lines=L.layerGroup().addTo(map),radius=L.layerGroup().addTo(map),head=null,points=[],distances=[],total=0,frame=0,progress=0,started=0,elapsed=0,duration=12000,paused=true,dead=false;
    const colors=['#2275cd','#ca5d23','#288653','#9949a5'];
    const coords=route=>(route?.polylinePoints||[]).map(p=>[Number(p.lat??p.latitude),Number(p.lng??p.longitude)]).filter(p=>p.every(Number.isFinite)&&Math.abs(p[0])<=85&&Math.abs(p[1])<=180);
    function at(fraction){
      if(!points.length)return null;const target=Math.max(0,Math.min(1,fraction))*total;let i=1;
      while(i<distances.length&&distances[i]<target)i++;
      if(i>=points.length)return points[points.length-1];const span=distances[i]-distances[i-1],part=span?(target-distances[i-1])/span:0;
      return [points[i-1][0]+(points[i][0]-points[i-1][0])*part,points[i-1][1]+(points[i][1]-points[i-1][1])*part];
    }
    function fractionAt(t,seconds){
      const pauses=[];let last=0;
      for(const stop of (route?.stops||[]).slice(1,-1)){
        const point=stop.coordinates||{latitude:stop.lat,longitude:stop.lng};if(point.latitude==null||point.longitude==null)continue;let best=Infinity,index=last;
        for(let i=last;i<points.length;i++){const d=map.distance([point.latitude,point.longitude],points[i]);if(d<best){best=d;index=i;}}
        last=index;pauses.push({fraction:total?distances[index]/total:0,seconds:Math.max(0,Math.min(120,Number(stop.stopSeconds??1.5)))});
      }
      const requested=pauses.reduce((sum,p)=>sum+p.seconds,0),scale=requested?Math.min(1,seconds*.75/requested):1,travel=seconds-requested*scale;
      let used=0,previous=0,target=t*seconds;
      for(const pause of pauses){const moving=(pause.fraction-previous)*travel;if(target<used+moving)return previous+(target-used)/travel;used+=moving;if(target<used+pause.seconds*scale)return pause.fraction;used+=pause.seconds*scale;previous=pause.fraction;}
      return Math.min(1,previous+(target-used)/travel);
    }
    function seek(value,fromTick=false){progress=Math.max(0,Math.min(1,Number(value)||0));if(!fromTick){pause();let lo=0,hi=1;for(let i=0;i<28;i++){const mid=(lo+hi)/2;if(fractionAt(mid,duration/1000)<progress)lo=mid;else hi=mid;}elapsed=hi*duration;}const point=at(progress);if(point){if(!head)head=L.circleMarker(point,{radius:9,color:'#222',weight:2,fillColor:'#ffc000',fillOpacity:1}).addTo(lines);else head.setLatLng(point);}onProgress?.(progress);return point;}
    function pause(){if(!paused)elapsed=Math.min(duration,performance.now()-started);paused=true;cancelAnimationFrame(frame);}
    function tick(now){if(dead||paused)return;seek(fractionAt(Math.min(1,(now-started)/duration),duration/1000),true);if(progress<1)frame=requestAnimationFrame(tick);else paused=true;}
    function play({seconds=12,resume=false}={}){if(points.length<2)throw new Error('No source route geometry to play');cancelAnimationFrame(frame);duration=Math.max(.2,Math.min(600,seconds))*1000;paused=false;started=performance.now()-(resume?elapsed:0);frame=requestAnimationFrame(tick);}
    function setRoute(value,{fit=true}={}){
      pause();elapsed=0;progress=0;route=value;lines.clearLayers();head=null;points=coords(route);distances=[0];total=0;
      for(let i=1;i<points.length;i++){total+=map.distance(points[i-1],points[i]);distances.push(total);}
      const legs=route?.legs?.filter(leg=>coords(leg).length>1)||[];
      if(legs.length)legs.forEach((leg,i)=>L.polyline(coords(leg),{color:colors[i%colors.length],weight:5}).addTo(lines));else if(points.length>1)L.polyline(points,{color:colors[0],weight:5}).addTo(lines);
      (route?.stops||[]).forEach((stop,index)=>{const p=stop.coordinates||{latitude:stop.lat,longitude:stop.lng};if(p.latitude==null||p.longitude==null)return;const marker=L.circleMarker([p.latitude,p.longitude],{radius:7,color:colors[index%colors.length],fillOpacity:1}).addTo(lines);const label=document.createElement('span');label.textContent=(index+1)+'. '+(stop.name||stop.title||'Stop');marker.bindTooltip(label);});
      if(fit&&points.length)map.fitBounds(points,{padding:[35,35]});if(points.length)seek(0);
    }
    function setRadius(center,metres){radius.clearLayers();if(center&&Number(metres)>0)L.circle([center.latitude,center.longitude],{radius:Number(metres),color:'#4686bf',fillOpacity:.08}).addTo(radius);}
    function geojson(){return {type:'FeatureCollection',features:[...(points.length?[{type:'Feature',properties:{title:route?.title,provider:route?.provider,source:route?.sourceUrl||'',updated:route?.updated},geometry:{type:'LineString',coordinates:points.map(p=>[p[1],p[0]])}}]:[]),...(route?.stops||[]).map((p,index)=>({type:'Feature',properties:{name:p.name||p.title,index},geometry:{type:'Point',coordinates:[p.coordinates?.longitude??p.lng,p.coordinates?.latitude??p.lat]}}))]};}
    function svg(){
      const ns='http://www.w3.org/2000/svg',el=document.createElementNS(ns,'svg');el.setAttribute('xmlns',ns);el.setAttribute('width',canvas.clientWidth);el.setAttribute('height',canvas.clientHeight);el.setAttribute('viewBox','0 0 '+canvas.clientWidth+' '+canvas.clientHeight);
      const line=document.createElementNS(ns,'polyline');line.setAttribute('points',points.map(p=>{const xy=map.latLngToContainerPoint(p);return xy.x+','+xy.y;}).join(' '));line.setAttribute('stroke',colors[0]);line.setAttribute('stroke-width','5');line.setAttribute('fill','none');el.append(line);
      const title=document.createElementNS(ns,'text');title.setAttribute('x','12');title.setAttribute('y','22');title.textContent=(route?.title||'Route')+' · Source: '+(route?.provider||'provided geometry');el.append(title);return new XMLSerializer().serializeToString(el);
    }
    function canvasFrame(fraction=progress){
      const output=document.createElement('canvas');output.width=canvas.clientWidth;output.height=canvas.clientHeight;const ctx=output.getContext('2d');ctx.fillStyle='#f1f2ee';ctx.fillRect(0,0,output.width,output.height);const rect=canvas.getBoundingClientRect();
      canvas.querySelectorAll('.leaflet-tile-loaded').forEach(img=>{const b=img.getBoundingClientRect();ctx.drawImage(img,b.x-rect.x,b.y-rect.y,b.width,b.height);});
      if(points.length){ctx.strokeStyle=colors[0];ctx.lineWidth=5;ctx.beginPath();points.forEach((point,index)=>{const p=map.latLngToContainerPoint(point);if(index)ctx.lineTo(p.x,p.y);else ctx.moveTo(p.x,p.y);});ctx.stroke();}
      rows().forEach(row=>{const c=row.coordinates||row;if(c.latitude==null||c.longitude==null)return;const p=map.latLngToContainerPoint([c.latitude,c.longitude]),appearance=presentation(row),style=appearance?.style;ctx.beginPath();ctx.arc(p.x,p.y,style?.radius||6,0,2*Math.PI);ctx.fillStyle=style?.fillColor||row.color||'#2275cd';ctx.fill();ctx.strokeStyle=style?.color||'#fff';ctx.lineWidth=style?.weight||1;ctx.stroke();if(appearance?.label){ctx.font='12px sans-serif';ctx.lineWidth=3;ctx.strokeStyle='#fff';ctx.strokeText(appearance.label,p.x+12,p.y+4);ctx.fillStyle='#222';ctx.fillText(appearance.label,p.x+12,p.y+4);}});
      const head=fraction==null?null:at(fraction);if(head){const p=map.latLngToContainerPoint(head);ctx.beginPath();ctx.arc(p.x,p.y,9,0,2*Math.PI);ctx.fillStyle='#ffc000';ctx.fill();ctx.strokeStyle='#333';ctx.lineWidth=2;ctx.stroke();}
      ctx.fillStyle='rgba(255,255,255,.9)';ctx.fillRect(0,output.height-23,output.width,23);ctx.fillStyle='#222';ctx.font='12px sans-serif';ctx.fillText((route?.title||'Saved places')+' · © OpenStreetMap contributors',8,output.height-7);return output;
    }
    async function png({head=true}={}){const output=canvasFrame(head?progress:null);return await new Promise((resolve,reject)=>output.toBlob(blob=>blob?resolve(blob):reject(new Error('Map image could not be exported')),'image/png'));}
    function scene(){return {width:canvas.clientWidth,height:canvas.clientHeight,points:points.map(point=>{const p=map.latLngToContainerPoint(point);return [p.x,p.y];}),stops:(route?.stops||[]).slice(1,-1).map(stop=>{const c=stop.coordinates||{latitude:stop.lat,longitude:stop.lng};if(c.latitude==null||c.longitude==null)return null;let index=0;for(let i=1;i<points.length;i++)if(map.distance([c.latitude,c.longitude],points[i])<map.distance([c.latitude,c.longitude],points[index]))index=i;return {fraction:total?distances[index]/total:0,seconds:Number(stop.stopSeconds??1.5)};}).filter(Boolean)};}
    async function video({seconds=12,fps=30}={}){
      if(points.length<2)throw new Error('A route with source geometry is required');if(!window.MediaRecorder)throw new Error('Video recording is unavailable in this browser');
      const background=canvasFrame(null),output=canvasFrame(0),ctx=output.getContext('2d'),stream=output.captureStream(0),chunks=[];const mime=['video/webm;codecs=vp8','video/webm;codecs=vp9','video/webm'].find(type=>MediaRecorder.isTypeSupported(type));if(!mime)throw new Error('WebM encoding is unavailable');const recorder=new MediaRecorder(stream,{mimeType:mime});let animation;
      const done=new Promise((resolve,reject)=>{recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};recorder.onerror=event=>reject(event.error||new Error('Video export failed'));recorder.onstop=()=>resolve(new Blob(chunks,{type:'video/webm'}));});
      recorder.start(100);stream.getVideoTracks()[0]?.requestFrame?.();const start=performance.now();const ms=Math.max(.2,Math.min(120,seconds))*1000;
      try{await new Promise((resolve,reject)=>{function draw(now){try{if(dead)throw new Error('Map was closed');const t=Math.min(1,(now-start)/ms);ctx.drawImage(background,0,0);const point=at(fractionAt(t,seconds));if(point){const p=map.latLngToContainerPoint(point);ctx.beginPath();ctx.arc(p.x,p.y,9,0,2*Math.PI);ctx.fillStyle='#ffc000';ctx.fill();ctx.strokeStyle='#333';ctx.lineWidth=2;ctx.stroke();}stream.getVideoTracks()[0]?.requestFrame?.();if(t<1)animation=requestAnimationFrame(draw);else resolve();}catch(error){reject(error);}}animation=requestAnimationFrame(draw);});await new Promise(resolve=>setTimeout(resolve,150));recorder.stop();const blob=await done;if(blob.size<256)throw new Error('Video encoder produced no frames');return blob;}
      finally{cancelAnimationFrame(animation);if(recorder.state!=='inactive')recorder.stop();stream.getTracks().forEach(track=>track.stop());}
    }
    return {setRoute,setRadius,play,pause,resume:()=>play({seconds:duration/1000,resume:true}),stop(){pause();elapsed=0;seek(0);},seek,geojson,svg,png,video,scene,destroy(){dead=true;pause();lines.remove();radius.remove();}};
  }
  function playbackDocument(route,{scene,background,seconds=12}={}){
    if(background&&!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(background))throw new Error('Playback backgrounds must be embedded PNG data');
    const json=JSON.stringify({...route,playbackScene:scene,playbackBackground:background,playbackSeconds:seconds}).replace(/</g,'\\u003c');
    // A self-contained geometry viewer; no external dependencies or source URL execution.
    const script=String(function(){
      const route=JSON.parse(document.getElementById('route').textContent),canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d'),slider=document.querySelector('input'),status=document.querySelector('p');
      document.querySelector('h1').textContent=route.title||'Route';status.textContent='Source: '+(route.provider||'provided geometry')+' · '+(route.sourceUrl||'')+' · '+(route.playbackScene?'Captured map':'Schematic view');
      const rows=(route.polylinePoints||[]).filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lng));
      if(rows.length<2){status.textContent+=' · No source geometry';return;}
      const xs=rows.map(p=>p.lng),ys=rows.map(p=>p.lat),minx=Math.min(...xs),miny=Math.min(...ys),scale=Math.min(900/(Math.max(...xs)-minx||1),550/(Math.max(...ys)-miny||1));
      const scene=route.playbackScene;if(scene){canvas.width=scene.width;canvas.height=scene.height;}
      const points=scene?.points||rows.map(p=>[50+(p.lng-minx)*scale,600-(p.lat-miny)*scale]),lengths=[0];let total=0;const image=new Image();
      for(let i=1;i<points.length;i++){total+=Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1]);lengths.push(total);}
      const pauses=[];let previous=0;for(const stop of (scene?[]:route.stops||[]).slice(1,-1)){
        const c=stop.coordinates||{latitude:stop.lat,longitude:stop.lng};if(c.latitude==null||c.longitude==null)continue;
        let at=previous;for(let i=previous;i<rows.length;i++)if(Math.hypot(rows[i].lat-c.latitude,rows[i].lng-c.longitude)<Math.hypot(rows[at].lat-c.latitude,rows[at].lng-c.longitude))at=i;
        previous=at;pauses.push({fraction:lengths[at]/(total||1),seconds:Math.max(0,Number(stop.stopSeconds??1.5))});
      }
      if(scene)pauses.push(...(scene.stops||[]));
      const pauseSeconds=pauses.reduce((s,p)=>s+p.seconds,0),duration=Math.max(.2,Number(route.playbackSeconds)||12),pauseScale=pauseSeconds?Math.min(1,duration*.75/pauseSeconds):1,travel=duration-pauseSeconds*pauseScale;
      function fraction(t){let time=t*duration,used=0,prev=0;for(const p of pauses){const moving=(p.fraction-prev)*travel;if(time<used+moving)return prev+(time-used)/travel;used+=moving;if(time<used+p.seconds*pauseScale)return p.fraction;used+=p.seconds*pauseScale;prev=p.fraction;}return Math.min(1,prev+(time-used)/travel);}
      let progress=0,start=0,playing=false,frame=0;
      function draw(){ctx.clearRect(0,0,canvas.width,canvas.height);if(route.playbackBackground&&image.complete&&image.naturalWidth)ctx.drawImage(image,0,0,canvas.width,canvas.height);else{ctx.beginPath();points.forEach((p,i)=>ctx[i?'lineTo':'moveTo'](...p));ctx.strokeStyle='#2874b8';ctx.lineWidth=4;ctx.stroke();}let i=1;while(i<points.length-1&&lengths[i]<progress*total)i++;const t=(progress*total-lengths[i-1])/(lengths[i]-lengths[i-1]||1),a=points[i-1],b=points[i];ctx.beginPath();ctx.arc(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,8,0,2*Math.PI);ctx.fillStyle='#d90';ctx.fill();slider.value=progress;}
      function tick(now){if(!playing)return;const t=Math.min(1,(now-start)/(duration*1000));progress=fraction(t);draw();if(t<1)frame=requestAnimationFrame(tick);else playing=false;}
      document.getElementById('play').onclick=()=>{cancelAnimationFrame(frame);playing=true;progress=0;start=performance.now();frame=requestAnimationFrame(tick);};document.getElementById('pause').onclick=()=>{playing=false;cancelAnimationFrame(frame);};slider.oninput=()=>{playing=false;progress=Number(slider.value);draw();};if(route.playbackBackground){image.onload=draw;image.src=route.playbackBackground;}draw();
    });
    return '<!doctype html><meta charset="utf-8"><title>Route playback</title><style>body{font:16px system-ui;margin:2em}canvas{max-width:100%;border:1px solid #aaa}</style><h1></h1><button id="play">Play / replay</button> <button id="pause">Pause</button> <input aria-label="Route position" type="range" min="0" max="1" step=".001" value="0"><p></p><canvas width="1000" height="650"></canvas><script type="application/json" id="route">'+json+'</script><script>('+script+')();</script>';
  }
  return {create,playbackDocument};
})();
