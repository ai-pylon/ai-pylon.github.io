/* Private markup for sidebar tab strips and lazy panels. */
window._AppUISidebarTabView = {
  frame() {
    const tabBar = document.createElement('div');
    tabBar.className = 'ai-app-sidebar-tabs';
    tabBar.setAttribute('role', 'tablist');
    const panelHost = document.createElement('div');
    panelHost.className = 'ai-app-sidebar-panel';
    return {tabBar, panelHost};
  },
  panel(tab) {
    var tabPanel = document.createElement('div');
    tabPanel.className = 'ai-app-tab-panel';
    tabPanel.dataset.tabId = tab.id;
    tabPanel.style.cssText = 'flex:1;overflow:auto;display:flex;flex-direction:column;';
    tabPanel.innerHTML = '<div class="ai-app-tab-loading">Loading...</div>';
    return tabPanel;
  },
  button(tab, index) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'ai-app-sidebar-tab';
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', 'false');
    button.tabIndex = -1;
    button.dataset.tabId = tab.id;
    button.title = tab.title || tab.label || tab.id || 'Sidebar tab';
    button.textContent = (tab.icon || '') + (tab.label || tab.title || tab.id || 'Tab ' + (index + 1));
    button.draggable = true;
    if (tab.closable) button.dataset.closable = 'true';
    return button;
  },
};
