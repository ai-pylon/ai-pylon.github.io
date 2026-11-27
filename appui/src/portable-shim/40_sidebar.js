  function buildSidebar(host, spec, side) {
    host.replaceChildren();
    if (!spec || !Array.isArray(spec.tabs) || !spec.tabs.length) {
      host.classList.add('ai-app-hidden');
      return;
    }
    // Lay the sidebar out as a flex COLUMN so the fixed tab row + the flex:1
    // panel stack correctly and the panel (hence the tree) fills the height and
    // can scroll.
    host.style.display = 'flex';
    host.style.flexDirection = 'column';
    host.style.minHeight = '0';
    // Restore a persisted width, else the spec default.
    const storeKey = 'sysdoc_viewer.sidebar.' + side;
    let width = spec.width || 220;
    try {
      const saved = parseInt(localStorage.getItem(storeKey), 10);
      if (saved > 0) width = saved;
    } catch (e) { /* storage unavailable */ }
    host.style.width = width + 'px';

    const tabStrip = document.createElement('div');
    tabStrip.className = 'ai-tab-strip';
    // Slide-nav: flank the strip with ◂ ▸ buttons that scroll it when the tabs
    // overflow the (narrow) sidebar. Always visible; disabled when nothing to scroll.
    const tabRow = document.createElement('div');
    tabRow.className = 'ai-tab-row';
    tabRow.style.cssText = 'display:flex;align-items:stretch;min-width:0;flex:0 0 auto;position:relative';
    tabStrip.style.cssText = 'flex:1 1 auto;min-width:0;overflow-x:auto;overflow-y:hidden;scrollbar-width:none';
    function _nav(dir, glyph, label) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'ai-tab-nav'; b.textContent = glyph;
      b.title = label; b.setAttribute('aria-label', label); b.tabIndex = -1;
      // ABSOLUTELY positioned OVERLAY on the strip's edge — NOT a flex sibling.
      // As a flex sibling, hiding/showing the arrows changed the strip's width,
      // which re-triggered the ResizeObserver → a feedback loop the browser
      // silently drops (so _updateNav stopped running and the arrows were stuck
      // visible even when the tabs fit). Out of flow, the strip always keeps full
      // width and toggling arrows never resizes it → correct measure, no loop.
      b.style.cssText = 'position:absolute;top:0;bottom:0;' + (dir < 0 ? 'left:0;' : 'right:0;') +
        'width:18px;border:0;padding:0;cursor:pointer;z-index:2;display:none;' +
        'background:var(--shell-chrome,var(--bg-elevated,rgba(245,245,245,.92)));' +
        'color:var(--text-muted,#888);font-size:11px;line-height:1';
      b.addEventListener('click', function (e) {
        e.preventDefault();
        const step = Math.max(40, Math.round(tabStrip.clientWidth * 0.8));
        tabStrip.scrollBy({ left: dir * step, behavior: 'smooth' });
      });
      return b;
    }
    const navPrev = _nav(-1, '\u25C2', 'Scroll tabs left');
    const navNext = _nav(1, '\u25B8', 'Scroll tabs right');
    function _updateNav() {
      // Arrows are absolute overlays (see _nav) → toggling them does NOT resize
      // the strip, so there's no ResizeObserver feedback loop and we can run
      // SYNCHRONOUSLY. (An earlier rAF-deferred version risked a stuck
      // "_navScheduled" flag when rAF didn't fire — e.g. a backgrounded tab —
      // which froze the arrows. Synchronous + idempotent is simpler and robust.)
      const of = tabStrip.scrollWidth - tabStrip.clientWidth > 1;
      if (!of) { navPrev.style.display = 'none'; navNext.style.display = 'none'; return; }
      const x = tabStrip.scrollLeft;
      navPrev.style.display = (x <= 1) ? 'none' : '';
      navNext.style.display = (x >= (tabStrip.scrollWidth - tabStrip.clientWidth - 1)) ? 'none' : '';
    }
    tabStrip.addEventListener('scroll', _updateNav, { passive: true });
    // MOUSE-WHEEL navigation: scrolling the wheel over the tab strip scrolls it
    // HORIZONTALLY (a vertical wheel is the natural gesture over a horizontal
    // overflow strip). Only when there's actually overflow — otherwise let the
    // event bubble (so a trackpad scroll over a non-overflowing strip doesn't get
    // swallowed). preventDefault stops the page/panel from also scrolling.
    tabStrip.addEventListener('wheel', function (e) {
      if (tabStrip.scrollWidth - tabStrip.clientWidth <= 1) return;   // nothing to scroll
      const delta = (Math.abs(e.deltaY) > Math.abs(e.deltaX)) ? e.deltaY : e.deltaX;
      if (!delta) return;
      e.preventDefault();
      tabStrip.scrollBy({ left: delta, behavior: 'auto' });
    }, { passive: false });
    const panel = document.createElement('div');
    panel.className = 'ai-tab-panel';
    // The panel is a flex COLUMN filling remaining height so the per-tab pane
    // (flex:1) + any tree host inside it get a real height and can SCROLL.
    panel.style.cssText = 'flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden';

    // PER-TAB persistent panels. The old code re-rendered EVERY tab into ONE
    // shared ``panel`` on each activate — so switching tabs (or any re-render)
    // clobbered the content with another tab's output (content-bleed, lost
    // context menus, "same list"). Now each tab gets its OWN pane, rendered ONCE
    // (lazy) then just shown/hidden — so a tab's tree + bindings survive.
    const _panes = {};
    const activate = function (tab, button) {
      tabStrip.querySelectorAll('.ai-tab').forEach(function (b) {
        b.classList.remove('is-active');
      });
      button.classList.add('is-active');
      try { button.scrollIntoView({ inline: 'nearest', block: 'nearest' }); } catch (e) {}
      const id = tab.id || tab.label;
      Object.keys(_panes).forEach(function (k) { _panes[k].style.display = 'none'; });
      let pane = _panes[id];
      if (!pane) {
        pane = document.createElement('div');
        pane.className = 'ai-tab-pane';
        pane.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;overflow:auto';
        panel.appendChild(pane);
        _panes[id] = pane;
        if (typeof tab.render === 'function') tab.render(pane);   // render ONCE
      }
      pane.style.display = '';
      if (typeof tab.activate === 'function') tab.activate();
    };

    spec.tabs.forEach(function (tab) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ai-tab';
      button.dataset.tabId = tab.id || tab.label;
      button.textContent = tab.label;
      button.addEventListener('click', function () {
        activate(tab, button);
      });
      tabStrip.appendChild(button);
      if (tab.active) {
        setTimeout(function () { activate(tab, button); }, 0);
      }
    });

    tabRow.appendChild(navPrev);
    tabRow.appendChild(tabStrip);
    tabRow.appendChild(navNext);
    host.appendChild(tabRow);
    host.appendChild(panel);
    try { requestAnimationFrame(_updateNav); } catch (e) { setTimeout(_updateNav, 0); }
    setTimeout(_updateNav, 120);   // backstop: rAF may be deferred (background tab) or fire pre-layout
    if (typeof ResizeObserver === 'function') { try { new ResizeObserver(_updateNav).observe(tabStrip); } catch (e) {} }

    // Allow programmatic tab activation (e.g. switch to Files after a drop).
    host._activateTab = function (tabId) {
      const idx = spec.tabs.findIndex(function (t) { return (t.id || t.label) === tabId; });
      if (idx < 0) return false;
      const btn = tabStrip.querySelectorAll('.ai-tab')[idx];
      if (btn) { activate(spec.tabs[idx], btn); return true; }
      return false;
    };

    // Drag-to-resize handle on the inner edge (right edge for the left sidebar,
    // left edge for the right sidebar). Width is clamped and persisted.
    const handle = document.createElement('div');
    handle.className = 'ai-resize-handle ai-resize-' + side;
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-orientation', 'vertical');
    handle.setAttribute('aria-label', side + ' sidebar width');
    host.appendChild(handle);
    const MIN = 140, MAX = 560;
    handle.addEventListener('mousedown', function (e) {
      e.preventDefault();
      const startX = e.clientX, startW = host.getBoundingClientRect().width;
      document.body.style.userSelect = 'none';
      const onMove = function (ev) {
        const delta = ev.clientX - startX;
        let w = side === 'left' ? startW + delta : startW - delta;
        w = Math.max(MIN, Math.min(MAX, w));
        host.style.width = w + 'px';
      };
      const onUp = function () {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.userSelect = '';
        try { localStorage.setItem(storeKey, String(Math.round(host.getBoundingClientRect().width))); } catch (e2) { /* storage unavailable */ }
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

