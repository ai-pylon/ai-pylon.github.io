/* AppUI content regions: optional top, body, and bottom areas for the AppUI shell. */
var AppContent = window.AppContent || (function() {
  const {render, isColumnsSpec} = window._AppUIContentRenderer;
  function create(opts) {
    const container = typeof opts.container === 'string'
      ? document.querySelector(opts.container)
      : opts.container;
    if (!container) throw new Error('AppContent: container not found');

    const regions = opts.regions || {};
    const created = Object.create(null), mounted = Object.create(null);
    const owners = AppUILifecycle.createKeyedScopes({pagehide: false});
    const replaceRegion = (name, mount) => {
      const area = Object.hasOwn(regions, name) ? regions[name] : created[name];
      if (!area || owners.destroyed) return;
      mounted[name] = null;
      const owner = owners.begin(name);
      if (!owner.current()) return;
      area.hidden = false;
      area.replaceChildren();
      const instance = mount(area);
      owner.add(instance);
      if (owner.current()) mounted[name] = instance || null;
    };
    const renderRegion = (name, spec) => replaceRegion(name, area => {
      if (name === 'body') area.style.overflow = isColumnsSpec(spec) ? 'hidden' : 'auto';
      return render(spec, area, opts.onCommand);
    });
    const renderState = (name, kind, message) => replaceRegion(name, area => state(area, kind, message));
    if (regions.top || regions.body || regions.bottom) {
      for (const name of ['top', 'body', 'bottom']) {
        const area = regions[name];
        if (!area) throw new Error(`AppContent: template region not found: ${name}`);
        area.classList.add(`appui-content-${name}`);
        area.style.minHeight = '0';
        if (name === 'body') {
          area.style.flex = '1';
          area.style.overflow = 'auto';
        }
        renderRegion(name, opts[name]);
      }
      return controller(regions, owners, mounted, renderRegion, renderState);
    }

    container.replaceChildren();
    for (const name of ['top', 'body', 'bottom']) {
      const area = document.createElement('section');
      area.className = `appui-content-${name}`;
      if (name === 'body') area.style.flex = '1';
      area.style.minHeight = '0';
      if (name === 'body') area.style.overflow = 'auto';
      container.appendChild(area);
      created[name] = area;
      renderRegion(name, opts[name]);
    }
    return controller(created, owners, mounted, renderRegion, renderState);
  }

  function controller(regions, owners, mounted, renderRegion, renderState) {
    return {
      get(name) {
        if (Object.hasOwn(regions, name)) return regions[name];
        const [region, slot] = String(name || '').split('.');
        const split = mounted[region];
        if (!split || !slot) return null;
        return split[slot === 'left' ? 'primary' : slot === 'right' ? 'secondary' : slot] || null;
      },
      render: renderRegion,
      loading: (name, message) => renderState(name, 'loading', message || 'Loading…'),
      empty: (name, message) => renderState(name, 'empty', message || 'Nothing to show.'),
      error: (name, message) => renderState(name, 'error', message || 'Something went wrong.'),
      destroy: () => {
        try { owners.destroy(); }
        finally { Object.keys(mounted).forEach(name => { mounted[name] = null; }); }
      },
    };
  }

  function state(area, kind, message) {
    if (!area) return;
    area.hidden = false;
    area.replaceChildren();
    const el = document.createElement('div');
    el.className = `appui-content-state appui-content-${kind}`;
    el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    el.textContent = message;
    area.appendChild(el);
  }



  return { create };
})();
