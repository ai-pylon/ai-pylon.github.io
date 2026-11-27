/* Private draggable title-bar ownership for shared dialogs. */
var _AppUIDialogDrag = window._AppUIDialogDrag || {
  bind({overlay, box, titleBar}) {
    let sx = 0, sy = 0, ox = 0, oy = 0, placed = false;
    return window.AppUIPointerGesture.bind(titleBar, {
      cursor: 'move',
      shouldStart: event => overlay.isConnected && !event.target?.closest?.('button'),
      onStart(event) {
        const rect = box.getBoundingClientRect();
        if (!placed) {
          // Pin the current rect before moving out of the centering flex layout.
          overlay.style.display = 'block';
          box.style.position = 'fixed';
          box.style.left = rect.left + 'px';
          box.style.top = rect.top + 'px';
          box.style.margin = '0';
          placed = true;
        }
        sx = event.clientX; sy = event.clientY; ox = rect.left; oy = rect.top;
      },
      onMove(event) {
        const width = box.offsetWidth;
        const left = Math.max(8 - width + 60, Math.min(ox + event.clientX - sx, window.innerWidth - 60));
        const top = Math.max(0, Math.min(oy + event.clientY - sy, window.innerHeight - 40));
        box.style.left = left + 'px';
        box.style.top = top + 'px';
      },
    });
  }
};
