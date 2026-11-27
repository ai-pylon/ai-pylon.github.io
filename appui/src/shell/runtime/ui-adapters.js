/* Shell UI adapters: notification push, diagnostics/error reporting, confirm dialogs. */

/* Notification feature adapter. */
window.AppUIShellNotifications = {
  notify(message, level = 'info') {
    const notifications = window.AppUINotificationsFeature;
    if (!notifications?.push) return false;
    notifications.push(typeof message === 'object' ? Object.assign({level}, message) : {message: String(message || ''), level});
    return true;
  },
};

/* Error reporting and plugin discovery kept outside shell orchestration. */
window.AppUIShellDiagnostics = {
  reportUnhandled(event, setStatus) {
    const message = event.reason?.message || event.message || 'Unknown error';
    window.AppUIToast?.error?.(message.substring(0, 100));
    setStatus(`Error: ${message.substring(0, 60)}`);
  },
  discoverSidebarPlugins(position) {
    return (window.__appui_sidebar_plugins || []).filter(plugin => !plugin.position || plugin.position === position);
  },
};

/* Shell dialog adapters. */
window.AppUIShellDialogs = {
  confirm(message, options = {}) {
    return new Promise(resolve => {
      if (typeof AppUIDialog === 'undefined') return resolve(window.confirm(message));
      AppUIDialog.show({ title: options.title || 'Confirm', body: `<div style="font-size:13px">${message}</div>`, buttons: [
        {text: options.confirmText || 'OK', action: () => resolve(true)},
        {text: options.cancelText || 'Cancel', action: () => resolve(false)},
      ]});
    });
  },
};
