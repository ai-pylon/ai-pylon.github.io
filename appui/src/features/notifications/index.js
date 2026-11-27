/* Integrated notification-center feature adapter. */
const AppUINotificationsFeature = {
  mount(container) {
    const mounted = AppUINotifications.mount(container);
    return {
      ...mounted,
      destroy() {
        mounted?.button?.remove?.();
        mounted?.panel?.remove?.();
      },
    };
  },
  push(notification) { return AppUINotifications.push(notification); },
  show(message, type, duration) { return AppUINotifications.show(message, type, duration); },
  clear() { return AppUINotifications.clear(); },
  items() { return AppUINotifications.items(); },
};
window.AppUINotificationsFeature = AppUINotificationsFeature;
