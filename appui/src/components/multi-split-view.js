/* Private pane and separator markup for MultiSplit. */
window._AppUIMultiSplitView = {
  root(direction, className) {
    const root = document.createElement('div');
    root.className = `appui-multi-split ${direction}${className ? ` ${className}` : ''}`;
    return root;
  },
  direction(root, handles, direction, className) {
    root.className = `appui-multi-split ${direction}${className ? ` ${className}` : ''}`;
    handles.forEach(handle => handle.setAttribute('aria-orientation', direction === 'horizontal' ? 'vertical' : 'horizontal'));
  },
  pane(definition, index) {
    const pane = document.createElement('section');
    pane.className = `appui-multi-split-pane${definition.className ? ` ${definition.className}` : ''}`;
    pane.setAttribute('aria-label', definition.label || `Pane ${index + 1}`);
    pane.dataset.paneIndex = String(index);
    return pane;
  },
  handle(index, direction, swappable, initial) {
    const handle = document.createElement('div');
    handle.className = 'appui-multi-split-handle';
    handle.setAttribute('role', 'separator');
    handle.setAttribute('tabindex', '0');
    handle.setAttribute('aria-orientation', direction === 'horizontal' ? 'vertical' : 'horizontal');
    handle.dataset.handleIndex = String(index);
    let swapButton = null;
    if (swappable) {
      swapButton = document.createElement('button');
      swapButton.className = 'appui-multi-split-swap';
      swapButton.setAttribute('aria-label', 'Swap panes');
      swapButton.textContent = !initial && direction === 'vertical' ? '\u21c5' : '\u21c4';
      handle.appendChild(swapButton);
    }
    return {element: handle, swapButton};
  },
};
