/* Private overflow navigation for sidebar tab strips. */
const _AppUISidebarTabOverflow = {
  create(tabBar) {
    const scope = AppUILifecycle.createScope();
    const tabRow = document.createElement('div');
    tabRow.className = 'ai-app-sidebar-tabrow';
    function _mkNav(dir, glyph, label) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ai-app-sidebar-tabnav ai-app-sidebar-tabnav-' + (dir < 0 ? 'prev' : 'next');
      b.setAttribute('aria-label', label);
      b.title = label;
      b.textContent = glyph;
      b.tabIndex = -1;                 // not part of the tab keyboard order
      scope.listen(b, 'click', function (e) {
        if (scope.destroyed) return;
        e.preventDefault();
        // scroll by ~80% of the visible width in the requested direction
        const step = Math.max(40, Math.round(tabBar.clientWidth * 0.8));
        tabBar.scrollBy({ left: dir * step, behavior: 'smooth' });
      });
      return b;
    }
    const navPrev = _mkNav(-1, '\u25C2', 'Scroll tabs left');   // ◂
    const navNext = _mkNav(1, '\u25B8', 'Scroll tabs right');   // ▸
    tabRow.append(navPrev, tabBar, navNext);
    // Reflect overflow + scroll position onto the nav buttons. Hidden entirely
    // when everything fits; each arrow disabled at its end.
    function _updateNav() {
      if (scope.destroyed) return;
      const overflow = tabBar.scrollWidth - tabBar.clientWidth > 1;
      tabRow.classList.toggle('has-overflow', overflow);
      if (!overflow) { navPrev.disabled = navNext.disabled = true; return; }
      const x = tabBar.scrollLeft;
      navPrev.disabled = x <= 1;
      navNext.disabled = x >= (tabBar.scrollWidth - tabBar.clientWidth - 1);
    }
    scope.listen(tabBar, 'scroll', _updateNav, { passive: true });
    if (typeof ResizeObserver === 'function') {
      try { const observer = new ResizeObserver(_updateNav); observer.observe(tabBar); scope.add(() => observer.disconnect()); } catch (e) { /* best-effort */ }
    }
    scope.listen(window, 'resize', _updateNav);
    // Run once after the strip has laid out (and expose for post-add/remove).
    const navFrame = AppUILifecycle.createFrameTask(_updateNav, {fallbackDelay: 0});
    scope.add(() => navFrame.destroy());
    const _scheduleNav = () => {if (!scope.destroyed) navFrame.schedule();};
    _scheduleNav();
    return {element: tabRow, schedule: _scheduleNav, destroy: () => scope.destroy()};
  }
};
