/* Private DOM and listener ownership for DataTable headers. */
window._AppUIDataTableHeader = {
  create({header,body,columns,opts,sort,filters,onSort,onFilter,onMenu,onMove,isCurrent}) {
    const scope=AppUILifecycle.createScope(),current=()=>!scope.destroyed&&isCurrent();
    header.innerHTML = '';
    const row = document.createElement('div');
    row.className = 'appui-dt-row appui-dt-row-header';
    columns.forEach(col => {
      if (!current()) return;
      const cell = document.createElement('div');
      cell.className = 'appui-dt-cell appui-dt-cell-header';
      cell.style.boxSizing='border-box';
      AppUITableControls.bindHeader({cell,column:col,scope,onMenu,onMove,reorderable:opts.reorderable!==false,isCurrent:current});
      if (col.width) {cell.style.width = col.width;cell.style.flex = '0 0 ' + col.width;}
      else cell.style.flex = '1';
      cell.style.minWidth = col.minWidth || '60px';

      // Label + sort indicator
      const label = document.createElement('span');
      label.className = 'appui-dt-label';
      label.textContent = col.label || col.id;
      if (col.description) {
        const hint = document.createElement('small');
        hint.textContent = col.description;
        hint.style.cssText = 'display:block;font-size:9px;color:var(--text-muted)';
        label.appendChild(hint);
      }
      cell.appendChild(label);

      if (col.sortable || sort.column === col.id) {
        const arrow = document.createElement('span');
        arrow.className = 'appui-dt-sort';
        if (sort.column === col.id) arrow.textContent = sort.asc ? ' ▲' : ' ▼';
        else arrow.textContent = ' ⇅';
        cell.appendChild(arrow);
        cell.style.cursor = 'pointer';
        scope.listen(cell,'click',()=>{if(current())onSort(col);});
      }

      if(filters[col.id]){
        cell.classList.add('appui-dt-column-filtered');
        const filter=filters[col.id];
        cell.title='Filter: '+AppUITableFilter.format(filter)+' (right-click to change)';
      }

      // Column resize handle
      if (opts.resizable !== false) {
        const handle = document.createElement('div');
        handle.className = 'appui-dt-resize-handle';
        handle.style.cssText = 'position:absolute;right:0;top:0;bottom:0;width:8px;cursor:col-resize;user-select:none;z-index:2';
        handle.draggable=false;handle.title='Drag to resize column';
        let startX, startWidth;
        const binding = window.AppUIPointerGesture.bind(handle, {
          onStart(event) {
            event.stopPropagation();cell.draggable=false;
            startX = event.clientX;startWidth = cell.offsetWidth;
          },
          onMove(event) {
            const newWidth = Math.max(40, startWidth + event.clientX - startX);
            col.width = newWidth + 'px';
            col.minWidth='40px';cell.style.minWidth='40px';cell.style.boxSizing='border-box';
            cell.style.width = newWidth + 'px';cell.style.flex = '0 0 '+newWidth+'px';
            const colIdx = columns.indexOf(col);
            body.querySelectorAll('.appui-dt-row').forEach(row => {
              const cells = row.querySelectorAll('.appui-dt-cell');
              if (cells[colIdx]) {cells[colIdx].style.minWidth='40px';cells[colIdx].style.boxSizing='border-box';cells[colIdx].style.width = newWidth + 'px';cells[colIdx].style.flex = '0 0 '+newWidth+'px';}
            });
          },
          onEnd(){cell.draggable=opts.reorderable!==false;},
        });
        scope.listen(handle,'click',event=>{if(current())event.stopPropagation();});
        scope.add(binding);
        cell.style.position = 'relative';
        cell.appendChild(handle);
      }

      row.appendChild(cell);
    });
    header.appendChild(row);

    return scope;
  }
};
