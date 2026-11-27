/* Template-mounted menubar region. */
const AppUIMenubarRegion = (function() {
  function create(element) {
    let menu = null;
    let right = null;
    return {
      mount({visible = true} = {}) {
        element.replaceChildren();
        element.hidden = !visible;
        if (!visible) { menu = null; right = null; return {menu, right}; }
        menu = document.createElement('div'); menu.className = 'ai-app-menu-main';
        right = document.createElement('div'); right.className = 'ai-app-menu-right';
        element.append(menu, right);
        return {menu, right};
      },
      initMenu({component, definition, onAction} = {}) {
        if (!menu || !component?.init) return null;
        component.init({container: menu, definition, onAction});
        return component;
      },
      mountTheme({enabled = false, themeService} = {}) {
        if (!enabled || !right) return null;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'ai-app-theme-btn';
        button.title = 'Toggle theme';
        button.textContent = 'Theme';
        button.addEventListener('click', () => themeService.toggle());
        right.appendChild(button);
        return button;
      },
      mountNotifications({enabled = false, feature} = {}) {
        if (!enabled || !right || !feature?.mount) return null;
        return feature.mount(right);
      },
      destroy() { element.replaceChildren(); element.hidden = false; menu = null; right = null; },
      get menu() { return menu; },
      get right() { return right; },
    };
  }
  return {create};
})();
window.AppUIMenubarRegion = AppUIMenubarRegion;
