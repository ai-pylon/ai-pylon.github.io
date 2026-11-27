/* AppUIWorkspaceFolderPicker — a reusable "choose a target workspace AND a
 * destination folder inside it" control.
 *
 * It renders a workspace <select> (from an injected list) + a folder tree of the
 * selected workspace, and reports the chosen workspace + folder. It is fully
 * DECOUPLED from any page: the caller injects the workspace list and a folder
 * source, so the component makes NO network calls or page-state reads itself
 * (per the AppUI boundary rules). Use it anywhere a "save/link/copy into
 * <workspace>/<folder>" destination is needed.
 *
 * TWO folder-source modes (lazy preferred):
 *
 *   LAZY (expand-on-the-fly — fetch children only when a node is expanded):
 *     listChildren(wsPath, relPath) -> Promise<[{ name, hasChildren? }]>
 *       relPath "" = workspace root. Return the DIRECT child folders of relPath.
 *       `hasChildren` (optional) controls whether a ▸ twisty is shown; when
 *       omitted the node is assumed expandable (the twisty is shown and an
 *       expand that yields [] just shows "(no subfolders)"). This avoids
 *       fetching the whole tree upfront — only the opened branches are loaded.
 *
 *   EAGER (back-compat — fetch the whole flattened tree once):
 *     listFolders(wsPath) -> Promise<[{ path, depth }]>
 *       Used only when listChildren is NOT supplied.
 *
 * Usage:
 *   const picker = AppUIWorkspaceFolderPicker.create({
 *     container,
 *     workspaces: [{id, name, path, current}],   // current:true → initial selection
 *     listChildren(wsPath, rel) {                 // LAZY source (preferred)
 *       return api('vfs/list', {url: wsPath + '/' + rel})
 *         .then(r => r.entries.filter(e => e.kind === 'dir')
 *                             .map(e => ({ name: e.name })));
 *     },
 *     defFolder: '',                              // optional initial folder (rel)
 *     onChange(sel) { ... },                      // optional {workspace, folder, absolute}
 *   });
 *   picker.get();            // chosen folder: workspace-RELATIVE
 *   picker.getAbsolute();    // <wsPath>/<rel>  (absolute dest)
 *   picker.workspacePath();  // selected workspace path
 *   picker.workspaceId();    // selected workspace id (if the list carried ids)
 *   picker.destroy();        // idempotent cleanup
 */
