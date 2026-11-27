/**
 * UI Table  --  sortable, filterable data table.
 * 
 * Usage:
 *   AppUITable.render('#container', {
 *     columns: [{key:'name', label:'Name'}, {key:'score', label:'Score', type:'number'}],
 *     data: [{name:'foo', score:85}, {name:'bar', score:92}],
 *     sortable: true,
 *     filterable: true,
 *     onRowClick: (row) => console.log(row),
 *   });
 */
const AppUITable = (function() {

  function render(selector, opts) {
    const container = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (!container) return;
    const columns = opts.columns || [];
    const data = opts.data || [];
    let sortKey = opts.defaultSort || (columns[0] && columns[0].key);
    let sortDir = opts.defaultDir || 'asc';
    let filterText = '';

    function _render() {
      let filtered = data;
      if (filterText) {
        const q = filterText.toLowerCase();
        filtered = data.filter(row => columns.some(c => String(row[c.key] || '').toLowerCase().includes(q)));
      }
      // Sort
      filtered.sort((a, b) => {
        const va = a[sortKey], vb = b[sortKey];
        const col = columns.find(c => c.key === sortKey);
        if (col && col.type === 'number') return sortDir === 'asc' ? (va - vb) : (vb - va);
        return sortDir === 'asc' ? String(va || '').localeCompare(String(vb || '')) : String(vb || '').localeCompare(String(va || ''));
      });

      let html = '';
      if (opts.filterable) {
        html += `<input class="ui-table-filter" type="text" placeholder="Filter..." value="${filterText}" style="margin-bottom:8px;padding:5px 8px;width:100%;background:#2a2a2a;border:1px solid #444;color:#eee;border-radius:4px;font-size:12px">`;
      }
      html += '<table class="ui-table"><thead><tr>';
      for (const col of columns) {
        const arrow = sortKey === col.key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';
        html += `<th data-key="${col.key}" class="ui-table-sortable">${col.label || col.key}${arrow}</th>`;
      }
      html += '</tr></thead><tbody>';
      for (const row of filtered) {
        html += '<tr class="ui-table-row">';
        for (const col of columns) {
          const val = row[col.key] != null ? row[col.key] : '';
          const style = col.style ? ` style="${typeof col.style === 'function' ? col.style(val, row) : col.style}"` : '';
          html += `<td${style}>${col.render ? col.render(val, row) : val}</td>`;
        }
        html += '</tr>';
      }
      html += '</tbody></table>';
      container.innerHTML = html;

      // Bind sort
      container.querySelectorAll('.ui-table-sortable').forEach(th => {
        th.onclick = () => {
          if (sortKey === th.dataset.key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
          else { sortKey = th.dataset.key; sortDir = 'asc'; }
          _render();
        };
      });
      // Bind filter
      const filterInput = container.querySelector('.ui-table-filter');
      if (filterInput) {
        filterInput.oninput = (e) => { filterText = e.target.value; _render(); };
      }
      // Bind row click
      if (opts.onRowClick) {
        container.querySelectorAll('.ui-table-row').forEach((tr, i) => {
          tr.style.cursor = 'pointer';
          tr.onclick = () => opts.onRowClick(filtered[i]);
        });
      }
    }

    _render();
  }

  return { render };
})();
