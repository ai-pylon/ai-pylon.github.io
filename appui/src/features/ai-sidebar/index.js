/* Integrated AI sidebar feature adapter. */
const AppUIAISidebarFeature = {
  create(options) {
    return AppUIAISidebar.create(options);
  },
  mount({container, sidebar = {}, pipeline, appId}) {
    const config = sidebar.config || {};
    return this.create(AppUIAISidebarConnections.mountOptions({
      container, config, system: pipeline?.ai?.system, appId,
    }));
  },
};
window.AppUIAISidebarFeature = AppUIAISidebarFeature;
