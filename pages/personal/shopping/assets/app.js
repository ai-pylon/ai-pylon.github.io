window.AppUIReady.then(() => {
  AppUICatalogView.createApp({
    id: "personal-shopping",
    title: "Shopping Archive",
    icon: "🛍️",
    apiBase: "/v1/apps/personal/shopping/",
    sections: [{ id: "Shopping", label: "🛍️ Shopping" }],
    emptyText: "No shopping items archived yet.",
  });
});
