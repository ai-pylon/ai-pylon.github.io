/** Accessible D3 or native graph-node activation with caller-owned domain actions. */
const AppUIGraphNode = (function () {
  'use strict';
  const owners = new WeakMap();
  let sequence = 0;
  function bind({
    selection,
    elements,
    getData = (element) => element,
    label,
    onActivate,
    onDoubleClick,
    onContextMenu,
    isCurrent = () => true,
    signal
  }) {
    if (!selection && !elements)
      throw new Error('GraphNode requires a selection or native elements');
    const nativeElements = selection ? null : Array.from(elements);
    function each(callback) {
      if (selection) selection.each(callback);
      else
        nativeElements.forEach((element, index) =>
          callback.call(element, undefined, index, nativeElements)
        );
    }
    function attribute(name, value) {
      if (selection) selection.attr(name, value);
      else
        each(function (data, index) {
          this.setAttribute(
            name,
            typeof value === 'function'
              ? value.call(this, getData(this, index), index, nativeElements)
              : value
          );
        });
    }
    const namespace = '.appuiGraphNode' + ++sequence,
      token = {};
    const scope = AppUILifecycle.createViewScope({ signal, isCurrent });
    const binding = { destroy: () => scope.destroy() };
    if (!scope.current()) {
      scope.destroy();
      return binding;
    }
    const current = (element) =>
      scope.current() && element.isConnected !== false && owners.get(element) === token;
    each(function () {
      owners.set(this, token);
    });
    scope.add(() => {
      if (selection) selection.on(namespace, null);
      each(function () {
        if (owners.get(this) === token) owners.delete(this);
      });
    });
    function listen(type, handler) {
      if (selection) selection.on(type + namespace, handler);
      else
        nativeElements.forEach((element, index) =>
          scope.listen(element, type, (event) => {
            if (current(element)) handler.call(element, event, getData(element, index));
          })
        );
    }
    attribute('role', 'button');
    attribute('tabindex', 0);
    if (label != null) attribute('aria-label', label);
    function activate(event, node) {
      if (!current(this) || event.defaultPrevented || event.isComposing) return;
      event.stopPropagation();
      onActivate?.call(this, event, node);
    }
    listen('click', activate);
    listen('keydown', function (event, node) {
      if (
        !current(this) ||
        event.defaultPrevented ||
        event.isComposing ||
        !['Enter', ' '].includes(event.key)
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      onActivate?.call(this, event, node);
    });
    if (onDoubleClick)
      listen('dblclick', function (event, node) {
        if (!current(this) || event.defaultPrevented) return;
        event.stopPropagation();
        onDoubleClick.call(this, event, node);
      });
    if (onContextMenu)
      listen('contextmenu', function (event, node) {
        if (!current(this) || event.defaultPrevented) return;
        event.preventDefault();
        event.stopPropagation();
        onContextMenu.call(this, event, node);
      });
    return binding;
  }
  return { bind };
})();
window.AppUIGraphNode = AppUIGraphNode;
