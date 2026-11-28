window.AppUIReady.then(() => {
  AppUICatalogView.createApp({
    id: "personal-book",
    title: "Book Catalog",
    icon: "📚",
    apiBase: "/v1/apps/personal/book/",
    sections: [{ id: "Book", label: "📚 Books" }],
    emptyText: "No books archived yet.",
  });
});
