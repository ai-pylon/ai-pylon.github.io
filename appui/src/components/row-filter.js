/* Filter existing table/list rows without rebuilding their markup or handlers. */
var AppUIRowFilter = window.AppUIRowFilter || (() => {
  function bind({input, container, selector = '[data-filter-row]',
    text = row => row.textContent} = {}) {
    if (!input || !container) throw new Error('RowFilter requires an input and container');
    const displays = new Map();
    let destroyed = false;
    function apply() {
      if (destroyed) return;
      const query = input.value.trim().toLowerCase();
      // Query again so asynchronously appended rows participate on the next input.
      container.querySelectorAll(selector).forEach(row => {
        if (!displays.has(row)) displays.set(row, row.style.display);
        const matches = !query || String(text(row) ?? '').toLowerCase().includes(query);
        row.style.display = matches ? displays.get(row) : 'none';
      });
    }
    input.addEventListener('input', apply);
    apply();
    return {apply, destroy() {
      if (destroyed) return;
      destroyed = true;
      input.removeEventListener('input', apply);
      displays.forEach((display, row) => { row.style.display = display; });
      displays.clear();
    }};
  }
  return {bind};
})();
window.AppUIRowFilter = AppUIRowFilter;
