(function(){
  'use strict';
  const app='personal/web-navermap',ns='personal-web-navermap';
  let router,tree,map,notice,details,poller,items=[],summary={},route=null,epoch=0,disposed=false,viewer;
  let sidebarFilterIds=null,sidebarMemberships=new Map(),sidebarTables=new Map(),sidebarSearches=[],sidebarChildCache=new Map(),sidebarPinned=new Set();
  let pageReady=Promise.resolve(),navigationFreshness;
  let visibleMapOnly=localStorage.getItem('web-navermap.visible-map-only')==='true',viewportPlaceIds=null,viewportStatus;
  const pageLifetime=new AbortController();
  let markerColors={},categoryMarkerStyles=new Map(),mapColorControl;
  function categoryChain(group){const result=[],seen=new Set();while(group&&!seen.has(group.id)){seen.add(group.id);result.unshift(group);group=sidebarHierarchy.find(row=>row.id===group.parentId);}return result;}
  function indexCategoryColors(){
    categoryMarkerStyles=new Map();
    const rules=sidebarHierarchy.filter(group=>group.kind==='category'&&markerColors[group.id]).map(group=>({group,chain:categoryChain(group)})).sort((a,b)=>a.chain.length-b.chain.length||a.group.id.localeCompare(b.group.id));
    for(const {group,chain} of rules)for(const id of group.place_ids)categoryMarkerStyles.set(id,{color:markerColors[group.id],label:chain.map(item=>item.name).join(' › ')});
  }
  async function saveCategoryColor(group,color){
    const result=await api('category_color_save',{category_id:group.id,color,confirm:true});if(disposed)return;
    markerColors=result.marker_colors;indexCategoryColors();tree?.refreshDecorations();
    mapPreferences.color='category';if(mapColorControl)mapColorControl.value='category';localStorage.setItem(mapPreferencesKey,JSON.stringify(mapPreferences));
    sessionStorage.removeItem(navigationCacheKey);map?.setAppearance(mapAppearance());tell(group.name+': '+(color?'marker color saved.':'inherited / automatic marker color restored.'));
  }
  function chooseCategoryColor(group){
    let saving=false,dialog;
    const inherited=categoryChain(group).reverse().find(row=>markerColors[row.id]);
    dialog=AppUIDialog.form({title:'Marker color — '+group.name,submitLabel:'Save color',signal:pageLifetime.signal,
      note:'Applies to this category and its subcategories. More specific category colors take priority.',fields:[{name:'color',label:'Marker color',type:'color',default:markerColors[inherited?.id]||'#0072b2'}],
      onSubmit:values=>{if(saving)return false;saving=true;saveCategoryColor(group,values.color).then(()=>AppUIDialog.close(dialog)).catch(error=>{saving=false;if(dialog?.isConnected)dialog.querySelector('.ui-dialog-note').textContent=error.message;});return false;}
    });
  }
  async function categoryContextMenu(row,event){
    const group=sidebarHierarchy.find(group=>'hierarchy/'+group.id===row.path&&group.kind==='category');if(!group)return;
    const point={x:event.clientX,y:event.clientY};await AppUIAssets.load('contextMenu');if(disposed)return;
    AppUIContextMenu.show(point,[{label:group.name,disabled:true},{label:'Set marker color…',action:()=>chooseCategoryColor(group)},
      {label:'Quick colors',submenu:[['Blue','#0072b2'],['Orange','#d55e00'],['Green','#009e73'],['Purple','#6f42c1'],['Pink','#cc79a7']].map(([label,color])=>({label,action:guard(()=>saveCategoryColor(group,color))}))},
      {label:'Reset to inherited / automatic',disabled:!markerColors[group.id],action:guard(()=>saveCategoryColor(group,''))}],{signal:pageLifetime.signal});
  }
  let markerDialog,markerDetailRefresh;
  function showMarkerDetails(row){
    markerDialog?.abort();
    const controller=new AbortController();markerDialog=controller;
    const id=String(row.place_id||row.id||''),saved=items.some(item=>item.place_id===id),body=node('div'),loading=node('p',saved?'Loading saved details…':''),content=node('div'),previousFocus=document.activeElement;
    let article,fetching=false;const fetchStatus=node('p');fetchStatus.setAttribute('role','status');
    body.append(node('p',[row.category,row.address].filter(Boolean).join(' · ')),loading,fetchStatus,content);
    const buttons=[...(/^\d+$/.test(id)?[{text:'Fetch details',action:()=>{if(!fetching){fetching=true;fetchStatus.textContent='Queuing detail capture...';fetchPlaceDetails(id).then(()=>{if(!controller.signal.aborted)fetchStatus.textContent='Fetching details in the background. Progress is available in Jobs.';}).catch(error=>{if(!controller.signal.aborted)fetchStatus.textContent=error.message;}).finally(()=>{fetching=false;});}return false;}}]:[]),...(saved?[{text:'Open full page',action:()=>go('places',id)},{text:'Reviews',action:()=>go('places',id+'/reviews')}]:[]),{text:'Close',primary:true}];
    AppUIDialog.show({title:row.title||row.name||'Map location',body,width:'760px',buttons,signal:controller.signal,onClose(){controller.abort();article?.destroy();if(markerDialog===controller){markerDialog=null;markerDetailRefresh=null;}if(previousFocus?.isConnected)previousFocus.focus();}});
    const display=bundle=>{
      if(controller.signal.aborted)return;
      loading.remove();article?.destroy();content.replaceChildren();const meta=bundle?.metadata||{},visitor=bundle?.state?.visitorReviews||{},reviews=bundle?.reviews||[],menu=bundle?.menu?.items||[];
      const blocks=[{text:'Category: '+(meta.category||row.category||'Not provided')},{text:'Address: '+(meta.roadAddress||meta.address||row.address||'Not provided')},
        {text:'Rating: '+(visitor.score??row.score??'Not provided')+' · Reported reviews: '+(visitor.displayText||row.review_count_text||'Not provided')},
        {text:'Saved visitor reviews: '+(bundle?reviews.length:row.captured_reviews||0)+' · Capture: '+(bundle?.capture_status||row.capture_status||'Not saved locally')},
        ...(bundle?.updated?[{text:'Updated: '+new Date(bundle.updated).toLocaleString()}]:[]),
        ...(menu.length?[{type:'heading',text:'Menu'},...menu.slice(0,10).map(item=>({text:[item.name,item.priceText,item.description].filter(Boolean).join(' · ')}))]:[]),
        ...(reviews.length?[{type:'heading',text:'Saved review previews'},...reviews.slice(0,3).map(review=>({type:'quote',text:String(review.body||review.text||'').slice(0,1000)}))]:[]),
        ...(bundle?.capture_notes?.naver_search_list?[{type:'heading',text:'List capture notes'},{type:'quote',text:bundle.capture_notes.naver_search_list.text||''}]:[]),
        ...(bundle?.warnings?.length?[{text:'Capture notes: '+bundle.warnings.join(' · ')}]:[])];
      if(bundle?.photos?.length)blocks.push({type:'heading',text:'Photos'},...bundle.photos.slice(0,6).map(photo=>({type:'image',local_url:photo.url,alt:photo.kind||'Saved place photo'})));
      article=AppUIArticle.create({container:content,blocks,maxWidth:700});
      if(bundle?.blog_links?.length){content.append(node('h3','Blogs'));for(const blog of bundle.blog_links){try{const url=new URL(blog.url);if(!['http:','https:'].includes(url.protocol))continue;const line=node('p'),link=node('a',blog.title||blog.url);link.href=blog.article_saved&&blog.captured_path?'/apps/personal/web-naverblog/?path='+encodeURIComponent(blog.captured_path+'/article'):url.href;link.target='_blank';link.rel='noopener';line.append(link);content.append(line);}catch{}}}
      const source=bundle?.url||row.url;
      if(source){try{const url=new URL(source);if(['https:','http:'].includes(url.protocol)){const link=node('a','Open Naver source');link.href=url.href;link.target='_blank';link.rel='noopener';content.append(link);}}catch{}}
      if(bundle){const raw=node('details');raw.append(node('summary','All saved place information'),pre({metadata:meta,information:bundle.information,state:bundle.state,capture_notes:bundle.capture_notes}));content.append(raw);}
    };
    markerDetailRefresh=()=>!items.some(row=>row.place_id===id)?Promise.resolve():api('get',{place_id:id}).then(result=>{display(result.item);if(!controller.signal.aborted)fetchStatus.textContent='Saved details updated.';});
    if(saved)api('get',{place_id:id}).then(result=>display(result.item)).catch(error=>{if(!controller.signal.aborted){display(null);content.append(node('p','Could not load saved details: '+error.message));}});
    else display(null);
  }
  const mapPreferencesKey='web-navermap.appearance';
  let mapPreferences={color:'category',labels:'auto',size:'fixed'};
  try{const saved=JSON.parse(localStorage.getItem(mapPreferencesKey)||'{}');for(const [key,allowed] of Object.entries({color:['category','district','none'],labels:['auto','hover','always','none'],size:['fixed','reviews']}))if(allowed.includes(saved[key]))mapPreferences[key]=saved[key];}catch{}
  function mapAppearance(){return {colorBy:mapPreferences.color==='category'?row=>categoryMarkerStyles.get(String(row.place_id||row.id))?.label||sidebarHierarchy.find(group=>group.id==='map-category-group:'+row.category_code)?.name||row.category_code||'Unspecified':mapPreferences.color==='district'?row=>(row.address||'').split(/\s+/).slice(0,2).join(' ')||'Unspecified':null,colorFor:mapPreferences.color==='category'?row=>categoryMarkerStyles.get(String(row.place_id||row.id))?.color:null,legendTitle:mapPreferences.color==='district'?'District':'Category',labelMode:mapPreferences.labels,sizeBy:mapPreferences.size==='reviews'?'captured_reviews':null};}
  function mountMapControls(host){
    const change=key=>value=>{mapPreferences[key]=value;localStorage.setItem(mapPreferencesKey,JSON.stringify(mapPreferences));map.setAppearance(mapAppearance());};
    persistent.push(AppUIToolbar.create({container:host,label:'Map appearance',items:[
      {type:'select',ariaLabel:'Marker colors',value:mapPreferences.color,options:[{value:'category',label:'Colors: category'},{value:'district',label:'Colors: district'},{value:'none',label:'Colors: uniform'}],onChange:change('color')},
      {type:'select',ariaLabel:'Place labels',value:mapPreferences.labels,options:[{value:'auto',label:'Labels: auto at zoom 14+'},{value:'hover',label:'Labels: on hover'},{value:'always',label:'Labels: all (may overlap)'},{value:'none',label:'Labels: hidden'}],onChange:change('labels')},
      {type:'select',ariaLabel:'Marker sizes',value:mapPreferences.size,options:[{value:'fixed',label:'Size: uniform'},{value:'reviews',label:'Size: saved review count'}],onChange:change('size')},
      {type:'checkbox',label:'Visible map area only',checked:visibleMapOnly,onChange:checked=>{visibleMapOnly=checked;localStorage.setItem('web-navermap.visible-map-only',String(checked));syncViewportTables();}},
      {label:'Fit selected places',action:()=>map.fit()},
      {label:'Map PNG',action:guard(async()=>{await pageReady;download(await map.exportPng(),'places.png');})}
    ]}));
    mapColorControl=host.querySelector('select[aria-label="Marker colors"]');
    viewportStatus=node('p');viewportStatus.setAttribute('role','status');host.append(viewportStatus);
    persistent.push({destroy:map.onViewportChange(syncViewportTables)});
    syncViewportTables();
  }
  let sidebarHideZero=localStorage.getItem('web-navermap.hide-zero')==='true';
  let sidebarMode=localStorage.getItem('web-navermap.selection-mode')==='and'?'and':'or',sidebarPaths=[],sidebarFocus=null,sidebarSelectionEpoch=0,sidebarCollections=[],sidebarHierarchy=[],renderRunning=false,renderPending=false,jobsRefresh=null,tickBusy=false;
  let accountHost,accountBusy=false,accountTimer,accountScopes=[],buildingAccount=false;
  let scopes=[],persistent=[],draftStops=[],jobId=localStorage.getItem('web-navermap.job')||'';
  const node=(tag,text)=>{const el=document.createElement(tag);if(text!=null)el.textContent=text;return el;};
  const api=async(op,args={},owner=app)=>{const r=await AppUIApi.request('/v1/apps/'+owner+'/'+op,args);if(!r.ok)throw new Error(r._error||r.error||'Request failed');return r;};
  const startupData=AppUIAssets.load('foundation').then(()=>Promise.all([api('status'),api('sidebar')]));
  startupData.catch(()=>{});
  const tell=text=>{if(notice&&!disposed){notice.textContent=text;notice.hidden=!text;}};
  const guard=fn=>async(...args)=>{try{return await fn(...args);}catch(error){AppUILogger.create(app).error(error.message,{operation:'page_action',stack:error.stack});tell(error.message);}};
  const own=value=>((buildingAccount?accountScopes:scopes).push(value),value);
  function pre(value){const el=node('pre',typeof value==='string'?value:JSON.stringify(value,null,2));el.style.whiteSpace='pre-wrap';el.style.overflowWrap='anywhere';return el;}
  function controls(host,actions){const box=node('div');host.append(box);return own(AppUIToolbar.create({container:box,label:'Map actions',items:actions.map(([label,fn])=>({label,action:guard(fn)}))}));}
  function form(host,value){const box=node('div');host.append(box);return own(AppUIJsonForm.create({container:box,value,allowRaw:true,schema:{properties:{provider:{enum:['naver-browser','naver','kakao','google']},mode:{enum:['DRIVE','WALKING','TRANSIT','BICYCLING']},client_secret:{format:'password'},key:{format:'password'}}}}));}
  function grid(host,rows,columns,extra={}){
    const tools=node('div'),box=node('div');host.append(tools,box);
    // Keep both scrollbars within reach, including virtualized discovery lists.
    box.style.height='min(60vh, '+Math.max(120,Math.min(rows.length+1,17)*33)+'px)';
    box.style.minWidth='0';
    const widths={name:'220px',distance_metres:'110px',discovered_page:'75px',rank:'130px',review_count_text:'110px',advertisement:'75px',coordinate_source:'170px',snippet:'360px',actions:'250px'};
    columns=columns.map(column=>({...column,minWidth:column.minWidth||widths[column.id]||'160px'}));
    const table=own(AppUIDataTable.create({container:box,items:tablePlaceRows(rows),columns,stateKey:app+'.'+columns.map(col=>col.id).join(','),getId:row=>String(row.place_id||row.placeId||row.id||''),onRowHover:row=>map?.setHovered(row?.place_id||row?.placeId||null),maxRows:1000,empty:'No saved entries for this view.',...extra}));
    if(rows.some(row=>row.place_id||row.placeId)){sidebarTables.set(table,rows);own({destroy(){sidebarTables.delete(table);}});}
    controls(tools,[['CSV',()=>table.exportCsv({filename:'navermap'})],['XLSX',()=>table.exportXlsx({filename:'navermap',sheetName:'Maps'})]]);return table;
  }
  function reviewCount(value){
    const match=String(value??'').replace(/,/g,'').match(/(\d+(?:\.\d+)?)\s*([천만억kmb]?)/i);
    if(!match)return -1;
    return Number(match[1])*({'천':1000,'만':10000,'억':100000000,k:1000,m:1000000,b:1000000000}[match[2].toLowerCase()]||1);
  }
  const col=(id,label=id)=>({id,label,sortable:true,...(id==='review_count_text'?{getValue:row=>reviewCount(row[id]),render:row=>String(row[id]??'')}: {})});
  const distanceColumn=()=>({id:'distance_metres',label:'Distance',sortable:true,getValue:row=>row.distance_metres??Infinity,
    render:row=>row.distance_metres==null?'—':row.distance_metres<1000?row.distance_metres+' m':(row.distance_metres/1000).toFixed(2)+' km',
    exportLabel:'Distance (m)',exportValue:row=>row.distance_metres??''});
  const actions=fn=>({id:'actions',label:'Actions',actions:row=>fn(row).map(([label,action])=>({label,action:guard(action)}))});
  const path=()=>router?.get('path')||'';
  function go(view='places',target=''){router.set('view',view,{silent:true});router.set('path',target,{replace:true});}
  const sidebarPlace=id=>({path:id,title:items.find(row=>row.place_id===id)?.title||id,has_children:true});
  const hierarchyRow=row=>({path:'hierarchy/'+row.id,title:row.name,count:new Set(row.place_ids).size,has_children:true});
  async function children(target){
    if(target.startsWith('hierarchy/')){const id=target.slice(10),parent=sidebarHierarchy.find(row=>row.id===id),groups=sidebarHierarchy.filter(row=>row.parentId===id),covered=new Set(groups.flatMap(row=>row.place_ids));return [...groups.map(hierarchyRow),...(parent?.place_ids||[]).filter(id=>!covered.has(id)).map(sidebarPlace)];}
    if(target==='@name')return [...items].sort((a,b)=>a.title.localeCompare(b.title,'ko')).map(row=>sidebarPlace(row.place_id));
    if(target==='@addresses'||target==='@category')return sidebarHierarchy.filter(row=>!row.parentId&&row.kind===(target==='@addresses'?'address':'category')).sort((a,b)=>a.name.localeCompare(b.name,'ko')).map(hierarchyRow);
    if(target==='collections')return [['custom','Custom collections'],['naver','Naver collections']].map(([kind,title])=>({path:'collections/@'+kind,title,count:sidebarCollections.filter(row=>(row.source==='naver'?'naver':'custom')===kind).length,has_children:sidebarCollections.some(row=>(row.source==='naver'?'naver':'custom')===kind)}));
    if(target==='collections/@custom'||target==='collections/@naver')return sidebarCollections.filter(row=>(row.source==='naver'?'naver':'custom')===target.slice(13)).map(row=>({path:'collections/'+row.id,title:row.title,count:new Set(row.place_ids).size,has_children:row.place_ids.length>0}));
    if(target.startsWith('collections/'))return (sidebarCollections.find(row=>row.id===target.split('/')[1])?.place_ids||[]).map(sidebarPlace);
    if(target==='searches')return sidebarSearches.map(row=>({path:'searches/'+row.id,title:row.title,count:row.place_ids.length,has_children:row.place_ids.length>0}));
    if(target.startsWith('searches/'))return (sidebarSearches.find(row=>row.id===target.split('/')[1])?.place_ids||[]).filter(id=>items.some(row=>row.place_id===id)).map(sidebarPlace);
    if(!sidebarChildCache.has(target))sidebarChildCache.set(target,(async()=>{let page=0,rows=[],r;do{r=await api('vis_children',{path:target,page,page_size:100});rows.push(...r.children);page++;}while(r.more);return rows;})().catch(error=>{sidebarChildCache.delete(target);throw error;}));
    return sidebarChildCache.get(target);
  }
  const shape=row=>({name:row.title,path:row.path,hasChildren:row.has_children,count:row.count,badge:row.count==null?undefined:String(row.count)});
  async function refresh(preloaded){
    const [r,navigation]=await (preloaded||Promise.all([api('status'),api('sidebar')]));if(disposed)return;
    items=r.items;summary=r.summary;sidebarCollections=r.collections;sidebarHierarchy=navigation.hierarchy;markerColors=r.marker_colors||{};indexCategoryColors();sidebarSearches=navigation.searches;sidebarChildCache.clear();indexSidebarMemberships();
    const group=(path,title,count)=>({path,title,count,has_children:count>0});
    tree?.setRoots([group('collections','Collections',r.collections.length),group('@addresses','Addresses',sidebarHierarchy.filter(row=>row.kind==='address'&&!row.parentId).length),group('@category','Category',sidebarHierarchy.filter(row=>row.kind==='category'&&!row.parentId).length),group('@name','Name',items.length),group('searches','Discovery',sidebarSearches.length),...Object.entries({routes:'Routes',visits:'Photo visits',locations:'Address evidence',batches:'Jobs'}).filter(([key])=>key!=='locations'||navigation.counts[key]).map(([key,title])=>group(key,title,navigation.counts[key]||0)),{path:'@tools',title:'Tools',has_children:false}].map(shape));
    performance.mark('navermap:tree-ready');await applySidebar();if(!preloaded){rememberNavigation([r,navigation]);if(navigationFreshness)navigationFreshness.textContent='';}return r;
  }
  const navigationCacheKey='web-navermap.navigation-v1';
  function cachedNavigation(){try{const value=JSON.parse(sessionStorage.getItem(navigationCacheKey)||'null');return value&&Date.now()-value.saved<300000&&value.data?.[0]?.ok&&value.data?.[1]?.ok?value.data:null;}catch{return null;}}
  function rememberNavigation(data){try{sessionStorage.setItem(navigationCacheKey,JSON.stringify({saved:Date.now(),data}));}catch{/* Storage limits never block live navigation. */}}
  function filteredPlaceRows(rows){return sidebarFilterIds===null?rows:rows.filter(row=>{const id=row.place_id||row.placeId;return !id||sidebarFilterIds.has(String(id));});}
  function tablePlaceRows(rows){
    const selected=filteredPlaceRows(rows);
    return !visibleMapOnly||viewportPlaceIds===null?selected:selected.filter(row=>{const id=row.place_id||row.placeId;return !id||viewportPlaceIds.has(String(id));});
  }
  function syncViewportTables(){
    const visible=map?.getVisibleItems()||[];
    viewportPlaceIds=map?new Set(visible.map(row=>String(row.place_id||row.placeId||row.id))):null;
    for(const [table,rows] of sidebarTables)table.setItems(tablePlaceRows(rows));
    if(viewportStatus){
      viewportStatus.hidden=!visibleMapOnly;
      const selected=map?.getItems()||[],located=selected.filter(row=>AppUIMap.position(row)).length;
      viewportStatus.textContent='Visible map area: '+visible.length+' of '+located+' mapped places'+(selected.length>located?' · '+(selected.length-located)+' without coordinates excluded.':'.');
    }
  }
  function indexSidebarMemberships(){
    const known=new Set(items.map(row=>row.place_id)),add=(path,ids)=>sidebarMemberships.set(path,new Set(ids.map(String).filter(id=>known.has(id))));sidebarMemberships=new Map();
    add('@name',[...known]);
    for(const row of sidebarHierarchy)add('hierarchy/'+row.id,row.place_ids);
    for(const kind of ['address','category'])add(kind==='address'?'@addresses':'@category',sidebarHierarchy.filter(row=>row.kind===kind).flatMap(row=>row.place_ids));
    for(const kind of ['custom','naver'])add('collections/@'+kind,sidebarCollections.filter(row=>(row.source==='naver'?'naver':'custom')===kind).flatMap(row=>row.place_ids));
    add('collections',sidebarCollections.flatMap(row=>row.place_ids));for(const row of sidebarCollections)add('collections/'+row.id,row.place_ids);
    for(const row of sidebarSearches)add('searches/'+row.id,row.place_ids);
    add('searches',sidebarSearches.flatMap(row=>row.place_ids));
  }
  function sidebarMemberSet(target){if(/^\d+(\/|$)/.test(target))return new Set([target.split('/')[0]]);return sidebarMemberships.get(target)||new Set();}
  async function sidebarMembers(target){return [...sidebarMemberSet(target)];}
  function decorateSidebar(row,el,{nameEl}){
    const constrained=sidebarMode==='and'&&sidebarFilterIds!==null,members=sidebarMemberSet(row.path);
    if(!selectablePath(row.path))return;
    const count=constrained?[...members].filter(id=>sidebarFilterIds.has(id)).length:members.size;
    const category=sidebarHierarchy.find(group=>'hierarchy/'+group.id===row.path&&group.kind==='category');
    if(category){let swatch=el.querySelector('.navermap-category-color');if(!swatch){swatch=node('span');swatch.className='navermap-category-color';swatch.style.marginRight='4px';el.insertBefore(swatch,nameEl);}const source=categoryChain(category).reverse().find(group=>markerColors[group.id]);swatch.textContent=source?'\u25cf':'';swatch.style.color=source?markerColors[source.id]:'';swatch.title=source?'Marker color: '+markerColors[source.id]+(source.id===category.id?'':' (inherited)'):'Right-click to set marker color';}
    // Keep each row, its checkbox and expansion state in place while counts change.
    const badge=el.querySelector('.tree-badge');
    if(badge){badge.textContent=constrained?count+' / '+members.size:String(row.count);badge.title=constrained?count+' matching places out of '+members.size:String(row.count);}
    el.style.opacity=constrained&&count===0?'.45':'';
    if(el.parentElement)el.parentElement.hidden=sidebarHideZero&&constrained&&count===0&&!sidebarPinned.has(row.path);
    el.title=constrained?count+' matching places out of '+members.size:row.path;
  }
  function syncSidebarData(){
    const pinnedSelection=sidebarPaths.length?sidebarPaths:sidebarFocus?[sidebarFocus]:[];
    sidebarPinned=new Set(pinnedSelection);
    for(const target of pinnedSelection){
      if(target.startsWith('hierarchy/')){let row=sidebarHierarchy.find(row=>row.id===target.slice(10));while(row){sidebarPinned.add('hierarchy/'+row.id);sidebarPinned.add(row.kind==='address'?'@addresses':'@category');row=sidebarHierarchy.find(parent=>parent.id===row.parentId);}}
      else if(/^\d+(\/|$)/.test(target)){const id=target.split('/')[0];sidebarPinned.add('@name');sidebarPinned.add(id);for(const row of sidebarHierarchy)if(row.place_ids.includes(id)){sidebarPinned.add('hierarchy/'+row.id);sidebarPinned.add(row.kind==='address'?'@addresses':'@category');}for(const row of sidebarCollections)if(row.place_ids.includes(id)){sidebarPinned.add('collections');sidebarPinned.add('collections/'+row.id);sidebarPinned.add('collections/@'+(row.source==='naver'?'naver':'custom'));}for(const row of sidebarSearches)if(row.place_ids.includes(id)){sidebarPinned.add('searches');sidebarPinned.add('searches/'+row.id);}}
      else if(target.startsWith('collections/')){sidebarPinned.add('collections');const collection=sidebarCollections.find(row=>'collections/'+row.id===target);if(collection)sidebarPinned.add('collections/@'+(collection.source==='naver'?'naver':'custom'));}
      else if(target.includes('/'))sidebarPinned.add(target.split('/')[0]);
    }
    tree?.refreshDecorations();
    syncViewportTables();
  }
  async function applySidebar({fitBounds=!visibleMapOnly}={}){
    const selected=sidebarPaths.length?sidebarPaths:sidebarFocus?[sidebarFocus]:[];const ticket=++sidebarSelectionEpoch;
    if(!selected.length){sidebarFilterIds=null;map?.setItems(items,{fitBounds});syncSidebarData();return;}
    const groups=(await Promise.all(selected.map(sidebarMembers))).map(ids=>new Set(ids));if(ticket!==sidebarSelectionEpoch||disposed)return;
    const ids=sidebarMode==='and'?new Set([...groups[0]].filter(id=>groups.every(group=>group.has(id)))):new Set(groups.flatMap(group=>[...group]));
    sidebarFilterIds=ids;const rows=items.filter(row=>ids.has(row.place_id));map?.setItems(rows,{fitBounds});syncSidebarData();
  }
  function selectablePath(target){return ['collections','@addresses','@category','@name','searches'].includes(target)||/^(hierarchy|collections|searches)\//.test(target)||/^\d+(\/|$)/.test(target);}
  const membershipScope=target=>/^(collections|searches)\/(?!@)[^/]+$/.test(target||'');
  async function checkSidebar(row,checked,paths){
    const next=new Set(paths);
    if(checked&&!sidebarPaths.length&&membershipScope(sidebarFocus)&&sidebarFocus!==row.path)next.add(sidebarFocus);
    sidebarPaths=[...next];sidebarFocus=null;tree.setCheckedPaths(sidebarPaths);await applySidebar();
  }
  function selectSidebar(row){
    sidebarFocus=selectablePath(row.path)?row.path:null;
    if(sidebarPaths.length&&membershipScope(sidebarFocus)&&!sidebarPaths.includes(sidebarFocus)){
      sidebarPaths=[...sidebarPaths,sidebarFocus];tree.setCheckedPaths(sidebarPaths);
    }
    applySidebar().catch(error=>tell(error.message));
    go({'@addresses':'collections','@category':'collections','@name':'places',collections:'collections',hierarchy:'collections',routes:'routes',visits:'visits',searches:'discovery',locations:'visits',batches:'jobs','@tools':'tools'}[row.path.split('/')[0]]||'places',row.path==='@name'?'':row.path);
  }
  function remember(id){jobId=id||'';if(jobId)localStorage.setItem('web-navermap.job',jobId);else localStorage.removeItem('web-navermap.job');}
  const detailCaptures=new Map();
  async function fetchPlaceDetails(id,{reviewBatch=0,allReviews=false}={}){
    id=String(id||'').trim();
    let entry=detailCaptures.get(id);
    // Re-present an existing capture instead of silently returning for a connected,
    // possibly displaced dialog. Keep its worker identity so work is not duplicated.
    if(entry?.dialog?.isConnected)AppUIDialog.close(entry.dialog);
    if(!entry){entry={captureId:Array.from(crypto.getRandomValues(new Uint8Array(16)),byte=>byte.toString(16).padStart(2,'0')).join('')};detailCaptures.set(id,entry);}
    const controller=new AbortController(),body=node('div'),status=node('p','Queuing place capture...'),tableHost=node('div');
    body.append(node('p',allReviews?'Fetches all remaining visitor reviews from the saved checkpoint, with no review-count cap. Existing photos, blogs and business details are kept.':reviewBatch?'Fetches up to '+reviewBatch+' additional visitor reviews from the saved checkpoint. Existing photos, blogs and business details are kept.': 'Fetches place info, menu, business information, up to 1,000 reviews, 20 photos, 20 blog links and 3 blog posts. Closing this dialog keeps the job running.'),status,tableHost);
    status.setAttribute('role','status');
    const names={metadata:'Place info',menu:'Menu',information:'Business information',reviews:'Visitor reviews',photos:'Photos',blogs:'Blogs'};
    let timer,busy=false,finished=false;
    const table=AppUIDataTable.create({container:tableHost,items:Object.entries(names).map(([key,label])=>({key,label,status:'pending',detail:'Waiting'})),getId:row=>row.key,columns:[col('label','Data'),col('status','Status'),col('count','Saved'),col('saved_posts','Blog posts'),col('detail','Progress / errors'),actions(row=>finished&&row.key==='reviews'&&!row.exhausted?[['Fetch all remaining reviews',()=>{AppUIDialog.close(entry.dialog);return fetchPlaceDetails(id,{allReviews:true});}]]:[])]});
    entry.dialog=AppUIDialog.show({title:'Fetching details — '+(items.find(row=>row.place_id===id)?.title||id),body,width:'950px',signal:pageLifetime.signal,
      buttons:[{text:'Cancel capture',action:()=>{if(entry.jobId&&!finished)api('cancel',{job_id:entry.jobId,force:true,confirm:true},'platform/work_runner').catch(error=>{status.textContent=error.message;});return false;}},{text:'Close',primary:true}],
      onClose(){controller.abort();clearTimeout(timer);table.destroy();entry.dialog=null;}
    });
    AppUILogger.create(app).info('Detail capture progress opened',{place_id:id,reopened:!!entry.jobId});
    const poll=async()=>{
      if(controller.signal.aborted||busy||!entry.jobId)return;busy=true;let delay=1000;
      try{
        // ROUND3 #9: long-poll the job (returns at completion or after 2 s),
        // THEN read the stage progress so it is fresh when shown.
        const result=await api('wait',{job_id:entry.jobId,timeout_s:2},'platform/work_runner');
        const progress=await api('capture_progress',{capture_id:entry.captureId});delay=50;
        if(controller.signal.aborted)return;
        const job=result.job,record=progress.item||job.op_result?.progress;
        finished=['done','failed','cancelled','error'].includes(job.status);
        table.setItems((record?.stages||Object.entries(names).map(([key])=>({key,status:'pending',detail:'Waiting'}))).map(row=>({...row,label:names[row.key],detail:row.detail+(row.errors?.length?' | '+row.errors.map(error=>error.error).join(' | '):''),...(finished&&['running','pending'].includes(row.status)?{status:row.status==='pending'?'skipped':job.status==='cancelled'?'cancelled':'failed',detail:job.error||'Job ended before this step finished'}:{})})));
        status.textContent=(finished?(record?.status==='partial'?'Completed with some missing data':job.status==='done'?(job.op_result?.ok===false?'Capture failed':'Capture completed'):job.status):job.status)+' - '+(job.error||job.op_result?._error||job.progress?.detail||'Waiting for worker');
        if(finished){detailCaptures.delete(id);await refresh();await markerDetailRefresh?.();}
      }catch(error){if(!controller.signal.aborted)status.textContent='Progress unavailable: '+error.message;}
      finally{busy=false;if(!finished&&!controller.signal.aborted)timer=setTimeout(poll,delay);}
    };
    try{
      if(!entry.jobId){if(!entry.submission)entry.submission=api('submit',{kind:'op',app,op:'capture_details',args:{place_id:id,capture_id:entry.captureId,max_reviews:1000,review_sort:'recent',...(allReviews?{all_reviews:true,reviews_only:true}:{}),...(reviewBatch?{review_batch:reviewBatch,reviews_only:true}:{}),max_photos:20,max_blogs:20,blog_posts:3,resume:true,confirm:true},timeout:7200,label:'Naver map: capture details '+id,confirm:true},'platform/work_runner').then(result=>{entry.jobId=result.job?.id||result.job_id;if(!entry.jobId)throw new Error('Worker returned no job identity');remember(entry.jobId);});await entry.submission;}
      await poll();
    }catch(error){detailCaptures.delete(id);if(!controller.signal.aborted)status.textContent='Could not start capture: '+error.message;throw error;}
  }
  async function queueDiscovery(args,op='search_capture'){
    const label=op==='discovery_coordinates'?'Resolve missing coordinates':args.refresh_list?'Refresh list capture notes':'Search Naver map — '+args.query;
    const progress=AppUIDialog.job({title:label,signal:pageLifetime.signal,
      submit:async()=>{const result=await api('submit',{kind:'op',app,op,args:{...args,confirm:true},timeout:7200,label:'Naver map: '+label,confirm:true},'platform/work_runner');return result.job?.id||result.job_id;},
      getJob:async id=>(await api('get',{job_id:id},'platform/work_runner')).job,
      waitJob:async id=>(await api('wait',{job_id:id,timeout_s:3},'platform/work_runner')).job,
      cancelJob:id=>api('cancel',{job_id:id,force:true,confirm:true},'platform/work_runner'),
      onComplete:async job=>{
        await refresh();if(disposed)return;
        const result=job.op_result;if(!result?.id)throw new Error('Search returned no discovery item');
        sidebarPaths=[];sidebarFocus='searches/'+result.id;tree.setCheckedPaths([]);
        tree.setChildren('searches',(await children('searches')).map(shape));
        tree.setActive(sidebarFocus);await applySidebar();go('discovery',sidebarFocus);await render();
        tell('Discovery updated: '+result.title+' · '+result.items.length+' places.'+(result.coordinate_resolution?' Coordinates: '+result.coordinate_resolution.remaining+' remaining.':''));
      }
    });return progress.ready;
  }
  async function queue(op,args,owner=app){if(owner===app&&['search_capture','discovery_coordinates'].includes(op))return queueDiscovery(args,op);const r=await api('submit',{kind:'op',app:owner,op,args:{...args,confirm:true},timeout:7200,label:'Naver map: '+op,confirm:true},'platform/work_runner');remember(r.job?.id||r.job_id);tell(op+' queued · '+jobId);}
  async function tick(){
    if(tickBusy||disposed)return;tickBusy=true;try{if(jobsRefresh)await jobsRefresh();guard(tickWatched)();}finally{tickBusy=false;}
  }
  // ROUND3 #9: the watched job is followed by ONE long-poll chain
  // (work_runner.wait, 25 s budget, returns at completion) instead of a
  // work_runner.get on every 2 s tick.
  let watching='';
  async function tickWatched(){
    if(!jobId||disposed||watching===jobId)return;const id=watching=jobId;
    try{
      for(;;){
        if(disposed||jobId!==id)return;
        const r=await api('wait',{job_id:id,timeout_s:25},'platform/work_runner'),job=r.job||r;
        if(disposed||jobId!==id)return;
        if(['done','failed','error','cancelled'].includes(job.status)){remember('');if(job.status!=='done'||!job.op_result?.ok)throw new Error(job.op_result?._error||job.error||job.status);tell(job.op_result.complete===false?'Saved partial progress. Check Jobs and resume to finish.':'Map job completed.');await refresh();await markerDetailRefresh?.();await render();return;}
        tell('Map job '+job.status+' · '+jobId+' · open Jobs for checkpoints');
      }
    }finally{if(watching===id)watching='';}
  }
  function operation(host,title,op,value,{slow=false,read=false,after,prepare}={}){
    host.append(node('h3',title));const editor=form(host,value),result=node('div');
    controls(host,[[slow?'Queue '+title:title,async()=>{const args=prepare?prepare(editor.getValue()):editor.getValue();if(slow){await queue(op,args);result.replaceChildren(node('p',op==='search_capture'?'Search progress is shown in the dialog.':'Queued. Follow progress in Jobs.'));}else{const r=await api(op,read?args:{...args,confirm:true});result.replaceChildren(pre(r));if(r.item?.revision!=null&&args.revision!=null)editor.setValue({...args,revision:r.item.revision});if(op==='collection_save'&&r.item?.id)editor.setValue({...args,id:r.item.id});if(op==='provider_configure')editor.setValue({...args,client_secret:'',key:''});if(!read)await refresh();if(after)await after(r);}}]]);host.append(result);return editor;
  }
  function download(blob,name){const url=URL.createObjectURL(blob),a=node('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
  async function artifact(blob,kind){if(!route)throw new Error('Select a route first');const r=await fetch('/apps/'+app+'/media/upload?format='+kind,{method:'POST',headers:{'X-Confirm':'true'},body:blob});const asset=await r.json();if(!asset.ok)throw new Error(asset.error);await api('route_artifact',{id:route.id,artifact:asset,confirm:true});return asset;}
  async function playbackPage(seconds,native=false){
    let scene,blob;
    if(native){const data=route.native_geometry,points=data.path,lengths=[0];for(let i=1;i<points.length;i++)lengths.push(lengths[i-1]+Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1]));scene={width:data.width,height:data.height,points,stops:data.stopIndices.slice(1,-1).map((index,i)=>({fraction:lengths[index]/lengths.at(-1),seconds:Number(route.stops[i+1].stopSeconds??1.5)}))};const response=await fetch(route.map_image.url);if(!response.ok)throw new Error('Saved native map unavailable');blob=await response.blob();}
    else{scene=map.exportScene();blob=await map.exportPng({head:false});}
    const background='data:image/png;base64,'+await AppUIFileUtils.readBase64(blob);download(new Blob([AppUIMap.playbackDocument(route,{scene,background,seconds})],{type:'text/html'}),native?'native-route-playback.html':'route-playback.html');
  }
  function addStop(row){if(!row?.coordinates)throw new Error('Fetch the place to obtain source coordinates');draftStops.push({place_id:row.place_id,name:row.title,coordinates:row.coordinates,stopSeconds:1.5});tell('Added stop '+draftStops.length+': '+row.title);}
  async function checkAccount(){
    if(accountBusy||disposed||!accountHost?.isConnected)return;accountBusy=true;
    try{const result=await api('account');if(disposed)return;accountScopes.forEach(x=>x?.destroy?.());accountScopes=[];buildingAccount=true;accountHost.replaceChildren(node('p',result.signed_in?'Signed in to Naver · '+result.folders.length+' saved folders. Select Import to save a folder locally.':'Not signed in to Naver in the managed browser.'));
      controls(accountHost,[['Naver sign in',login],['Check sign-in',checkAccount]]);
      if(result.signed_in){clearInterval(accountTimer);accountTimer=null;grid(accountHost,result.folders,[col('title','Naver folder'),col('count','Places'),actions(row=>row.share_id?[['Import bookmarks',()=>queue('folder_capture',{share_id:row.share_id,capture_places:false})],['Import with details and reviews',()=>queue('folder_capture',{share_id:row.share_id,capture_places:true,max_reviews:1000,resume:true,delay:1})]]:[])]);}
    }catch(error){accountHost.replaceChildren(node('p','Unable to check Naver sign-in: '+error.message));}finally{buildingAccount=false;accountBusy=false;}
  }
  async function login(){viewer?.destroy();clearInterval(accountTimer);accountTimer=setInterval(()=>checkAccount(),8000);viewer=AppUIRemoteBrowserViewer.create({title:'Sign in to Naver',why:'After sign-in, your saved folders appear in the map page. Choose a folder to import.',onDone:()=>checkAccount(),onClose:()=>{clearInterval(accountTimer);accountTimer=null;checkAccount();},transport:{open:body=>api('signin_open',{...body,url:'https://nid.naver.com/nidlogin.login',confirm:true},'system/cdp'),input:(session,kind,payload)=>api('signin_input',{session,kind,payload,confirm:true},'system/cdp'),stop:session=>api('signin_stop',{session,confirm:true},'system/cdp'),shot:(session,etag)=>api('signin_shot',{session,etag:etag||''},'system/cdp'),stream(){throw new Error('Polling transport');}}});}
  async function places(host,target){
    if(target){await place(host,target);return;}
    host.append(node('h2','Places'),node('p','Save Naver place details, menu, visitor reviews and photos. Full crawls checkpoint their cursor and can resume.'));
    operation(host,'Fetch place','capture',{url:'',max_reviews:1000,all_reviews:false,resume:true,max_photos:0},{slow:true});
    const filters=form(host,{query:'',collection:'',category:'',tag:''}),list=node('div');host.append(list);
    const draw=async()=>{const f=filters.getValue(),collections=sidebarCollections,members=f.collection?collections.find(c=>c.id===f.collection||c.title===f.collection)?.place_ids||[]:null;
      const rows=items.filter(row=>(!f.query||JSON.stringify(row).toLocaleLowerCase().includes(f.query.toLocaleLowerCase()))&&(!members||members.includes(row.place_id))&&(!f.category||row.category.includes(f.category))&&(!f.tag||(row.personal?.tags||[]).includes(f.tag)));
      list.replaceChildren();grid(list,rows,[col('title','Place'),col('category'),col('address'),col('score','Rating'),col('captured_reviews','Saved reviews'),col('review_count_text','Reported reviews'),col('capture_status','Capture'),actions(row=>[['Open',()=>go('places',row.place_id)],['Add route stop',()=>addStop(row)]])]);map.setItems(filteredPlaceRows(rows),{fitBounds:!visibleMapOnly});syncViewportTables();};
    controls(host,[['Apply filters',draw],['Fit places',()=>map.fit()],['Naver sign in',login]]);await draw();
  }
  async function place(host,target){
    const id=target.split('/')[0],section=target.split('/')[1]||'metadata',bundle=(await api('get',{place_id:id})).item;
    const parts=target.split('/');if(!['metadata','menu','information','reviews','photos','analysis','annotations','blogs'].includes(section)||parts.length>3||parts.length===3&&!['reviews','photos'].includes(section))throw new Error('Unknown place section');
    host.append(node('h2',bundle.metadata.title),node('p',bundle.metadata.roadAddress||bundle.metadata.address||''));map.setActive(id,{pan:false});
    controls(host,[['Fetch details',()=>fetchPlaceDetails(id)],['Fetch all remaining reviews',()=>fetchPlaceDetails(id,{allReviews:true})],...['metadata','menu','information','reviews','photos','analysis','annotations','blogs'].map(key=>[key,()=>go('places',id+'/'+key)]),['Naver source',()=>window.open(bundle.url,'_blank','noopener')],['Copy VIS link',()=>navigator.clipboard.writeText('vis://navermap/'+target)],['Add route stop',()=>addStop(items.find(r=>r.place_id===id))]]);
    if(bundle.warnings?.length)host.append(node('p','Capture notes: '+bundle.warnings.join(' | ')));
    if(section==='metadata'&&bundle.capture_notes?.naver_search_list){
      const note=bundle.capture_notes.naver_search_list;
      host.append(node('h3','List capture notes'),node('p','Search: '+(note.query||'')+' · page '+(note.page??'unknown')+' · zoom '+(note.zoom??'unknown')+' · captured '+(note.captured_at||'unknown')));
      own(AppUIArticle.create({container:host,blocks:[{type:'quote',text:note.text||''}]}));
      const trigger=node('button','List evidence details'),panel=node('div');panel.append(pre(note));host.append(trigger,panel);own(AppUIDisclosure.bind({trigger,panel,expanded:false}));
    }
    if(section==='reviews'){
      if(parts.length===3){const selected=await api('vis_node',{path:target});host.append(node('h3',selected.title),pre(selected.content));controls(host,[['All reviews',()=>go('places',id+'/reviews')],...['include','exclude','clear'].map(status=>[status,()=>api('review_select',{place_id:id,review_key:parts[2],status,confirm:true})])]);return;}
      await reviews(host,id);return;
    }
    if(section==='analysis'){
      const r=await api('review_insights',{place_id:id});host.append(node('p',r.notice),pre(r));
      operation(host,'Next analysis batch','analysis_next',{place_id:id,limit:30,context_tokens:16000},{read:true});
      operation(host,'Apply external analysis','analysis_apply',{place_id:id,annotation_revision:(await api('annotations',{place_id:id})).item.revision,rows:[]});
      operation(host,'Analyze with LLM','analysis_run',{place_id:id,backend:'ericai',batches:10,limit:30,context_tokens:16000},{slow:true});return;
    }
    if(section==='annotations'){const v=(await api('annotations',{place_id:id})).item;operation(host,'Save notes and tags','annotate',{place_id:id,revision:v.revision,notes:v.notes,tags:v.tags,collections:v.collections,display_name:v.display_name||''});host.append(pre(await api('related',{place_id:id})));return;}
    if(section==='blogs'){
      operation(host,'Fetch blog review links','blog_links',{place_id:id,sort:'latest',limit:200,capture_posts:0,max_comments:0,max_images:0},{slow:true});
      const saved=new Map((await api('status',{},'personal/web-naverblog')).items.map(row=>[row.url,row.path]));
      grid(host,bundle.blog_links||[],[col('title'),{id:'url',label:'Source',render:row=>{const a=node('a',row.url);a.href=row.url;a.target='_blank';a.rel='noopener';return a;}},actions(row=>saved.has(row.url)?[['Read saved article',()=>window.open('/apps/personal/web-naverblog/?path='+encodeURIComponent(saved.get(row.url)+'/article'),'_blank','noopener')]]:row.source_type==='naver-blog'?[['Save article',()=>queue('capture',{url:row.url,max_comments:100,max_images:20},'personal/web-naverblog')]]:[])]);return;
    }
    if(section==='photos'){
      operation(host,'Save source photos','photos_capture',{place_id:id,limit:30},{slow:true});
      let photos=bundle.photos||[];if(parts.length===3){if(!/^\d+$/.test(parts[2])||!photos[Number(parts[2])])throw new Error('Unknown photo');photos=[photos[Number(parts[2])]];controls(host,[['All photos',()=>go('places',id+'/photos')]]);}
      own(AppUIArticle.create({container:host,maxWidth:700,blocks:photos.map(photo=>({type:'image',local_url:photo.url,alt:(photo.kind||'Photo')+' · '+(photo.source_url||'')}))}));return;
    }
    if(section==='menu')grid(host,bundle.menu?.items||[],[col('name','Menu'),col('priceText','Price'),col('description')]);else host.append(pre(section==='metadata'?{metadata:bundle.metadata,state:bundle.state,capture:bundle.review_capture,updated:bundle.updated}:bundle.information));
    operation(host,'Nearby saved places','nearby',{place_id:id,radius:3000},{read:true,after:r=>{map.setRadius(r.center,r.radius);map.setItems([items.find(x=>x.place_id===id),...r.items],{fitBounds:true});}});
  }
  async function reviews(host,id){
    const filters=form(host,{place_id:id,query:'',sort:'visit-newest',period:'all',topic:'all',selected:'all',page:0,page_size:50}),body=node('div');host.append(body);let last;
    const draw=async()=>{const r=await api('reviews',filters.getValue());last=r;body.replaceChildren(node('p',r.total+' matching reviews · page '+(r.page+1)+' · '+JSON.stringify(r.capture)));
      grid(body,r.items.map(row=>({...row,author_name:row.author?.nickname||row.nickname||'',text:row.body||row.text||'',selected:row.selection?.status||'',category_text:row.categories.join(', ')})),[col('author_name','Reviewer'),col('visit_date','Visited'),col('created_date','Created'),col('text','Review'),col('selected'),col('category_text','Verified categories'),actions(row=>['include','exclude','clear'].map(status=>[status,async()=>{await api('review_select',{place_id:id,review_key:row.review_key,status,confirm:true});await draw();}]))],{getId:row=>row.review_key,renderDetails:row=>pre(row)});};
    controls(host,[['Apply review filters',draw],['Fetch all remaining reviews',()=>fetchPlaceDetails(id,{allReviews:true})],['Previous page',async()=>{const v=filters.getValue();filters.setValue({...v,page:Math.max(0,v.page-1)});await draw();}],['Next page',async()=>{if(!last?.more)return;const v=filters.getValue();filters.setValue({...v,page:v.page+1});await draw();}]]);
    host.append(node('p','Sort: source, visit-newest, visit-oldest, created-newest, created-oldest. Period: all, month, year, older, unknown. Selection: all, include, exclude. Expand a row for its source key and full text.'));
    await draw();operation(host,'Assign verified review categories','review_categories',{place_id:id,review_key:'',categories:[]});operation(host,'Continue full review capture','capture',{place_id:id,all_reviews:true,resume:true},{slow:true});
  }
  function editCustomCollection(collection){
    const body=node('div'),fields=node('div'),tools=node('div'),count=node('p'),tableHost=node('div'),error=node('p');body.append(fields,tools,count,error,tableHost);
    const chosen=new Set(collection?.place_ids||[]),editor=AppUIJsonForm.create({container:fields,value:{title:collection?.title||'',notes:collection?.notes||''}});
    let saving=false,dialog,query='';
    const updateCount=()=>{count.textContent=chosen.size+' selected places';};
    const table=AppUIDataTable.create({container:tableHost,items,columns:[{id:'selected',label:'Include',checkbox:row=>({checked:chosen.has(row.place_id),ariaLabel:'Include '+row.title,onChange:(row,checked)=>{if(checked)chosen.add(row.place_id);else chosen.delete(row.place_id);updateCount();}})},col('title','Place'),col('category'),col('address')],getId:row=>row.place_id,maxRows:1000});
    const redraw=()=>{table.setItems(items.filter(row=>!query||[row.title,row.category,row.address].join(' ').toLocaleLowerCase().includes(query)));updateCount();};
    const toolbar=AppUIToolbar.create({container:tools,label:'Collection membership',items:[{type:'search',ariaLabel:'Find collection places',placeholder:'Find places',onInput:value=>{query=value.toLocaleLowerCase();redraw();}},
      {label:'Add current map results',action:()=>{for(const row of map.getItems())if(items.some(item=>item.place_id===row.place_id))chosen.add(row.place_id);redraw();}},
      {label:'Clear membership',action:()=>{chosen.clear();redraw();}}]});updateCount();
    dialog=AppUIDialog.show({title:collection?'Edit custom collection':'New custom collection',body,width:'1000px',signal:pageLifetime.signal,
      buttons:[{text:'Save collection',primary:true,action:()=>{
        if(saving)return false;const value=editor.getValue();if(!String(value.title||'').trim()){error.textContent='Enter a collection name.';return false;}saving=true;error.textContent='Saving…';
        api('collection_save',{...value,...(collection?{id:collection.id}:{}),source:'local',place_ids:[...chosen],confirm:true}).then(async result=>{
          const navigate=dialog.isConnected;AppUIDialog.close(dialog);sidebarPaths=[];sidebarFocus='collections/'+result.item.id;tree.setCheckedPaths([]);await refresh();if(navigate)go('collections',sidebarFocus);
        }).catch(cause=>{saving=false;if(dialog.isConnected)error.textContent=cause.message;else tell(cause.message);});return false;
      }},{text:'Cancel'}],onClose(){editor.destroy();toolbar.destroy();table.destroy();}
    });
  }
  async function collections(host,target){
    if(target==='@addresses'||target==='@category'){host.append(node('h2',target==='@addresses'?'Addresses':'Category'));if(target==='@category')controls(host,[['Refresh source subcategories',()=>queue('category_refresh',{})]]);grid(host,await children(target),[col('title','Group'),actions(row=>[['Open',()=>go('collections',row.path)]])]);return;}
    const rows=(await api('collections')).items,selected=rows.find(r=>'collections/'+r.id===target);host.append(node('h2',selected?selected.title:'Collections'));
    controls(host,[['New custom collection',()=>editCustomCollection()]]);
    if(selected&&selected.source!=='naver')controls(host,[['Edit custom collection',()=>editCustomCollection(selected)],['Delete custom collection',async()=>{if(await AppUIDialog.confirmAsync('Delete this custom collection? Saved places will be kept.')){await api('collection_delete',{id:selected.id,confirm:true});sidebarPaths=[];sidebarFocus=null;tree.setCheckedPaths([]);await refresh();go('collections','collections');}}]]);
    if(selected)return;
    for(const [kind,label] of [['custom','Custom collections'],['naver','Naver collections']]){host.append(node('h3',label));grid(host,rows.filter(row=>(row.source==='naver'?'naver':'custom')===kind).map(row=>({...row,count:row.place_ids.length})),[col('title'),col('count','Places'),col('notes'),actions(row=>[['Open',()=>go('collections','collections/'+row.id)],...(kind==='custom'?[['Edit places',()=>editCustomCollection(row)]]:[])])]);}
    if(target.startsWith('hierarchy/')){const cached=sidebarHierarchy.find(row=>row.id===target.slice(10)),group=cached?{title:cached.name,attributes:cached}:await api('vis_node',{path:target});host.append(node('h3',group.title));grid(host,items.filter(row=>group.attributes.place_ids.includes(row.place_id)),[col('title'),col('category'),col('address'),actions(row=>[['Open',()=>go('places',row.place_id)]])]);}

  }
  async function discovery(host,target){
    host.append(node('h2','Restaurant and place discovery'),node('p','Search at several zoom levels. Candidates without source coordinates remain unlocated; radius distances are straight-line.'));
    const allSearches=(await api('searches')).items.filter(row=>Array.isArray(row.items)),selected=allSearches.find(row=>'searches/'+row.id===target);
    let appendTarget=selected?.id||'';
    const destination=node('div');host.append(destination);
    own(AppUIToolbar.create({container:destination,label:'Discovery destination',items:[{type:'select',ariaLabel:'Save search results to',value:appendTarget,options:[{value:'',label:'Create a new discovery item'},...allSearches.map(row=>({value:row.id,label:'Append to: '+row.title}))],onChange:value=>{appendTarget=value;}}]}));
    const searchArgs=args=>({...args,coordinates:map.getViewport().center,zooms:[Math.round(map.getViewport().zoom)],append_to:appendTarget||undefined});
    const viewport=map.getViewport(),locationNote=node('p');host.append(locationNote);
    const search=operation(host,'Search Naver map','search_capture',{query:selected?.query||'음식점',coordinates:viewport.center,zooms:[Math.round(viewport.zoom)],max_pages:5,limit:200,save_candidates:true},{slow:true,prepare:searchArgs});
    const nearby=operation(host,'Find nearby saved places','nearby',{coordinates:viewport.center,radius:3000},{read:true,after:r=>{map.setRadius(r.center,r.radius);map.setItems(r.items,{fitBounds:true});}});
    const useMap=()=>{const current=map.getViewport();search.setValue({...search.getValue(),coordinates:current.center,zooms:[Math.round(current.zoom)]});nearby.setValue({...nearby.getValue(),coordinates:current.center});locationNote.textContent='Map center: '+current.center.latitude.toFixed(6)+', '+current.center.longitude.toFixed(6)+' · zoom '+current.zoom;};
    controls(host,[['Use current map center and zoom',useMap],['Search current map',async()=>{useMap();await queue('search_capture',searchArgs(search.getValue()));}],['Append search to current discovery',async()=>{if(!appendTarget){tell('Select an existing discovery item in Save search results to.');return;}useMap();await queue('search_capture',searchArgs(search.getValue()));}]]);useMap();
    const unsubscribe=map.onViewportChange(useMap);own({destroy:unsubscribe});
    const savedSearches=allSearches.filter(search=>!target.startsWith('searches/')||target==='searches/'+search.id);
    if(!savedSearches.length)host.append(node('p','No discovery results yet. Search the current map to find places.'));
    const results=node('div');host.prepend(results);
    for(const saved of savedSearches){
      const host=results;
      if(saved.items)grid(host,saved.items,[col('name'),distanceColumn(),col('discovered_page','Page'),col('rank','Naver position'),col('review_count_text','Reviews'),col('advertisement','Ad'),col('coordinate_source'),col('snippet'),actions(row=>[['Open candidate',()=>{const id=String(row.placeId||row.place_id);map.setActive(id);go('places',id);}],['Fetch details',()=>fetchPlaceDetails(row.placeId||row.place_id)]])],{getId:row=>String(row.placeId||row.place_id)});
      host.append(node('h3',saved.title||saved.query||saved.id||'Folder source'));
      host.append(node('p',saved.coordinates?'Distance is straight-line from the saved discovery center ('+saved.coordinates.latitude+', '+saved.coordinates.longitude+').':'Distance unavailable: this discovery has no saved center.'));
      const pages=Object.entries(saved.pagination||{}).map(([zoom,cursor])=>'zoom '+zoom+': '+(cursor.exhausted?'source ended':'next page '+cursor.next_page)+' ('+cursor.stop_reason+')');
      host.append(node('p',pages.length?pages.join(' · '):'Captured through page '+Math.max(0,...(saved.runs||[]).map(run=>run.page))+'. Fetch next pages continues the saved search scope.'));
      controls(host,[['Fetch next pages',async()=>{const budget=search.getValue();await queue('search_capture',{continue_from:saved.id,query:saved.query,max_pages:budget.max_pages,limit:budget.limit,save_candidates:true});}]]);
      controls(host,[['Resolve missing coordinates',()=>queue('discovery_coordinates',{id:saved.id})]]);
      controls(host,[['Refresh list notes',()=>queue('search_capture',{refresh_list:saved.id,query:saved.query,max_pages:Math.min(50,Math.max(5,...(saved.runs||[]).map(run=>run.page))),limit:5000,save_candidates:true,resolve_coordinates:false})]]);
    }
  }
  async function visits(host,target){
    host.append(node('h2','Photo visits'),node('p','Import photos through VFS for EXIF GPS and dates. Place choices remain separate from original photo evidence.'));
    const rows=(await api('visits')).items;grid(host,rows,[col('title'),col('photo_count','Photos'),col('visit_count','Visit dates'),col('address'),actions(row=>[['Open',()=>go('visits','visits/'+row.id)],['Map',()=>map.setItems([{...row,place_id:row.id}],{fitBounds:true})]])]);
    const selected=target.startsWith('visits/')?(await api('visits',{id:target.split('/')[1]})).item:null;
    if(selected){host.append(node('h3',selected.title),pre(selected.visit_dates));operation(host,'Update visit','visit_update',{id:selected.id,custom_name:selected.custom_name||'',notes:selected.notes||'',collections:selected.collections||[],selected_place:selected.selected_place||{},address_default:false});operation(host,'Photo place override','visit_photo_update',{id:selected.id,photo_id:'',selected_place:{},clear:false});
      const parts=target.split('/');if(parts.length===4){const photo=selected.photos[Number(parts[3])];if(parts[2]!=='photos'||!/^\d+$/.test(parts[3])||!photo)throw new Error('Unknown visit photo');own(AppUIArticle.create({container:host,blocks:[{type:'image',local_url:photo.url||photo.thumbnail?.url,alt:photo.title||photo.id}]}));host.append(pre(photo));}
      grid(host,selected.photos.map(row=>({...row,coordinate_text:JSON.stringify(row.coordinates)})),[col('id'),col('taken_at','Taken'),col('source'),col('coordinate_text','Source GPS')],{renderDetails:row=>{const box=node('div');if(row.url)own(AppUIArticle.create({container:box,blocks:[{type:'image',local_url:row.url,alt:'Visit photo'}]}));box.append(pre(row));return box;}});
    }
    operation(host,'Import EXIF photos','photo_import',{urls:[],limit:500},{slow:true});operation(host,'Import GPS evidence records','visits_import',{photos:[]});operation(host,'Group nearby visits','visit_group',{ids:[],name:'',radius:500});
    operation(host,'Resolve coordinates to address','reverse_geocode',{coordinates:selected?.coordinates||{latitude:37.5665,longitude:126.978}},{slow:true});operation(host,'Find places at address','address_lookup',{address:selected?.address||''},{slow:true});host.append(node('h3','Saved address and place evidence'),pre(await api('locations')));
  }
  async function routes(host,target){
    host.append(node('h2','Routes and waypoint playback'),node('p','Add ordered stops from Places, then calculate. Lines follow returned source geometry. Metrics-only results have no playable line. API providers need credentials.'));
    const rows=(await api('routes')).items;grid(host,rows,[col('title'),col('provider'),col('mode'),col('distanceMeters','Metres'),col('duration'),col('metricsOnly','Metrics only'),actions(row=>[['Open route',()=>go('routes','routes/'+row.id)]])]);route=target.startsWith('routes/')?(await api('route_get',{id:target.split('/')[1],section:'geometry'})).item:null;
    if(route){await map.setRoute(route);host.append(node('h3',route.title),pre({stops:route.stops,distanceMeters:route.distanceMeters,duration:route.duration,metricsOnly:route.metricsOnly}));if(route.map_image){const a=node('a','Captured Naver map');a.href=route.map_image.url;a.target='_blank';host.append(a);}
      if(target.split('/')[2]){const section=target.split('/')[2];host.append(node('h3',section),pre((await api('route_get',{id:route.id,section})).item));}
      const playback=form(host,{seconds:12,position:0});controls(host,[['Play',()=>map.play({seconds:playback.getValue().seconds})],['Pause',()=>map.pause()],['Resume',()=>map.resume()],['Stop',()=>map.stop()],['Seek',()=>map.seek(playback.getValue().position)],
        ['GeoJSON',()=>download(new Blob([JSON.stringify(map.exportGeoJSON(),null,2)],{type:'application/geo+json'}),'route.geojson')],['SVG',()=>download(new Blob([map.exportSvg()],{type:'image/svg+xml'}),'route.svg')],
        ['PNG',async()=>{const b=await map.exportPng();await artifact(b,'png');download(b,'route.png');}],...['webm','mp4'].map(format=>[format.toUpperCase()+' animation',async()=>{const asset=await artifact(await map.exportPng({head:false}),'png');await queue('route_render',{id:route.id,background:asset.file,scene:map.exportScene(),seconds:playback.getValue().seconds,format});}]),...(route.native_geometry?[['Native map MP4',()=>queue('route_render',{id:route.id,seconds:playback.getValue().seconds,format:'mp4'})]]:[]),
        ['Route check',async()=>host.append(pre(await api('route_check',{id:route.id})))],['Playback page',()=>playbackPage(playback.getValue().seconds)],...(route.native_geometry?[['Native playback page',()=>playbackPage(playback.getValue().seconds,true)]]:[])]);
      for(const a of route.artifacts||[]){const link=node('a','Saved '+a.file.split('.').pop()+' · '+a.bytes+' bytes');link.href=a.url;link.target='_blank';host.append(link,node('br'));}
      operation(host,'Convert saved animation','route_convert',{id:route.id,file:(route.artifacts||[]).find(a=>a.file.endsWith('.webm'))?.file||'',format:'mp4'},{slow:true});
    }
    operation(host,'Calculate route','route_calculate',{title:'',provider:'naver-browser',mode:'DRIVE',stops:draftStops,optimize:false,strict_geometry:false},{slow:true});controls(host,[['Clear draft stops',()=>{draftStops=[];render();}]]);
    host.append(node('p','Providers: naver-browser, naver, kakao, google. Modes: DRIVE, WALKING, TRANSIT, BICYCLING. Stops: {name, coordinates:{latitude,longitude}, place_id?, stopSeconds?}. Native Naver segments are accepted.'));
    operation(host,'Import source route geometry','route_import',{title:'Imported route',geojson:{type:'LineString',coordinates:[]},route:{stops:[]}});
  }
  async function jobs(host){
    host.append(node('h2','Jobs and resumable checkpoints'),node('p','Updates live as jobs change. Select a job to inspect its request, progress, errors and collected results.'));
    const status=node('p'),tableHost=node('div'),detail=node('div'),checkpoints=node('div');status.setAttribute('role','status');host.append(status,tableHost,detail,checkpoints);
    const selected=path().replace(/^jobs\//,'');let alive=true,busy=false;
    own({destroy(){alive=false;jobsRefresh=null;}});
    const table=grid(tableHost,[],[col('id'),col('label'),col('status'),col('progress_text','Current activity'),col('counts','Progress'),col('error'),actions(row=>[['Details',()=>go('jobs','jobs/'+row.id)],['Watch',()=>remember(row.id)],['Cancel',()=>api('cancel',{job_id:row.id,confirm:true},'platform/work_runner')]])],{onRowClick:row=>go('jobs','jobs/'+row.id)});
    const update=async()=>{
      if(busy||!alive)return;busy=true;
      try{const r=await api('list',{which:'all',limit:100},'platform/work_runner');let rows=(r.jobs||r.items||[]).filter(row=>row.app===app||row.args?.app===app||row.label?.startsWith('Naver map:'));
        rows=await Promise.all(rows.map(async row=>row.id===selected?(await api('get',{job_id:row.id},'platform/work_runner')).job:row));
        if(!alive)return;
        rows.sort((a,b)=>Number(['running','pending'].includes(b.status))-Number(['running','pending'].includes(a.status)));
        table.setItems(rows.map(row=>({...row,progress_text:row.progress?.detail||'',counts:row.progress?.total?row.progress.done+'/'+row.progress.total:''})));
        status.textContent=rows.filter(row=>['running','pending'].includes(row.status)).length+' active jobs - updated '+new Date().toLocaleTimeString();
        const job=rows.find(row=>row.id===selected)||rows.find(row=>row.id===jobId)||rows[0];
        detail.replaceChildren();if(job){detail.append(node('h3',job.label||job.id),node('p',job.status+' - '+(job.progress?.detail||'')),pre(job));if(job.progress?.fraction!=null){const meter=node('progress');meter.max=1;meter.value=job.progress.fraction;detail.prepend(meter);}}
        const saved=await api('checkpoints');if(alive)checkpoints.replaceChildren(node('h3','Saved review checkpoints and batch outcomes'),pre(saved));
      }finally{busy=false;}
    };
    // ROUND4 #29: follow the EventBus "jobs" channel (work_runner state changes + throttled progress) and refresh on
    // an event; the 2 s tick then only re-lists every 20 s as a fallback while the bus is connected.
    let last=0,busUp=false,pend=null,bus=null;
    const run=async()=>{last=Date.now();await update();};
    try{if(window.AppUIEventBus){bus=new AppUIEventBus(['jobs'],{debounce:300,onStatus:s=>{busUp=s==='connected';}});bus.onAny((ch)=>{if(ch==='jobs'&&alive&&!pend)pend=setTimeout(()=>{pend=null;run();},250);});own({destroy(){try{bus.close();}catch(_e){}if(pend)clearTimeout(pend);}});}}catch(_e){bus=null;}
    jobsRefresh=()=>busUp&&Date.now()-last<20000?null:run();await run();
    controls(host,[['Refresh jobs',update]]);
  }
  async function tools(host){host.append(node('h2','Naver connection and imports'),accountHost);checkAccount();host.append(node('h2','Connections and migration'),node('p','Keys are stored by the platform credential vault. Kakao partner walking, bicycle and transit APIs require enabled access.'));host.append(pre(await api('provider_status')));operation(host,'Configure provider','provider_configure',{provider:'naver',client_id:'',client_secret:'',key:''});operation(host,'Import old Map.db','legacy_import',{url:'file:///C:/251216/personal-kb/kb/Map.db'},{slow:true});operation(host,'Delete collection','collection_delete',{id:''});operation(host,'Delete route','route_delete',{id:''});}
  async function renderOnce(){const ticket=++epoch;scopes.forEach(x=>x?.destroy?.());scopes=[];details.replaceChildren();const box=node('section');details.append(box);route=null;map?.setRadius(null,0);const view=router?.get('view')||'places';if(view!=='routes')map?.setRoute(null);try{await ({places,collections,discovery,visits,routes,jobs,tools}[view]||places)(box,path());if(ticket!==epoch)box.remove();else if(sidebarPaths.length||sidebarFocus)await applySidebar({fitBounds:false});}catch(error){if(ticket===epoch){box.append(node('p',error.message));tell(error.message);}}}
  async function render(){renderPending=true;if(renderRunning)return;renderRunning=true;try{await pageReady;while(renderPending&&!disposed){renderPending=false;await renderOnce();}}finally{renderRunning=false;}}
  function mountTree(host){const box=node('div'),tools=node('div');host.append(tools,box);const toolbar=AppUIToolbar.create({container:tools,label:'Map selection',items:[{type:'select',ariaLabel:'Combine checked groups',value:sidebarMode,options:[{value:'or',label:'OR - any checked group'},{value:'and',label:'AND - every checked group'}],onChange:guard(async value=>{sidebarMode=value;localStorage.setItem('web-navermap.selection-mode',value);await applySidebar();})},{type:'checkbox',label:'Hide zero matches (AND)',checked:sidebarHideZero,onChange:value=>{sidebarHideZero=value;localStorage.setItem('web-navermap.hide-zero',String(value));syncSidebarData();}},{label:'Refresh',action:guard(async()=>{await refresh();await render();})},{label:'Clear selection',action:guard(async()=>{sidebarPaths=[];sidebarFocus=null;tree.setCheckedPaths([]);await applySidebar();})}]});tree=AppUITree.create({container:box,searchable:true,onContextMenu:guard(categoryContextMenu),storageKey:'web-navermap.tree',decorateRow:decorateSidebar,checkable:row=>selectablePath(row.path),checkedPaths:sidebarPaths,onCheck:guard(checkSidebar),onSelect:selectSidebar,onExpand:(row,done)=>children(row.path).then(rows=>done(rows.map(shape))).catch(error=>{tell(error.message);done([]);})});return()=>{toolbar.destroy();tree?.destroy();};}
  window.AppUIReady.then(()=>AppUI.createApp({id:ns,title:'Naver Places',leftSidebar:{width:290,tabs:[{id:'library',label:'Map library',active:true,render:mountTree}]},content:{async render(host){
    try{
    const mapHost=node('div');notice=node('div');notice.hidden=true;notice.setAttribute('role','status');document.getElementById('app-content-bottom').append(notice);accountHost=node('div');navigationFreshness=node('div');navigationFreshness.setAttribute('role','status');details=node('div');host.append(navigationFreshness);
    const splitHost=node('div');host.append(splitHost);
    await AppUIAssets.load('splitter');
    const split=AppUISplit.create({container:splitHost,ratio:.55,minSize:240,primaryLabel:'Place table and details',secondaryLabel:'Place map',primary:details,secondary:mapHost});persistent.push(split);
    split.element.style.height='calc(100vh - 70px)';split.primary.style.overflow='auto';split.secondary.style.overflow='auto';
    details.append(node('p','Loading places and map?'));
    const cached=cachedNavigation();
    const initialRefresh=refresh(cached?Promise.resolve(cached):startupData);
    if(cached)navigationFreshness.textContent='Showing saved navigation; refreshing from the server?';
    const liveRefresh=initialRefresh.then(async()=>{try{if(cached)await refresh(startupData);rememberNavigation(await startupData);navigationFreshness.textContent='';}catch(error){if(!cached)throw error;navigationFreshness.textContent='Showing saved navigation; live refresh failed. Use Refresh to retry.';}});
    liveRefresh.catch(()=>{});
    pageReady=(async()=>{
      await initialRefresh;
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      await AppUIAssets.load('map','previewEditors','jsonEditor','dataTable','article','remoteBrowserViewer');if(disposed)return;
      const appearanceHost=node('div');mapHost.append(appearanceHost);
      map=AppUIMap.create({container:mapHost,items:[],height:480,label:'Places and source route geometry',...mapAppearance(),onSelect:showMarkerDetails,onHover:row=>{for(const table of sidebarTables.keys())table.setHighlighted(row?.place_id||row?.id||null,{scroll:!!row});}});
      mountMapControls(appearanceHost);
      await map.ready;if(!disposed)await applySidebar({fitBounds:true});
    })();
    AppUIRouter.alias(ns,'path','path');AppUIRouter.alias(ns,'view','view');router=AppUIRouter.create(ns,()=>render());AppUIHostHooks.register('navermap.assistant',{context:()=>JSON.stringify({view:router.get('view')||'places',path:path(),summary,sidebarSelection:{mode:sidebarMode,paths:sidebarPaths},route:route?{id:route.id,title:route.title}:null,draftStops})});
    if(selectablePath(path()))sidebarFocus=path();
    await pageReady;await liveRefresh;await render();poller=AppUIPollRefresh.create(()=>guard(tick)(),2000,{refreshOnVisible:true});poller.start();
    }catch(error){tell(error.message);}
  }}})).catch(error=>tell(error.message));
  window.addEventListener('pagehide',()=>{disposed=true;epoch++;pageLifetime.abort();markerDialog?.abort();clearInterval(accountTimer);poller?.stop();router?.destroy();tree?.destroy();map?.destroy();viewer?.destroy();scopes.concat(persistent,accountScopes).forEach(x=>x?.destroy?.());});
})();
