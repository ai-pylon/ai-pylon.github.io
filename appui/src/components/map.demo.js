/* Gallery demo for map.js - shown by the AppUI Guide (platform/appui_guide) Components gallery.
 * Kept next to the component; the AppUI catalog (framework/appui_catalog.py) finds it by the .demo.js suffix.
 * demo(host, kit) mounts into host and may return a cleanup (function or {destroy}); kit = {el, btn, esc}. */
(function () {
  var kit = window.AppUIDemos.kit, el = kit.el, btn = kit.btn, esc = kit.esc;
  AppUIDemos.register({
    name: "Map",
    global: "AppUIMap",
    what: "Interactive map with category colors and explicit colorFor overrides, counted legend, zoom-aware collision-limited labels, scaled markers (setAppearance), live center/zoom/bounds (getViewport), visible-item lookup (getVisibleItems) without removing offscreen markers, linked hover via onHover(row|null) and setHovered(id), batched markers, source route overlays, waypoint playback, radius circles, PNG/SVG/GeoJSON exports and standalone playback pages",
    code: "await AppUIAssets.load('map');\nAppUIMap.create({container:host,height:280,colorBy:'kind',labelMode:'always',items:[{kind:'Landmark',id:'palace',title:'Gyeongbokgung Palace',latitude:37.57884,longitude:126.97702},{kind:'Viewpoint',id:'tower',title:'N Seoul Tower',latitude:37.55117,longitude:126.98823}]});",
    demo: function(host) {
     const map=AppUIMap.create({container:host,height:280,colorBy:'kind',labelMode:'always',items:[{kind:'Landmark',id:'palace',title:'Gyeongbokgung Palace',latitude:37.57884,longitude:126.97702},{kind:'Viewpoint',id:'tower',title:'N Seoul Tower',latitude:37.55117,longitude:126.98823}]});
     const controls=document.createElement('div'),visible=document.createElement('p');host.append(controls,visible);let dead=false,toolbar;const updateVisible=()=>{if(!dead)visible.textContent=map.getVisibleItems().length+' places in the visible map area';};const stopVisible=map.onViewportChange(updateVisible);map.ready.then(updateVisible,()=>{});
     AppUIAssets.load('toolbar').then(function(){if(dead)return;toolbar=AppUIToolbar.create({container:controls,items:[{label:'Demo source route',action:async()=>{await map.ready;map.setRoute({title:'Schematic demonstration',provider:'demo geometry',polylinePoints:[{lat:37.57884,lng:126.97702},{lat:37.565,lng:126.982},{lat:37.55117,lng:126.98823}]});map.play({seconds:5});}},{label:'Pause',action:()=>map.pause()},{label:'Stop',action:()=>map.stop()}]});}).catch(function(error){if(!dead)controls.textContent=error.message;});
     return {destroy(){dead=true;stopVisible();toolbar?.destroy();map.destroy();}};
   },
  });
})();
