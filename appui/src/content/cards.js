/**
 * UI Cards  --  expandable card/accordion component.
 * 
 * Usage:
 *   <div class="ui-card" data-id="item1">
 *     <div class="ui-card-header">Title <span class="ui-card-toggle">▸</span></div>
 *     <div class="ui-card-body">Content here</div>
 *   </div>
 * 
 *   UICards.init({persist: true});  // remember expanded state in localStorage
 *   UICards.toggle('item1');
 *   UICards.expandAll();
 *   UICards.collapseAll();
 */
const UICards = (function() {
  let _persist = false;
  let _storageKey = 'ui-cards-state';
  let _bound = false;

  function _handleClick(e) {
    const header = e.target.closest('.ui-card-header');
    if (!header) return;
    const card = header.closest('.ui-card');
    if (card) _toggle(card);
  }

  function init(opts) {
    opts = opts || {};
    _persist = opts.persist || false;
    if (opts.storageKey) _storageKey = opts.storageKey;
    // Restore state
    if (_persist) _restoreState();
    // Click handler
    if (!_bound) { document.addEventListener('click', _handleClick); _bound = true; }
  }

  function _toggle(card) {
    card.classList.toggle('expanded');
    const toggle = card.querySelector('.ui-card-toggle');
    if (toggle) toggle.textContent = card.classList.contains('expanded') ? '▾' : '▸';
    if (_persist) _saveState();
  }

  function toggle(id) {
    const card = document.querySelector(`.ui-card[data-id="${id}"]`);
    if (card) _toggle(card);
  }

  function expandAll(container) {
    (container || document).querySelectorAll('.ui-card').forEach(c => {
      c.classList.add('expanded');
      const t = c.querySelector('.ui-card-toggle');
      if (t) t.textContent = '▾';
    });
    if (_persist) _saveState();
  }

  function collapseAll(container) {
    (container || document).querySelectorAll('.ui-card').forEach(c => {
      c.classList.remove('expanded');
      const t = c.querySelector('.ui-card-toggle');
      if (t) t.textContent = '▸';
    });
    if (_persist) _saveState();
  }

  function _saveState() {
    const expanded = [...document.querySelectorAll('.ui-card.expanded')].map(c => c.dataset.id).filter(Boolean);
    AppUIStorage.setJSON(_storageKey, expanded);
  }

  function _restoreState() {
    try {
      const expanded = AppUIStorage.getJSON(_storageKey, []);
      expanded.forEach(id => {
        const card = document.querySelector(`.ui-card[data-id="${id}"]`);
        if (card) { card.classList.add('expanded'); const t = card.querySelector('.ui-card-toggle'); if (t) t.textContent = '▾'; }
      });
    } catch(e) {}
  }

  function destroy() {
    if (_bound) document.removeEventListener('click', _handleClick);
    _bound = false;
  }

  return { init, toggle, expandAll, collapseAll, destroy };
})();
