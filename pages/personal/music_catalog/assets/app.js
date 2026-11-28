window.AppUIReady.then(() => {
  AppUICatalogView.createApp({
    id: "personal-music-catalog",
    title: "Music & Classical Catalog",
    icon: "🎼",
    apiBase: "/v1/apps/personal/music_catalog/",
    sections: [
      { id: "Classical", label: "🎻 Classical" },
      { id: "Music", label: "🎵 Music" },
    ],
    emptyText: "No albums cataloged yet.",
  });
});
