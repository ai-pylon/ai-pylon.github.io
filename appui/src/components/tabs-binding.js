/* Shared keyboard, selection and drag binding for tab buttons. */
window._AppUITabsBinding = (() => {
  function nextIndex(key, index, count) {
    if (!count) return -1;
    if (key === 'Home') return 0;
    if (key === 'End') return count - 1;
    if (key === 'ArrowLeft') return (index - 1 + count) % count;
    if (key === 'ArrowRight') return (index + 1) % count;
    return index;
  }
  function bindDrag({
    element,
    listen,
    isCurrent = () => true,
    draggingClass,
    overClass,
    onStart,
    onEnd,
    onDrop
  }) {
    const on = (type, handler) =>
      listen(element, type, (event) => {
        if (isCurrent()) handler(event);
      });
    on('dragstart', (event) => {
      onStart(event);
      element.classList.add(draggingClass);
    });
    on('dragend', () => {
      element.classList.remove(draggingClass);
      onEnd?.();
    });
    on('dragover', (event) => {
      event.preventDefault();
      if (overClass) element.classList.add(overClass);
    });
    if (overClass) on('dragleave', () => element.classList.remove(overClass));
    on('drop', (event) => {
      event.preventDefault();
      if (overClass) element.classList.remove(overClass);
      onDrop(event);
    });
  }
  function dragReorder({ listen, reorder }) {
    let dragged = null;
    return {
      reset() {
        dragged = null;
      },
      bind(element, tab) {
        element.draggable = true;
        bindDrag({
          element,
          listen,
          draggingClass: 'dragging',
          overClass: 'drag-over',
          onStart: (event) => {
            dragged = tab;
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', tab.id);
          },
          onEnd: () => {
            dragged = null;
          },
          onDrop: () => {
            if (dragged && dragged.id !== tab.id) reorder(dragged.id, tab.id);
          }
        });
      }
    };
  }
  function bind({
    container,
    panels = [],
    onSwitch,
    selector = '[data-tab]',
    getId = (button) => button.dataset.tab
  } = {}) {
    if (!container) throw new Error('AppUITabs: container is required');
    const buttons = Array.from(container.querySelectorAll(selector));
    const panelList = Array.from(panels);
    let activeId = null;
    const owner = AppUILifecycle.createScope();
    container.setAttribute('role', 'tablist');
    const available = (button) =>
      !button.hidden && !button.disabled && button.getAttribute?.('aria-disabled') !== 'true';
    function switchTo(id, notify = true) {
      if (owner.destroyed) return;
      const button = buttons.find((item) => getId(item) === id);
      if (!button || !available(button)) return;
      activeId = id;
      buttons.forEach((item) => {
        const selected = item === button;
        item.classList.toggle('active', selected);
        item.setAttribute('role', 'tab');
        item.setAttribute('aria-selected', String(selected));
        item.tabIndex = selected ? 0 : -1;
      });
      panelList.forEach((panel) => {
        const selected = getId(panel) === id;
        panel.classList.toggle('active', selected);
        panel.setAttribute('role', 'tabpanel');
        panel.hidden = !selected;
      });
      if (notify)
        onSwitch?.({ id, button, panel: panelList.find((panel) => getId(panel) === id) || null });
    }
    buttons.forEach((button) => {
      const editable = (event) =>
        event?.target?.isContentEditable ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(event?.target?.tagName);
      const click = (event) => {
        if (!editable(event)) switchTo(getId(button));
      };
      const keydown = (event) => {
        if (owner.destroyed || event.isComposing || event.defaultPrevented || editable(event))
          return;
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const visible = buttons.filter(available);
        if (!visible.length || !available(button)) return;
        const index = visible.indexOf(button);
        const next = nextIndex(event.key, index, visible.length);
        visible[next].focus();
        switchTo(getId(visible[next]));
      };
      owner.listen(button, 'click', click);
      owner.listen(button, 'keydown', keydown);
    });
    const initial =
      buttons.find((button) => available(button) && button.classList.contains('active')) ||
      buttons.find(available);
    if (initial) switchTo(getId(initial), false);
    return { switch: switchTo, active: () => activeId, destroy: () => owner.destroy() };
  }

  return { bind, nextIndex, dragReorder, bindDrag };
})();
// Existing markup can use tab navigation without loading generated tab widgets.
window.AppUITabNavigation = { bind: window._AppUITabsBinding.bind };
