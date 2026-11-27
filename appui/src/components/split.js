/* AppUI resizable two-pane content layout. */
const AppUISplit = (() => {
  function bind(handle,opts={}) {
    if(!handle)throw new Error('AppUISplit: handle not found');
    return window.AppUIPointerGesture.bind(handle,opts);
  }
  function create(opts = {}) {
    const container = typeof opts.container === 'string' ? document.querySelector(opts.container) : opts.container;
    if (!container) throw new Error('AppUISplit: container not found');
    const direction = opts.direction === 'vertical' ? 'vertical' : 'horizontal';
    const axis = direction === 'horizontal' ? 'width' : 'height';
    const minSize = Number.isFinite(opts.minSize) ? opts.minSize : 160;
    container.replaceChildren();
    const split = document.createElement('div');
    split.className = `appui-split ${direction}${opts.className ? ` ${opts.className}` : ''}`;
    const primary = document.createElement('section'); primary.className = 'appui-split-primary';
    const handle = document.createElement('div'); handle.className = 'appui-split-handle'; handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-orientation', direction === 'horizontal' ? 'vertical' : 'horizontal');
    const secondary = document.createElement('section'); secondary.className = 'appui-split-secondary';
    primary.setAttribute('aria-label', opts.primaryLabel || 'Primary content');
    secondary.setAttribute('aria-label', opts.secondaryLabel || 'Secondary content');
    split.append(primary, handle, secondary); container.appendChild(split);
    const primaryCleanup = render(opts.primary, primary);
    const secondaryCleanup = render(opts.secondary, secondary);
    let start;
    let destroyed = false;
    const ratioFrame = AppUILifecycle.createFrameTask(() => setPrimarySize(container.getBoundingClientRect()[axis] * opts.ratio));
    function setPrimarySize(size) {
      if (destroyed) return;
      primary.style.flex = `0 0 ${Math.max(minSize, size)}px`;
    }
    if (Number.isFinite(opts.primarySize)) setPrimarySize(opts.primarySize);
    else if (Number.isFinite(opts.ratio) && opts.ratio > 0 && opts.ratio < 1) {
      ratioFrame.schedule();
    }
    const binding = bind(handle, {
      cursor: direction === 'horizontal' ? 'col-resize' : 'row-resize',
      onStart(event) {
        start = {point: direction === 'horizontal' ? event.clientX : event.clientY, size: primary.getBoundingClientRect()[axis]};
      },
      onMove(event) {
        const point = direction === 'horizontal' ? event.clientX : event.clientY;
        setPrimarySize(start.size + point - start.point);
      },
      onEnd() { start = null; },
    });
    return {
      element: split,
      primary,
      secondary,
      setPrimarySize,
      destroy() {
        if (destroyed) return;
        destroyed = true;
        const teardown=AppUILifecycle.createScope();
        teardown.add(()=>split.remove());
        teardown.add(secondaryCleanup);
        teardown.add(primaryCleanup);
        teardown.add(binding);
        teardown.add(() => ratioFrame.destroy());
        teardown.destroy();
      },
    };
  }
  function render(spec, el) {
    let mounted;
    if (typeof spec === 'function') mounted = spec(el);
    else if (spec?.render) mounted = spec.render(el);
    else if (spec instanceof Node) el.appendChild(spec);
    else if (typeof spec === 'string') el.innerHTML = spec;
    if (typeof mounted === 'function') return mounted;
    if (mounted?.destroy) return () => mounted.destroy();
    return null;
  }
  return {create, bind};
})();
window.AppUISplit = AppUISplit;
