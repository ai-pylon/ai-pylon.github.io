/* AppUI DataTable: sortable, filterable table for content areas.
 *
 * Usage:
 *   const table = AppUIDataTable.create({
 *     container: document.getElementById('content'),
 *     columns: [
 *       { id: 'time', label: 'Time', width: '80px', render: row => new Date(row.ts*1000).toLocaleTimeString() },
 *       { id: 'channel', label: 'Channel', sortable: true, filterable: true },
 *       { id: 'event', label: 'Event', sortable: true, filterable: true },
 *       { id: 'source', label: 'Source', sortable: true },
 *       { id: 'data', label: 'Data', render: row => JSON.stringify(row.data) },
 *     ],
 *     items: [],
 *     getId: row => row.ts,
 *     empty: 'No data',
 *     maxRows: 300,           // cap displayed rows
 *     stickyHeader: true,
 *   });
 *   table.setItems(newItems);          // replace all
 *   table.prepend(item);               // add to top (live stream)
 *   table.setFilter(columnId, value);  // filter by column value
 *   table.clearFilters();
 *   table.setSearch('text'); // case-insensitive find over loaded data
 *   table.setColumnVisible('source', false);
 *   table.moveColumn('source', 'time'); // move to target column position
 *   table.getColumns(); // order + hidden flags (copies)
 *   table.resetColumns();
 * Built-in controls (controls:false to hide) include find and a column chooser.
 * Header right-click / Shift+F10 offers sort, filter, hide and move actions.
 * Headers support drag/drop unless reorderable:false. At least one stays visible.
 * stateKey optionally persists column order/visibility in localStorage; no data
 * or search terms are persisted. New columns appear according to their defaults.
 * filterable:false opts a column out of filters; searchable:false opts out of find.
 *   table.exportXlsx({filename: 'results', sheetName: 'Results'});
 *   table.exportCsv({filename: 'results'});
 * Exports use displayed model order/filter/maxRows (including virtual rows).
 * Pass scope:'all' for all loaded items. Columns support export:false,
 * exportValue(row), exportLink(row), exportLabel and exportWidth. Renderers
 * are never invoked. Numeric cells stay numeric; XLSX links are clickable.
 * Columns may provide getValue(row) for sorting/filtering computed values.
 * Custom renderers do not change the underlying sort/filter value.
 * actions: descriptors[] or actions(row) renders owned native buttons instead
 * of the cell value. Descriptors support label, title, ariaLabel, className,
 * disabled and action(row, event). Button clicks do not trigger onRowClick.
 * checkbox: descriptor or checkbox(row) renders an owned native checkbox with
 * checked, disabled, title, ariaLabel, className and onChange(row, checked, event).
 * render(row, scope) receives signal/current/add/listen helpers owned by the
 * displayed body. Rebuilding rows or a virtual window releases that scope.
 * renderDetails(row, scope) optionally returns full-width expandable content.
 * Its scope is released on collapse and row replacement. Use getId for stable
 * expansion across setItems; detailLabel(row) names the native toggle button.
 */
