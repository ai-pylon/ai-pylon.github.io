window.AppUIReady.then(() => {
  const base = "/v1/apps/personal/map/";
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
    if (!r.data || !r.data.ok) throw new Error(r.data?.error || "Map request failed");
    return r.data;
  }

  let navHost, bodyHost, feedbackEl;
  const state = { kind: "all" };

  function setFeedback(msg, isError = false) {
    if (!feedbackEl) return;
    feedbackEl.textContent = msg || "";
    feedbackEl.className = isError ? "mp-feedback error" : "mp-feedback";
    feedbackEl.hidden = !msg;
  }

  function renderNav() {
    if (!navHost) return;
    navHost.textContent = "";
    const wrap = el("div", null, "mp-nav");
    for (const [k, lbl] of [["all", "All Locations"], ["place", "Saved Places"], ["visited", "Visited by Photos"]]) {
      wrap.append(btn(lbl, () => { state.kind = k; renderMain(); }, "mp-nav-btn" + (state.kind === k ? " active" : "")));
    }
    navHost.append(wrap);
  }

  async function renderMain() {
    renderNav();
    try {
      const res = await api("places_list", { kind: state.kind, page: 1, page_size: 100 });
      bodyHost.textContent = "";
      bodyHost.append(feedbackEl);

      const bar = el("div", null, "mp-actions");
      bar.append(btn("Rebuild Photo Visits", async () => {
        try {
          const r = await api("build_photo_visits", { confirm: true });
          setFeedback("Built " + r.count + " visited location(s) from GPS photos.");
          renderMain();
        } catch (err) {
          setFeedback(err.message, true);
        }
      }));
      bar.append(btn("Refresh", () => renderMain()));
      bodyHost.append(el("h2", "Locations (" + res.total + ")"), bar);

      if (!res.items.length) bodyHost.append(el("p", "No saved places or visited locations yet."));
      for (const item of res.items) {
        const card = el("article", null, "mp-card");
        const head = el("div", null, "mp-card-head");
        head.append(el("span", item.title));
        head.append(el("span", item.source_type));
        card.append(head);
        if (item.address) card.append(el("div", item.address, "mp-meta"));
        if (item.coordinates) {
          card.append(el("div", "GPS: " + item.coordinates.latitude + ", " + item.coordinates.longitude, "mp-meta"));
        }
        const actions = el("div", null, "mp-actions");
        if (item.coordinates) {
          actions.append(btn("Find Nearby (500m)", async () => {
            try {
              const nb = await api("nearby", { source_id: item.source_id, radius: 500 });
              setFeedback("Found " + nb.total + " nearby place(s) within 500m of " + item.title);
            } catch (err) {
              setFeedback(err.message, true);
            }
          }));
        }
        if (item.source_type === "photo-visited-address") {
          actions.append(btn("Rename Visit", async () => {
            const name = window.prompt("Custom place name:", item.title);
            if (!name || !name.trim()) return;
            try {
              await api("visit_rename", { source_id: item.source_id, custom_name: name.trim(), confirm: true });
              setFeedback("Renamed to " + name.trim());
              renderMain();
            } catch (err) {
              setFeedback(err.message, true);
            }
          }));
        }
        if (actions.childNodes.length) card.append(actions);
        bodyHost.append(card);
      }
    } catch (err) {
      setFeedback(err.message, true);
    }
  }

  AppUI.createApp({
    id: "personal-map",
    title: "Saved Places & Map",
    leftSidebar: {
      width: 240,
      tabs: [{ id: "nav", label: "Map", active: true, render: (host) => { navHost = host; } }],
    },
    content: {
      render: (host) => {
        bodyHost = el("div", null, "mp-body");
        feedbackEl = el("div", "", "mp-feedback");
        feedbackEl.setAttribute("role", "status");
        feedbackEl.hidden = true;
        host.append(bodyHost);
      },
    },
    statusbar: {},
  });

  renderMain();
}).catch((err) => {
  const host = document.getElementById("app-content-body");
  if (host) host.textContent = "Map unavailable: " + String(err.message || err);
});
