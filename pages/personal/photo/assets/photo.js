window.AppUIReady.then(() => {
  const base = "/v1/apps/personal/photo/";
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
    if (!r.data || !r.data.ok) throw new Error(r.data?.error || "Photo request failed");
    return r.data;
  }

  let navHost, bodyHost, feedbackEl;
  const state = { folder: "", folders: [], selected: new Set() };

  function setFeedback(msg, isError = false) {
    if (!feedbackEl) return;
    feedbackEl.textContent = msg || "";
    feedbackEl.className = isError ? "ph-feedback error" : "ph-feedback";
    feedbackEl.hidden = !msg;
  }

  function renderNav() {
    if (!navHost) return;
    navHost.textContent = "";
    const wrap = el("div", null, "ph-nav");
    wrap.append(btn("All Photos", () => { state.folder = ""; loadGallery(); }, "ph-nav-btn" + (!state.folder ? " active" : "")));
    for (const f of state.folders) {
      const b = btn(f.name, () => { state.folder = f.name; loadGallery(); }, "ph-nav-btn" + (state.folder === f.name ? " active" : ""));
      b.append(el("span", f.count));
      wrap.append(b);
    }
    navHost.append(wrap);
  }

  async function loadGallery() {
    renderNav();
    try {
      const res = await api("list", { folder: state.folder || undefined, page: 1, page_size: 100 });
      bodyHost.textContent = "";
      bodyHost.append(feedbackEl);

      const bar = el("div", null, "ph-bar");
      const fileInput = el("input");
      fileInput.type = "file";
      fileInput.accept = "image/jpeg,image/png,image/webp,image/tiff";
      fileInput.onchange = async () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        try {
          const buf = await file.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let bin = "";
          for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
          const r = await api("import_photo", { filename: file.name, content_b64: btoa(bin), confirm: true });
          setFeedback(r.duplicate ? "Already archived (" + r.source_id + ")" : "Imported " + r.source_id);
          await refreshAll();
        } catch (err) {
          setFeedback(err.message, true);
        }
      };

      const folderInput = el("input");
      folderInput.placeholder = "Logical folder (e.g. Jeju/2026)";
      bar.append(
        fileInput,
        folderInput,
        btn("Assign Folder", async () => {
          if (!state.selected.size) { setFeedback("Select photos first.", true); return; }
          try {
            await api("folder_assign", { source_ids: [...state.selected], folder: folderInput.value.trim(), confirm: true });
            state.selected.clear();
            setFeedback("Updated folder assignment.");
            await refreshAll();
          } catch (err) {
            setFeedback(err.message, true);
          }
        }),
        btn("Refresh", () => refreshAll())
      );
      bodyHost.append(el("h2", (state.folder || "All Photos") + " (" + res.total + ")"), bar);

      const grid = el("div", null, "ph-grid");
      if (!res.items.length) grid.append(el("p", "No photos archived yet."));
      for (const p of res.items) {
        const card = el("article", null, "ph-card" + (state.selected.has(p.source_id) ? " selected" : ""));
        card.onclick = () => {
          if (state.selected.has(p.source_id)) state.selected.delete(p.source_id);
          else state.selected.add(p.source_id);
          card.className = "ph-card" + (state.selected.has(p.source_id) ? " selected" : "");
        };
        const img = el("img", null, "ph-thumb");
        img.src = p.thumbnail_url;
        img.alt = p.title;
        img.loading = "lazy";
        const info = el("div", null, "ph-card-info");
        info.append(el("div", p.title, "ph-title"));
        info.append(el("div", p.taken_at ? p.taken_at.slice(0, 10) : "Unknown date"));
        if (p.folder) info.append(el("div", "Folder: " + p.folder));
        if (p.coordinates) info.append(el("div", "GPS: " + p.coordinates.latitude + ", " + p.coordinates.longitude));
        card.append(img, info);
        grid.append(card);
      }
      bodyHost.append(grid);
    } catch (err) {
      setFeedback(err.message, true);
    }
  }

  async function refreshAll() {
    try {
      const f = await api("folders");
      state.folders = f.folders || [];
      await loadGallery();
    } catch (err) {
      setFeedback(err.message, true);
    }
  }

  AppUI.createApp({
    id: "personal-photo",
    title: "Photo Archive",
    leftSidebar: {
      width: 240,
      tabs: [{ id: "folders", label: "Folders", active: true, render: (host) => { navHost = host; } }],
    },
    content: {
      render: (host) => {
        bodyHost = el("div", null, "ph-body");
        feedbackEl = el("div", "", "ph-feedback");
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
  if (host) host.textContent = "Photo Archive unavailable: " + String(err.message || err);
});
