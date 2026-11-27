/* AppUI resizable N-pane content layout with swap support.
 *
 * API:
 *   AppUIMultiSplit.create({
 *     container: el,
 *     panes: [
 *       { render: fn, label: 'Editor', ratio: 0.5 },
 *       { render: fn, label: 'Preview', ratio: 0.3 },
 *       { render: fn, label: 'Props', ratio: 0.2, minSize: 150 },
 *     ],
 *     direction: 'horizontal',   // or 'vertical'
 *     minSize: 100,              // default minimum pane size
 *     swappable: true,           // show swap buttons on handles
 *   })
 *
 * Returns:
 *   { element, panes: HTMLElement[], swap(i, j), destroy() }
 */
const AppUIMultiSplit = (() => {
  function create(opts = {}) {
    const container = typeof opts.container === 'string'
      ? document.querySelector(opts.container)
      : opts.container;
    if (!container) throw new Error('AppUIMultiSplit: container not found');

    const panes = opts.panes || [];
    if (panes.length < 2) throw new Error('AppUIMultiSplit: need at least 2 panes');

    let direction = opts.direction === 'vertical' ? 'vertical' : 'horizontal';
    let axis = direction === 'horizontal' ? 'width' : 'height';
    let clientAxis = direction === 'horizontal' ? 'clientX' : 'clientY';
    const defaultMinSize = Number.isFinite(opts.minSize) ? opts.minSize : 100;
    const swappable = opts.swappable !== false;
    const storageKey = opts.storageKey || null;
    let sizes = loadSizes(storageKey, panes.length) || window._AppUIMultiSplitModel.normalize(opts.sizes, panes.length);

    container.replaceChildren();
    const root = window._AppUIMultiSplitView.root(direction, opts.className);
    container.appendChild(root);

    // State: pane order (allows swap without DOM rebuild)
    let order = panes.map((_, i) => i);
    const paneEls = [];
    const handleEls = [];
    const cleanups = [];
    const renders = AppUILifecycle.generation();
    const lifetime = AppUILifecycle.createScope();
    lifetime.add(() => root.remove());
    lifetime.add(disposePanes);
    let destroyed = false;

    function buildDOM(initial = false) {
      for (let i = 0; i < order.length; i++) {
        const paneIndex = order[i];
        const pane = window._AppUIMultiSplitView.pane(panes[paneIndex], paneIndex);
        paneEls.push(pane);
        root.appendChild(pane);

        if (i < order.length - 1) {
          const {element: handle, swapButton} = window._AppUIMultiSplitView.handle(i, direction, swappable, initial);
          if (swapButton) swapButton.addEventListener('click', e => {
            e.stopPropagation();
            swap(i, i + 1);
          });
          handleEls.push(handle);
          root.appendChild(handle);
        }
      }
    }
    buildDOM(true);

    // Render content into panes (respecting order)
    function renderAll() {
      const version = renders.next();
      const current = () => !destroyed && renders.isCurrent(version);
      for (let slot = 0; slot < paneEls.length && current(); slot++) {
        const paneIdx = order[slot];
        const el = paneEls[slot];
        const previous = cleanups[slot];
        cleanups[slot] = null;
        previous?.();
        if (!current()) return;
        const scope = AppUILifecycle.createScope();
        cleanups[slot] = () => scope.destroy();
        el.replaceChildren();
        el.setAttribute('aria-label', panes[paneIdx].label || `Pane ${paneIdx + 1}`);
        const spec = panes[paneIdx].render || panes[paneIdx];
        const instance = renderSpec(spec, el);
        scope.add(instance);
      }
    }

    // Initial sizes from ratios
    function applyRatios() {
      const ratios = window._AppUIMultiSplitModel.ratios(panes, sizes);
      for (let i = 0; i < paneEls.length; i++) {
        const paneIdx = order[i];
        const ratio = ratios[paneIdx];
        paneEls[i].style.flex = `${ratio} 1 0%`;
        paneEls[i].style['min' + axis.charAt(0).toUpperCase() + axis.slice(1)] =
          (panes[paneIdx].minSize || defaultMinSize) + 'px';
      }
    }

    renderAll();
    applyRatios();

    // --- Drag resize ---
    function captureSizes() {
      const values = Array(panes.length).fill(0);
      paneEls.forEach((pane, slot) => { values[order[slot]] = pane.hidden ? 0 : pane.getBoundingClientRect()[axis]; });
      sizes = window._AppUIMultiSplitModel.normalize(values, panes.length);
      if (storageKey) AppUIStorage.setJSON(storageKey, sizes);
    }

    function disposePanes() {
      const scope = AppUILifecycle.createScope();
      cleanups.splice(0).reverse().forEach(cleanup => scope.add(cleanup));
      scope.destroy();
    }

    const resize=window._AppUIMultiSplitResize.create({
      root,panes,paneEls,handleEls,defaultMinSize,captureSizes,
      getState:()=>({destroyed,direction,axis,clientAxis,order}),
    });
    const clearGestures=()=>resize.clear(),bindGestures=()=>resize.bind();
    bindGestures();
    lifetime.add(resize);

    // --- Swap ---
    function swap(i, j) {
      if (destroyed || i < 0 || j < 0 || i >= order.length || j >= order.length || i === j) return;
      clearGestures();
      bindGestures();
      // Swap logical order
      const tmp = order[i];
      order[i] = order[j];
      order[j] = tmp;
      // Re-render swapped panes and update labels/ratios
      renderAll();
      applyRatios();
    }

    // --- Public API ---
    return {
      element: root,
      get panes() { return [...paneEls]; },
      get order() { return [...order]; },
      get direction() { return direction; },
      getSizes() { return [...sizes]; },
      setSizes(nextSizes) { if (destroyed) return; sizes = window._AppUIMultiSplitModel.normalize(nextSizes, panes.length); applyRatios(); if (storageKey) AppUIStorage.setJSON(storageKey, sizes); },
      setPaneVisible(slot, visible) {
        if (destroyed) return;
        const pane = paneEls[slot];
        if (!pane) return;
        pane.hidden = !visible;
        sizes = window._AppUIMultiSplitModel.visibleSizes(order, paneEls.map(item => !item.hidden), panes.length);
        applyRatios();
        if (storageKey) AppUIStorage.setJSON(storageKey, sizes);
      },
      getPane(slot) { return paneEls[slot] || null; },
      swap,
      addPane(spec, position) {
        if (destroyed) return;
        const idx = panes.length;
        position = (position != null && position >= 0) ? Math.min(position, panes.length) : panes.length;
        panes.push(spec);
        order.splice(position, 0, idx);
        // Rebuild DOM
        _rebuild();
      },
      removePane(slot) {
        if (destroyed || paneEls.length <= 1) return;
        const paneIdx = order[slot];
        if (paneIdx == null) return;
        order.splice(slot, 1);
        // Remap indices
        order = order.map(i => i > paneIdx ? i - 1 : i);
        panes.splice(paneIdx, 1);
        _rebuild();
      },
      setDirection(newDir) {
        if (destroyed) return;
        const d = newDir === 'vertical' ? 'vertical' : 'horizontal';
        if (d === direction) return;
        clearGestures();
        direction = d;
        axis = direction === 'horizontal' ? 'width' : 'height';
        clientAxis = direction === 'horizontal' ? 'clientX' : 'clientY';
        window._AppUIMultiSplitView.direction(root,handleEls,direction,opts.className);
        // Update handle cursors via CSS class
        bindGestures();
        applyRatios();
      },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        lifetime.destroy();
      },
    };

    function _rebuild() {
      clearGestures();
      disposePanes();
      if (destroyed) return;
      root.replaceChildren();
      paneEls.length = 0;
      handleEls.length = 0;
      cleanups.length = 0;
      buildDOM();
      bindGestures();
      renderAll();
      applyRatios();
    }
  }

  function renderSpec(spec, el) {
    if (typeof spec === 'function') return spec(el);
    if (spec?.render) return spec.render(el);
    if (spec instanceof Node) { el.appendChild(spec); return null; }
    if (typeof spec === 'string') { el.innerHTML = spec; return null; }
    return null;
  }

  function loadSizes(key, count) {
    if (!key) return null;
    const stored = AppUIStorage.getJSON(key, null);
    return Array.isArray(stored) ? window._AppUIMultiSplitModel.normalize(stored, count) : null;
  }

  return { create };
})();
window.AppUIMultiSplit = AppUIMultiSplit;
