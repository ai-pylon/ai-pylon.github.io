/* Private markup and owned row bindings for generated tab bars. */
window._AppUITabView = {
  bindRow({element:el,closeButton,tab,listen,onClose,onSwitch,onContextMenu,drag}) {
    if(closeButton)listen(closeButton,'click',event=>{event.stopPropagation();onClose(tab.id);});
    listen(el, 'click', () => onSwitch(tab.id));
    // Middle-click (wheel) closes the tab. A middle-button mousedown on
    // scrollable content starts the browser's autoscroll mode, which can
    // swallow the follow-up 'auxclick' so the close never fires — notably
    // when a single tab is the only hit target. Prevent that default on
    // middle-mousedown so 'auxclick' reliably reaches the close handler.
    listen(el, 'mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
    listen(el, 'auxclick', (e) => { if (e.button === 1) { e.preventDefault(); onClose(tab.id); } });

    if (onContextMenu) {
      listen(el, 'contextmenu', (e) => { e.preventDefault(); onContextMenu(e, tab); });
    }

    if (drag) drag.bind(el, tab);
  },
  newButton() {
    const newBtn = document.createElement('button');
    newBtn.className = 'tab-new';
    newBtn.type = 'button';
    newBtn.setAttribute('aria-label', 'New tab');
    newBtn.title = 'New tab';
    newBtn.textContent = '+';
    return newBtn;
  },
  create({tab,activeId,index,escapeHtml}) {
    const el = document.createElement('div');
    el.className = 'tab-item' + (tab.id === activeId ? ' active' : '') + (tab.pinned ? ' pinned' : '');
    el.dataset.tabId = tab.id;
    el.setAttribute('role', 'tab');
    el.setAttribute('aria-selected', String(tab.id === activeId));
    el.tabIndex = tab.id === activeId || (activeId === null && index === 0) ? 0 : -1;

    const pinIcon = tab.pinned ? '<span class="tab-pin-icon">📌</span>' : '';
    const icon = tab.icon ? '<span class="tab-icon">' + escapeHtml(tab.icon) + '</span>' : '';
    const titleSpan = '<span class="tab-title" style="overflow:hidden;text-overflow:ellipsis">' + escapeHtml(tab.title || 'New Tab') + '</span>';
    const closeBtn = tab.pinned ? '' : '<button class="tab-close" title="Close tab">✕</button>';

    el.innerHTML = pinIcon + icon + titleSpan + closeBtn;

    const closeButton = tab.pinned ? null : el.querySelector('.tab-close');
    if (closeButton) {
      closeButton.type='button';closeButton.tabIndex=-1;
      closeButton.setAttribute('aria-label','Close '+tab.title);
    }
    return {element:el,closeButton};
  }
};
