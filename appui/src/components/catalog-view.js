/* AppUI CatalogView — Reusable 3-pane catalog component for KB & archive apps.
 *
 * Usage:
 *   AppUICatalogView.createApp({
 *     id: 'personal-book',
 *     title: 'Book Catalog',
 *     icon: '📚',
 *     apiBase: '/v1/apps/personal/book/',
 *     sections: [{ id: 'Book', label: '📚 Books' }], // optional
 *     listOp: 'list',
 *     itemFormatter: (item) => ({ badge, title, subtitle, meta }), // optional
 *   });
 */
(function () {
  "use strict";

  const CSS = `
.cv-sb{padding:14px 12px;display:flex;flex-direction:column;gap:12px;height:100%;box-sizing:border-box;overflow-y:auto}
.cv-sb h3{margin:0;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted)}
.cv-nav{display:flex;flex-direction:column;gap:6px}
.cv-nav-btn{display:flex;align-items:center;justify-content:space-between;padding:9px 11px;border-radius:9px;border:1px solid var(--border);background:var(--bg-elevated);color:var(--text-primary);font-size:13px;font-weight:500;cursor:pointer}
.cv-nav-btn:hover{border-color:var(--accent)}
.cv-nav-btn.on{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 12%,var(--bg-elevated));color:var(--accent);font-weight:600}
.cv-cnt{font-size:11px;padding:2px 7px;border-radius:999px;background:var(--bg-secondary);color:var(--text-muted);font-variant-numeric:tabular-nums}
.cv-input{width:100%;box-sizing:border-box;padding:8px 10px;border-radius:8px;border:1px solid var(--border);background:var(--bg-primary);color:var(--text-primary);font-size:12.5px}
.cv-input:focus{outline:none;border-color:var(--accent)}
.cv-btn{padding:7px 11px;border-radius:8px;border:1px solid var(--border);background:var(--bg-elevated);color:var(--text-primary);font-size:12px;font-weight:500;cursor:pointer}
.cv-btn:hover{border-color:var(--accent)}
.cv-btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
.cv-btn.sm{padding:4px 8px;font-size:11px}
.cv-btn:disabled{opacity:.45;cursor:not-allowed}
.cv-seg{display:inline-flex;border:1px solid var(--border);border-radius:8px;overflow:hidden;background:var(--bg-primary)}
.cv-seg button{flex:1;border:0;background:transparent;color:var(--text-secondary);padding:6px 10px;font-size:12px;cursor:pointer}
.cv-seg button.on{background:var(--accent);color:#fff;font-weight:600}
.cv-main{padding:18px 22px 32px;max-width:1280px;margin:0 auto;display:flex;flex-direction:column;gap:14px}
.cv-topbar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:14px 18px;border:1px solid var(--border);border-radius:12px;background:var(--bg-elevated)}
.cv-topbar h1{margin:0;font-size:18px;font-weight:700;color:var(--text-primary)}
.cv-sub{font-size:12px;color:var(--text-muted);margin-top:2px}
.cv-pager{display:flex;align-items:center;gap:8px}
.cv-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}
.cv-card{border:1px solid var(--border);border-radius:11px;background:var(--bg-elevated);padding:13px 14px;display:flex;flex-direction:column;gap:8px;cursor:pointer;transition:border-color .14s,transform .12s}
.cv-card:hover{border-color:var(--accent);transform:translateY(-2px)}
.cv-card.active{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 9%,var(--bg-elevated));box-shadow:0 0 0 1px color-mix(in srgb,var(--accent) 35%,transparent)}
.cv-card-top{display:flex;align-items:center;justify-content:space-between;gap:6px}
.cv-badge{display:inline-flex;align-items:center;padding:2px 7px;border-radius:999px;font-size:10.5px;font-weight:600;background:var(--bg-secondary);color:var(--text-secondary);border:1px solid var(--border)}
.cv-badge.accent{background:color-mix(in srgb,var(--accent) 14%,transparent);color:var(--accent);border-color:color-mix(in srgb,var(--accent) 35%,transparent)}
.cv-card-title{font-size:13.5px;font-weight:600;color:var(--text-primary);line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.cv-card-desc{font-size:11.5px;color:var(--text-secondary);line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.cv-card-meta{margin-top:auto;display:flex;align-items:center;justify-content:space-between;gap:6px;font-size:11px;color:var(--text-muted);padding-top:6px;border-top:1px solid var(--border)}
.cv-mono{font-family:var(--font-mono,ui-monospace,SFMono-Regular,Consolas,monospace);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cv-list{display:flex;flex-direction:column;gap:5px}
.cv-row{display:grid;grid-template-columns:86px minmax(0,1fr) auto;align-items:center;gap:10px;padding:8px 12px;border:1px solid var(--border);border-radius:8px;background:var(--bg-elevated);cursor:pointer}
.cv-row:hover{border-color:var(--accent)}
.cv-row.active{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 10%,var(--bg-elevated))}
.cv-detail{padding:16px 14px;display:flex;flex-direction:column;gap:12px;height:100%;box-sizing:border-box;overflow-y:auto}
.cv-detail h2{margin:0;font-size:16px;line-height:1.3;color:var(--text-primary)}
.cv-chips{display:flex;flex-wrap:wrap;gap:5px}
.cv-sec-lbl{font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:4px;font-weight:600}
.cv-box{padding:10px 12px;border-radius:9px;border:1px solid var(--border);background:var(--bg-secondary);font-size:12.5px;line-height:1.55;color:var(--text-secondary);white-space:pre-wrap;word-break:break-word}
.cv-empty{padding:36px 16px;text-align:center;color:var(--text-muted);font-size:13px}
`;

  function injectCss() {
    if (document.getElementById("appui-catalog-view-css")) return;
    const s = document.createElement("style");
    s.id = "appui-catalog-view-css";
    s.textContent = CSS;
    document.head.append(s);
  }

  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  async function postJson(url, args = {}) {
    const r = await AppUIApi.requestResponse(url, args, {
      method: "POST",
      timeout: 60000,
      decode: (x) => x.json(),
    });
    if (!r.data?.ok) throw new Error(r.data?.error || "Request failed");
    return r.data;
  }

  function createApp(opts) {
    injectCss();
    const sections = Array.isArray(opts.sections) && opts.sections.length
      ? opts.sections
      : [{ id: "", label: (opts.icon ? opts.icon + " " : "") + (opts.title || "All") }];
    const listOp = opts.listOp || "list";
    const itemsKey = opts.itemsKey || "items";
    const kbDetails = opts.kbDetails !== false;

    const state = {
      section: sections[0].id,
      query: "",
      page: 1,
      pageSize: opts.pageSize || 48,
      view: "grid",
      items: [],
      total: 0,
      counts: {},
      selected: null,
    };

    let sbEl, mainEl, detailEl;

    function renderSidebar() {
      if (!sbEl) return;
      sbEl.innerHTML =
        '<div class="cv-sb">' +
          '<h3>Sections</h3>' +
          '<div class="cv-nav">' +
            sections.map((s) =>
              '<button type="button" class="cv-nav-btn' + (state.section === s.id ? " on" : "") + '" data-sec="' + esc(s.id) + '">' +
                '<span>' + esc(s.label) + '</span>' +
                '<span class="cv-cnt">' + esc(state.counts[s.id] ?? "…") + '</span>' +
              '</button>'
            ).join("") +
          '</div>' +
          '<h3>Search</h3>' +
          '<input class="cv-input" id="cv-search" type="search" placeholder="Search…" value="' + esc(state.query) + '">' +
          '<button type="button" class="cv-btn primary" id="cv-go">Search</button>' +
          '<h3>View</h3>' +
          '<div class="cv-seg">' +
            '<button type="button" data-view="grid" class="' + (state.view === "grid" ? "on" : "") + '">Grid</button>' +
            '<button type="button" data-view="list" class="' + (state.view === "list" ? "on" : "") + '">List</button>' +
          '</div>' +
        '</div>';

      sbEl.querySelectorAll("[data-sec]").forEach((b) => {
        b.onclick = () => { state.section = b.getAttribute("data-sec"); state.page = 1; load(); };
      });
      sbEl.querySelectorAll("[data-view]").forEach((b) => {
        b.onclick = () => { state.view = b.getAttribute("data-view"); renderSidebar(); renderMain(); };
      });
      const inp = sbEl.querySelector("#cv-search");
      const go = () => { state.query = inp.value.trim(); state.page = 1; load(); };
      inp.onkeydown = (e) => { if (e.key === "Enter") go(); };
      sbEl.querySelector("#cv-go").onclick = go;
    }

    function fmtItem(item) {
      if (typeof opts.formatItem === "function") return opts.formatItem(item);
      return {
        id: item.source_id || item.id || item.title,
        badge: item.section || item.phase || opts.icon || "Item",
        badge2: item.adapter || "",
        title: item.title || item.source_id || "Untitled",
        desc: item.summary || "",
        metaLeft: item.source_id || item.id || "",
        metaRight: (item.updated_at || item.captured_at || "").slice(0, 10),
      };
    }

    function renderMain(loadingMsg) {
      if (!mainEl) return;
      const totalPages = Math.max(1, Math.ceil((state.total || 0) / state.pageSize));
      const curSec = sections.find((s) => s.id === state.section) || sections[0];

      let bodyHtml = "";
      if (loadingMsg) {
        bodyHtml = '<div class="cv-empty">' + esc(loadingMsg) + '</div>';
      } else if (!state.items.length) {
        bodyHtml = '<div class="cv-empty">' + esc(opts.emptyText || "No records archived yet.") + '</div>';
      } else if (state.view === "grid") {
        bodyHtml = '<div class="cv-grid">' + state.items.map((raw, idx) => {
          const it = fmtItem(raw);
          const active = state.selected && fmtItem(state.selected).id === it.id ? " active" : "";
          return (
            '<article class="cv-card' + active + '" data-idx="' + idx + '">' +
              '<div class="cv-card-top">' +
                '<span class="cv-badge accent">' + esc(it.badge) + '</span>' +
                (it.badge2 ? '<span class="cv-badge">' + esc(it.badge2) + '</span>' : '') +
              '</div>' +
              '<div class="cv-card-title" title="' + esc(it.title) + '">' + esc(it.title) + '</div>' +
              (it.desc ? '<div class="cv-card-desc">' + esc(it.desc) + '</div>' : '') +
              '<div class="cv-card-meta">' +
                '<span class="cv-mono">' + esc(it.metaLeft) + '</span>' +
                '<span>' + esc(it.metaRight) + '</span>' +
              '</div>' +
            '</article>'
          );
        }).join("") + '</div>';
      } else {
        bodyHtml = '<div class="cv-list">' + state.items.map((raw, idx) => {
          const it = fmtItem(raw);
          const active = state.selected && fmtItem(state.selected).id === it.id ? " active" : "";
          return (
            '<div class="cv-row' + active + '" data-idx="' + idx + '">' +
              '<span class="cv-badge accent">' + esc(it.badge) + '</span>' +
              '<span class="cv-card-title" style="-webkit-line-clamp:1">' + esc(it.title) + '</span>' +
              '<span style="font-size:11px;color:var(--text-muted)">' + esc(it.metaRight) + '</span>' +
            '</div>'
          );
        }).join("") + '</div>';
      }

      mainEl.innerHTML =
        '<div class="cv-main">' +
          '<div class="cv-topbar">' +
            '<div>' +
              '<h1>' + esc(curSec.label) + ' <span style="font-weight:400;color:var(--text-muted);font-size:14px">(' + state.total + ')</span></h1>' +
              '<div class="cv-sub">' + (state.query ? 'Filter: "' + esc(state.query) + '" · ' : '') + 'Click any item to inspect full details.</div>' +
            '</div>' +
            '<div class="cv-pager">' +
              '<button type="button" class="cv-btn sm" id="cv-prev"' + (state.page <= 1 ? " disabled" : "") + '>← Prev</button>' +
              '<span style="font-size:12px;color:var(--text-muted)">Page ' + state.page + ' / ' + totalPages + '</span>' +
              '<button type="button" class="cv-btn sm" id="cv-next"' + (state.page >= totalPages ? " disabled" : "") + '>Next →</button>' +
            '</div>' +
          '</div>' +
          bodyHtml +
        '</div>';

      mainEl.querySelector("#cv-prev").onclick = () => { if (state.page > 1) { state.page--; load(); } };
      mainEl.querySelector("#cv-next").onclick = () => { if (state.page < totalPages) { state.page++; load(); } };
      mainEl.querySelectorAll("[data-idx]").forEach((node) => {
        node.onclick = () => {
          const item = state.items[Number(node.getAttribute("data-idx"))];
          if (item) selectItem(item);
        };
      });
    }

    async function selectItem(item) {
      state.selected = item;
      renderMain();
      if (!detailEl) return;
      try {
        const rEl = document.getElementById("app-right");
        if (rEl && rEl.classList.contains("ai-app-hidden")) AppUI.toggleRightSidebar();
      } catch (_) {}

      if (!kbDetails || !item.source_id) {
        const it = fmtItem(item);
        detailEl.innerHTML =
          '<div class="cv-detail">' +
            '<h2>' + esc(it.title) + '</h2>' +
            '<div class="cv-chips"><span class="cv-badge accent">' + esc(it.badge) + '</span></div>' +
            '<div class="cv-box">' + esc(JSON.stringify(item, null, 2)) + '</div>' +
          '</div>';
        return;
      }

      detailEl.innerHTML = '<div class="cv-detail"><div class="cv-empty">Loading details…</div></div>';
      try {
        const res = await postJson("/v1/apps/knowledge/kb_core/item_get", {
          section: item.section || state.section,
          source_id: item.source_id,
        });
        const d = res.data || {};
        const tags = (res.annotations && res.annotations.tags) || item.tags || [];
        const body = String(d.bodyMarkdown || d.body || d.summary || item.summary || "").trim();
        const url = d.sourceUrl || d.source || item.source_url || "";
        const extras = [];
        for (const k of ["year", "author", "authors", "channel", "artist", "composer", "performer", "rating", "price", "brand", "language"]) {
          if (d[k] != null && d[k] !== "" && !(Array.isArray(d[k]) && !d[k].length)) {
            extras.push([k, Array.isArray(d[k]) ? d[k].join(", ") : String(d[k])]);
          }
        }
        detailEl.innerHTML =
          '<div class="cv-detail">' +
            '<h2>' + esc(d.title || item.title || item.source_id) + '</h2>' +
            '<div class="cv-chips">' +
              '<span class="cv-badge accent">' + esc(item.section || state.section) + '</span>' +
              extras.map(([k, v]) => '<span class="cv-badge">' + esc(k + ": " + v) + '</span>').join("") +
              tags.map((t) => '<span class="cv-badge">#' + esc(t) + '</span>').join("") +
            '</div>' +
            (d.folder ? '<div><div class="cv-sec-lbl">Folder</div><div class="cv-box cv-mono" style="font-size:11px">' + esc(d.folder) + '</div></div>' : '') +
            (body ? '<div><div class="cv-sec-lbl">Content &amp; Notes</div><div class="cv-box">' + esc(body) + '</div></div>' : '') +
            '<div><div class="cv-sec-lbl">Source ID</div><div class="cv-mono" style="font-size:11px;color:var(--text-muted)">' + esc(item.source_id) + '</div></div>' +
            (url ? '<a class="cv-btn primary" style="text-align:center;text-decoration:none" target="_blank" rel="noopener noreferrer" href="' + esc(url) + '">Open Source ↗</a>' : '') +
          '</div>';
      } catch (e) {
        detailEl.innerHTML = '<div class="cv-detail"><div class="cv-empty">Could not load details: ' + esc(e.message) + '</div></div>';
      }
    }

    async function load() {
      renderSidebar();
      renderMain("Loading…");
      try {
        const args = { page: state.page, page_size: state.pageSize };
        if (state.section) args.section = state.section;
        if (state.query) args.query = state.query;
        const res = await postJson(opts.apiBase + listOp, args);
        state.items = res[itemsKey] || [];
        state.total = Number(res.total != null ? res.total : state.items.length);
        if (!state.query) state.counts[state.section] = state.total;
        renderSidebar();
        renderMain();
        if (state.items.length && !state.selected) selectItem(state.items[0]);
      } catch (e) {
        renderMain("Error: " + e.message);
      }
    }

    AppUI.createApp({
      id: opts.id,
      title: opts.title,
      leftSidebar: { width: 240, tabs: [{ id: "catalog", label: "Catalog", active: true, render: (h) => { sbEl = h; renderSidebar(); } }] },
      rightSidebar: { width: 340, title: "Details", tabs: [{ id: "details", label: "Details", active: true, render: (h) => { detailEl = h; h.innerHTML = '<div class="cv-detail"><div class="cv-empty">Select an item to inspect details.</div></div>'; } }] },
      content: { render: (h) => { mainEl = h; load(); } },
      statusbar: {},
    });

    // Pre-fetch counts for other sections
    sections.slice(1).forEach((s) => {
      postJson(opts.apiBase + listOp, { section: s.id, page: 1, page_size: 1 })
        .then((r) => { state.counts[s.id] = Number(r.total || 0); renderSidebar(); })
        .catch(() => {});
    });
  }

  window.AppUICatalogView = { createApp };
})();
