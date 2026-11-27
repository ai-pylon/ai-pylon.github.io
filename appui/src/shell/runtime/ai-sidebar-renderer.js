/* AI-sidebar feature mounting and its unavailable-feature fallback. */
window.AppUIShellAISidebarRenderer = {
  mount({container, sidebar, pipeline, appId}) {
    return AppUIAISidebarFeature.mount({container, sidebar, pipeline, appId});
  },
};
