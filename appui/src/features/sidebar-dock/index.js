/* AppUI sidebar-dock shell integration.
 *
 * Registers with the shell to add undock buttons to sidebars and expose
 * dock/undock commands. Loaded as part of the shell bundle.
 */
const AppUISidebarDockFeature = (() => {
  let active = null;

  // Called by the shell after sidebar regions are mounted
  function mount({elements = {}, layout, persist, config}) {
    destroy();
    const scope = AppUILifecycle.createScope();
    const mounted = {left: null, right: null, destroy: () => scope.destroy()};
    active = mounted;
    scope.add(() => {
      mounted.left?.destroy();
      mounted.right?.destroy();
      if (active === mounted) active = null;
    });
    const main = elements.main || document.getElementById('app-main');
    const leftEl = elements.left || document.getElementById('app-left');
    const rightEl = elements.right || document.getElementById('app-right');

    if (leftEl && config?.leftSidebar) {
      mounted.left = AppUISidebarDock.create({
        side: 'left',
        element: leftEl,
        main,
        layout,
        persist,
        title: config.leftSidebar.title || leftEl.getAttribute('aria-label') || 'Left Panel',
      });
      _injectUndockButton(leftEl, 'left', mounted.left, scope);
    }

    if (rightEl && config?.rightSidebar) {
      mounted.right = AppUISidebarDock.create({
        side: 'right',
        element: rightEl,
        main,
        layout,
        persist,
        title: config.rightSidebar.title || rightEl.getAttribute('aria-label') || 'Right Panel',
      });
      _injectUndockButton(rightEl, 'right', mounted.right, scope);
    }

    return mounted;
  }

  function _injectUndockButton(sidebarEl, side, instance, scope) {
    // Add an undock icon button at the top of the sidebar
    const existing = sidebarEl.querySelector('.appui-sidebar-undock-btn');
    if (existing) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'appui-sidebar-undock-btn';
    btn.title = 'Pop out to floating panel';
    btn.textContent = side === 'left' ? '⏵' : '⏴';
    btn.style.cssText = 'position:absolute;top:4px;' + (side === 'left' ? 'right:4px' : 'left:4px') + ';z-index:2;border:0;background:var(--bg-elevated);color:var(--text-muted);border-radius:3px;padding:2px 5px;cursor:pointer;font-size:11px;opacity:0;transition:opacity 0.2s';
    scope.listen(btn, 'click', () => instance.undock());
    const position = sidebarEl.style.position;
    sidebarEl.style.position = 'relative';
    scope.listen(sidebarEl, 'mouseenter', () => { btn.style.opacity = '1'; });
    scope.listen(sidebarEl, 'mouseleave', () => { btn.style.opacity = '0'; });
    scope.add(() => {btn.remove(); sidebarEl.style.position = position;});
    sidebarEl.appendChild(btn);
  }

  function toggleLeft() { active?.left?.toggle(); }
  function toggleRight() { active?.right?.toggle(); }
  function isLeftFloating() { return active?.left?.isFloating() ?? false; }
  function isRightFloating() { return active?.right?.isFloating() ?? false; }

  function destroy() {
    active?.destroy();
  }

  return { mount, toggleLeft, toggleRight, isLeftFloating, isRightFloating, destroy };
})();
window.AppUISidebarDockFeature = AppUISidebarDockFeature;
