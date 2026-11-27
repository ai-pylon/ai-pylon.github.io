window.AppUIReady.then(() => {
  const base = "/v1/apps/personal/movie/";
  const el = (t, txt) => { const n = document.createElement(t); if (txt !== undefined) n.textContent = String(txt); return n; };
  async function api(op, args = {}) {
    const r = await AppUIApi.requestResponse(base + op, args, { method: "POST", decode: (x) => x.json() });
    if (!r.data?.ok) throw new Error(r.data?.error || "Request failed");
    return r.data;
  }
  let host;
  async function render() {
    const res = await api("list", { section: "Movie", page: 1, page_size: 50 });
    host.textContent = "";
    host.append(el("h2", "Movie & AVDBS Catalog (" + res.total + ")"));
    for (const item of res.items || []) host.append(el("p", item.title + " — " + item.source_id));
    if (!res.items?.length) host.append(el("p", "No movies archived yet."));
  }
  AppUI.createApp({ id: "personal-movie", title: "Movie & AVDBS", content: { render: (h) => { host = h; host.style.padding = "14px"; } }, statusbar: {} });
  render().catch((e) => { if (host) host.textContent = e.message; });
});
