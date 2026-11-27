/* AppUI data view: selectable list or table with standard empty state. */
const AppUIDataView = (() => {
  function create(opts = {}) {
    const container = typeof opts.container === 'string' ? document.querySelector(opts.container) : opts.container;
    if (!container) throw new Error('AppUIDataView: container not found');
    let items = opts.items || [], selected = new Set(opts.selected || []), destroyed = false;
    const id = item => opts.getId ? opts.getId(item) : item.id;
    function render(nextItems = items) {
      if (destroyed) return;
      items = nextItems; container.replaceChildren();
      if (!items.length) { const empty = document.createElement('div'); empty.className = 'appui-data-empty'; empty.textContent = opts.empty || 'Nothing to show.'; container.appendChild(empty); return; }
      if (opts.mode === 'list') renderList(); else renderTable();
    }
    function select(item, event) { const key = id(item); if (!opts.multi || !event?.ctrlKey) selected.clear(); selected.has(key) ? selected.delete(key) : selected.add(key); opts.onSelectionChange?.([...selected]); render(); }
    function renderList() { const list = document.createElement('div'); list.className = 'appui-data-list'; items.forEach(item => { const row = document.createElement('button'); row.type = 'button'; row.className = 'appui-data-row'; row.classList.toggle('selected', selected.has(id(item))); row.textContent = opts.renderItem ? '' : (item.label || item.name || id(item)); if (opts.renderItem) opts.renderItem(item, row); row.addEventListener('click', event => select(item, event)); list.appendChild(row); }); container.appendChild(list); }
    function renderTable() { const table = document.createElement('table'); table.className = 'appui-data-table'; const columns = opts.columns || []; table.innerHTML = `<thead><tr>${columns.map(column => `<th>${column.label || column.id}</th>`).join('')}</tr></thead>`; const body = document.createElement('tbody'); items.forEach(item => { const row = document.createElement('tr'); row.classList.toggle('selected', selected.has(id(item))); columns.forEach(column => { const cell = document.createElement('td'); const value = column.render ? column.render(item) : item[column.id]; if (value instanceof Node) cell.appendChild(value); else cell.textContent = value ?? ''; row.appendChild(cell); }); row.addEventListener('click', event => select(item, event)); body.appendChild(row); }); table.appendChild(body); container.appendChild(table); }
    render(); return {
      render,
      selected: () => [...selected],
      clearSelection: () => { if (!destroyed) { selected.clear(); render(); } },
      destroy() { if (!destroyed) { destroyed = true; container.replaceChildren(); } },
    };
  }
  return {create};
})();
window.AppUIDataView = AppUIDataView;
