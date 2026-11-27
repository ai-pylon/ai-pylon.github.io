/* Owned pointer gestures shared by layout and floating controls. */
var AppUIPointerGesture = window.AppUIPointerGesture || (() => {
  const bodyOwners = [];
  let bodyStyles;
  function acquireBody(owner, cursor) {
    if (!bodyOwners.length) bodyStyles = {userSelect:document.body.style.userSelect,cursor:document.body.style.cursor};
    bodyOwners.push({owner,cursor});
    document.body.style.userSelect = 'none';
    document.body.style.cursor = cursor;
  }
  function releaseBody(owner) {
    const index = bodyOwners.findIndex(entry => entry.owner === owner);
    if (index < 0) return;
    bodyOwners.splice(index,1);
    if (bodyOwners.length) {
      document.body.style.userSelect = 'none';
      document.body.style.cursor = bodyOwners[bodyOwners.length-1].cursor;
    } else {
      document.body.style.userSelect = bodyStyles.userSelect;
      document.body.style.cursor = bodyStyles.cursor;
      bodyStyles = null;
    }
  }
  function bind(handle, opts = {}) {
    if (!handle) throw new Error('AppUIPointerGesture: handle not found');
    let active = null, destroyed = false;
    const bodyOwner = {};
    const touchAction = handle.style.touchAction;
    handle.style.touchAction = opts.touchAction || 'none';
    function finish(event, notify = true) {
      if (active === null || (event && event.pointerId !== active)) return;
      const pointerId = active;
      active = null;
      releaseBody(bodyOwner);
      if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId);
      if (notify) opts.onEnd?.(event);
    }
    function down(event) {
      if (destroyed || active !== null || event.button !== (opts.button ?? 0)) return;
      if (opts.shouldStart && !opts.shouldStart(event)) return;
      event.preventDefault();
      active = event.pointerId;
      acquireBody(bodyOwner, opts.cursor || 'col-resize');
      try {
        handle.setPointerCapture(event.pointerId);
        opts.onStart?.(event);
      } catch (error) { finish(event, false); throw error; }
    }
    function move(event) {
      if (active !== event.pointerId) return;
      try { opts.onMove?.(event); }
      catch (error) { finish(event, false); throw error; }
    }
    const end = event => finish(event);
    const listeners = {pointerdown: down, pointermove: move, pointerup: end,
      pointercancel: end, lostpointercapture: end};
    for (const [name, listener] of Object.entries(listeners)) handle.addEventListener(name, listener);
    return {destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const [name, listener] of Object.entries(listeners)) handle.removeEventListener(name, listener);
      finish(null, false);
      handle.style.touchAction = touchAction;
    }};
  }
  function positionHandlers(target, {minLeft=0,minTop=0,onMove} = {}) {
    let start;
    return {
      onStart(event) {
        const rect=target.getBoundingClientRect();
        start={x:event.clientX,y:event.clientY,left:rect.left,top:rect.top};
      },
      onMove(event) {
        if(!start)return;
        target.style.left=`${Math.max(minLeft,start.left+event.clientX-start.x)}px`;
        target.style.top=`${Math.max(minTop,start.top+event.clientY-start.y)}px`;
        onMove?.(event);
      },
    };
  }
  /** Bind a pane divider whose position is a percentage of a container. */
  function bindPercentage(handle, {container, direction='horizontal', min=0, max=100, onResize} = {}) {
    const owner = AppUILifecycle.createViewScope({host:handle});
    const vertical = direction === 'vertical';
    let rect;
    owner.add(bind(handle, {
      cursor: vertical ? 'row-resize' : 'col-resize',
      shouldStart() {
        if (!owner.current()) return false;
        const target = typeof container === 'function' ? container() : container;
        rect = target?.getBoundingClientRect();
        return !!rect && rect[vertical ? 'height' : 'width'] > 0;
      },
      onMove(event) {
        const point = vertical ? event.clientY : event.clientX;
        const start = vertical ? rect.top : rect.left;
        const size = vertical ? rect.height : rect.width;
        onResize?.(Math.min(max, Math.max(min, (point - start) / size * 100)), event);
      },
    }));
    return {destroy: () => owner.destroy()};
  }
  return {bind,positionHandlers,bindPercentage};
})();
window.AppUIPointerGesture=AppUIPointerGesture;
