/**
 * AppUI Shell Layout  --  shared shell styles and sidebar drag handles.
 * Extracted from shell/app.js for modularity.
 *
 * Exposes: window.AppUIShellLayout
 */
(function() {
  'use strict';

  function _el(tag, cls) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    return el;
  }

  function beginResize(handle) {
    if (document.querySelector('.appui-resize-shield')) return () => {};
    const shield = _el('div', 'appui-resize-shield');
    shield.setAttribute('aria-hidden', 'true');
    document.body.appendChild(shield);
    document.body.classList.add('appui-sidebar-resizing');
    handle?.classList.add('active');
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      shield.remove();
      document.body.classList.remove('appui-sidebar-resizing');
      handle?.classList.remove('active');
      window.removeEventListener('blur', finish);
      window.dispatchEvent(new CustomEvent('appui:sidebar-resized'));
    };
    window.addEventListener('blur', finish);
    return finish;
  }

  function makeDraggable(handle, target, prop, min, max, reverse, layoutKey, layout, writeLayout) {
    let startX, startVal;
    let cancelActive = null;
    const onMouseDown = (e) => {
      if (e.button !== 0) return;
      const finishResize = beginResize(handle);
      startX = e.clientX;
      // Prefer the PERSISTED layout value over getComputedStyle(target)[prop]:
      // reading a computed style forces a synchronous reflow, which on a page
      // showing a very large document (e.g. a 30MB combined spec) can cost
      // 200ms+ at drag-start ("[Violation] mousedown handler took …"). The
      // persisted layout[layoutKey] is the same width without the layout flush;
      // fall back to the computed style only when it isn't available.
      const _persisted = layoutKey && layout && Number.isFinite(parseInt(layout[layoutKey], 10))
        ? parseInt(layout[layoutKey], 10) : NaN;
      startVal = Number.isFinite(_persisted) ? _persisted : parseInt(getComputedStyle(target)[prop]);
      let active = true;
      const onMove = (e) => {
        const delta = reverse ? startX - e.clientX : e.clientX - startX;
        const val = Math.max(min, Math.min(max, startVal + delta));
        target.style[prop] = val + 'px';
      };
      const onUp = () => {
        if (!active) return;
        active = false;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        window.removeEventListener('blur', onUp);
        if (layoutKey) {
          layout[layoutKey] = parseInt(target.style[prop], 10);
          writeLayout?.();
        }
        finishResize();
        cancelActive = null;
      };
      cancelActive = onUp;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      window.addEventListener('blur', onUp);
    };
    handle.addEventListener('mousedown', onMouseDown);
    return () => {
      cancelActive?.();
      handle.removeEventListener('mousedown', onMouseDown);
    };
  }

  function injectStyles() {
    if (document.getElementById('appui-styles')) return;
    const link = document.createElement('link');
    link.id = 'appui-styles';
    link.rel = 'stylesheet';
    const assets = window.AppUIAssets;
    if (!assets?.base || !assets?.css) return;
    link.href = assets.base + assets.css;
    document.head.appendChild(link);
  }

  window.AppUIShellLayout = {
    beginResize,
    makeDraggable,
    injectStyles,
  };
})();
