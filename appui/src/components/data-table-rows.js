/* Private cell and row rendering for DataTable. */
window._AppUIDataTableRows = {
  create({ opts, columns, detailRow, isCurrent }) {
    return function createRow(item, context) {
      const row = document.createElement('div');
      row.className = 'appui-dt-row';
      row.dataset.rowId=String(opts.getId?.(item) ?? item.id ?? '');
      if(opts.onRowHover){
        context.listen(row,'mouseenter',event=>opts.onRowHover(item,event));
        context.listen(row,'mouseleave',event=>opts.onRowHover(null,event));
      }
      columns.forEach((col) => {
        if (!isCurrent() || !context.current()) return;
        const cell = document.createElement('div');
        cell.className = 'appui-dt-cell';
        cell.style.boxSizing='border-box';
        if (col.width) {
          cell.style.width = col.width;
          cell.style.flex = '0 0 ' + col.width;
        } else cell.style.flex = '1';
        cell.style.minWidth = col.minWidth || '60px';
        if (col.render) {
          const val = col.render(item, context);
          if (val instanceof Node) cell.appendChild(val);
          else cell.textContent = val ?? '';
        } else if (col.checkbox) {
          window._AppUIDataTableControls.checkbox(cell, col.checkbox, item, context, isCurrent);
        } else if (col.actions) {
          window._AppUIDataTableControls.actions(cell, col.actions, item, context, isCurrent);
        } else if (opts.renderDetails) {
          const value = document.createElement('span');
          value.textContent = item[col.id] ?? '';
          cell.appendChild(value);
        } else {
          cell.textContent = item[col.id] ?? '';
        }
        if (col.className) {
          const classes = String(col.className).split(/\s+/).filter(Boolean);
          if (classes.length) cell.classList.add(...classes);
        }
        row.appendChild(cell);
      });
      if (opts.onRowClick)
        context.listen(row, 'click', (event) => opts.onRowClick(item, event, row));
      if (opts.renderDetails && (!opts.canExpand || opts.canExpand(item)))
        return detailRow(item, row, context);
      return row;
    };
  }
};
