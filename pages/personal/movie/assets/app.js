// Movie & AVDBS Catalog — Rich AppUI workspace with grid/list, live detail inspector, and quick tools.
window.AppUIReady.then(() => {
  const MOVIE_API = "/v1/apps/personal/movie/";
  const KB_API = "/v1/apps/knowledge/kb_core/";

  const el = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = String(text);
    if (cls) n.className = cls;
    return n;
  };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  async function post(url, args = {}) {
    const r = await AppUIApi.requestResponse(url, args, {
      method: "POST",
      timeout: 60000,
      decode: (x) => x.json(),
    });
    if (!r.data?.ok) throw new Error(r.data?.error || "Request failed");
    return r.data;
  }

  const state = {
    section: "Movie",
    query: "",
    page: 1,
    pageSize: 48,
    view: "grid",
    items: [],
    total: 0,
    counts: { Movie: "…", avdbs: "…" },
    selected: null,
  };

  let sbEl, mainEl, detailEl;

  function parseYearAndSource(item) {
    const m = String(item.title || "").match(/^((?:19|20)\d{2})\s+(.+)$/);
    const year = m ? m[1] : "";
    const cleanTitle = m ? m[2] : (item.title || item.source_id || "Untitled");
    const sid = String(item.source_id || "");
    const src = sid.startsWith("tmdb:") ? "TMDB" : sid.startsWith("avdbs") ? "AVDBS" : sid.includes("imdb") ? "IMDb" : sid.includes("cine21") ? "Cine21" : "KB";
    return { year, cleanTitle, src };
  }

  function renderSidebar() {
    if (!sbEl) return;
    sbEl.innerHTML =
      '<div class="mv-sb">' +
        '<h3>Library</h3>' +
        '<div class="mv-nav">' +
          '<button type="button" class="mv-nav-btn' + (state.section === "Movie" ? " on" : "") + '" data-sec="Movie"><span>🎬 Movies</span><span class="mv-cnt">' + esc(state.counts.Movie) + '</span></button>' +
          '<button type="button" class="mv-nav-btn' + (state.section === "avdbs" ? " on" : "") + '" data-sec="avdbs"><span>📀 AVDBS</span><span class="mv-cnt">' + esc(state.counts.avdbs) + '</span></button>' +
        '</div>' +
        '<h3>Search</h3>' +
        '<input class="mv-input" id="mv-search" type="search" placeholder="Search title, director…" value="' + esc(state.query) + '">' +
        '<button type="button" class="mv-btn primary" id="mv-search-go">Search</button>' +
        '<h3>View</h3>' +
        '<div class="mv-seg">' +
          '<button type="button" data-view="grid" class="' + (state.view === "grid" ? "on" : "") + '">Grid</button>' +
          '<button type="button" data-view="list" class="' + (state.view === "list" ? "on" : "") + '">List</button>' +
        '</div>' +
        '<h3>Actions</h3>' +
        '<button type="button" class="mv-btn" id="mv-add-btn">+ Add Movie / AVDBS</button>' +
      '</div>';

    sbEl.querySelectorAll("[data-sec]").forEach((b) => {
      b.onclick = () => { state.section = b.getAttribute("data-sec"); state.page = 1; loadList(); };
    });
    sbEl.querySelectorAll("[data-view]").forEach((b) => {
      b.onclick = () => { state.view = b.getAttribute("data-view"); renderSidebar(); renderMain(); };
    });
    const inp = sbEl.querySelector("#mv-search");
    const doSearch = () => { state.query = inp.value.trim(); state.page = 1; loadList(); };
    inp.onkeydown = (e) => { if (e.key === "Enter") doSearch(); };
    sbEl.querySelector("#mv-search-go").onclick = doSearch;
    sbEl.querySelector("#mv-add-btn").onclick = openAddDialog;
  }

  function renderMain(loadingMsg) {
    if (!mainEl) return;
    const totalPages = Math.max(1, Math.ceil((state.total || 0) / state.pageSize));
    const secLabel = state.section === "Movie" ? "🎬 Movies" : "📀 AVDBS";

    let bodyHtml = "";
    if (loadingMsg) {
      bodyHtml = '<div class="mv-empty">' + esc(loadingMsg) + '</div>';
    } else if (!state.items.length) {
      bodyHtml = '<div class="mv-empty">No records match your filter.</div>';
    } else if (state.view === "grid") {
      bodyHtml = '<div class="mv-grid">' + state.items.map((item, idx) => {
        const { year, cleanTitle, src } = parseYearAndSource(item);
        const active = state.selected && state.selected.source_id === item.source_id ? " active" : "";
        return (
          '<article class="mv-card' + active + '" data-idx="' + idx + '">' +
            '<div class="mv-card-top">' +
              (year ? '<span class="mv-badge year">' + esc(year) + '</span>' : '<span class="mv-badge">' + esc(src) + '</span>') +
              '<span class="mv-badge">' + esc(src) + '</span>' +
            '</div>' +
            '<div class="mv-card-title" title="' + esc(item.title) + '">' + esc(cleanTitle) + '</div>' +
            '<div class="mv-card-meta">' +
              '<span class="mv-mono">' + esc(item.source_id) + '</span>' +
              '<span>' + esc((item.updated_at || item.captured_at || "").slice(0, 10)) + '</span>' +
            '</div>' +
          '</article>'
        );
      }).join("") + '</div>';
    } else {
      bodyHtml = '<div class="mv-list">' + state.items.map((item, idx) => {
        const { year, cleanTitle, src } = parseYearAndSource(item);
        const active = state.selected && state.selected.source_id === item.source_id ? " active" : "";
        return (
          '<div class="mv-row' + active + '" data-idx="' + idx + '">' +
            '<span class="mv-badge' + (year ? " year" : "") + '">' + esc(year || src) + '</span>' +
            '<span class="mv-card-title" style="-webkit-line-clamp:1">' + esc(cleanTitle) + '</span>' +
            '<span class="mv-badge">' + esc(src) + '</span>' +
            '<span style="font-size:11px;color:var(--text-muted)">' + esc((item.updated_at || item.captured_at || "").slice(0, 10)) + '</span>' +
          '</div>'
        );
      }).join("") + '</div>';
    }

    mainEl.innerHTML =
      '<div class="mv-main">' +
        '<div class="mv-topbar">' +
          '<div>' +
            '<h1>' + secLabel + ' <span style="font-weight:400;color:var(--text-muted);font-size:14px">(' + state.total + ')</span></h1>' +
            '<div class="mv-sub">' + (state.query ? 'Filter: "' + esc(state.query) + '" · ' : '') + 'Click any item to inspect full metadata, cast, and synopsis.</div>' +
          '</div>' +
          '<div class="mv-pager">' +
            '<button type="button" class="mv-btn sm" id="mv-prev"' + (state.page <= 1 ? " disabled" : "") + '>← Prev</button>' +
            '<span style="font-size:12px;color:var(--text-muted)">Page ' + state.page + ' / ' + totalPages + '</span>' +
            '<button type="button" class="mv-btn sm" id="mv-next"' + (state.page >= totalPages ? " disabled" : "") + '>Next →</button>' +
          '</div>' +
        '</div>' +
        bodyHtml +
        '<dialog class="mv-dialog" id="mv-add-dlg">' +
          '<form id="mv-add-form">' +
            '<div class="mv-dlg-head"><h3>Add Movie / AVDBS Record</h3><button type="button" class="mv-btn sm" id="mv-dlg-x">✕</button></div>' +
            '<div class="mv-dlg-body">' +
              '<label class="mv-field">Section<select class="mv-input" name="section"><option value="Movie">Movie</option><option value="avdbs">AVDBS</option></select></label>' +
              '<label class="mv-field">Source ID<input class="mv-input" name="source_id" required placeholder="tmdb:12345"></label>' +
              '<label class="mv-field">Title<input class="mv-input" name="title" required placeholder="2024 Film Title"></label>' +
              '<label class="mv-field">Year (optional)<input class="mv-input" name="year" type="number" placeholder="2024"></label>' +
              '<label class="mv-field">Director (optional)<input class="mv-input" name="director" placeholder="Director name"></label>' +
              '<label class="mv-field">Source URL (optional)<input class="mv-input" name="source_url" placeholder="https://www.themoviedb.org/movie/..."></label>' +
              '<label class="mv-field">Synopsis (optional)<textarea name="synopsis" rows="3"></textarea></label>' +
            '</div>' +
            '<div class="mv-dlg-foot"><button type="button" class="mv-btn" id="mv-dlg-cancel">Cancel</button><button type="submit" class="mv-btn primary">Save</button></div>' +
          '</form>' +
        '</dialog>' +
      '</div>';

    mainEl.querySelector("#mv-prev").onclick = () => { if (state.page > 1) { state.page--; loadList(); } };
    mainEl.querySelector("#mv-next").onclick = () => { if (state.page < totalPages) { state.page++; loadList(); } };
    mainEl.querySelectorAll("[data-idx]").forEach((node) => {
      node.onclick = () => {
        const item = state.items[Number(node.getAttribute("data-idx"))];
        if (item) selectItem(item);
      };
    });
  }

  function renderDetailEmpty() {
    if (!detailEl) return;
    detailEl.innerHTML = '<div class="mv-detail"><div class="mv-empty">Select a movie or AVDBS entry<br>to view full metadata, cast, and synopsis.</div></div>';
  }

  async function selectItem(item) {
    state.selected = item;
    renderMain();
    if (!detailEl) return;
    try {
      const rEl = document.getElementById("app-right");
      if (rEl && rEl.classList.contains("ai-app-hidden")) AppUI.toggleRightSidebar();
    } catch (_) {}

    detailEl.innerHTML = '<div class="mv-detail"><div class="mv-empty">Loading details…</div></div>';
    try {
      const res = await post(KB_API + "item_get", { section: item.section || state.section, source_id: item.source_id });
      const d = res.data || {};
      const titleKo = d.titleKo || d.title || item.title || item.source_id;
      const titleOrg = d.titleOrg && d.titleOrg !== titleKo ? d.titleOrg : "";
      const dirs = Array.isArray(d.directors) ? d.directors : (d.director ? [d.director] : []);
      const genres = Array.isArray(d.genres) ? d.genres : [];
      const cast = Array.isArray(d.cast) ? d.cast : [];
      const body = String(d.bodyMarkdown || d.synopsis || "").replace(/^##\s*Synopsis\s*/i, "").trim();

      detailEl.innerHTML =
        '<div class="mv-detail">' +
          '<div>' +
            '<h2>' + esc(titleKo) + '</h2>' +
            (titleOrg ? '<div class="mv-detail-sub" style="margin-top:3px">' + esc(titleOrg) + '</div>' : '') +
          '</div>' +
          '<div class="mv-chips">' +
            (d.year ? '<span class="mv-badge year">' + esc(d.year) + '</span>' : '') +
            (d.rating != null ? '<span class="mv-badge star">★ ' + esc(d.rating) + '</span>' : '') +
            (d.language ? '<span class="mv-badge">' + esc(d.language) + '</span>' : '') +
            genres.map((g) => '<span class="mv-badge">' + esc(g) + '</span>').join("") +
          '</div>' +
          (dirs.length ? '<div><div class="mv-sec-lbl">Director</div><div class="mv-chips">' + dirs.map((x) => '<span class="mv-badge">' + esc(x) + '</span>').join("") + '</div></div>' : '') +
          (cast.length ? '<div><div class="mv-sec-lbl">Cast</div><div class="mv-chips">' + cast.slice(0, 12).map((x) => '<span class="mv-badge">' + esc(x) + '</span>').join("") + (cast.length > 12 ? '<span class="mv-badge">+' + (cast.length - 12) + '</span>' : '') + '</div></div>' : '') +
          (d.folder ? '<div><div class="mv-sec-lbl">Library Folder</div><div class="mv-box mv-mono" style="font-size:11px">' + esc(d.folder) + '</div></div>' : '') +
          (body ? '<div><div class="mv-sec-lbl">Synopsis &amp; Notes</div><div class="mv-box">' + esc(body) + '</div></div>' : '') +
          '<div><div class="mv-sec-lbl">Record</div><div class="mv-detail-sub mv-mono">' + esc(item.source_id) + '</div></div>' +
          ((d.source || item.source_url)
            ? '<a class="mv-btn primary" style="text-align:center;text-decoration:none" target="_blank" rel="noopener noreferrer" href="' + esc(d.source || item.source_url) + '">Open Source Page ↗</a>'
            : '') +
        '</div>';
    } catch (e) {
      detailEl.innerHTML = '<div class="mv-detail"><div class="mv-empty">Could not load details: ' + esc(e.message) + '</div></div>';
    }
  }

  function openAddDialog() {
    const dlg = mainEl && mainEl.querySelector("#mv-add-dlg");
    if (!dlg) return;
    const form = dlg.querySelector("#mv-add-form");
    form.reset();
    form.querySelector('select[name="section"]').value = state.section;
    dlg.querySelector("#mv-dlg-x").onclick = () => dlg.close();
    dlg.querySelector("#mv-dlg-cancel").onclick = () => dlg.close();
    form.onsubmit = async (ev) => {
      ev.preventDefault();
      const fd = new FormData(form);
      const payload = {
        section: fd.get("section"),
        source_id: String(fd.get("source_id") || "").trim(),
        title: String(fd.get("title") || "").trim(),
        confirm: true,
      };
      if (fd.get("year")) payload.year = Number(fd.get("year"));
      if (String(fd.get("director") || "").trim()) payload.director = String(fd.get("director")).trim();
      if (String(fd.get("source_url") || "").trim()) payload.source_url = String(fd.get("source_url")).trim();
      if (String(fd.get("synopsis") || "").trim()) payload.synopsis = String(fd.get("synopsis")).trim();
      try {
        await post(MOVIE_API + "save_movie", payload);
        dlg.close();
        loadList();
      } catch (e) {
        window.alert(e.message);
      }
    };
    dlg.showModal();
  }

  async function loadList() {
    renderSidebar();
    renderMain("Loading " + state.section + " catalog…");
    try {
      const res = await post(MOVIE_API + "list", {
        section: state.section,
        query: state.query,
        page: state.page,
        page_size: state.pageSize,
      });
      state.items = res.items || [];
      state.total = Number(res.total || 0);
      if (!state.query) state.counts[state.section] = state.total;
      renderSidebar();
      renderMain();
      if (state.items.length && (!state.selected || !state.items.some((x) => x.source_id === state.selected.source_id))) {
        selectItem(state.items[0]);
      }
    } catch (e) {
      renderMain("Error: " + e.message);
    }
  }

  AppUI.createApp({
    id: "personal-movie",
    title: "Movie & AVDBS",
    leftSidebar: { width: 250, tabs: [{ id: "catalog", label: "Catalog", active: true, render: (h) => { sbEl = h; renderSidebar(); } }] },
    rightSidebar: { width: 340, title: "Details", tabs: [{ id: "details", label: "Details", active: true, render: (h) => { detailEl = h; renderDetailEmpty(); } }] },
    content: { render: (h) => { mainEl = h; loadList(); } },
    statusbar: {},
  });

  // Pre-fetch the other section's count quietly
  post(MOVIE_API + "list", { section: "avdbs", page: 1, page_size: 1 })
    .then((r) => { state.counts.avdbs = Number(r.total || 0); renderSidebar(); })
    .catch(() => {});
});
