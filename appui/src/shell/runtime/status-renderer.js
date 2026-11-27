/* Status-bar composition is separate from page and shell lifecycle. */
window.AppUIShellStatusRenderer = {
  mountRight({config, elements, renderSlot, trackCleanup, right}) {
    const daemonConfig = this.serviceConfig(config);
    const daemonStatusFeature = window.AppUIDaemonStatus;
    if (daemonStatusFeature && daemonConfig) {
      const daemons = Array.isArray(daemonConfig) ? daemonConfig : [daemonConfig];
      const indicators = daemons.filter(Boolean).map(config => daemonStatusFeature.mount(elements.statusRight, config));
      trackCleanup(() => indicators.forEach(i => i?.destroy?.()));
    }
    renderSlot(right, elements.statusRight);
    // Dark/light theme toggle in statusbar
    if (elements.statusRight && window.AppUIShellThemeToggle) {
      trackCleanup(AppUIShellThemeToggle.mount(elements.statusRight));
    }
  },
  serviceConfig(statusBar) {
    if (!statusBar || typeof statusBar !== 'object') return null;
    if (statusBar.services) {
      return Object.assign({}, statusBar.serviceStatus || {}, {services: statusBar.services});
    }
    return statusBar.serviceStatus || statusBar.daemon || statusBar.daemons || null;
  },
  mount({config, elements, region, renderSlot, trackCleanup}) {
    if (config.status) {
      renderSlot(config.status, elements.statusMain);
      return null;
    }
    if (config.render) {
      renderSlot(container => config.render(container), elements.statusMain);
      return null;
    }
    const mounted = region.mountDefault({component: AppUIStatusBar, sections: config.sections});
    if (mounted.logButton) trackCleanup(() => mounted.logButton.destroy());
    return mounted.statusBar;
  },
};
