/* AppUI content header: breadcrumbs, title, state, and contextual actions. */
const AppUIHeader = (() => {
  function create(opts = {}) {
    const container = typeof opts.container === 'string' ? document.querySelector(opts.container) : opts.container;
    if (!container) throw new Error('AppUIHeader: container not found');
    container.replaceChildren();
    const header = document.createElement('header');
    header.className = 'appui-header';
    const main = document.createElement('div'); main.className = 'appui-header-main';
    const actions = document.createElement('div'); actions.className = 'appui-header-actions';
    const invoke = item => {
      if (item.command && typeof opts.onCommand === 'function') {
        opts.onCommand(item.command, item);
      } else {
        item.action?.(item);
      }
    };
    if (opts.breadcrumbs?.length) {
      const crumbs = document.createElement('nav'); crumbs.className = 'appui-breadcrumbs'; crumbs.setAttribute('aria-label', 'Breadcrumb');
      opts.breadcrumbs.forEach((crumb, index) => {
        const button = document.createElement(crumb.action || crumb.command ? 'button' : 'span');
        button.textContent = typeof crumb === 'string' ? crumb : crumb.label;
        if (button.tagName === 'BUTTON') {
          button.type = 'button';
          button.addEventListener('click', () => invoke(crumb));
        }
        crumbs.appendChild(button);
        if (index < opts.breadcrumbs.length - 1) crumbs.append(' / ');
      });
      main.appendChild(crumbs);
    }
    if (opts.title) { const title = document.createElement('h1'); title.textContent = opts.title; main.appendChild(title); }
    if (opts.state) { const state = document.createElement('span'); state.className = 'appui-header-state'; state.textContent = opts.state; main.appendChild(state); }
    (opts.actions || []).forEach(action => {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = action.label || action.id || 'Action';
      button.className = action.primary ? 'primary' : '';
      button.addEventListener('click', () => invoke(action));
      actions.appendChild(button);
    });
    header.append(main, actions); container.appendChild(header);
    let destroyed = false;
    return {
      element: header,
      setState: value => { const el = header.querySelector('.appui-header-state'); if (!destroyed && el) el.textContent = value; },
      destroy() { if (!destroyed) { destroyed = true; header.remove(); } },
    };
  }
  return {create};
})();
window.AppUIHeader = AppUIHeader;
