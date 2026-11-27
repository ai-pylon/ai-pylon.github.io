/* DataTable values, client filtering and sorting, independent of DOM rendering. */
window._AppUIDataTableModel = (() => {
  function columnValue(item, column) {
    return (column?.getValue ? column.getValue(item) : item[column?.id]) ?? '';
  }
  function numeric(value){
    if(value==null||typeof value==='boolean'||String(value).trim()==='')return null;
    const number=typeof value==='number'?value:Number(String(value).replace(/,/g,''));
    return Number.isFinite(number)?number:null;
  }

  function display(items,{columns,filters,sortColumn,sortAscending,manualSort,maxRows,query=''}) {
    let display = [...items];
    const needle=String(query).trim().toLocaleLowerCase();
    if(needle)display=display.filter(item=>columns.some(col=>col.searchable!==false&&!col.actions&&!col.checkbox&&String(columnValue(item,col)).toLocaleLowerCase().includes(needle)));
    // Apply filters
    for (const [colId, val] of Object.entries(filters)) {
      if(val&&typeof val==='object'&&val.type==='range'){
        const col=columns.find(c=>c.id===colId),min=numeric(val.min),max=numeric(val.max);
        display=display.filter(item=>{const n=numeric(columnValue(item,col));return n!==null&&(min===null||n>=min)&&(max===null||n<=max);});
        continue;
      }
      const lower = String(val?.type==='contains'?val.value:val).toLowerCase();
      display = display.filter(item => {
        const col = columns.find(c => c.id === colId);
        const cellVal = String(columnValue(item, col));
        return cellVal.toLowerCase().includes(lower);
      });
    }
    // Apply sort
    if (sortColumn && !manualSort) {
      const col = columns.find(c => c.id === sortColumn);
      display.sort((a, b) => {
        const av = columnValue(a, col), bv = columnValue(b, col);
        const cmp = typeof av === 'number' && typeof bv === 'number'
          ? av - bv : String(av).localeCompare(String(bv), undefined, {numeric: true});
        return sortAscending ? cmp : -cmp;
      });
    }
    return display.slice(0, maxRows);
  }

  return {columnValue,display,numeric};
})();
