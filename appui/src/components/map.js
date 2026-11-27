/* AppUIMap — shared Leaflet map, selectable markers, bounds, resize and lifecycle. */
const AppUIMap = (() => {
  let styles;
  function assets() {
    if (!styles) styles=new Promise((resolve,reject)=>{
      const link=document.createElement('link');link.rel='stylesheet';link.href='/appui/vendor/leaflet/leaflet.css';
      link.onload=resolve;link.onerror=()=>{styles=null;link.remove();reject(new Error('Map styles could not load'));};document.head.append(link);
    });
    return Promise.all([styles,AppUIScriptLoader.load('/appui/vendor/leaflet/leaflet.js','L')]);
  }
  function position(row) {
    const value=row.coordinates||row;
    if(value.latitude==null||value.longitude==null||value.latitude===''||value.longitude==='')return null;
    const lat=Number(value.latitude),lon=Number(value.longitude);
    return Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=85.0511&&Math.abs(lon)<=180?[lat,lon]:null;
  }
  const palette=['#0072b2','#d55e00','#009e73','#cc79a7','#8c6d00','#6f42c1','#007f86','#b43b58','#556b2f','#8c564b','#4b59a8','#a85500','#394d54','#a41370','#227c2c','#5d65db','#c02d24','#767319','#864d79','#18716b'];
  function categoryColor(value){let hash=2166136261;for(const c of String(value))hash=Math.imul(hash^c.charCodeAt(0),16777619);return palette[(hash>>>0)%palette.length];}
  function create({container,items=[],onSelect,onHover,height=420,center=[36.3,127.8],zoom=7,label='Place map',colorBy=null,colorFor=null,sizeBy=null,labelMode='hover',labelMinZoom=14,legendTitle='Colors',labelText=null}={}) {
    if(!container)throw new Error('AppUIMap requires a container');
    const el=document.createElement('div'),canvas=document.createElement('div'),status=document.createElement('p'),legend=document.createElement('div');
    el.className='appui-map';canvas.style.height=typeof height==='number'?height+'px':height;canvas.setAttribute('aria-label',label);status.setAttribute('role','status');el.append(canvas,status);container.append(el);
    legend.className='appui-map-legend';legend.setAttribute('aria-label','Map legend');legend.style.cssText='display:flex;flex-wrap:wrap;gap:6px 14px;padding:8px 0;font-size:12px';el.append(legend);
    let routeView,pendingRoute=null,map,layer,focusLayer,active='',hovered='',dead=false,rows=items,markers=new Map(),renderFrame=null,renderVersion=0;
    const value=(row,key)=>typeof key==='function'?key(row):row[key];
    const group=row=>String(value(row,colorBy)||'Unspecified');
    const categoryColors=new Map(),viewportListeners=new Set();
    function color(name){if(!categoryColors.has(name)){const preferred=categoryColor(name),used=new Set(categoryColors.values());categoryColors.set(name,!used.has(preferred)?preferred:palette.find(c=>!used.has(c))||preferred);}return categoryColors.get(name);}
    function markerStyle(row){const selected=[active,hovered].filter(Boolean).includes(String(row.id||row.place_id||'')),n=sizeBy?Number(value(row,sizeBy)):0;
      return {radius:(Number.isFinite(n)&&n>0?Math.min(15,5+Math.log10(n+1)*2.5):7)+(selected?3:0),color:selected?'#202020':'#ffffff',fillColor:(colorFor?value(row,colorFor):null)||(colorBy?color(group(row)):row.color||'#3a83db'),fillOpacity:.9,weight:selected?3:1.5};}
    function tooltip(row){const text=document.createElement('span');text.textContent=labelText?value(row,labelText):row.title||row.name||row.id||row.place_id;return text;}
    function updateLabels(){
      const occupied=[],size=map?.getSize?.();let count=0;
      for(const entry of [...markers.values()].sort((a,b)=>Number(b.row.place_id===active)-Number(a.row.place_id===active))){
        const {marker,row}=entry,point=map.latLngToContainerPoint?.(marker.getLatLng());
        let permanent=labelMode==='always';
        if(labelMode==='auto'&&map.getZoom()>=labelMinZoom&&point&&count<100){
          const width=Math.min(220,String(row.title||row.name||'').length*13+20),box={x:point.x+10,y:point.y-12,w:width,h:25};
          permanent=(!size||point.x>=0&&point.y>=0&&point.x<=size.x&&point.y<=size.y)&&!occupied.some(b=>box.x<b.x+b.w&&box.x+box.w>b.x&&box.y<b.y+b.h&&box.y+box.h>b.y);
          if(permanent){occupied.push(box);count++;}
        }
        if(entry.permanent!==permanent||entry.mode!==labelMode){marker.unbindTooltip?.();if(labelMode!=='none')marker.bindTooltip(tooltip(row),{permanent,direction:'right',offset:[10,0],opacity:.95});entry.permanent=permanent;entry.mode=labelMode;}
      }
    }
    function updateLegend(){
      legend.replaceChildren();legend.style.display=colorBy?'flex':'none';legend.style.maxHeight='96px';legend.style.overflowY='auto';if(!colorBy)return;
      const title=document.createElement('strong');title.textContent=legendTitle+':';legend.append(title);
      const counts=new Map(),samples=new Map();rows.filter(position).forEach(row=>{counts.set(group(row),(counts.get(group(row))||0)+1);samples.set(group(row),row);});
      for(const [name,count] of [...counts].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))){const item=document.createElement('span'),swatch=document.createElement('span');swatch.style.cssText='display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:5px';swatch.style.backgroundColor=(colorFor?value(samples.get(name),colorFor):null)||color(name);item.append(swatch,document.createTextNode(name+' ('+count+')'));legend.append(item);}
    }
    const observer=new ResizeObserver(()=>map?.invalidateSize());observer.observe(canvas);
    function updateFocus(){
      if(!focusLayer||dead)return;
      focusLayer.clearLayers();
      for(const id of new Set([active,hovered].filter(Boolean))){
        const entry=markers.get(id);if(!entry)continue;
        L.circleMarker(entry.marker.getLatLng(),{...markerStyle(entry.row),pane:'appui-map-highlight',interactive:false}).addTo(focusLayer);
      }
    }
    function setActive(id,{pan=true}={}) {
      const previous=markers.get(active);
      active=String(id||'');
      if(previous)previous.marker.setStyle(markerStyle(previous.row));
      const selected=markers.get(active);if(selected){selected.marker.setStyle(markerStyle(selected.row));selected.marker.bringToFront?.();}
      const entry=markers.get(active);if(entry&&pan){map.panTo(entry.marker.getLatLng());entry.marker.openTooltip();}
      updateFocus();
    }
    function setHovered(id){
      const previous=markers.get(hovered);hovered=String(id||'');
      if(previous){previous.marker.setStyle(markerStyle(previous.row));if(!previous.permanent)previous.marker.closeTooltip();}
      const entry=markers.get(hovered);if(entry){entry.marker.setStyle(markerStyle(entry.row));entry.marker.bringToFront?.();entry.marker.openTooltip();}
      updateFocus();
    }
    function fit() {const points=rows.map(position).filter(Boolean);if(map&&points.length)map.fitBounds(points,{padding:[30,30],maxZoom:16});}
    function getViewport(){if(!map||dead)return null;const center=map.getCenter(),bounds=map.getBounds();return {center:{latitude:center.lat,longitude:center.lng},zoom:map.getZoom(),bounds:{south:bounds.getSouth(),west:bounds.getWest(),north:bounds.getNorth(),east:bounds.getEast()}};}
    function getVisibleItems(){
      if(!map||dead)return [];
      const bounds=map.getBounds();
      return rows.filter(row=>{const point=position(row);return point&&bounds.contains(point);});
    }
    function render() {
      if(!map||dead)return;
      const version=++renderVersion,snapshot=rows;let offset=0;
      if(renderFrame!==null)cancelAnimationFrame(renderFrame);renderFrame=null;
      layer.clearLayers();focusLayer?.clearLayers();markers.clear();updateLegend();
      const missing=snapshot.filter(row=>!position(row)).length;
      function batch(){
        renderFrame=null;if(dead||version!==renderVersion)return;
        const end=Math.min(snapshot.length,offset+40);
        for(;offset<end;offset++){
        const row=snapshot[offset],point=position(row);if(!point)continue;
        const id=String(row.id||row.place_id||'');const marker=L.circleMarker(point,markerStyle(row)).addTo(layer);
        const text=document.createElement('span');text.textContent=row.title||row.name||id;marker.bindTooltip(text);
        const select=()=>{setActive(id,{pan:false});onSelect?.(row);};marker.on('click',select);
        marker.on('mouseover',()=>{setHovered(id);onHover?.(row);});marker.on('mouseout',()=>{setHovered(null);onHover?.(null);});
        const svg=marker.getElement();if(svg){svg.setAttribute('tabindex','0');svg.setAttribute('role','button');svg.setAttribute('aria-label',text.textContent);svg.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();select();}});}
        markers.set(id,{marker,row});
        }
        status.textContent=snapshot.length?(markers.size+' mapped · '+missing+' without coordinates'+(offset<snapshot.length?' · loading markers '+offset+'/'+snapshot.length:'')):'No saved places yet.';
        updateFocus();
        if(offset<snapshot.length)renderFrame=requestAnimationFrame(batch);else updateLabels();
      }
      batch();
    }
    const ready=assets().then(()=>{
      if(dead)return;
      map=L.map(canvas).setView(center,zoom);layer=L.layerGroup().addTo(map);
      const focusPane=map.createPane('appui-map-highlight');focusPane.style.zIndex='675';focusPane.style.pointerEvents='none';focusLayer=L.layerGroup().addTo(map);
      const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,crossOrigin:true,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(map);
      map.on?.('zoomend moveend',()=>{updateLabels();const viewport=getViewport();for(const listener of viewportListeners)listener(viewport);});
      tiles.on('tileerror',()=>{if(!dead)status.textContent='Basemap tiles unavailable. Saved place markers remain available.';});routeView=window._AppUIMapRoute.create({map,canvas,rows:()=>rows,presentation:row=>({style:markerStyle(row),label:markers.get(String(row.id||row.place_id||''))?.permanent?String(row.title||row.name||''):''})});render();fit();if(pendingRoute)routeView.setRoute(pendingRoute);
    }).catch(error=>{if(!dead)status.textContent=error.message;throw error;});
    // Surface failure through ready while avoiding an unhandled rejection if a caller ignores it.
    ready.catch(()=>{});
    return {el,ready,getViewport,getVisibleItems,onViewportChange(listener){viewportListeners.add(listener);return ()=>viewportListeners.delete(listener);},getItems:()=>rows.slice(),setAppearance(options={}){if('colorBy' in options)colorBy=options.colorBy;if('colorFor' in options)colorFor=options.colorFor;if('sizeBy' in options)sizeBy=options.sizeBy;if('labelMode' in options)labelMode=options.labelMode;if('legendTitle' in options)legendTitle=options.legendTitle;render();},update(next){rows=Array.isArray(next)?next:next?.items||rows;render();},setItems(next,{fitBounds=false}={}){rows=next||[];render();if(fitBounds)fit();},setActive,setHovered,fit,setRoute(value,options){pendingRoute=value;routeView?.setRoute(value,options);},setRadius:(...args)=>routeView?.setRadius(...args),play:opts=>routeView?.play(opts),pause:()=>routeView?.pause(),resume:()=>routeView?.resume(),stop:()=>routeView?.stop(),seek:fraction=>routeView?.seek(fraction),exportGeoJSON:()=>routeView?.geojson(),exportSvg:()=>routeView?.svg(),exportPng:options=>ready.then(()=>routeView.png(options)),exportVideo:opts=>ready.then(()=>routeView.video(opts)),
      exportScene:()=>routeView?.scene(),destroy(){dead=true;viewportListeners.clear();renderVersion++;if(renderFrame!==null)cancelAnimationFrame(renderFrame);observer.disconnect();routeView?.destroy();map?.remove();el.remove();}};
  }
  return {create,position,playbackDocument:(route,options)=>window._AppUIMapRoute.playbackDocument(route,options)};
})();
window.AppUIMap=AppUIMap;
