/* Private pointer and keyboard resize ownership for MultiSplit handles. */
window._AppUIMultiSplitResize = {
  create({root,panes,paneEls,handleEls,defaultMinSize,getState,captureSizes}) {
    let dragState = null;
    const gestureBindings = [];

    function onPointerDown(e) {
      const {destroyed,axis,clientAxis,order}=getState();
      if (destroyed) return;
      const handle = e.target.closest('.appui-multi-split-handle');
      if (!handle || handle.parentNode !== root) return;
      const hi = parseInt(handle.dataset.handleIndex);
      const leftPane = paneEls[hi];
      const rightPane = paneEls[hi + 1];
      const leftRect = leftPane.getBoundingClientRect();
      const rightRect = rightPane.getBoundingClientRect();
      dragState = {
        handleIndex: hi,
        startPoint: e[clientAxis],
        leftSize: leftRect[axis],
        rightSize: rightRect[axis],
        leftMin: panes[order[hi]].minSize || defaultMinSize,
        rightMin: panes[order[hi + 1]].minSize || defaultMinSize,
      };
      root.classList.add('dragging');
    }

    function onPointerMove(e) {
      const {clientAxis}=getState();
      if (!dragState) return;
      const delta = e[clientAxis] - dragState.startPoint;
      const newLeft = Math.max(dragState.leftMin, dragState.leftSize + delta);
      const newRight = Math.max(dragState.rightMin, dragState.rightSize - delta);
      // Clamp: don't exceed combined space
      const total = dragState.leftSize + dragState.rightSize;
      const clampedLeft = Math.min(newLeft, total - dragState.rightMin);
      const clampedRight = total - clampedLeft;
      paneEls[dragState.handleIndex].style.flex = `0 0 ${clampedLeft}px`;
      paneEls[dragState.handleIndex + 1].style.flex = `0 0 ${clampedRight}px`;
    }

    function onPointerUp(e) {
      if (!dragState) return;
      dragState = null;
      root.classList.remove('dragging');
      captureSizes();
    }

    function onKeyDown(e) {
      const {destroyed,direction,axis,order}=getState();
      if (destroyed) return;
      const handle = e.target.closest('.appui-multi-split-handle');
      if (!handle || handle.parentNode !== root) return;
      const forward = direction === 'horizontal' ? e.key === 'ArrowRight' : e.key === 'ArrowDown';
      const backward = direction === 'horizontal' ? e.key === 'ArrowLeft' : e.key === 'ArrowUp';
      if (!forward && !backward) return;
      e.preventDefault();
      const index = Number(handle.dataset.handleIndex);
      const delta = (forward ? 1 : -1) * (e.shiftKey ? 20 : 8);
      const left = paneEls[index].getBoundingClientRect()[axis];
      const right = paneEls[index + 1].getBoundingClientRect()[axis];
      const leftMin = panes[order[index]].minSize || defaultMinSize;
      const rightMin = panes[order[index + 1]].minSize || defaultMinSize;
      const nextLeft = Math.max(leftMin, Math.min(left + right - rightMin, left + delta));
      paneEls[index].style.flex = `0 0 ${nextLeft}px`;
      paneEls[index + 1].style.flex = `0 0 ${left + right - nextLeft}px`;
      captureSizes();
    }

    function clearGestures() {
      gestureBindings.splice(0).forEach(binding => binding.destroy());
      dragState = null;
      root.classList.remove('dragging');
    }

    function bindGestures() {
      const {direction}=getState();
      for (const handle of handleEls) {
        gestureBindings.push(window.AppUIPointerGesture.bind(handle, {
          cursor: direction === 'horizontal' ? 'col-resize' : 'row-resize',
          shouldStart: event => !getState().destroyed && !dragState && !event.target.closest('button'),
          onStart: onPointerDown, onMove: onPointerMove, onEnd: onPointerUp,
        }));
      }
    }
    root.addEventListener('keydown', onKeyDown);
    return {bind:bindGestures,clear:clearGestures,destroy() {
      root.removeEventListener('keydown', onKeyDown);
      clearGestures();
    }};
  },
};