const AppUIDataTable = (() => {
  function create(opts = {}) {
    const container = typeof opts.container === 'string' ? document.querySelector(opts.container) : opts.container;
    if (!container) throw new Error('AppUIDataTable: container required');
    if (opts.signal?.aborted) return {
      setItems() {}, prepend() {}, setFilter() {}, clearFilters() {},
      getFilters: () => ({}), setHighlighted() {}, render() {}, destroy() {},
      setSearch() {}, getSearch:()=>'',getColumns:()=>[],setColumnVisible:()=>false,moveColumn(){},resetColumns(){},showColumns(){},getDisplayItems:()=>[],
      exportCsv() {throw new Error('Table is destroyed');}, exportXlsx() {throw new Error('Table is destroyed');},
    };
    const columnState=AppUITableColumns.create({columns:opts.columns||[],stateKey:opts.stateKey,onChange(){_render();opts.onColumnsChange?.(getColumns());}});
    const allColumns=columnState.all,columns=columnState.visible;
    let query='';
    const getColumns=columnState.getColumns;
    function setColumnVisible(id,show){return !_destroyed&&columnState.setVisible(id,show);}
    function moveColumn(id,target){if(!_destroyed)columnState.move(id,target);}
    function resetColumns(){if(!_destroyed)columnState.reset();}
    function setSearch(value){if(_destroyed)return;query=String(value||'');bodyEl.scrollTop=0;_render(true);}
    const maxRows = opts.maxRows || 500;
    const getId = opts.getId || (row => row.id || row.ts || Math.random());
    const detailId = opts.getId || (row => row.id ?? row.ts ?? row);
    const expandedDetails = new Set(opts.expandedDetails || []);

    let _items = opts.items ? [...opts.items] : [];
    let _sortCol = opts.sort?.column || null, _sortAsc = opts.sort?.direction !== 'desc';
    let _filters = Object.create(null);  // columnId → filterValue
    let _destroyed = false;
    let highlightedId=null;
    function paintHighlight(){for(const row of bodyEl.querySelectorAll('.appui-dt-row'))row.classList.toggle('appui-dt-row-highlighted',highlightedId!==null&&row.dataset.rowId===highlightedId);}
    function setHighlighted(id,{scroll=false}={}){
      highlightedId=id==null?null:String(id);
      if(_destroyed)return;
      if(scroll&&highlightedId!==null){
        const display=_getDisplayItems(),index=display.findIndex(item=>String(opts.getId?.(item)??item.id??'')===highlightedId);
        if(index>=0){
          if(!opts.renderDetails&&opts.virtualScroll!==false&&display.length>200){
            if(index*32<bodyEl.scrollTop||index*32+32>bodyEl.scrollTop+bodyEl.clientHeight){bodyEl.scrollTop=Math.max(0,index*32-bodyEl.clientHeight/2);bodyEl.dispatchEvent(new Event('scroll'));}
          }else{const row=[...bodyEl.querySelectorAll('.appui-dt-row')].find(row=>row.dataset.rowId===highlightedId);if(row){const top=row.getBoundingClientRect().top-bodyEl.getBoundingClientRect().top;if(top<0||top+row.offsetHeight>bodyEl.clientHeight)bodyEl.scrollTop+=top-bodyEl.clientHeight/2;}}
        }
      }
      paintHighlight();
    }
    let _rowsScope = null;
    function clearRows() {const previous=_rowsScope;_rowsScope=null;previous?.destroy();}
    function renderContext() {
      clearRows();
      const scope = AppUILifecycle.createViewScope({pagehide: false,
        isCurrent: () => !_destroyed && _rowsScope === scope,
      });
      _rowsScope = scope;
      const context = {
        signal: scope.signal,
        current: () => scope.current(),
        add: cleanup => scope.add(cleanup),
        listen(target, type, listener, options) {
          return scope.listen(target, type, function (...args) {
            if (context.current()) return listener.apply(this, args);
          }, options);
        },
      };
      return context;
    }
    let headerScope;
    let _filterCleanup = null;
    const {columnValue}=window._AppUIDataTableModel;
    const detailRow=window._AppUIDataTableDetails.create({opts,columns,detailId,expandedDetails,columnValue});
    const _createRow=window._AppUIDataTableRows.create({opts,columns,detailRow,isCurrent:()=>!_destroyed});

    container.classList.add('appui-datatable');
    const view=window.AppUITableControls.create({container,opts,allColumns,getColumns:()=>columns.slice(),getFilters,setSearch,clearFilters,setVisible:setColumnVisible,moveColumn,resetColumns,showFilter:_showFilterPopup,isCurrent:()=>!_destroyed,clearSort(){_sortCol=null;_render();opts.onSort?.({column:null,direction:null});},
      sortColumn(id,ascending){_sortCol=id;_sortAsc=ascending;_render();opts.onSort?.({column:id,direction:ascending?'asc':'desc'});}});
    const headerEl = document.createElement('div');
    headerEl.className = 'appui-dt-header';
    const bodyEl = document.createElement('div');
    bodyEl.className = 'appui-dt-body';
    container.append(headerEl, bodyEl);
    headerEl.style.overflow = 'hidden';
    const syncHorizontal = () => {headerEl.scrollLeft = bodyEl.scrollLeft;};
    bodyEl.addEventListener('scroll', syncHorizontal);

    function _renderHeader() {
      headerScope?.destroy();
      _filterCleanup?.();
      headerScope=window._AppUIDataTableHeader.create({header:headerEl,body:bodyEl,columns,opts,
        sort:{column:_sortCol,asc:_sortAsc},filters:_filters,isCurrent:()=>!_destroyed,onFilter:_showFilterPopup,onMenu:view.showMenu,onMove:moveColumn,
        onSort(col){
          if(_sortCol===col.id)_sortAsc=!_sortAsc;else{_sortCol=col.id;_sortAsc=true;}
          _render();opts.onSort?.({column:_sortCol,direction:_sortAsc?'asc':'desc'});
        }
      });
    }

    function _showFilterPopup(col) {
      if (_destroyed) return;
      _filterCleanup?.();
      const rawValues=_items.map(item=>columnValue(item,col));
      const values=[...new Set(rawValues.map(String).filter(Boolean))].sort();
      const popup=window.AppUITableFilter.create({container,column:col,values,value:_filters[col.id],
        rawValues,
        onApply:value=>setFilter(col.id,value),
        onClose:()=>{if(_filterCleanup===popup.destroy)_filterCleanup=null;},
      });
      _filterCleanup=popup.destroy;
    }

    function _getDisplayItems() {
      return window._AppUIDataTableModel.display(_items,{
        columns:allColumns,filters:_filters,sortColumn:_sortCol,sortAscending:_sortAsc,
        manualSort:opts.manualSort,maxRows,query,
      });
    }

    function _render(bodyOnly) {
      if (_destroyed) return;
      clearRows();
      if (!bodyOnly) _renderHeader();
      const display = _getDisplayItems();
      view.update({query,count:display.length,filtered:Object.keys(_filters).length>0});
      if (_destroyed) return;
      if (opts.renderDetails || opts.virtualScroll === false || display.length <= 200) {
        _virtualCleanup?.();_virtualCleanup = null;
        bodyEl.style.position = '';bodyEl.style.overflowY = '';
      }
      if (!display.length) {
        const empty = document.createElement('div'); empty.className = 'appui-dt-empty';
        empty.textContent = opts.empty || 'No data'; bodyEl.replaceChildren(empty);
        return;
      }

      // Virtual scrolling for large datasets (>200 rows)
      if (!opts.renderDetails && opts.virtualScroll !== false && display.length > 200) {
        _renderVirtual(display);
        return;
      }

      const scrollTop = bodyEl.scrollTop, scrollLeft = bodyEl.scrollLeft;
      bodyEl.innerHTML = '';
      const context = renderContext();
      display.forEach(item => {
        if (_destroyed || !context.current()) return;
        const row = _createRow(item, context);
        if (_destroyed || !context.current()) return;
        bodyEl.appendChild(row);
      });
      bodyEl.scrollTop = scrollTop;bodyEl.scrollLeft = scrollLeft;syncHorizontal();
      paintHighlight();
    }

    let _virtualCleanup = null;
    function _renderVirtual(display) {
      _virtualCleanup?.();_virtualCleanup=null;
      bodyEl.style.position='relative';bodyEl.style.overflowY='auto';
      let context;
      const virtual=window.AppUIVirtualScroll.create({container:bodyEl,content:bodyEl,layout:'list',
        rowHeight:32,buffer:5,threshold:201,throttle:false,
        onBeforeRender:()=>{context=renderContext();},
        renderRow:item=>{const row=_createRow(item,context);row.style.height='32px';return row;},
        onRender:()=>{syncHorizontal();paintHighlight();},
      });
      _virtualCleanup=()=>virtual.destroy();
      try {virtual.setItems(display);}
      catch(error){try{virtual.destroy();}catch{} _virtualCleanup=null;throw error;}
      if(_destroyed){_virtualCleanup?.();_virtualCleanup=null;}
    }

    function setItems(items) {
      _items = [...items];
      if (opts.renderDetails) {const ids = new Set(_items.map(detailId)); for (const id of expandedDetails) if (!ids.has(id)) expandedDetails.delete(id);}
      _render(true);
    }
    function prepend(item) { _items.unshift(item); if (_items.length > maxRows * 2) _items.length = maxRows * 2; _render(true); }
    function setFilter(colId, value) { if (value) _filters[colId] = value; else delete _filters[colId]; _render(); }
    function clearFilters() { _filters = Object.create(null); _render(); }
    function getFilters() { return {..._filters}; }
    function exportTable(format, options = {}) {
      if (_destroyed) throw new Error('Table is destroyed');
      return AppUITableExport.create({...options, format, columns,
        items: options.scope === 'all' ? [..._items] : _getDisplayItems()});
    }
    function destroy() {
      if (_destroyed) return;
      _destroyed = true;
      expandedDetails.clear();
      const teardown=AppUILifecycle.createScope();
      teardown.add(()=>container.replaceChildren());
      teardown.add(()=>view.destroy());
      teardown.add(()=>bodyEl.removeEventListener('scroll', syncHorizontal));
      teardown.add(()=>{const cleanup=_virtualCleanup;_virtualCleanup=null;cleanup?.();});
      teardown.add(()=>_filterCleanup?.());
      teardown.add(()=>headerScope?.destroy());
      teardown.add(clearRows);
      teardown.add(()=>opts.signal?.removeEventListener('abort', abort));
      teardown.destroy();
    }

    const abort = () => destroy();
    if (opts.signal?.aborted) destroy();
    else {
      opts.signal?.addEventListener('abort', abort, {once: true});
      _render();
    }
    // the rows as displayed (filtered + sorted, capped by maxRows): lets a page do keyboard navigation / "next row"
    function getDisplayItems() { return _destroyed ? [] : [..._getDisplayItems()]; }
    return { setItems, prepend, setFilter, clearFilters, getFilters, getDisplayItems, setHighlighted, setSearch,getSearch:()=>query,getColumns,setColumnVisible,moveColumn,resetColumns,showColumns:view.showColumns, render: _render, destroy,
      exportCsv: options => exportTable('csv', options), exportXlsx: options => exportTable('xlsx', options) };
  }
  return { create };
})();
window.AppUIDataTable = AppUIDataTable;
