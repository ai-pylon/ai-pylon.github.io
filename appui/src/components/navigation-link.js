/* Owned bindings for native anchors; presentation and destinations stay with callers. */
const AppUINavigationLink = (() => {
  const bindings = new WeakMap();
  const lifetime = AppUILifecycle.createViewScope();

  function inactive(element, href) {
    if (href !== null && element.getAttribute('href') === href) element.removeAttribute('href');
    return { element, current: () => false, destroy() {} };
  }

  function bind(element, { signal, isCurrent, stopPropagation = false } = {}) {
    if (!element || String(element.tagName).toLowerCase() !== 'a')
      throw new Error('AppUINavigationLink: a native anchor is required');
    const href = element.getAttribute('href');
    bindings.get(element)?.destroy();
    if (href === null || signal?.aborted || !lifetime.current()) return inactive(element, href);
    element.setAttribute('href', href);
    const scope = AppUILifecycle.createScope();
    let destroyed = false;
    const api = {
      element,
      current: () =>
        !destroyed &&
        !signal?.aborted &&
        lifetime.current() &&
        element.isConnected !== false &&
        element.getAttribute('href') === href &&
        (!isCurrent || !!isCurrent()),
      destroy() {
        if (destroyed) return;
        destroyed = true;
        scope.destroy();
      }
    };
    scope.add(() => {
      if (bindings.get(element) === api) bindings.delete(element);
      if (element.getAttribute('href') === href) element.removeAttribute('href');
    });
    bindings.set(element, api);
    const gesture = (event) => {
      if (stopPropagation) event.stopPropagation();
      if (!api.current()) event.preventDefault();
    };
    scope.listen(element, 'click', gesture);
    scope.listen(element, 'auxclick', gesture);
    scope.listen(element, 'contextmenu', (event) => {
      if (!api.current()) event.preventDefault();
    });
    scope.listen(lifetime.signal, 'abort', api.destroy, { once: true });
    if (signal) scope.listen(signal, 'abort', api.destroy, { once: true });
    if (signal?.aborted || !lifetime.current()) api.destroy();
    return api;
  }
  return { bind };
})();
window.AppUINavigationLink = AppUINavigationLink;
