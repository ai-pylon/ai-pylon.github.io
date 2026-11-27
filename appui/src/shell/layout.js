/* Shell layout: sidebar tab switching, status sections, layout persistence, sidebar resize controls. */

/* Public sidebar-tab activation adapter. */
window.AppUIShellSidebarTabs = {
  create(getTabs) {
    return {
      activate(position, id) {
        const sidebar = getTabs()[position], tab = sidebar?.tabs.find(item => item.id === id);
        if (!tab) return false;
        sidebar.activate(tab); return true;
      },
    };
  },
};

/* Status rendering adapter. */
window.AppUIShellStatus = {
  create(getStatusBar) {
    return {
      set(text, position) {
        const statusBar = getStatusBar();
        if (statusBar) return statusBar.set(position || 'main', text);
        const element = document.getElementById(position === 'right' ? 'appStatusRight' : 'appStatusLeft');
        if (element) element.textContent = text;
      },
    };
  },
};

/* Layout persistence bridge for the shell. */
window.AppUIShellLayoutStorage = {
  create({getAppId, getState, getLayout}) {
    const key = () => `pylon/appui/layout/${getAppId() || 'page'}`;
    return {
      read() { const state = getState(); return state ? state.all() : (AppUIStorage.getJSON(key(), {}) || {}); },
      write() { const state = getState(); return state ? state.replace(getLayout()) : AppUIStorage.setJSON(key(), getLayout()); },
    };
  },
};

/* Sidebar visibility controls; shell supplies region and layout state. */
window.AppUIShellSidebarControls = {
  create({elements, regions, layout, saveLayout}) {
    function toggle(side) {
      const element = elements()[side]; if (!element) return;
      if (document.body.classList.contains('ai-app-compact')) {
        const className = `ai-app-compact-${side}-open`, opening = !document.body.classList.contains(className);
        document.body.classList.toggle(className, opening);
        document.body.classList.remove(`ai-app-compact-${side === 'left' ? 'right' : 'left'}-open`);
        if (opening) element.classList.remove('ai-app-hidden');
        return;
      }
      const region = regions()[side]; if (region) return region.toggle();
      element.classList.toggle('ai-app-hidden'); layout()[`${side}Collapsed`] = element.classList.contains('ai-app-hidden'); saveLayout();
    }
    return {toggleLeft: () => toggle('left'), toggleRight: () => toggle('right')};
  },
};
