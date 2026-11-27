window.AppUIReady.then(() => {
  const appId = "knowledge/kb_core";
  const base = "/v1/apps/" + appId + "/";
  const el = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text !== undefined && text !== null) n.textContent = String(text);
    if (cls) n.className = cls;
    return n;
  };
  const btn = (label, fn, cls) => {
    const b = el("button", label, cls);
    b.type = "button";
    b.onclick = fn;
    return b;
  };

  async function api(op, args = {}) {
    const r = await AppUIApi.requestResponse(base + op, args, {
      method: "POST",
      timeout: 120000,
      decode: (res) => res.json(),
    });
    if (!r.data || !r.data.ok) {
      throw new Error(r.data?.error || "KB request failed");
    }
    return r.data;
  }

  const state = {
    tab: "library",
    section: "",
    tag: "",
    collection: "",
    query: "",
    sort: "updated_desc",
    page: 1,
    pageSize: 25,
    sections: [],
    collections: [],
    tags: [],
    selectedId: null,
    reconcileToken: null,
  };

  let navHost, topHost, bodyHost, feedbackEl, searchInput, sortSelect;

  function setFeedback(msg, isError = false) {
    if (!feedbackEl) return;
    feedbackEl.textContent = msg || "";
    feedbackEl.className = isError ? "kb-feedback error" : "kb-feedback";
    feedbackEl.hidden = !msg;
  }

  function renderSidebar() {
    if (!navHost) return;
    navHost.textContent = "";
    const wrap = el("div", null, "kb-nav");

    wrap.append(el("div", "Sections", "kb-nav-heading"));
    const allBtn = btn("All items", () => {
      state.section = "";
      state.tag = "";
      state.collection = "";
      state.page = 1;
      state.tab = "library";
      loadView();
    }, "kb-nav-btn" + (!state.section && !state.tag && !state.collection && state.tab === "library" ? " active" : ""));
    const totalCount = state.sections.reduce((acc, s) => acc + (s.count || 0), 0);
    allBtn.append(el("span", totalCount, "kb-badge"));
    wrap.append(allBtn);

    for (const sec of state.sections) {
      const b = btn(sec.name, () => {
        state.section = sec.name;
        state.tag = "";
        state.collection = "";
        state.page = 1;
        state.tab = "library";
        loadView();
      }, "kb-nav-btn" + (state.section === sec.name && state.tab === "library" ? " active" : ""));
      b.append(el("span", sec.count, "kb-badge"));
      wrap.append(b);
    }

    if (state.collections.length) {
      wrap.append(el("div", "Collections", "kb-nav-heading"));
      for (const col of state.collections.slice(0, 20)) {
        const b = btn(col.name, () => {
          state.section = "";
          state.tag = "";
          state.collection = col.name;
          state.page = 1;
          state.tab = "library";
          loadView();
        }, "kb-nav-btn" + (state.collection === col.name ? " active" : ""));
        b.append(el("span", col.count, "kb-badge"));
        wrap.append(b);
      }
    }

    if (state.tags.length) {
      wrap.append(el("div", "Tags", "kb-nav-heading"));
      for (const t of state.tags.slice(0, 20)) {
        const b = btn("#" + t.name, () => {
          state.section = "";
          state.collection = "";
          state.tag = t.name;
          state.page = 1;
          state.tab = "library";
          loadView();
        }, "kb-nav-btn" + (state.tag === t.name ? " active" : ""));
        b.append(el("span", t.count, "kb-badge"));
        wrap.append(b);
      }
    }

    navHost.append(wrap);
  }

  function renderTopBar() {
    if (!topHost) return;
    topHost.textContent = "";
    const bar = el("div", null, "kb-toolbar");

    const tabs = el("div", null, "kb-tabs");
    for (const [id, label] of [
      ["library", "Library"],
      ["search", "Search"],
      ["maintenance", "Health & Maintenance"],
    ]) {
      tabs.append(btn(label, () => {
        state.tab = id;
        loadView();
      }, "kb-tab" + (state.tab === id ? " active" : "")));
    }
    bar.append(tabs);

    searchInput = el("input");
    searchInput.type = "search";
    searchInput.placeholder = state.tab === "search" ? "Full-text search..." : "Filter library...";
    searchInput.value = state.query;
    searchInput.setAttribute("aria-label", "Search query");
    searchInput.onkeydown = (e) => {
      if (e.key === "Enter") {
        state.query = searchInput.value.trim();
        state.page = 1;
        loadView();
      }
    };
    bar.append(searchInput);

    if (state.tab === "library") {
      sortSelect = el("select");
      sortSelect.setAttribute("aria-label", "Sort order");
      for (const [val, lbl] of [
        ["updated_desc", "Updated (newest)"],
        ["captured_desc", "Captured (newest)"],
        ["title_asc", "Title (A-Z)"],
      ]) {
        const opt = new Option(lbl, val);
        if (state.sort === val) opt.selected = true;
        sortSelect.add(opt);
      }
      sortSelect.onchange = () => {
        state.sort = sortSelect.value;
        state.page = 1;
        loadView();
      };
      bar.append(sortSelect);
    }

    bar.append(btn("Go", () => {
      state.query = searchInput.value.trim();
      state.page = 1;
      loadView();
    }));
    bar.append(btn("+ New Item", openNewItemForm));
    bar.append(btn("Refresh", () => refreshAll()));

    topHost.append(bar);
  }

  async function renderLibrary() {
    const res = await api("list", {
      section: state.section || undefined,
      tag: state.tag || undefined,
      collection: state.collection || undefined,
      query: state.query || undefined,
      sort: state.sort,
      page: state.page,
      page_size: state.pageSize,
    });

    bodyHost.textContent = "";
    bodyHost.append(feedbackEl);

    const headingParts = ["Library"];
    if (state.section) headingParts.push("Section: " + state.section);
    if (state.collection) headingParts.push("Collection: " + state.collection);
    if (state.tag) headingParts.push("Tag: #" + state.tag);
    if (state.query) headingParts.push('Filter: "' + state.query + '"');
    headingParts.push("(" + res.total + " item" + (res.total === 1 ? "" : "s") + ")");
    bodyHost.append(el("h2", headingParts.join(" · ")));

    const list = el("div", null, "kb-list");
    if (!res.items.length) {
      list.append(el("p", "No items found. Use '+ New Item' to add a fixture or entry."));
    }
    for (const item of res.items) {
      const card = el("article", null, "kb-card");
      card.onclick = () => openItem(item.source_id);
      const head = el("div", null, "kb-card-head");
      head.append(el("span", item.title, "kb-card-title"));
      head.append(el("span", item.section, "kb-badge"));
      card.append(head);

      const meta = el("div", null, "kb-card-meta");
      meta.append(el("span", item.source_id));
      if (item.source_type) meta.append(el("span", item.source_type));
      if (item.updated_at) meta.append(el("span", "Updated " + item.updated_at.slice(0, 10)));
      card.append(meta);

      if (item.summary) {
        card.append(el("div", item.summary, "kb-card-summary"));
      }
      if ((item.tags && item.tags.length) || (item.collections && item.collections.length)) {
        const chips = el("div", null, "kb-chip-row");
        for (const c of item.collections || []) chips.append(el("span", c, "kb-chip"));
        for (const t of item.tags || []) chips.append(el("span", "#" + t, "kb-chip"));
        card.append(chips);
      }
      list.append(card);
    }
    bodyHost.append(list);

    const pager = el("div", null, "kb-pager");
    if (state.page > 1) {
      pager.append(btn("Previous", () => { state.page--; loadView(); }));
    }
    pager.append(el("span", "Page " + res.page));
    if (res.has_more) {
      pager.append(btn("Next", () => { state.page++; loadView(); }));
    }
    bodyHost.append(pager);
  }

  async function openItem(sourceId) {
    state.selectedId = sourceId;
    state.tab = "item";
    renderTopBar();
    setFeedback("");
    try {
      const res = await api("item_get", { source_id: sourceId });
      bodyHost.textContent = "";
      bodyHost.append(feedbackEl);

      const actions = el("div", null, "kb-actions");
      actions.append(btn("← Back to Library", () => { state.tab = "library"; loadView(); }));
      actions.append(btn("Delete item", async () => {
        if (!window.confirm("Delete item " + sourceId + "?")) return;
        await api("item_delete", { source_id: sourceId, confirm: true });
        setFeedback("Deleted " + sourceId);
        state.tab = "library";
        await refreshAll();
      }));
      bodyHost.append(actions);

      const grid = el("div", null, "kb-detail-grid");

      const left = el("section", null, "kb-panel");
      left.append(el("h2", res.data.title || sourceId));
      const meta = el("div", null, "kb-card-meta");
      meta.append(el("span", "ID: " + res.source_id));
      meta.append(el("span", "Section: " + res.section));
      if (res.data.sourceType) meta.append(el("span", "Type: " + res.data.sourceType));
      if (res.data.sourceUrl) meta.append(el("span", "URL: " + res.data.sourceUrl));
      left.append(meta);
      left.append(el("h3", "Document (Markdown)"));
      left.append(el("pre", res.markdown || "", "kb-pre"));

      if (res.dynamic_keys && res.dynamic_keys.length) {
        left.append(el("h3", "Dynamic Components"));
        left.append(el("p", res.dynamic_keys.join(", ")));
      }
      if (res.history && res.history.length) {
        left.append(el("h3", "History (" + res.history.length + ")"));
        left.append(el("pre", res.history.map((h) => h.at + " · " + h.action + " (" + h.transactionId + ")").join("\n"), "kb-pre"));
      }
      grid.append(left);

      const right = el("section", null, "kb-panel");
      right.append(el("h3", "Personal Annotations (rev " + res.annotations.revision + ")"));
      const noteRow = el("div", null, "kb-form-row");
      noteRow.append(el("label", "Note"));
      const noteArea = el("textarea");
      noteArea.value = res.annotations.note || "";
      noteRow.append(noteArea);

      const tagsRow = el("div", null, "kb-form-row");
      tagsRow.append(el("label", "Tags (comma-separated)"));
      const tagsInput = el("input");
      tagsInput.value = (res.annotations.tags || []).join(", ");
      tagsRow.append(tagsInput);

      const colsRow = el("div", null, "kb-form-row");
      colsRow.append(el("label", "Collections (comma-separated)"));
      const colsInput = el("input");
      colsInput.value = (res.annotations.collections || []).join(", ");
      colsRow.append(colsInput);

      const saveBtn = btn("Save Annotations", async () => {
        try {
          const tags = tagsInput.value.split(",").map((s) => s.trim()).filter(Boolean);
          const cols = colsInput.value.split(",").map((s) => s.trim()).filter(Boolean);
          await api("annotate", {
            source_id: sourceId,
            note: noteArea.value,
            tags,
            collections: cols,
            expected_revision: res.annotations.revision,
            confirm: true,
          });
          setFeedback("Annotations saved.");
          await refreshSidebarMeta();
          await openItem(sourceId);
        } catch (err) {
          setFeedback(err.message, true);
        }
      });
      right.append(noteRow, tagsRow, colsRow, saveBtn);
      grid.append(right);

      bodyHost.append(grid);
    } catch (err) {
      setFeedback(err.message, true);
    }
  }

  function openNewItemForm() {
    state.tab = "new";
    renderTopBar();
    bodyHost.textContent = "";
    bodyHost.append(feedbackEl);

    const panel = el("section", null, "kb-panel");
    panel.append(el("h2", "Create / Update KB Item"));

    const fields = {};
    for (const [key, label, placeholder, isArea] of [
      ["source_id", "Source ID", "e.g. note:hello-world", false],
      ["section", "Section", "e.g. Web, Photo, Movie, Book", false],
      ["title", "Title", "Human-readable title", false],
      ["source_url", "Source URL (optional)", "https://...", false],
      ["summary", "Summary (optional)", "Short summary", false],
      ["body", "Body (Markdown)", "Knowledge content...", true],
    ]) {
      const row = el("div", null, "kb-form-row");
      row.append(el("label", label));
      const inp = el(isArea ? "textarea" : "input");
      inp.placeholder = placeholder;
      fields[key] = inp;
      row.append(inp);
      panel.append(row);
    }

    const actions = el("div", null, "kb-actions");
    actions.append(btn("Save Item", async () => {
      try {
        const res = await api("item_put", {
          source_id: fields.source_id.value.trim(),
          section: fields.section.value.trim(),
          title: fields.title.value.trim(),
          source_url: fields.source_url.value.trim(),
          summary: fields.summary.value.trim(),
          body: fields.body.value,
          confirm: true,
        });
        setFeedback("Saved " + res.source_id);
        await refreshSidebarMeta();
        await openItem(res.source_id);
      } catch (err) {
        setFeedback(err.message, true);
      }
    }));
    actions.append(btn("Cancel", () => { state.tab = "library"; loadView(); }));
    panel.append(actions);
    bodyHost.append(panel);
  }

  async function renderSearch() {
    bodyHost.textContent = "";
    bodyHost.append(feedbackEl);
    bodyHost.append(el("h2", "Full-Text Search"));

    if (!state.query) {
      bodyHost.append(el("p", "Enter terms in the search bar above and press Enter."));
      return;
    }

    const res = await api("search", {
      query: state.query,
      section: state.section || undefined,
      limit: 50,
    });
    bodyHost.append(el("p", res.total + " match(es) via " + res.mode));

    const list = el("div", null, "kb-list");
    for (const hit of res.results) {
      const card = el("article", null, "kb-card");
      card.onclick = () => openItem(hit.source_id);
      const head = el("div", null, "kb-card-head");
      head.append(el("span", hit.title, "kb-card-title"));
      head.append(el("span", hit.section + " · " + hit.component, "kb-badge"));
      card.append(head);
      if (hit.excerpt) card.append(el("div", hit.excerpt, "kb-card-summary"));
      list.append(card);
    }
    bodyHost.append(list);
  }

  async function renderMaintenance() {
    const [st, h] = await Promise.all([api("status"), api("health")]);
    bodyHost.textContent = "";
    bodyHost.append(feedbackEl);

    const panel = el("section", null, "kb-panel");
    panel.append(el("h2", "Archive Health & Maintenance"));
    panel.append(el("p", "KB Root: " + st.kb_root));
    panel.append(el("p", "Indexed items: " + h.indexed_count + " · Discovered bundles: " + h.discovered_count + " · Healthy: " + (h.healthy ? "Yes" : "No")));
    panel.append(el("p", "FTS5 Search Index: " + (h.search_index.exists ? h.search_index.documents + " row(s)" : "Not built yet")));

    const actions = el("div", null, "kb-actions");
    actions.append(btn("Rebuild FTS5 Search Index", async () => {
      try {
        const r = await api("search_rebuild", { confirm: true });
        setFeedback("Rebuilt FTS5 index (" + r.indexed + " item(s)).");
        await renderMaintenance();
      } catch (err) {
        setFeedback(err.message, true);
      }
    }));

    const previewPre = el("pre", "", "kb-pre");
    const applyBtn = btn("Apply Reconcile", async () => {
      if (!state.reconcileToken) return;
      try {
        const r = await api("reconcile_apply", { token: state.reconcileToken, confirm: true });
        state.reconcileToken = null;
        setFeedback("Reconciled index (" + r.indexed_count + " item(s)).");
        await refreshAll();
      } catch (err) {
        setFeedback(err.message, true);
      }
    });
    applyBtn.hidden = true;

    actions.append(btn("Preview Index Reconcile", async () => {
      try {
        const p = await api("reconcile_preview");
        state.reconcileToken = p.can_apply ? p.token : null;
        applyBtn.hidden = !p.can_apply;
        previewPre.textContent = JSON.stringify(p, null, 2);
      } catch (err) {
        setFeedback(err.message, true);
      }
    }));
    actions.append(applyBtn);
    panel.append(actions, previewPre);

    if (!h.healthy) {
      panel.append(el("h3", "Findings"));
      panel.append(el("pre", JSON.stringify({
        missing_bundles: h.missing_bundles,
        unindexed_bundles: h.unindexed_bundles,
        duplicates: h.duplicates,
        bundle_errors: h.bundle_errors,
      }, null, 2), "kb-pre"));
    }

    bodyHost.append(panel);
  }

  async function loadView() {
    renderSidebar();
    renderTopBar();
    setFeedback("");
    try {
      if (state.tab === "library") await renderLibrary();
      else if (state.tab === "search") await renderSearch();
      else if (state.tab === "maintenance") await renderMaintenance();
    } catch (err) {
      setFeedback(err.message, true);
    }
  }

  async function refreshSidebarMeta() {
    const [secRes, colRes] = await Promise.all([api("sections"), api("collections")]);
    state.sections = secRes.sections || [];
    state.collections = colRes.collections || [];
    state.tags = colRes.tags || [];
    renderSidebar();
  }

  async function refreshAll() {
    try {
      await refreshSidebarMeta();
      await loadView();
    } catch (err) {
      setFeedback(err.message, true);
    }
  }

  AppUI.createApp({
    id: "knowledge-kb-core",
    title: "Personal KB",
    leftSidebar: {
      width: 260,
      tabs: [{
        id: "nav",
        label: "Archive",
        active: true,
        render: (host) => { navHost = host; },
      }],
    },
    content: {
      render: (host) => {
        topHost = document.getElementById("app-content-top") || host;
        bodyHost = el("div", null, "kb-body");
        feedbackEl = el("div", "", "kb-feedback");
        feedbackEl.setAttribute("role", "status");
        feedbackEl.hidden = true;
        host.append(bodyHost);
      },
    },
    statusbar: {},
  });

  refreshAll();
}).catch((err) => {
  const host = document.getElementById("app-content-body");
  if (host) host.textContent = "Personal KB unavailable: " + String(err.message || err);
});
