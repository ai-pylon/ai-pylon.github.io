window.AppUIReady.then(() => {
  AppUICatalogView.createApp({
    id: "personal-travel-video",
    title: "Travel Video Studio",
    icon: "🎬",
    apiBase: "/v1/apps/personal/travel_video/",
    listOp: "projects_list",
    itemsKey: "projects",
    kbDetails: false,
    sections: [{ id: "", label: "🎬 Projects" }],
    emptyText: "No travel video projects saved yet.",
    formatItem: (p) => ({
      id: p.id || p.title,
      badge: p.phase || "project",
      badge2: (p.sceneCount || 0) + " scenes",
      title: p.title || "Untitled Project",
      desc: (p.totalSeconds || 0) + "s total · " + (p.unverifiedSceneCount || 0) + " unverified",
      metaLeft: p.id || "",
      metaRight: (p.updatedAt || "").slice(0, 10),
    }),
  });
});
