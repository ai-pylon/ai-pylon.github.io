/* Shared left/right template-mounted sidebar region with resize ownership. */
const AppUISidebarRegion = (function() {
  function create({element, main, position, layout, persist}) {
    let handle = null;
    let resizeCleanup = null;
    const widthKey = position === 'left' ? 'leftWidth' : 'rightWidth';
    const collapsedKey = position === 'left' ? 'leftCollapsed' : 'rightCollapsed';
    const min = position === 'left' ? 150 : 200;
    const max = position === 'left' ? 500 : 600;

    function removeHandle() { resizeCleanup?.(); resizeCleanup = null; handle?.remove(); handle = null; }
    function mount(config, render) {
      element.replaceChildren();
      removeHandle();
      if (!config) {
        element.hidden = true; element.classList.remove('ai-app-hidden');
        return;
      }
      element.hidden = false;
      element.style.width = (layout[widthKey] || config.width || (position === 'left' ? 250 : 350)) + 'px';
      element.classList.toggle('ai-app-hidden', !!layout[collapsedKey]);
      handle = document.createElement('div');
      handle.className = position === 'left' ? 'ai-app-resize-left' : 'ai-app-resize-right';
      handle.dataset.appuiOwned = 'true';
      main.insertBefore(handle, position === 'left' ? element.nextSibling : element);
      bindResize();
      render?.(element);
    }
    function bindResize() {
      resizeCleanup = AppUIShellLayout.makeDraggable(
        handle, element, 'width', min, max, position === 'right', widthKey, layout, persist,
      );
    }
    return {
      mount,
      toggle() { element.classList.toggle('ai-app-hidden'); layout[collapsedKey] = element.classList.contains('ai-app-hidden'); persist?.(); },
      destroy() { removeHandle(); element.replaceChildren(); element.hidden = false; element.classList.remove('ai-app-hidden'); element.style.removeProperty('width'); },
    };
  }
  return {create};
})();
window.AppUISidebarRegion = AppUISidebarRegion;
