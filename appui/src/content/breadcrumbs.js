/* Reusable breadcrumb trails. Each instance owns its controls and listeners. */
const AppUIBreadcrumbs = (() => {
  function create(options = {}) {
    const container = typeof options.container === 'string' ? document.querySelector(options.container) : options.container;
    if (!container) throw new Error('Breadcrumbs container is required');
    const scope = AppUILifecycle.createScope();
    const root = document.createElement('nav');
    root.className = 'ui-breadcrumbs'; root.setAttribute('aria-label', options.label || 'Breadcrumb');
    root.style.cssText = 'min-width:0;max-width:100%;overflow:auto';
    container.appendChild(root);
    let items = [], controls;
    scope.add(() => {controls?.destroy(); root.remove();});
    function setItems(next) {
      if (scope.destroyed) return;
      controls?.destroy(); controls = AppUILifecycle.createScope();
      items = (next || []).map(item => typeof item === 'object' && item !== null ? {...item} : {label: String(item ?? '')});
      const list = document.createElement('ol');
      list.style.cssText = 'display:flex;align-items:center;list-style:none;margin:0;padding:0;white-space:nowrap;gap:3px';
      items.forEach((item, index) => {
        const current = item.current ?? index === items.length - 1;
        const entry = document.createElement('li');
        entry.style.cssText = 'display:flex;align-items:center';
        const select = item.onSelect || options.onSelect;
        const link = item.href && !current;
        const control = document.createElement(link ? 'a' : select ? 'button' : 'span');
        control.className = current ? 'ui-crumb-current' : 'ui-crumb-link';
        control.textContent = String(item.label ?? '');
        if (item.title != null) control.title = String(item.title);
        if (link) control.href = item.href;
        else if (select) control.type = 'button';
        if (current) control.setAttribute('aria-current', 'page');
        control.style.cssText = 'font:inherit;color:inherit;border:0;background:transparent;padding:2px 4px;text-decoration:none';
        if (select) controls.listen(control, 'click', event => {event.preventDefault(); select(item, index, event);});
        entry.appendChild(control);
        if (item.dropdown && options.onDropdown) {
          const button = document.createElement('button'); button.type = 'button';
          button.className = 'ui-crumb-dropdown'; button.textContent = '\u25be';
          button.setAttribute('aria-label', 'Show siblings of ' + String(item.label ?? ''));
          button.setAttribute('aria-haspopup', 'menu');
          button.style.cssText = 'font:inherit;font-size:10px;border:0;background:transparent;color:inherit;padding:2px;cursor:pointer';
          const open = event => {event.preventDefault(); options.onDropdown(item, index, event);};
          controls.listen(button, 'click', open); controls.listen(entry, 'contextmenu', open);
          entry.appendChild(button);
        }
        if (index) {
          const separator = document.createElement('li'); separator.className = 'ui-crumb-sep';
          separator.textContent = options.separator ?? '\u203a'; separator.setAttribute('aria-hidden', 'true');
          list.appendChild(separator);
        }
        list.appendChild(entry);
      });
      root.replaceChildren(list);
    }
    setItems(options.items);
    return {element: root, setItems, destroy: () => scope.destroy()};
  }
  let legacy, legacyItems = [];
  function render(container, items) {
    legacy?.destroy();
    const target = typeof container === 'string' ? document.querySelector(container) : container;
    if (!target) {legacy = null; return null;}
    legacyItems = (items || []).slice();
    legacy = create({container: target, items: legacyItems, separator: '/'}); return legacy;
  }
  function push(item) {legacyItems.push(item); legacy?.setItems(legacyItems);}
  function pop() {legacyItems.pop(); legacy?.setItems(legacyItems);}
  function set(items) {legacyItems = (items || []).slice(); legacy?.setItems(legacyItems);}
  return {create, render, push, pop, set};
})();
window.AppUIBreadcrumbs = AppUIBreadcrumbs;