const AppUIWorkspaceFolderPicker = (function () {
  const esc = (s) => (window.AppUITextUtils && AppUITextUtils.esc)
    ? AppUITextUtils.esc(s)
    : String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const makeMatcher = query => AppUITextUtils.makeMatcher(query);

  function norm(p) { return String(p || '').replace(/\\/g, '/').replace(/\/+$/, ''); }

  function create(options = {}) {
    const container = typeof options.container === 'string'
      ? document.querySelector(options.container) : options.container;
    if (!container) throw new Error('AppUIWorkspaceFolderPicker: container is required');
    const listChildren = typeof options.listChildren === 'function' ? options.listChildren : null;
    const listFolders = typeof options.listFolders === 'function' ? options.listFolders : null;
    const lazy = !!listChildren;
    // Optional label overrides (default to the existing copy so every current
    // caller is unchanged). A caller choosing a TARGET FOLDER inside a workspace
    // (e.g. the "New workspace" dialog) can pass workspaceLabel + rootLabel to
    // frame the picker as a destination-folder chooser rather than a workspace
    // chooser.
    const wsLabel = (options.workspaceLabel != null) ? String(options.workspaceLabel) : 'Workspace';
    const rootLabel = (options.rootLabel != null) ? String(options.rootLabel) : '(workspace root)';
    let workspaces = Array.isArray(options.workspaces) ? options.workspaces.slice() : [];
    let destroyed = false;

    function pickInitial(list) { return list.filter((w) => w.current)[0] || list[0] || null; }

    let chosen = String(options.defFolder || '').replace(/^\/+|\/+$/g, '');

    container.innerHTML =
      '<div class="afp-wswrap"></div>' +
      '<input class="afp-filter ai-input" placeholder="filter folders (regex ok, e.g. ^MR|SP\\d+) — blank = ' + esc(rootLabel.replace(/^\(|\)$/g, '')) + '">' +
      '<div class="afp-tree" style="max-height:200px;overflow:auto;border:1px solid var(--border,#2a2c31);border-radius:5px;margin:3px 0;font-size:12px">loading folders…</div>' +
      '<div class="afp-sel" style="font-size:11px;color:var(--text-muted,#9aa0a6);margin:4px 0"></div>';
    const wsWrap = container.querySelector('.afp-wswrap');
    const filterEl = container.querySelector('.afp-filter');
    const treeEl = container.querySelector('.afp-tree');
    const selEl = container.querySelector('.afp-sel');
    let wsSelEl = null;

    // ---- LAZY model: a node map keyed by rel path -----------------------------
    // Each node: { rel, name, depth, expanded, loaded, loading, children:[rel],
    //              hasChildren }. The root is rel "" (not drawn as a row; its
    //              children are the top level).
    let nodes = {};        // rel -> node
    // ---- EAGER model: a flat [{path, depth}] list -----------------------------
    let flat = [];

    function wsSelMarkup(list) {
      if (!list.length) return '';
      const act = pickInitial(list);
      return '<label style="font-size:11px;color:var(--text-muted,#9aa0a6);display:block;margin-bottom:2px">' + esc(wsLabel) + '</label>' +
        '<select class="afp-ws ai-input" style="margin-bottom:5px;font-size:12px">' +
        list.map((w) => {
          const wp = norm(w.path);
          const sel = (act && w.id != null && w.id === act.id) ? ' selected' : (act && !w.id && w === act ? ' selected' : '');
          return '<option value="' + esc(w.id != null ? w.id : wp) + '" data-path="' + esc(wp) + '"' + sel + '>' +
            esc(w.name || wp) + (wp ? ' (' + esc(wp) + ')' : '') + '</option>';
        }).join('') + '</select>';
    }

    function selWsPath() {
      if (wsSelEl) {
        const opt = wsSelEl.options[wsSelEl.selectedIndex];
        if (opt && opt.getAttribute('data-path')) return opt.getAttribute('data-path');
      }
      const init = pickInitial(workspaces);
      return init ? norm(init.path) : '';
    }

    function selWsId() {
      if (wsSelEl) {
        const opt = wsSelEl.options[wsSelEl.selectedIndex];
        if (opt) {
          const wp = opt.getAttribute('data-path');
          const hit = workspaces.filter((w) => norm(w.path) === norm(wp))[0];
          if (hit && hit.id != null) return hit.id;
        }
      }
      const init = pickInitial(workspaces);
      return init ? init.id : undefined;
    }

    function renderSel() {
      if (destroyed) return;
      selEl.innerHTML = 'Selected: <b>' + esc(chosen || rootLabel) + '</b>';
      if (typeof options.onChange === 'function') {
        try {
          const wp = selWsPath();
          options.onChange({ workspace: wp, folder: chosen, absolute: chosen ? (wp + '/' + chosen) : wp });
        } catch (e) { /* host callback error is not ours */ }
      }
    }

    function rowHtml(opts) {
      // opts: { rel, leaf, depth, twisty ('▸'|'▾'|''), loading }
      const pad = 8 + opts.depth * 16;
      const tw = opts.twisty
        ? '<span class="afp-tw" data-p="' + esc(opts.rel) + '" style="display:inline-block;width:14px;cursor:pointer;opacity:.75">' + opts.twisty + '</span>'
        : '<span style="display:inline-block;width:14px"></span>';
      const spin = opts.loading ? ' <span style="opacity:.6">…</span>' : '';
      return '<div class="afp-opt" data-p="' + esc(opts.rel) + '" ' +
        'style="padding:3px 8px 3px ' + pad + 'px;cursor:pointer;white-space:nowrap' +
        (chosen === opts.rel ? ';background:var(--accent-bg,rgba(79,195,247,.15))' : '') + '">' +
        tw + '📁 ' + esc(opts.leaf) + spin + '</div>';
    }

    // ---- LAZY render: walk the expanded node tree depth-first -----------------
    function renderLazy() {
      if (destroyed) return;
      const html = ['<div class="afp-opt" data-p="" style="padding:3px 8px 3px 8px;cursor:pointer' +
        (chosen === '' ? ';background:var(--accent-bg,rgba(79,195,247,.15))' : '') +
        '"><span style="display:inline-block;width:14px"></span>📁 ' + esc(rootLabel) + '</div>'];
      const root = nodes[''];
      function walk(rel, depth) {
        const n = nodes[rel];
        if (!n) return;
        (n.children || []).forEach((crel) => {
          const cn = nodes[crel];
          if (!cn) return;
          const canExpand = cn.hasChildren !== false;
          const twisty = cn.loading ? '' : (canExpand ? (cn.expanded ? '▾' : '▸') : '');
          html.push(rowHtml({ rel: crel, leaf: cn.name, depth: depth, twisty: twisty, loading: cn.loading }));
          if (cn.expanded) {
            if (cn.loaded && (cn.children || []).length === 0) {
              html.push('<div style="padding:2px 8px 2px ' + (8 + (depth + 1) * 16) + 'px;color:var(--text-muted,#9aa0a6);font-size:11px">(no subfolders)</div>');
            } else {
              walk(crel, depth + 1);
            }
          }
        });
      }
      if (root) walk('', 0);
      treeEl.innerHTML = html.join('');
      bindRowEvents();
    }

    // ---- EAGER render: filter + flat list (original behavior) -----------------
    function renderEager(q) {
      if (destroyed) return;
      const m = makeMatcher(q);
      const rows = flat.filter((f) => m(f.path));
      const html = ['<div class="afp-opt" data-p="" style="padding:3px 8px;cursor:pointer' +
        (chosen === '' ? ';background:var(--accent-bg,rgba(79,195,247,.15))' : '') +
        '"><span style="display:inline-block;width:14px"></span>📁 ' + esc(rootLabel) + '</div>'];
      rows.slice(0, 400).forEach((f) => {
        html.push(rowHtml({ rel: f.path, leaf: String(f.path).split('/').pop(), depth: f.depth || 0, twisty: '' }));
      });
      treeEl.innerHTML = html.join('');
      bindRowEvents();
    }

    function renderTree(q) { if (lazy) renderLazy(); else renderEager(q); }

    function bindRowEvents() {
      [].forEach.call(treeEl.querySelectorAll('.afp-opt'), (el) => {
        el.onmouseenter = () => { if (el.getAttribute('data-p') !== chosen) el.style.background = 'var(--bg-hover,#2a2c31)'; };
        el.onmouseleave = () => { if (el.getAttribute('data-p') !== chosen) el.style.background = ''; };
        el.onclick = (ev) => {
          // A click on the twisty toggles expand; elsewhere selects the row.
          if (ev.target && ev.target.classList && ev.target.classList.contains('afp-tw')) return;
          chosen = el.getAttribute('data-p') || '';
          if (!lazy) filterEl.value = '';
          renderSel(); renderTree(filterEl.value || '');
        };
      });
      [].forEach.call(treeEl.querySelectorAll('.afp-tw'), (tw) => {
        tw.onclick = (ev) => { ev.stopPropagation(); toggleExpand(tw.getAttribute('data-p') || ''); };
      });
    }

    // Expand/collapse a lazy node; fetch its children on first expand.
    function toggleExpand(rel) {
      if (destroyed || !lazy) return;
      const n = nodes[rel];
      if (!n) return;
      if (n.expanded) { n.expanded = false; renderLazy(); return; }
      n.expanded = true;
      if (n.loaded) { renderLazy(); return; }
      n.loading = true; renderLazy();
      const wp = selWsPath();
      Promise.resolve(listChildren(wp, rel)).then((kids) => {
        if (destroyed) return;
        n.loading = false; n.loaded = true; n.children = [];
        (Array.isArray(kids) ? kids : []).forEach((k) => {
          const name = (k && (k.name != null ? k.name : k)) + '';
          if (!name || name.charAt(0) === '.') return;
          const crel = rel ? (rel + '/' + name) : name;
          nodes[crel] = { rel: crel, name: name, expanded: false, loaded: false,
                          loading: false, children: [],
                          hasChildren: (k && typeof k === 'object' && 'hasChildren' in k) ? !!k.hasChildren : undefined };
          n.children.push(crel);
        });
        renderLazy();
      }).catch(() => {
        if (destroyed) return;
        n.loading = false; n.loaded = true; n.children = [];
        renderLazy();
      });
    }

    function loadRoot() {
      if (destroyed) return;
      chosen = String(options.defFolder || '').replace(/^\/+|\/+$/g, '');
      if (lazy) {
        nodes = { '': { rel: '', name: '', expanded: true, loaded: false, loading: true, children: [] } };
        treeEl.innerHTML = 'loading folders…';
        const wp = selWsPath();
        Promise.resolve(listChildren(wp, '')).then((kids) => {
          if (destroyed) return;
          const root = nodes[''];
          root.loading = false; root.loaded = true; root.children = [];
          (Array.isArray(kids) ? kids : []).forEach((k) => {
            const name = (k && (k.name != null ? k.name : k)) + '';
            if (!name || name.charAt(0) === '.') return;
            nodes[name] = { rel: name, name: name, expanded: false, loaded: false,
                            loading: false, children: [],
                            hasChildren: (k && typeof k === 'object' && 'hasChildren' in k) ? !!k.hasChildren : undefined };
            root.children.push(name);
          });
          renderLazy();
        }).catch(() => { if (!destroyed) treeEl.innerHTML = '<div style="padding:6px;color:var(--text-muted,#9aa0a6)">(could not load folders — type a path)</div>'; });
      } else {
        treeEl.innerHTML = 'loading folders…';
        Promise.resolve(listFolders ? listFolders(selWsPath()) : []).then((out) => {
          if (destroyed) return;
          flat = Array.isArray(out) ? out : [];
          if (chosen) {
            const bad = /^vfs:\/\//i.test(chosen) || /^[A-Za-z]:[\\/]/.test(chosen) || chosen.charAt(0) === '/';
            if (bad) { chosen = ''; renderSel(); }
            else if (!flat.some((f) => f.path === chosen)) flat.unshift({ path: chosen, depth: (chosen.split('/').length - 1) });
          }
          renderEager('');
        }).catch(() => { if (!destroyed) treeEl.innerHTML = '<div style="padding:6px;color:var(--text-muted,#9aa0a6)">(could not load folders — type a path)</div>'; });
      }
    }

    function bindWsSel() {
      wsSelEl = container.querySelector('.afp-ws');
      if (wsSelEl) wsSelEl.addEventListener('change', () => { filterEl.value = ''; renderSel(); loadRoot(); });
    }

    // Filter box. In EAGER mode it filters the flat list live. In LAZY mode we
    // don't have the whole tree, so a plain-text value is treated as a TYPED
    // destination path (so you can still target a not-yet-expanded folder), and
    // the tree stays as-is.
    function onFilter() {
      const v = filterEl.value.trim();
      if (lazy) {
        if (v && !/[\\^$.*+?()[\]{}|]/.test(v)) {
          chosen = v.replace(/^__root\d+\//, '').replace(/^\/+|\/+$/g, '');
          renderSel(); renderLazy();
        }
        return;
      }
      const isRx = /[\\^$.*+?()[\]{}|]/.test(v);
      if (v && !isRx) chosen = v.replace(/^__root\d+\//, '').replace(/^\/+|\/+$/g, '');
      else if (isRx) { const m = makeMatcher(v); const hits = flat.filter((f) => m(f.path)); if (hits.length === 1) chosen = hits[0].path; }
      renderSel(); renderEager(v);
    }

    wsWrap.innerHTML = wsSelMarkup(workspaces);
    bindWsSel();
    filterEl.addEventListener('input', onFilter);
    renderSel();
    loadRoot();

    function setWorkspaces(list) {
      if (destroyed) return;
      workspaces = Array.isArray(list) ? list.slice() : [];
      wsWrap.innerHTML = wsSelMarkup(workspaces);
      bindWsSel();
      filterEl.value = ''; renderSel(); loadRoot();
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      try { filterEl.removeEventListener('input', onFilter); } catch (e) {}
      try { container.innerHTML = ''; } catch (e) {}
    }

    return {
      get: () => (chosen || '').replace(/^__root\d+\//, '').replace(/^\/+|\/+$/g, ''),
      getAbsolute: () => {
        const rel = (chosen || '').replace(/^__root\d+\//, '').replace(/^\/+|\/+$/g, '');
        const wp = selWsPath();
        return rel ? (wp + '/' + rel) : wp;
      },
      workspacePath: selWsPath,
      workspaceId: selWsId,
      setWorkspaces,
      destroy,
    };
  }

  return { create };
})();

if (typeof window !== 'undefined') window.AppUIWorkspaceFolderPicker = AppUIWorkspaceFolderPicker;
