/* AppUI toolbar: a standard content.top title, controls, and actions region. */
const AppUIToolbar = (function() {
  const {append} = window._AppUIToolbarItems;
  const bindings = new WeakMap();
  function create(opts) {
    opts = opts || {};
    const container = typeof opts.container === 'string'
      ? document.querySelector(opts.container)
      : opts.container;
    if (!container) throw new Error('AppUIToolbar: container not found');
    if (opts.signal?.aborted) return {element: null, main: null, right: null, append: () => null, destroy() {}};
    bindings.get(container)?.destroy();
    const scope = AppUILifecycle.createScope();

    container.replaceChildren();
    const toolbar = document.createElement('div');
    toolbar.className = 'appui-toolbar' + (opts.variant === 'inline' ? ' appui-toolbar-inline' : '');
    if (opts.orientation === 'vertical') {
      toolbar.classList.add('appui-toolbar-vertical');
      toolbar.setAttribute('aria-orientation', 'vertical');
    }
    toolbar.setAttribute('role', 'toolbar');
    if (opts.label) toolbar.setAttribute('aria-label', opts.label);

    const main = document.createElement('div');
    main.className = 'appui-toolbar-main';
    const right = document.createElement('div');
    right.className = 'appui-toolbar-right';
    toolbar.append(main, right);
    container.appendChild(toolbar);

    if (opts.title || opts.subtitle) {
      const heading = document.createElement('div');
      heading.className = 'appui-toolbar-heading';
      if (opts.title) {
        const title = document.createElement('strong');
        title.className = 'appui-toolbar-title';
        title.textContent = opts.title;
        heading.appendChild(title);
      }
      if (opts.subtitle) {
        const subtitle = document.createElement('span');
        subtitle.className = 'appui-toolbar-subtitle';
        subtitle.textContent = opts.subtitle;
        heading.appendChild(subtitle);
      }
      main.appendChild(heading);
    }

    const controls = document.createElement('div');
    controls.className = 'appui-toolbar-controls';
    main.appendChild(controls);
    const onCmd = opts.onCommand;
    (opts.items || []).forEach(item => append(controls, item, onCmd, scope));
    (opts.right || []).forEach(item => append(right, item, onCmd, scope));

    let destroyed = false;
    const api = {
      element: toolbar,
      main,
      right,
      append: item => destroyed ? null : append(controls, item, onCmd, scope),
      destroy() {
        if (destroyed) return;
        destroyed = true;
        try { scope.destroy(); }
        finally {
          toolbar.remove();
          if (bindings.get(container) === api) bindings.delete(container);
        }
      },
    };
    bindings.set(container, api);
    if (opts.signal) {
      scope.listen(opts.signal, 'abort', () => api.destroy(), {once: true});
      if (opts.signal.aborted) api.destroy();
    }
    return api;
  }


  return { create };
})();
window.AppUIToolbar = AppUIToolbar;
