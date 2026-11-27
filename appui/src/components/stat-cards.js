/* Read-only label/value summaries using the shared collection lifetime. */
const AppUIStatCards = (function() {
  function create(options = {}) {
    const grid = AppUIGridView.create({container: options.container, signal: options.signal,
      columns: options.columns, gap: options.gap, padding: options.padding,
      viewMode: 'grid', persistKey: false, selectable: false, itemSize: options.itemSize ?? 130,
      renderItem(stat) {
        const card = document.createElement('dl'); card.className = 'appui-stat-card' + (options.compact ? ' appui-stat-card-compact' : '');
        const label = document.createElement('dt'); label.className = 'appui-stat-label'; label.textContent = String(stat.label ?? '');
        const value = document.createElement('dd'); value.className = 'appui-stat-value'; value.textContent = String(stat.value ?? '--');
        if (stat.color) value.style.color = stat.color;
        card.appendChild(label); card.appendChild(value);
        if (stat.description != null) {
          const description = document.createElement('dd'); description.className = 'appui-stat-description';
          description.textContent = String(stat.description); card.appendChild(description);
        }
        return card;
      },
    });
    function setItems(items) {grid.setItems((items || []).map(stat => ({...stat})));}
    if (options.items) setItems(options.items);
    return {setItems, destroy: () => grid.destroy()};
  }
  return {create};
})();
window.AppUIStatCards = AppUIStatCards;
