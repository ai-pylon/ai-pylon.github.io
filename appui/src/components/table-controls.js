/* Renderer-independent table find, column chooser and header context menu. */
window.AppUITableControls={
  bindHeader({cell,column,scope,onMenu,onMove,reorderable=true,isCurrent=()=>true}){
    cell.dataset.columnId=column.id;cell.tabIndex=0;cell.draggable=reorderable;
    scope.listen(cell,'contextmenu',event=>{event.preventDefault();if(isCurrent())onMenu?.(column,event);});
    scope.listen(cell,'keydown',event=>{if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){event.preventDefault();const rect=cell.getBoundingClientRect();if(isCurrent())onMenu?.(column,{x:rect.left,y:rect.bottom});}});
    if(!reorderable)return;
    scope.listen(cell,'dragstart',event=>{if(event.target.closest('.appui-dt-resize-handle,.aubt-rs,button')){event.preventDefault();return;}event.dataTransfer.setData('application/x-appui-column',column.id);event.dataTransfer.effectAllowed='move';});
    scope.listen(cell,'dragover',event=>{if([...event.dataTransfer.types].includes('application/x-appui-column')){event.preventDefault();event.dataTransfer.dropEffect='move';}});
    scope.listen(cell,'drop',event=>{const source=event.dataTransfer.getData('application/x-appui-column');if(source&&isCurrent()){event.preventDefault();onMove?.(source,column.id);}});
  },
  create({container,opts,allColumns,getColumns,getFilters,setSearch,clearFilters,setVisible,moveColumn,resetColumns,showFilter,sortColumn,clearSort,isCurrent}){
    const scope=AppUILifecycle.createViewScope({pagehide:false,isCurrent});
    const host=document.createElement('div');host.className='appui-dt-tools';container.append(host);
    const search=document.createElement('input');search.type='search';search.placeholder='Find in table';search.setAttribute('aria-label','Find in table');
    const count=document.createElement('span');count.setAttribute('role','status');
    scope.listen(search,'input',()=>setSearch(search.value));
    scope.listen(search,'keydown',event=>{if(event.key==='Escape'){search.value='';setSearch('');event.preventDefault();event.stopPropagation();}});
    const columnsButton=document.createElement('button');columnsButton.type='button';columnsButton.textContent='Columns';
    const clear=document.createElement('button');clear.type='button';clear.textContent='Clear filters';scope.listen(clear,'click',clearFilters);
    host.append(search,columnsButton,clear,count);if(opts.find===false)search.hidden=true;
    let chooser,chooserScope;
    function showColumns(){
      if(!scope.current())return;
      chooser?.abort();chooserScope?.destroy();chooser=new AbortController();chooserScope=AppUILifecycle.createScope();
      const body=document.createElement('div');body.className='appui-dt-column-choices';
      const visible=new Set(getColumns().map(col=>col.id));
      const checks=[];
      for(const col of allColumns){
        const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.checked=visible.has(col.id);input.setAttribute('aria-label',col.label||col.id);
        label.append(input,document.createTextNode(col.label||col.id));body.append(label);checks.push([col,input]);
        chooserScope.listen(input,'change',()=>{if(!setVisible(col.id,input.checked))input.checked=true;for(const [,check]of checks)check.disabled=checks.filter(([,c])=>c.checked).length===1&&check.checked;});
      }
      for(const [,check]of checks)check.disabled=visible.size===1&&check.checked;
      AppUIDialog.show({title:'Table columns',body,signal:chooser.signal,onClose:()=>chooserScope?.destroy(),buttons:[{text:'Show all',action:()=>{for(const col of allColumns)setVisible(col.id,true);}},{text:'Reset columns',action:resetColumns},{text:'Close',primary:true}]});
    }
    scope.listen(columnsButton,'click',showColumns);
    scope.listen(container,'keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='f'&&opts.controls!==false&&opts.find!==false){event.preventDefault();event.stopPropagation();search.focus();search.select();}});
    let menuController;
    async function showMenu(col,event){
      const point={x:event.clientX??event.x,y:event.clientY??event.y};
      menuController?.abort();const controller=new AbortController();menuController=controller;
      try{await AppUIAssets.load('contextMenu');}catch(error){if(scope.current())AppUIToast.error(error.message);return;}
      if(!scope.current()||controller.signal.aborted)return;
      const columns=getColumns(),index=columns.findIndex(c=>c.id===col.id);
      AppUIContextMenu.show(point,[
        {label:'Sort ascending',disabled:col.sortable===false||!!col.actions||!!col.checkbox,action:()=>sortColumn(col.id,true)},
        {label:'Sort descending',disabled:col.sortable===false||!!col.actions||!!col.checkbox,action:()=>sortColumn(col.id,false)},
        ...(clearSort?[{label:'Clear sort',action:clearSort}]:[]),
        {label:'Copy column name',action:()=>{try{navigator.clipboard.writeText(String(col.id)).catch(()=>{});}catch{}}},
        {label:'Filter '+(col.label||col.id),disabled:col.filterable===false||!!col.actions||!!col.checkbox,action:()=>showFilter(col)},
        {label:'Clear filters',disabled:!Object.keys(getFilters()).length,action:clearFilters},
        {separator:true},
        {label:'Hide column',disabled:columns.length<=1,action:()=>setVisible(col.id,false)},
        {label:'Choose columns...',action:showColumns},
        {label:'Move left',disabled:opts.reorderable===false||index<=0,action:()=>moveColumn(col.id,columns[index-1].id)},
        {label:'Move right',disabled:opts.reorderable===false||index===columns.length-1,action:()=>moveColumn(col.id,columns[index+1].id)},
        {label:'Reset columns',action:resetColumns},...(opts.columnMenuItems?.(col)||[])
      ],{signal:controller.signal});
    }
    if(opts.controls===false)host.style.display='none';
    return {showMenu,showColumns,update({query,count:total,filtered}){if(search.value!==query)search.value=query;count.textContent=total+(total===1?' row':' rows');clear.disabled=!filtered;},destroy(){chooser?.abort();chooserScope?.destroy();menuController?.abort();scope.destroy();host.remove();}};
  }
};
