window.AppUIReady.then(() => {
  const base = "/v1/apps/personal/movie/";
  const el = (t, txt, style) => {
    const n = document.createElement(t);
    if (txt !== undefined) n.textContent = String(txt);
    if (style) n.style.cssText = style;
    return n;
  };
  async function api(op, args = {}) {
    const r = await AppUIApi.requestResponse(base + op, args, {
      method: "POST",
      timeout: 60000,
      decode: (x) => x.json(),
    });
    if (!r.data?.ok) throw new Error(r.data?.error || "Request failed");
    return r.data;
  }

  let section = "Movie";
  let query = "";
  let page = 1;
  const pageSize = 50;

  function mount(host) {
    host.style.cssText = "padding:18px 22px;max-width:1100px;margin:0 auto;display:flex;flex-direction:column;gap:12px";
    const hdr = el("div", "", "display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px");
    const heading = el("h2", "Movie & AVDBS Catalog", "margin:0;font-size:18px");

    const bar = el("div", "", "display:flex;align-items:center;gap:8px;flex-wrap:wrap");
    const mkBtn = (label, fn) => {
      const b = el("button", label, "padding:6px 11px;border-radius:7px;border:1px solid var(--border);background:var(--bg-elevated);color:var(--text-primary);cursor:pointer;font-size:12px");
      b.type = "button";
      b.onclick = fn;
      return b;
    };
    const btnMovie = mkBtn("Movie", () => { section = "Movie"; page = 1; load(); });
    const btnAvdbs = mkBtn("AVDBS", () => { section = "avdbs"; page = 1; load(); });
    const search = el("input", "", "padding:6px 10px;border-radius:7px;border:1px solid var(--border);background:var(--bg-primary);color:var(--text-primary);font-size:12.5px;min-width:220px");
    search.type = "search";
    search.placeholder = "Search title…";
    search.onkeydown = (e) => { if (e.key === "Enter") { query = search.value.trim(); page = 1; load(); } };
    const btnSearch = mkBtn("Search", () => { query = search.value.trim(); page = 1; load(); });
    bar.append(btnMovie, btnAvdbs, search, btnSearch);
    hdr.append(heading, bar);

    const status = el("div", "Loading catalog…", "font-size:12px;color:var(--text-muted)");
    const list = el("div", "", "display:flex;flex-direction:column;gap:4px");
    const pager = el("div", "", "display:flex;align-items:center;gap:8px;margin-top:4px");
    const prevBtn = mkBtn("← Prev", () => { if (page > 1) { page--; load(); } });
    const pageInfo = el("span", "", "font-size:12px;color:var(--text-muted)");
    const nextBtn = mkBtn("Next →", () => { page++; load(); });
    pager.append(prevBtn, pageInfo, nextBtn);

    host.replaceChildren(hdr, status, list, pager);

    async function load() {
      btnMovie.style.borderColor = section === "Movie" ? "var(--accent)" : "var(--border)";
      btnAvdbs.style.borderColor = section === "avdbs" ? "var(--accent)" : "var(--border)";
      status.textContent = "Loading " + section + " records…";
      try {
        const res = await api("list", { section, query, page, page_size: pageSize });
        const total = Number(res.total || 0);
        const items = res.items || [];
        heading.textContent = "Movie & AVDBS Catalog (" + total + ")";
        status.textContent = section + " · showing " + items.length + " of " + total;
        list.replaceChildren();
        if (!items.length) {
          list.append(el("p", "No records found.", "color:var(--text-muted);font-size:13px"));
        } else {
          for (const item of items) {
            const row = el("div", "", "display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 12px;border:1px solid var(--border);border-radius:8px;background:var(--bg-elevated)");
            const left = el("div", "", "min-width:0;flex:1");
            const t = el("div", item.title || item.source_id, "font-size:13px;font-weight:600;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap");
            const sub = el("div", item.source_id + (item.updated_at ? " · " + item.updated_at.slice(0, 10) : ""), "font-size:11px;color:var(--text-muted)");
            left.append(t, sub);
            row.append(left);
            if (item.source_url) {
              const a = el("a", "Source ↗", "font-size:11px;color:var(--accent);text-decoration:none;flex:0 0 auto");
              a.href = item.source_url;
              a.target = "_blank";
              a.rel = "noopener noreferrer";
              row.append(a);
            }
            list.append(row);
          }
        }
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        pageInfo.textContent = "Page " + page + " / " + totalPages;
        prevBtn.disabled = page <= 1;
        nextBtn.disabled = page >= totalPages;
      } catch (e) {
        status.textContent = "Error: " + e.message;
      }
    }
    load();
  }

  AppUI.createApp({
    id: "personal-movie",
    title: "Movie & AVDBS",
    content: { render: mount },
    statusbar: {},
  });
});
