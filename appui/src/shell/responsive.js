/* Responsive shell behavior: compact mode and sidebar control rail. */
const AppUIResponsiveShell = (function() {
  function create({main, left, right, hasLeft, hasRight, layout, onToggleLeft, onToggleRight}) {
    let mediaQuery = null;
    let listener = null;
    let rail = null;

    if (hasLeft || hasRight) {
      rail = document.createElement('div');
      rail.className = 'ai-app-sidebar-rail';
      rail.dataset.appuiOwned = 'true';
      rail.setAttribute('aria-label', 'Sidebar controls');
      if (hasLeft) rail.appendChild(button('Left', 'Toggle left sidebar', onToggleLeft));
      if (hasRight) rail.appendChild(button('Right', 'Toggle right sidebar', onToggleRight));
      main?.appendChild(rail);
    }

    if (window.matchMedia) {
      mediaQuery = window.matchMedia('(max-width: 850px)');
      listener = () => {
        document.body.classList.toggle('ai-app-compact', mediaQuery.matches);
        if (!mediaQuery.matches) {
          document.body.classList.remove('ai-app-compact-left-open', 'ai-app-compact-right-open');
          left?.classList.toggle('ai-app-hidden', !!layout.leftCollapsed);
          right?.classList.toggle('ai-app-hidden', !!layout.rightCollapsed);
        }
      };
      mediaQuery.addEventListener('change', listener);
      listener();
    }

    return {
      rail,
      destroy() {
        if (mediaQuery && listener) mediaQuery.removeEventListener('change', listener);
        rail?.remove();
        mediaQuery = null;
        listener = null;
        rail = null;
      },
    };
  }

  function button(label, title, onClick) {
    const element = document.createElement('button');
    element.type = 'button';
    element.title = title;
    element.textContent = label;
    element.addEventListener('click', onClick);
    return element;
  }

  return {create};
})();
window.AppUIResponsiveShell = AppUIResponsiveShell;
