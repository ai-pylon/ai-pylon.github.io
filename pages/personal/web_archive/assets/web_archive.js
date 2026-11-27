window.AppUIReady.then(() => {
  const appId = "personal/web_archive";
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
      throw new Error(r.data?.error || "Web Archive request failed");
    }
    return r.data;
  }

  let navHost, bodyHost, feedbackEl;
  const state = { tab: "ingest", keepStatus: "queued", section: "" };

  function setFeedback(msg, isError = false) {
    if (!feedbackEl) return;
    feedbackEl.textContent = msg || "";
    feedbackEl.className = isError ? "wa-feedback error" : "wa-feedback";
    feedbackEl.hidden = !msg;
  }

  function renderNav() {
    if (!navHost) return;
    navHost.textContent = "";
    const wrap = el("div", null, "wa-nav");
    for (const [id, label] of [
      ["ingest", "Capture URL / Manual"],
      ["keep", "Keep Seed Queue"],
      ["archive", "Archived Web & Blog"],
      ["duplicates", "Duplicate Check"],
    ]) {
      wrap.append(btn(label, () => {
        state.tab = id;
        renderView();
      }, "wa-nav-btn" + (state.tab === id ? " active" : "")));
    }
    navHost.append(wrap);
  }

  function renderIngest() {
    bodyHost.textContent = "";
    bodyHost.append(feedbackEl);

    const urlPanel = el("section", null, "wa-panel");
    urlPanel.append(el("h2", "Capture Web / FMKorea / Naver Blog URL"));
    const urlRow = el("div", null, "wa-row");
    urlRow.append(el("label", "URL"));
    const urlInput = el("input");
    urlInput.type = "url";
    urlInput.placeholder = "https://...";
    urlRow.append(urlInput);

    const previewPre = el("pre", "", "wa-pre");
    const urlActions = el("div", null, "wa-actions");
    urlActions.append(btn("Classify URL", async () => {
      try {
        const res = await api("classify", { url: urlInput.value.trim() });
        previewPre.textContent = JSON.stringify(res, null, 2);
        setFeedback("Matched adapter: " + res.adapter + " (" + res.section + ")");
      } catch (err) {
        setFeedback(err.message, true);
      }
    }));
    urlActions.append(btn("Capture into KB", async () => {
      try {
        const res = await api("capture_url", { url: urlInput.value.trim(), confirm: true });
        previewPre.textContent = JSON.stringify(res, null, 2);
        setFeedback("Captured " + res.source_id + " (" + res.title + ")");
      } catch (err) {
        setFeedback(err.message, true);
      }
    }));
    urlPanel.append(urlRow, urlActions, previewPre);

    const manualPanel = el("section", null, "wa-panel");
    manualPanel.append(el("h2", "Save Manual Note / Excerpt"));
    const mTitle = el("input");
    mTitle.placeholder = "Title";
    const mUrl = el("input");
    mUrl.placeholder = "Source URL (optional)";
    const mBody = el("textarea");
    mBody.placeholder = "Markdown body...";
    const r1 = el("div", null, "wa-row"); r1.append(el("label", "Title"), mTitle);
    const r2 = el("div", null, "wa-row"); r2.append(el("label", "Source URL"), mUrl);
    const r3 = el("div", null, "wa-row"); r3.append(el("label", "Body"), mBody);
    manualPanel.append(r1, r2, r3, btn("Save Manual Entry", async () => {
      try {
        const res = await api("manual_save", {
          title: mTitle.value.trim(),
          source_url: mUrl.value.trim(),
          body: mBody.value,
          confirm: true,
        });
        setFeedback("Saved manual item: " + res.source_id);
        mTitle.value = ""; mUrl.value = ""; mBody.value = "";
      } catch (err) {
        setFeedback(err.message, true);
      }
    }));

    bodyHost.append(urlPanel, manualPanel);
  }

  async function renderKeep() {
    const res = await api("keep_list", { status: state.keepStatus, limit: 50 });
    bodyHost.textContent = "";
    bodyHost.append(feedbackEl);

    const panel = el("section", null, "wa-panel");
    panel.append(el("h2", "Google Keep Seed Queue (" + res.queued + " queued)"));

    const addUrl = el("input");
    addUrl.placeholder = "URL to enqueue (or leave blank for text note)";
    const addTitle = el("input");
    addTitle.placeholder = "Optional title";
    const addRow = el("div", null, "wa-actions");
    addRow.append(addUrl, addTitle, btn("Enqueue", async () => {
      try {
        await api("keep_enqueue", {
          items: [{ url: addUrl.value.trim(), title: addTitle.value.trim() }],
          confirm: true,
        });
        setFeedback("Enqueued item.");
        renderKeep();
      } catch (err) {
        setFeedback(err.message, true);
      }
    }));

    const filterRow = el("div", null, "wa-actions");
    for (const st of ["queued", "all", "pending", "removed"]) {
      filterRow.append(btn(st, () => { state.keepStatus = st; renderKeep(); }));
    }
    panel.append(addRow, filterRow);

    const list = el("div", null, "wa-list");
    if (!res.items.length) list.append(el("p", "Queue is empty."));
    for (const item of res.items) {
      const card = el("article", null, "wa-card");
      const head = el("div", null, "wa-card-head");
      head.append(el("span", item.title || item.url || item.key));
      head.append(el("span", item.status));
      card.append(head);
      if (item.url) card.append(el("div", item.url, "wa-meta"));
      if (item.queued) {
        card.append(btn("Remove", async () => {
          try {
            await api("keep_remove", { keys: [item.key], confirm: true });
            setFeedback("Removed " + item.key);
            renderKeep();
          } catch (err) {
            setFeedback(err.message, true);
          }
        }));
      }
      list.append(card);
    }
    panel.append(list);
    bodyHost.append(panel);
  }

  async function renderArchive() {
    const res = await api("list", { section: state.section || undefined, page: 1, page_size: 50 });
    bodyHost.textContent = "";
    bodyHost.append(feedbackEl);

    const panel = el("section", null, "wa-panel");
    panel.append(el("h2", "Archived Web & Blog (" + res.total + ")"));
    const filters = el("div", null, "wa-actions");
    for (const [val, lbl] of [["", "All"], ["Web", "Web"], ["Blog", "Blog"]]) {
      filters.append(btn(lbl, () => { state.section = val; renderArchive(); }));
    }
    panel.append(filters);

    const list = el("div", null, "wa-list");
    if (!res.items.length) list.append(el("p", "No archived web/blog items yet."));
    for (const item of res.items) {
      const card = el("article", null, "wa-card");
      const head = el("div", null, "wa-card-head");
      head.append(el("span", item.title));
      head.append(el("span", item.section + " · " + item.adapter));
      card.append(head);
      card.append(el("div", item.source_id + (item.source_url ? " · " + item.source_url : ""), "wa-meta"));
      if (item.summary) card.append(el("div", item.summary));
      list.append(card);
    }
    panel.append(list);
    bodyHost.append(panel);
  }

  async function renderDuplicates() {
    const res = await api("duplicates");
    bodyHost.textContent = "";
    bodyHost.append(feedbackEl);

    const panel = el("section", null, "wa-panel");
    panel.append(el("h2", "Duplicate Canonical URLs (" + res.count + ")"));
    if (!res.duplicate_groups.length) {
      panel.append(el("p", "No duplicate Web/Blog captures detected."));
    } else {
      panel.append(el("pre", JSON.stringify(res.duplicate_groups, null, 2), "wa-pre"));
    }
    bodyHost.append(panel);
  }

  async function renderView() {
    renderNav();
    setFeedback("");
    try {
      if (state.tab === "ingest") renderIngest();
      else if (state.tab === "keep") await renderKeep();
      else if (state.tab === "archive") await renderArchive();
      else if (state.tab === "duplicates") await renderDuplicates();
    } catch (err) {
      setFeedback(err.message, true);
    }
  }

  AppUI.createApp({
    id: "personal-web-archive",
    title: "Web Archive",
    leftSidebar: {
      width: 240,
      tabs: [{ id: "nav", label: "Navigation", active: true, render: (host) => { navHost = host; } }],
    },
    content: {
      render: (host) => {
        bodyHost = el("div", null, "wa-body");
        feedbackEl = el("div", "", "wa-feedback");
        feedbackEl.setAttribute("role", "status");
        feedbackEl.hidden = true;
        host.append(bodyHost);
      },
    },
    statusbar: {},
  });

  renderView();
}).catch((err) => {
  const host = document.getElementById("app-content-body");
  if (host) host.textContent = "Web Archive unavailable: " + String(err.message || err);
});
