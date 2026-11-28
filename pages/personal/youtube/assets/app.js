window.AppUIReady.then(() => {
  AppUICatalogView.createApp({
    id: "personal-youtube",
    title: "YouTube Archive",
    icon: "▶️",
    apiBase: "/v1/apps/personal/youtube/",
    sections: [{ id: "YouTube", label: "▶️ YouTube" }],
    emptyText: "No YouTube videos archived yet.",
  });
});
