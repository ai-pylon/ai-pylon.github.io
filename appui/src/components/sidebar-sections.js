/* Vertically stacked sections for a docked AppUI sidebar.
 *
 * Alternative to SidebarTabs: displays all sections simultaneously with
 * collapsible titled headers. Useful when sections are compact and benefit
 * from being visible at once (navigation + file tree, etc.).
 *
 * Built-in hash routing: buttons with [data-nav] inside sections automatically
 * update the URL hash when clicked, and restore state on page load.
 *
 * Usage:
 *   AppUISidebarSections.create({
 *     container: el,
 *     storageKey: 'my-page-left',
 *     hashRouting: true,           // enable URL hash sync (default: true)
 *     onNavigate(route, params) {} // called when a nav button is clicked or hash changes
 *     sections: [
 *       { id: 'nav', label: 'Navigation', render(panel) {
 *           panel.innerHTML = '<button data-nav="live">Live</button><button data-nav="history">History</button>';
 *       }},
 *       { id: 'files', label: 'Files', collapsible: true, tools: host => [button], render(panel) { ... } },
 *     ]
 *   });
 *
 * Hash format: #<route>  or  #<route>?key=value&key2=value2
 * The component reads the hash on init and marks matching [data-nav] as active.
 */
const AppUISidebarSections = (() => {
  function create({container, storageKey = '', sections = [], hashRouting = true, onNavigate} = {}) {
    if (!container) throw new Error('AppUISidebarSections: container required');
    const definitions = [...sections];
    const scope = AppUILifecycle.createScope(), toggles = new Map();
    let destroyed = false;
    const panels = new Map(), rendered = new Set();
    let collapsed = _load();
    let _currentRoute = '';
    let _hashListener = null;

    function _load() {
      return Object.assign(Object.create(null), storageKey ? (AppUIStorage.getJSON(`${storageKey}:collapsed`, {}) || {}) : {});
    }
    function _save() {
      if (storageKey) AppUIStorage.setJSON(`${storageKey}:collapsed`, collapsed);
    }

    function _parseHash() {
      const hash = location.hash.slice(1);
      const [route, query] = hash.split('?');
      const params = query ? Object.fromEntries(new URLSearchParams(query)) : {};
      return { route: route || '', params };
    }

    function _setHash(route, params) {
      if (!hashRouting) return;
      let hash = route || '';
      if (params && Object.keys(params).length) hash += '?' + new URLSearchParams(params).toString();
      if (hash) history.replaceState(null, '', '#' + hash);
      else history.replaceState(null, '', location.pathname);
    }

    function _activateNav(route) {
      _currentRoute = route;
      container.querySelectorAll('[data-nav]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.nav === route);
      });
    }

    function _renderSection(def, panel) {
      if (destroyed || rendered.has(def.id)) return;
      rendered.add(def.id);
      scope.add(def.render?.(panel));
    }

    function _bindNavButtons() {
      // Delegate so lazily rendered section content shares the same navigation.
      scope.listen(container, 'click', event => {
        if (destroyed) return;
        const btn = event.target.closest?.('[data-nav]');
        if (!btn || !container.contains(btn) || btn.disabled || btn.getAttribute('aria-disabled') === 'true') return;
        const route = btn.dataset.nav;
        const params = btn.dataset.navParams ? JSON.parse(btn.dataset.navParams) : {};
        _activateNav(route);
        _setHash(route, params);
        if (onNavigate) onNavigate(route, params);
      });
    }

    function render() {
      container.replaceChildren();
      container.classList.add('sidebar-sections');
      definitions.forEach(def => {
        const collapsible = def.collapsible !== false;
        const isCollapsed = collapsible && collapsed[def.id];
        const {section, header, panel} = window._AppUISidebarSectionView.section(def, isCollapsed);
        panels.set(def.id, panel);

        // Render content
        if (!isCollapsed) _renderSection(def, panel);

        // Toggle collapse
        if (collapsible) {
          header.style.cursor = 'pointer';
          const toggle = AppUIDisclosure.bind({trigger: header, panel, expanded: !isCollapsed, onToggle: open => {
            collapsed[def.id] = !open;
            header.querySelector('.sidebar-section-twisty').textContent = open ? '\u25be' : '\u25b8';
            _save();
            if (open) _renderSection(def, panel);
          }});
          toggles.set(def.id, toggle); scope.add(() => toggle.destroy());
        }

        container.appendChild(section);
      });

      // Bind nav buttons after all sections are rendered
      _bindNavButtons();

      // Apply initial route from hash
      if (hashRouting) {
        const { route, params } = _parseHash();
        if (route) {
          _activateNav(route);
          if (onNavigate) onNavigate(route, params);
        } else {
          // Activate first nav button as default
          const first = container.querySelector('[data-nav]');
          if (first) {
            _activateNav(first.dataset.nav);
            if (onNavigate) onNavigate(first.dataset.nav, {});
          }
        }
        // Listen for hash changes
        _hashListener = () => {
          const { route: r, params: p } = _parseHash();
          if (r !== _currentRoute) {
            _activateNav(r);
            if (onNavigate) onNavigate(r, p);
          }
        };
        scope.listen(window, 'hashchange', _hashListener);
      }
    }

    function getPanel(id) { return panels.get(id) || null; }
    function getRoute() { return _currentRoute; }
    function navigate(route, params) { if (destroyed) return; _activateNav(route); _setHash(route, params); if (onNavigate) onNavigate(route, params); }
    function collapse(id) { if (destroyed) return; if (toggles.has(id)) {toggles.get(id).collapse(); return;} const p = panels.get(id); if (p && !p.hidden) { p.hidden = true; collapsed[id] = true; _save(); const h = p.previousElementSibling; if (h) { const t = h.querySelector('.sidebar-section-twisty'); if (t) t.textContent = '▸'; } } }
    function expand(id) { if (destroyed) return; if (toggles.has(id)) {toggles.get(id).expand(); return;} const p = panels.get(id); if (p && p.hidden) { p.hidden = false; collapsed[id] = false; _save(); const h = p.previousElementSibling; if (h) { const t = h.querySelector('.sidebar-section-twisty'); if (t) t.textContent = '▾'; } const def = definitions.find(d => d.id === id); if (def) _renderSection(def, p); } }
    function destroy() {
      if (destroyed) return; destroyed = true;
      try { scope.destroy(); }
      finally {
        toggles.clear();_hashListener=null;panels.clear();rendered.clear();
        container.replaceChildren();
      }
    }

    render();
    return { getPanel, getRoute, navigate, collapse, expand, destroy };
  }
  return { create };
})();
window.AppUISidebarSections = AppUISidebarSections;
