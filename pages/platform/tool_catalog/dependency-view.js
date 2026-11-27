import { buildDependencyGraph as buildGraph } from './dependency-model.js?v=1';

export function mountDependencyGraph(root, actions, setStatus, { fetchApps, esc, svgEl, svgText, listHost }) {
  // The app/capability LIST goes into `listHost` (the page's left-sidebar "Apps" tab) when given; the canvas and
  // the detail pane stay in `root` (the content area).
  const listHtml =
      '<div class="tc-find"><input id="g-find" placeholder="Filter apps / capabilities…" spellcheck="false" aria-label="Filter apps and capabilities"></div>' +
      '<div class="tc-legend">' +
        '<span><i class="dot app"></i> app</span>' +
        '<span><i class="dot cap"></i> capability (daemon)</span>' +
        '<span><i class="edge app"></i> app→app</span>' +
        '<span><i class="edge cap"></i> app→capability</span>' +
      '</div>' +
      '<div class="tc-g-list" id="g-list"><div class="tc-dim">Loading…</div></div>';
  const viewHtml =
    '<div class="tc-g-canvas" id="g-canvas"><div class="tc-dim" style="padding:30px">Loading dependency graph…</div></div>' +
    '<div class="tc-g-detail" id="g-detail"><div class="tc-dim">Select a node to see its wiring.</div></div>';
  if (listHost) { listHost.innerHTML = '<div class="tc-g-side">' + listHtml + '</div>'; root.innerHTML = viewHtml; }
  else root.innerHTML = '<div class="tc-g-left">' + listHtml + '</div>' + viewHtml;
  root.classList.add('tc-graph');
  const q = (id) => root.querySelector('#' + id) || (listHost && listHost.querySelector('#' + id));

  const G = { apps: [], nodes: [], edges: [], byId: {}, filter: '', selected: null, missingCapOnly: false, expanded: new Set(), treeOpen: new Set() };

  // Shared selection channel (#6): publish the focused node so the AI panel's
  // context()/actions and any sibling view can read it; subscribe so an external
  // focus (e.g. a chat 'catalog.focus' action) re-centers the graph. Scoped to
  // this app so pages don't cross-talk. Degrades to no-op if the bus is absent.
  const selBus = (window.AppUISelectionBus && window.AppUISelectionBus.scope)
    ? window.AppUISelectionBus.scope('platform/tool_catalog') : null;
  let _lastPub = null, _applyingExternal = false, _pendingFocus = null;
  if (selBus) {
    selBus.subscribe((sel) => {
      if (_applyingExternal) return;
      const id = sel && sel.id;
      if (!id || id === G.selected) return;
      if (!G.byId[id]) { if (!G.nodes.length) _pendingFocus = id; return; }   // data still loading: apply after load()
      G.expanded.clear(); G.selected = id; draw(); renderDetail(); renderList();
    });
  }
  function publishSel() {
    if (!selBus) return;
    const id = G.selected; if (id === _lastPub) return; _lastPub = id;
    const n = id && G.byId[id];
    _applyingExternal = true;
    try { selBus.set(n ? { kind: 'graph-node', id, label: n.title, data: { type: n.type } } : null); }
    finally { _applyingExternal = false; }
  }

  if (window.AppUI && AppUI.components && AppUI.components.Toolbar) {
    AppUI.components.Toolbar.create({ container: actions, label: 'Graph actions', items: [
      { label: 'Refresh', title: 'Reload the app/dependency data', action: () => load() },
    ] });
  }

  // Left list — a collapsible GROUP → APP tree + a capabilities section, built
  // on the shared AppUITree (TODO #8) instead of a bespoke re-render. Created
  // once; state changes drive it via setRoots/setFilter/setActive.
  let treeInst = null;
  function buildTreeRoots() {
    const groupOf = (id) => (id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : id);
    const apps = G.nodes.filter((n) => n.type === 'app');
    const caps = G.nodes.filter((n) => n.type === 'cap');
    const byGroup = {};
    for (const n of apps) (byGroup[groupOf(n.id)] ||= []).push(n);
    const leafNode = (n) => ({
      name: n.title, path: n.id, hasChildren: false,
      data: { kind: n.type, count: (n.type === 'cap' ? (n.usage || 0) : (n.deps.length || 0)) },
    });
    const roots = [];
    for (const g of Object.keys(byGroup).sort()) {
      const list = byGroup[g].sort((a, b) => a.id.localeCompare(b.id));
      roots.push({ name: g, path: 'g:' + g, hasChildren: true, badge: String(list.length),
        children: list.map(leafNode) });
    }
    if (caps.length) {
      const sorted = caps.sort((a, b) => (b.usage || 0) - (a.usage || 0));
      roots.push({ name: 'capabilities', path: 'g:__caps', hasChildren: true, badge: String(caps.length),
        children: sorted.map(leafNode) });
    }
    return roots;
  }
  function renderList() {
    const box = q('g-list');
    if (!G.nodes.length) { box.innerHTML = '<div class="tc-dim">Loading…</div>'; return; }
    if (!treeInst) {
      if (!(window.AppUI && AppUI.components && AppUI.components.Tree)) {
        box.innerHTML = '<div class="tc-dim">Tree component unavailable.</div>'; return;
      }
      box.innerHTML = '';
      treeInst = AppUI.components.Tree.create({
        container: box,
        storageKey: 'pylon2.catalog.dep.tree',
        // match on id + title (not just name) so the filter finds app ids
        matchFn: (node, qlc) => {
          if ((node.name || '').toLowerCase().includes(qlc)) return true;
          return String(node.path || '').toLowerCase().includes(qlc);
        },
        decorateRow: (node, row) => {
          const d = node.data || {};
          if (d.kind) { const dot = document.createElement('i'); dot.className = 'dot ' + d.kind; row.insertBefore(dot, row.querySelector('.tree-name')); }
          if (d.count != null) { const c = document.createElement('span'); c.className = 'tc'; c.textContent = String(d.count); row.appendChild(c); }
        },
        onSelect: (node) => {
          if (node.hasChildren) return;   // group row — just toggles
          G.expanded.clear(); G.selected = node.path; draw(); renderDetail(); renderList();
        },
      });
    }
    treeInst.setRoots(buildTreeRoots());
    treeInst.setFilter(G.filter || '');
    if (G.selected) treeInst.setActive(G.selected);
  }

  // FOCUS / drill-down model: instead of drawing all 70+ nodes and 79 edges at
  // once (unreadable), we draw NOTHING until a node is picked, then show just
  // that node and its DIRECT neighbors as a radial ego-graph — deps on the
  // right, dependents on the left. Pick from the left list/search, click a
  // neighbor to re-center on it. This keeps the canvas to a handful of nodes.
  const NW = 170, NH = 34, VIEW = { k: 1, tx: 0, ty: 0 };

  function draw() {
    const canvas = q('g-canvas');
    if (!G.nodes.length) { canvas.innerHTML = '<div class="tc-dim" style="padding:30px">No dependency data.</div>'; return; }
    const center = G.selected && G.byId[G.selected];
    if (!center) {
      // entry state — no node chosen yet: a friendly prompt + the hubs to start from
      const hubs = G.nodes.filter((n) => n.type === 'cap').sort((a, b) => (b.usage || 0) - (a.usage || 0)).slice(0, 6);
      canvas.innerHTML =
        '<div class="tc-g-hint">' +
          '<div class="tc-g-hint-ic">🕸</div>' +
          '<div class="tc-g-hint-t">Pick an app or capability</div>' +
          '<div class="tc-g-hint-s">Choose from the list on the left (or search) to see just that node and what it wires to. Click a neighbor to walk the graph.</div>' +
          (hubs.length ? '<div class="tc-g-hint-hubs"><span>Busiest capabilities:</span>' +
            hubs.map((h) => '<button class="tc-chip" data-id="' + esc(h.id) + '">' + esc(h.title) + ' <b>' + (h.usage || 0) + '</b></button>').join('') + '</div>' : '') +
        '</div>';
      canvas.querySelectorAll('.tc-chip').forEach((b) => b.onclick = () => { G.expanded.clear(); G.selected = b.dataset.id; draw(); renderDetail(); renderList(); });
      publishSel();
      return;
    }

    // neighbors: deps (center → X) on the right, dependents (X → center) on the left
    const depIds = (center.deps || []).filter((id) => G.byId[id]);
    const rdepIds = (center.rdeps || []).filter((id) => G.byId[id]);
    // HOP-2: any number of right-side neighbors can stay EXPANDED at once. Each
    // expanded neighbor gets its own vertical BAND, tall enough for its deps;
    // siblings are pushed apart (padding grows with what's open) so no band
    // overlaps another. Each neighbor's deps sit in a third column, centered on
    // THAT neighbor's band — so every hop-2 edge stays inside its own band and
    // never crosses a sibling's. (Gravity + padding, not accordion.)
    const childrenOf = {};   // depId -> [its dep ids] (only for expanded, present ones)
    for (const nid of depIds) {
      if (!G.expanded.has(nid)) continue;
      childrenOf[nid] = (G.byId[nid].deps || []).filter((id) => G.byId[id] && id !== center.id);
    }
    const anyHop2 = Object.keys(childrenOf).some((k) => childrenOf[k].length);

    const leftN = rdepIds.length;
    const COLGAP = 300, ROWH = NH + 16, GAP = 18, PADY = 36;

    // band height for each right neighbor: 1 row, or enough rows for its kids
    const bandH = (id) => {
      const kids = childrenOf[id];
      const kidRows = kids ? kids.length : 0;
      return Math.max(ROWH, kidRows * ROWH);
    };
    let rightStackH = 0;
    depIds.forEach((id) => { rightStackH += bandH(id) + GAP; });
    rightStackH -= GAP;
    const leftStackH = Math.max(1, leftN) * ROWH - (ROWH - NH);

    const width = NW * (anyHop2 ? 4 : 3) + COLGAP * (anyHop2 ? 3 : 2) + 40;
    const height = Math.max(240, rightStackH + PADY * 2, leftStackH + PADY * 2);
    const cx = anyHop2 ? (COLGAP + NW) : (width - NW) / 2;   // shift center left when a 3rd column shows
    const cy = (height - NH) / 2;
    const leftX = cx - COLGAP, rightX = cx + COLGAP, rightX2 = cx + COLGAP * 2;

    const pos = { [center.id]: { x: cx, y: cy } };
    // left dependents: simple centered stack
    const lTop = PADY + (height - PADY * 2 - leftStackH) / 2;
    rdepIds.forEach((id, i) => { pos[id] = { x: leftX, y: lTop + i * ROWH }; });
    // right deps: stacked by BAND height, each centered in its band; its kids
    // fill the band in the third column.
    const bandMeta = {};   // id -> {top, h, cy}
    let y = PADY + (height - PADY * 2 - rightStackH) / 2;
    for (const id of depIds) {
      const h = bandH(id);
      const bc = y + h / 2;                       // band center
      pos[id] = { x: rightX, y: bc - NH / 2 };    // neighbor sits at band center
      bandMeta[id] = { top: y, h, cy: bc };
      const kids = childrenOf[id] || [];
      if (kids.length) {
        const kTotal = kids.length * ROWH - (ROWH - NH);
        let ky = bc - kTotal / 2;                 // kids centered in the band
        kids.forEach((k) => { pos[k] = { x: rightX2, y: ky }; ky += ROWH; });
      }
      y += h + GAP;
    }
    const hop2Ids = [].concat(...Object.values(childrenOf));

    const svg = svgEl('svg', { class: 'tc-svg', width, height, viewBox: '0 0 ' + width + ' ' + height });
    svg.appendChild(mkDefs());
    const scene = svgEl('g', { class: 'tc-scene', transform: 'translate(' + VIEW.tx + ',' + VIEW.ty + ') scale(' + VIEW.k + ')' });
    svg.appendChild(scene);

    // side labels
    if (leftN) scene.appendChild(svgText(leftX + NW / 2, 20, (center.type === 'cap' ? 'needed by' : 'depended on by') + ' (' + leftN + ')', 'tc-ghead'));
    if (depIds.length) scene.appendChild(svgText(rightX + NW / 2, 20, 'depends on (' + depIds.length + ')', 'tc-ghead'));
    if (anyHop2) scene.appendChild(svgText(rightX2 + NW / 2, 20, 'next hop', 'tc-ghead'));

    // edges center↔neighbors (curved; the only edges on screen are the relevant ones)
    const edgeKind = (fromId, toId) => { const e = G.edges.find((x) => x.from === fromId && x.to === toId); return e ? e.kind : 'app'; };
    const addEdge = (fromId, toId, faded) => {
      const a = pos[fromId], b = pos[toId]; if (!a || !b) return;
      let sx, sy, tx, ty;
      if (b.x > a.x) { sx = a.x + NW; sy = a.y + NH / 2; tx = b.x; ty = b.y + NH / 2; }
      else { sx = a.x; sy = a.y + NH / 2; tx = b.x + NW; ty = b.y + NH / 2; }
      const dx = Math.max(50, Math.abs(tx - sx) * 0.45);
      const kind = edgeKind(fromId, toId);
      scene.appendChild(svgEl('path', {
        d: 'M' + sx + ',' + sy + ' C' + (sx + (tx > sx ? dx : -dx)) + ',' + sy + ' ' + (tx + (tx > sx ? -dx : dx)) + ',' + ty + ' ' + tx + ',' + ty,
        class: 'tc-dep-edge ' + kind + (faded ? '' : ' hot'), fill: 'none', 'marker-end': 'url(#dep-arrow-' + kind + ')',
      }));
    };
    rdepIds.forEach((id) => addEdge(id, center.id));   // dependent → center
    depIds.forEach((id) => addEdge(center.id, id));    // center → dep
    for (const nid in childrenOf) for (const k of childrenOf[nid]) addEdge(nid, k, true);   // per-band hop-2 edges

    // nodes: center + neighbors (+ hop-2)
    const nodeEls = [];
    const node = (n, role) => {
      const p = pos[n.id];
      const canExpand = role === 'dep' && (G.byId[n.id].deps || []).some((id) => G.byId[id] && id !== center.id);
      const isExp = G.expanded.has(n.id);
      const g = svgEl('g', { class: 'tc-dnode ' + n.type + (role === 'center' ? ' sel center' : '') + (role === 'hop2' ? ' hop2' : '') + (n.present === false ? ' missing' : ''), transform: 'translate(' + p.x + ',' + p.y + ')' });
      g.dataset.id = n.id;
      g.appendChild(svgEl('rect', { width: NW, height: NH, rx: n.type === 'cap' ? NH / 2 : 8, filter: 'url(#dep-shadow)' }));
      g.appendChild(svgEl('circle', { cx: 16, cy: NH / 2, r: 4.5, class: 'tc-dglyph' }));
      g.appendChild(svgText(30, NH / 2 + 4, n.title, 'tc-dlabel', NW - (canExpand ? 62 : 46)));
      const badge = n.type === 'cap' ? (n.usage || 0) : ((n.deps || []).length || 0);
      if (badge && !canExpand) g.appendChild(svgText(NW - 10, NH / 2 + 4, String(badge), 'tc-dcnt'));
      // expand/collapse toggle on a dep that has further deps
      if (canExpand) {
        const btn = svgEl('g', { class: 'tc-expand', transform: 'translate(' + (NW - 22) + ',' + (NH / 2 - 9) + ')' });
        btn.dataset.expand = n.id;
        btn.appendChild(svgEl('circle', { cx: 9, cy: 9, r: 9, class: 'tc-expand-bg' }));
        btn.appendChild(svgText(9, 13, isExp ? '−' : '+', 'tc-expand-t'));
        const tt = svgEl('title'); tt.textContent = isExp ? 'collapse' : 'show what ' + n.title + ' depends on'; btn.appendChild(tt);
        g.appendChild(btn);
      }
      scene.appendChild(g); nodeEls.push(g);
    };
    rdepIds.forEach((id) => node(G.byId[id], 'rdep'));
    depIds.forEach((id) => node(G.byId[id], 'dep'));
    hop2Ids.forEach((id) => node(G.byId[id], 'hop2'));
    node(center, 'center');
    if (!leftN && !depIds.length) scene.appendChild(svgText(cx + NW / 2, cy + NH + 26, 'no wiring — this node has no dependencies', 'tc-dim-svg'));

    canvas.innerHTML = ''; canvas.appendChild(svg);
    wirePanZoom(svg, scene);
    // expand/collapse toggles (do NOT re-center) — bind before node activation so
    // a click on the toggle is handled here and stops propagation.
    scene.querySelectorAll('.tc-expand').forEach((b) => b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const id = b.dataset.expand;
      if (G.expanded.has(id)) G.expanded.delete(id); else G.expanded.add(id);   // multi-expand
      draw();
    }));
    const activate = (id) => { if (id === G.selected) return; VIEW.tx = 0; VIEW.ty = 0; VIEW.k = 1; G.expanded.clear(); G.selected = id; draw(); renderDetail(); renderList(); };
    if (window.AppUI && AppUI.components && AppUI.components.GraphNode) {
      AppUI.components.GraphNode.bind({ elements: nodeEls, getData: (e) => e.dataset.id, label: 'Dependency node', onActivate: (ev, id) => { if (ev && ev.target && ev.target.closest && ev.target.closest('.tc-expand')) return; activate(id); } });
    } else nodeEls.forEach((e) => e.addEventListener('click', (ev) => { if (ev.target.closest('.tc-expand')) return; activate(e.dataset.id); }));
    publishSel();
  }

  // wheel-zoom toward the cursor + drag-pan; updates VIEW and the scene transform
  // live (no full redraw), so interaction is smooth.
  function wirePanZoom(svg, scene) {
    const apply = () => scene.setAttribute('transform', 'translate(' + VIEW.tx + ',' + VIEW.ty + ') scale(' + VIEW.k + ')');
    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      const f = e.deltaY < 0 ? 1.12 : 1 / 1.12, k2 = Math.max(0.3, Math.min(2.5, VIEW.k * f));
      // keep the point under the cursor fixed
      VIEW.tx = mx - (mx - VIEW.tx) * (k2 / VIEW.k);
      VIEW.ty = my - (my - VIEW.ty) * (k2 / VIEW.k);
      VIEW.k = k2; apply();
    }, { passive: false });
    let drag = null;
    svg.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.tc-dnode')) return;   // let node clicks through
      drag = { x: e.clientX, y: e.clientY, tx: VIEW.tx, ty: VIEW.ty };
      svg.setPointerCapture(e.pointerId); svg.classList.add('panning');
    });
    svg.addEventListener('pointermove', (e) => { if (!drag) return; VIEW.tx = drag.tx + (e.clientX - drag.x); VIEW.ty = drag.ty + (e.clientY - drag.y); apply(); });
    const end = () => { drag = null; svg.classList.remove('panning'); };
    svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
  }
  function mkDefs() {
    const defs = svgEl('defs', {});
    defs.innerHTML =
      '<marker id="dep-arrow-app" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--accent)"/></marker>' +
      '<marker id="dep-arrow-cap" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--color-warning)"/></marker>' +
      '<filter id="dep-shadow" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="1.5" stdDeviation="2.2" flood-color="#000" flood-opacity="0.18"/></filter>';
    return defs;
  }
  function renderDetail() {
    const box = q('g-detail'); const n = G.byId[G.selected];
    if (!n) { box.innerHTML = '<div class="tc-dim">Select a node to see its wiring.</div>'; return; }
    const link = (id) => '<a class="tc-glink" data-id="' + esc(id) + '">' + esc(id) + '</a>';
    let html = '<div class="tc-d-h"><i class="dot ' + n.type + '"></i> ' + esc(n.title) +
      ' <span class="tc-d-type">' + (n.type === 'cap' ? 'capability' : 'app') + '</span></div>';
    if (n.type === 'app') {
      html += '<div class="tc-d-sec">Depends on (' + n.deps.length + ')</div>';
      html += n.deps.length ? '<div class="tc-d-list">' + n.deps.map(link).join('') + '</div>' : '<div class="tc-dim">— nothing</div>';
    }
    html += '<div class="tc-d-sec">' + (n.type === 'cap' ? 'Needed by' : 'Depended on by') + ' (' + n.rdeps.length + ')</div>';
    html += n.rdeps.length ? '<div class="tc-d-list">' + n.rdeps.map(link).join('') + '</div>' : '<div class="tc-dim">— nothing</div>';
    box.innerHTML = html;
    box.querySelectorAll('.tc-glink').forEach((a) => a.onclick = () => { G.expanded.clear(); G.selected = a.dataset.id; draw(); renderDetail(); renderList(); });
  }

  async function load() {
    setStatus('Loading dependency graph…');
    G.apps = await fetchApps();
    const built = buildGraph(G.apps);
    Object.assign(G, built);
    if (_pendingFocus && G.byId[_pendingFocus]) { G.expanded.clear(); G.selected = _pendingFocus; }
    _pendingFocus = null;
    renderList(); draw(); renderDetail();
    setStatus(G.nodes.filter((n) => n.type === 'app').length + ' apps, ' +
      G.nodes.filter((n) => n.type === 'cap').length + ' capabilities, ' + G.edges.length + ' edges');
  }
  let _gfindT = null;
  q('g-find').addEventListener('input', (e) => {
    const v = e.target.value;
    if (_gfindT) clearTimeout(_gfindT);
    _gfindT = setTimeout(() => { G.filter = v; renderList(); draw(); }, 140);
  });
  load();
}

