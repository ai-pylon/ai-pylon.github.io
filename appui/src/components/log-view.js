/* Owned, literal-text progress output for standalone AppUI controls. */
const AppUILogView = (() => {
  const bindings = new WeakMap();
  const levels = new Set(['info', 'muted', 'accent', 'heading', 'success', 'warning', 'error']);
  let lifetime;
  const inactive = () => ({
    element: null,
    current: () => false,
    append: () => null,
    clear() {},
    destroy() {}
  });

  function create(options = {}) {
    const container =
      typeof options.container === 'string'
        ? document.querySelector(options.container)
        : options.container;
    if (!container) throw new Error('LogView requires a container');
    if (options.signal?.aborted) return inactive();
    lifetime ||= AppUILifecycle.createViewScope();
    if (!lifetime.current()) return inactive();
    bindings.get(container)?.destroy();
    const element = document.createElement('div');
    element.className = 'appui-log-view';
    element.setAttribute('role', 'log');
    element.setAttribute('aria-label', String(options.label ?? 'Log'));
    element.setAttribute('aria-live', 'polite');
    element.setAttribute('aria-relevant', 'additions text');
    container.replaceChildren(element);
    let widget;
    const scope = AppUILifecycle.createViewScope({
      host: element,
      parent: lifetime,
      signal: options.signal,
      pagehide: false,
      isCurrent: () => bindings.get(container) === widget && element.parentNode === container
    });
    const maximum = Number(options.maxEntries);
    const limit = Number.isFinite(maximum) && maximum > 0 ? Math.max(1, Math.floor(maximum)) : 0;
    const autoScroll = options.autoScroll !== false;
    function append(text, settings = {}) {
      if (!scope.current()) return null;
      const level = levels.has(settings?.level) ? settings.level : 'info';
      const line = document.createElement('div');
      line.className = 'appui-log-line appui-log-line-' + level;
      line.textContent = String(text ?? '');
      element.appendChild(line);
      const height = container.scrollHeight,
        top = container.scrollTop;
      if (limit) while (element.children.length > limit) element.firstChild.remove();
      if (autoScroll) container.scrollTop = container.scrollHeight;
      else if (height > container.scrollHeight)
        container.scrollTop = Math.max(0, top - (height - container.scrollHeight));
      return line;
    }
    widget = {
      element,
      current: () => scope.current(),
      append,
      clear() {
        if (scope.current()) element.replaceChildren();
      },
      destroy: () => scope.destroy()
    };
    bindings.set(container, widget);
    scope.add(() => {
      if (bindings.get(container) === widget) bindings.delete(container);
      element.remove();
    });
    return widget;
  }
  return { create };
})();
window.AppUILogView = AppUILogView;
