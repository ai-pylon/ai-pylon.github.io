/* AppUI notification center: persistent-in-session activity list. */
const AppUINotifications = (() => {
  let items = [];
  let panel = null;
  function push(notification) {
    items.unshift(Object.assign({id: `notice-${Date.now()}-${Math.random()}`, time: new Date(), level: 'info'}, notification));
    items = items.slice(0, 100); render();
  }
  function mount(container) {
    if (!container) return null;
    const button = document.createElement('button'); button.type = 'button'; button.className = 'appui-notifications-btn'; button.title = 'Notifications'; button.textContent = 'Notifications';
    panel = document.createElement('div'); panel.className = 'appui-notifications-panel'; panel.hidden = true;
    button.addEventListener('click', () => { panel.hidden = !panel.hidden; render(); });
    container.append(button, panel); render(); return {button, panel};
  }
  function render() {
    if (!panel) return;
    panel.replaceChildren();
    if (!items.length) { panel.textContent = 'No notifications.'; return; }
    items.forEach(item => { const row = document.createElement('div'); row.className = `appui-notification ${item.level}`; row.textContent = item.message || item.title || ''; row.title = new Date(item.time).toLocaleString(); panel.appendChild(row); });
  }
  function clear() { items = []; render(); }
  function show(message, type = 'info', duration) {
    AppUIToast._showRaw(message, type, duration);
    push({message: String(message || ''), level: type});
  }
  return {
    push, mount, clear, show, items: () => items.slice(),
    success(message, duration) { show(message, 'success', duration); },
    error(message, duration) { show(message, 'error', duration || 5000); },
    info(message, duration) { show(message, 'info', duration); },
    warn(message, duration) { show(message, 'warn', duration || 4000); },
  };
})();
window.AppUINotifications = AppUINotifications;
