/** Internal ChatSurface tools dialog; core supplies instance dependencies. */
window._AppUIChatSurfaceTools = (() => {
  // Shared catalog-tree cache (#15): the fetched {tools,nodeDesc} model is
  // identical for every surface pointed at the same catalog, so cache it
  // module-wide keyed by catalogBase and share the in-flight promise. Without
  // this, each surface instance (e.g. a page's chat + the catalog page itself)
  // independently re-fetched + re-derived the whole ~560-tool model. A caller
  // can bust it by bumping its catalog signature (see _sharedTree key).
  const _treeCache = new Map();   // key -> Promise<{tools, nodeDesc}>
  function _sharedTree(key, fetchFn) {
    if (_treeCache.has(key)) return _treeCache.get(key);
    const p = Promise.resolve().then(fetchFn).catch((_e) => ({ tools: [], nodeDesc: {} }));
    _treeCache.set(key, p);
    // If the fetch resolved empty (catalog not ready), drop it so a later open retries.
    p.then((v) => { if (!v || !v.tools || !v.tools.length) _treeCache.delete(key); });
    return p;
  }

  function create({ state, Dialog, esc, call, catalog, refreshScopeBtn, onApply }) {
    // ---- Tools & system-prompt dialog (catalog scope tree) ------------------
    async function openSettings() {
      if (!state.tree) {
        // Share the fetched+normalized catalog tree across surfaces (#15),
        // keyed by this surface's catalog base so distinct catalogs don't mix.
        const key = state.catalogBase || '/v1/apps/platform/tool_catalog';
        state.tree = await _sharedTree(key, async () => {
          // LITE tree (the dialog never shows params) + revalidation: the last tree is kept per catalog in
          // sessionStorage with its sig; the server answers {unchanged} when nothing moved (#32)
          const sk = 'appui.toolTree:' + key;
          let kept = null;
          try { kept = JSON.parse(sessionStorage.getItem(sk) || 'null'); } catch (_e) { kept = null; }
          let r = {};
          try { r = await catalog('tree', kept && kept.sig ? { lite: true, if_sig: kept.sig } : { lite: true }, 15000); } catch (_e) { r = {}; }
          if (r && r.unchanged && kept) return { tools: kept.tools || [], nodeDesc: kept.nodeDesc || {} };
          const nodeDesc = {};
          ((r && r.nodes) || []).forEach(n => { nodeDesc[n.path] = n.description || ''; });
          const tools = (r && r.tools) || [];
          if (r && r.sig && tools.length) {
            try { sessionStorage.setItem(sk, JSON.stringify({ sig: r.sig, tools, nodeDesc })); } catch (_e) { /* quota */ }
          }
          return { tools, nodeDesc };
        });
      }
      if (!state.mandatory) {
        let c = {};
        try { c = await call('config', {}, 10000); } catch (_e) { c = {}; }
        state.mandatory = (c && c.mandatory_resolved) || [];
        state.mandatoryPats = (c && c.mandatory_tools) || [];
      }
      const tools = state.tree.tools, nodeDesc = state.tree.nodeDesc;
      const byId = {}; tools.forEach(t => { byId[t.id] = t; });
      // the tree follows the catalog's BROWSE placement (manifest category: t.app_path), not the app id
      function segsOf(id, t) { const dot = id.lastIndexOf('.'); return {segs: ((t && t.app_path) || id.slice(0, dot)).split('/'), op: id.slice(dot + 1)}; }
      const troot = {name: '', path: '', children: new Map(), tools: []};
      tools.forEach(t => {
        const {segs} = segsOf(t.id, t);
        let node = troot, acc = '';
        segs.forEach(seg => { acc = acc ? acc + '/' + seg : seg;
          if (!node.children.has(seg)) node.children.set(seg, {name: seg, path: acc, children: new Map(), tools: []});
          node = node.children.get(seg); });
        node.tools.push(t);
      });
      function idsUnder(node) { let ids = node.tools.map(t => t.id); node.children.forEach(c => { ids = ids.concat(idsUnder(c)); }); return ids; }
      const selected = new Set();
      const allIds = idsUnder(troot);
      function matchesPattern(id, pat) {
        if (pat === '*' || pat === 'all') return true;
        if (pat === id) return true;
        const appId = id.slice(0, id.lastIndexOf('.'));
        const ap = (byId[id] && byId[id].app_path) || appId;   // a saved tree path (category placement) selects too
        return appId === pat || (appId + '/').startsWith(pat + '/') || ap === pat || (ap + '/').startsWith(pat + '/');
      }
      (state.scope || []).forEach(pat => { allIds.forEach(id => { if (matchesPattern(id, pat)) selected.add(id); }); });
      let flatten = !!state.flatten;

      const body = document.createElement('div');
      body.style.cssText = 'display:flex;flex-direction:column;gap:10px;min-width:640px';
      const toolHdr = document.createElement('div');
      toolHdr.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap';
      toolHdr.innerHTML =
        '<div style="font-size:12px;font-weight:600">Tool scope</div><span style="flex:1"></span>' +
        '<button type="button" id="tt-selall" class="tt-ctl">Select all</button>' +
        '<button type="button" id="tt-deselall" class="tt-ctl">Deselect all</button>' +
        '<button type="button" id="tt-expand" class="tt-ctl">Expand all</button>' +
        '<button type="button" id="tt-collapse" class="tt-ctl">Collapse all</button>';
      const banner = document.createElement('div');
      banner.style.cssText = 'font-size:11px;padding:5px 8px;border-radius:var(--radius-sm);'
        + 'background:var(--bg-active);border:1px solid var(--border);display:flex;align-items:center;gap:8px';
      const flattenWrap = document.createElement('label');
      flattenWrap.style.cssText = 'display:flex;align-items:center;gap:5px;font-size:11px;cursor:pointer;white-space:nowrap';
      flattenWrap.innerHTML = '<input type="checkbox" id="tt-flatten"' + (flatten ? ' checked' : '') + '> flatten (send ALL leaf descriptions)';
      const bannerText = document.createElement('span'); bannerText.id = 'tt-mode'; bannerText.style.flex = '1';
      banner.append(bannerText, flattenWrap);
      const treeHost = document.createElement('div');
      treeHost.style.cssText = 'max-height:42vh;overflow:auto;border:1px solid var(--border);'
        + 'border-radius:var(--radius-sm);padding:4px;background:var(--bg)';
      const prevWrap = document.createElement('div');
      prevWrap.innerHTML = '<div style="font-size:12px;font-weight:600;margin:2px 0 4px">Final system prompt (preview)</div>';
      const prev = document.createElement('pre'); prev.id = 'tt-preview';
      prev.style.cssText = 'margin:0;max-height:22vh;overflow:auto;font-size:11px;white-space:pre-wrap;'
        + 'background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);padding:7px 9px;color:var(--text-muted)';
      prevWrap.appendChild(prev);
      body.append(toolHdr, banner, treeHost, prevWrap);
      // #25: tools WIRED into this chat (🔌) are not part of this selection - they travel separately as
      // extra_scope and are added on every message - but show them so the dialog tells the whole story.
      if (state.wiredScope && state.wiredScope.length) {
        const wiredNote = document.createElement('div');
        wiredNote.className = 'cs-wired-meta';
        wiredNote.style.cssText = 'font-size:11px;padding:5px 8px;border-radius:var(--radius-sm);border:1px dashed var(--border);color:var(--text-muted)';
        wiredNote.textContent = '🔌 Also wired into this chat (added on every message, kept when you Apply here): '
          + state.wiredScope.join(', ')
          + ((state.wiredWorkflows && state.wiredWorkflows.length) ? ' · workflows: ' + state.wiredWorkflows.map(w => w.name || w.id || w).join(', ') : '');
        body.insertBefore(wiredNote, prevWrap);
      }

      function setTri(cb, node) {
        const ids = idsUnder(node), on = ids.filter(id => selected.has(id)).length;
        cb.checked = on > 0 && on === ids.length; cb.indeterminate = on > 0 && on < ids.length;
      }
      const groupCbs = [];
      function refreshAllTri() { groupCbs.forEach(({cb, node}) => setTri(cb, node)); }
      function renderNode(node, depth) {
        const det = document.createElement('details'); det.className = 'tt-group';
        det.style.marginLeft = depth ? '14px' : '0'; det.open = false;
        const sum = document.createElement('summary');
        const twist = document.createElement('span'); twist.className = 'tt-twist'; twist.textContent = '▸';
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.title = 'Select everything under ' + node.path;
        const label = document.createElement('span');
        label.innerHTML = esc(node.name) + ' <span class="tt-count">(' + idsUnder(node).length + ')</span>';
        sum.append(twist, cb, label);
        const d = document.createElement('span'); d.className = 'tt-desc';
        d.style.marginLeft = '8px'; d.setAttribute('data-ndesc', node.path);
        d.textContent = nodeDesc[node.path] || ''; sum.appendChild(d); det.appendChild(sum);
        det.addEventListener('toggle', () => { if (det.open && !det._descFetched) { det._descFetched = true; lazyFetchDescriptions(node.path); } });
        groupCbs.push({cb, node}); setTri(cb, node);
        cb.addEventListener('click', e => e.stopPropagation());
        cb.addEventListener('change', () => {
          const ids = idsUnder(node), allOn = ids.every(id => selected.has(id));
          ids.forEach(id => { if (allOn) selected.delete(id); else selected.add(id); });
          treeHost.querySelectorAll('input[data-tool]').forEach(tc => { tc.checked = selected.has(tc.getAttribute('data-tool')); });
          refreshAllTri(); refreshState();
        });
        [...node.children.entries()].sort((a, b) => a[0].localeCompare(b[0])).forEach(([, child]) => det.appendChild(renderNode(child, depth + 1)));
        node.tools.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach(t => {
          const row = document.createElement('label'); row.className = 'tt-tool'; row.title = t.id;
          row.style.marginLeft = (depth + 1) * 14 + 'px';
          const tc = document.createElement('input'); tc.type = 'checkbox';
          tc.setAttribute('data-tool', t.id); tc.checked = selected.has(t.id);
          tc.addEventListener('change', () => { if (tc.checked) selected.add(t.id); else selected.delete(t.id); refreshAllTri(); refreshState(); });
          const opName = t.id.slice(t.id.lastIndexOf('.') + 1);
          const nm = document.createElement('span'); nm.className = 'tt-name'; nm.textContent = opName;
          const ds = document.createElement('span'); ds.className = 'tt-desc'; ds.textContent = t.description || '';
          row.append(tc, nm, ds); det.appendChild(row);
        });
        return det;
      }
      function buildMandatoryPins() {
        // Pinned, READ-ONLY "always-on" tools at the top of the tree so the user
        // sees what's injected into EVERY turn regardless of the scope selection
        // (they used to appear only in the preview text). Not selectable — they
        // are always available by config (mandatory_tools).
        const mand = (state.mandatory || []);
        if (!mand.length) return null;
        const box = document.createElement('div');
        box.className = 'tt-mandatory';
        box.style.cssText = 'margin:0 0 6px;padding:5px 7px;border:1px dashed var(--border);'
          + 'border-radius:var(--radius-sm);background:var(--bg-active)';
        const hdr = document.createElement('div');
        hdr.style.cssText = 'font-size:11px;font-weight:600;color:var(--text-muted);display:flex;align-items:center;gap:6px;margin-bottom:3px';
        hdr.innerHTML = '\ud83d\udccc Always-on tools <span style="font-weight:400">(always available \u2014 no selection needed)</span>';
        box.appendChild(hdr);
        mand.slice().sort((a, b) => String(a.id).localeCompare(String(b.id))).forEach(t => {
          const row = document.createElement('div');
          row.className = 'tt-tool tt-mandatory-row';
          row.title = t.id + ' \u2014 always available (mandatory_tools)';
          row.style.cssText = 'display:flex;align-items:center;gap:6px;opacity:0.85;font-size:11px;padding:1px 2px';
          const lock = document.createElement('span'); lock.textContent = '\ud83d\udd12'; lock.style.fontSize = '10px';
          const nm = document.createElement('span'); nm.className = 'tt-name'; nm.textContent = t.id;
          const ds = document.createElement('span'); ds.className = 'tt-desc'; ds.textContent = t.description || '';
          row.append(lock, nm, ds); box.appendChild(row);
        });
        return box;
      }
      function buildTree() {
        treeHost.replaceChildren(); groupCbs.length = 0;
        const pins = buildMandatoryPins(); if (pins) treeHost.appendChild(pins);
        [...troot.children.entries()].sort((a, b) => a[0].localeCompare(b[0])).forEach(([, child]) => treeHost.appendChild(renderNode(child, 0)));
      }
      buildTree();
      function collectPatterns(node) {
        const ids = idsUnder(node);
        if (ids.length && ids.every(id => selected.has(id))) return [node.path];
        let out = []; node.children.forEach(c => { out = out.concat(collectPatterns(c)); });
        node.tools.forEach(t => { if (selected.has(t.id)) out.push(t.id); });
        return out;
      }
      function level1Lines() { return [...troot.children.keys()].sort().map(seg => '- ' + seg + ' — ' + (nodeDesc[seg] || seg)); }
      function leafLines() { const sel = []; tools.forEach(t => { if (selected.has(t.id)) sel.push('- ' + t.id + ' — ' + (t.description || '')); }); return sel; }
      function mandatoryReadyLines() {
        return (state.mandatory || []).slice().sort((a, b) => String(a.id).localeCompare(String(b.id))).map(t => {
          const p = t.params || {};
          const sig = Object.keys(p).length ? Object.keys(p).map(k => k + ': ' + p[k]).join(', ') : '(no params)';
          return '- ' + t.id + '(' + sig + ') — ' + (t.description || '');
        });
      }
      function mandatoryReadyBlock() {
        const lines = mandatoryReadyLines(); if (!lines.length) return '';
        return 'ALWAYS-AVAILABLE TOOLS — invoke DIRECTLY (schemas given, no catalog_detail needed):\n'
          + lines.join('\n') + '\nCall: {"tool":"invoke","args":{"id":"<app_id>.<op>","args":{...}}}.';
      }
      function buildPreview() {
        const sys = (state.system || '').trim();
        const pats = collectPatterns(troot), hasSel = pats.length > 0, useLeaf = hasSel || flatten;
        let block;
        if (useLeaf) {
          const lines = hasSel ? leafLines() : tools.map(t => '- ' + t.id + ' — ' + (t.description || ''));
          block = 'You can use a SELECTED set of platform tools (below). Only their one-line '
            + 'descriptions are shown — pull a tool\'s exact parameters with catalog_detail '
            + 'ONLY when you\'re about to call it, then invoke it. To act, reply with ONE '
            + 'json object on its own line and NOTHING else:\n'
            + '  {"tool":"catalog_detail","args":{"names":["<id>"]}}   — exact params for a tool\n'
            + '  {"tool":"invoke","args":{"id":"<id>","args":{...}}}   — EXECUTE a selected tool\n'
            + 'I will run it and reply \'TOOL RESULT: <json>\'. When you can answer the '
            + 'user, reply NORMALLY in prose (no json). You may ONLY invoke tools from this list:\n'
            + (lines.join('\n') || '(none)');
        } else {
          block = 'You can use the platform\'s TOOL CATALOG, HIERARCHICALLY. You are shown the '
            + 'top-level GROUPS and what each is for; DRILL DOWN on demand — browse a '
            + 'group/app, then pull a tool\'s detail, then invoke it. Reply with ONE json '
            + 'object on its own line to act:\n'
            + '  {"tool":"catalog_browse","args":{"group":"<path>"}}   — list a group/app\'s tools\n'
            + '  {"tool":"catalog_detail","args":{"names":["<id>"]}}   — exact params for a tool\n'
            + '  {"tool":"invoke","args":{"id":"<id>","args":{...}}}   — EXECUTE a tool\n'
            + 'I will run it and reply \'TOOL RESULT: <json>\'. Only pull detail for tools '
            + 'you\'ll invoke. Top-level groups:\n' + level1Lines().join('\n');
        }
        const mand = mandatoryReadyBlock();
        if (mand) block = mand + '\n\n' + block;
        return sys ? (sys + '\n\n' + block) : block;
      }
      function modeText() {
        const pats = collectPatterns(troot); let m;
        if (pats.length) m = 'Mode: all-leaf-descriptions — ' + pats.length + ' pattern' + (pats.length > 1 ? 's' : '') + ' selected (' + selected.size + ' tools)';
        else if (flatten) m = 'Mode: all-leaf-descriptions — FLATTEN (every tool\'s description sent)';
        else m = 'Mode: multi-turn (hierarchical) — level-1 group descriptions first, drill down on demand';
        const n = (state.mandatory || []).length;
        return m + (n ? ('  ·  ' + n + ' always-available tool' + (n === 1 ? '' : 's') + ' (' + (state.mandatoryPats || []).join(', ') + ')') : '');
      }
      function refreshState() {
        const el = body.querySelector('#tt-mode'); if (el) el.textContent = modeText();
        const p = body.querySelector('#tt-preview'); if (p) p.textContent = buildPreview();
      }
      function setAll(on) {
        if (on) allIds.forEach(id => selected.add(id)); else selected.clear();
        treeHost.querySelectorAll('input[data-tool]').forEach(tc => { tc.checked = selected.has(tc.getAttribute('data-tool')); });
        refreshAllTri(); refreshState();
      }
      function setOpen(open) { treeHost.querySelectorAll('details.tt-group').forEach(d => { d.open = open; }); }
      body.querySelector('#tt-selall').addEventListener('click', () => setAll(true));
      body.querySelector('#tt-deselall').addEventListener('click', () => setAll(false));
      body.querySelector('#tt-expand').addEventListener('click', () => setOpen(true));
      body.querySelector('#tt-collapse').addEventListener('click', () => setOpen(false));
      body.querySelector('#tt-flatten').addEventListener('change', e => { flatten = e.target.checked; refreshState(); });
      const _lazyDone = new Set();
      function applyNodeDescs(nodes) {
        let changed = false;
        (nodes || []).forEach(n => {
          if (n.description && nodeDesc[n.path] !== n.description) {
            nodeDesc[n.path] = n.description; changed = true;
            const span = treeHost.querySelector('[data-ndesc="' + CSS.escape(n.path) + '"]');
            if (span) span.textContent = n.description;
          }
        });
        if (changed) refreshState(); return changed;
      }
      function lazyFetchDescriptions(path) {
        catalog('describe', {patterns: [path]}, 10000).then(r => {
          applyNodeDescs(r && r.nodes);
          if (!_lazyDone.has(path)) {
            _lazyDone.add(path);
            setTimeout(() => { if (!document.body.contains(treeHost)) return;
              catalog('describe', {patterns: [path]}, 10000).then(r2 => applyNodeDescs(r2 && r2.nodes)).catch(() => {}); }, 3000);
          }
        }).catch(() => {});
      }
      refreshState();
      (function primeTopLevel() {
        const once = () => { if (!document.body.contains(treeHost)) return;
          catalog('describe', {}, 10000).then(r => applyNodeDescs(r && r.nodes)).catch(() => {}); };
        setTimeout(once, 300); setTimeout(once, 3500);
      })();
      function apply() {
        state.scope = collectPatterns(troot);
        state.flatten = flatten;
        state.progressive = (state.scope.length === 0) && !flatten;
        refreshScopeBtn();
        try { if (typeof onApply === 'function') onApply(); } catch (_e) {}
      }
      if (Dialog) Dialog.show({title: 'Tools', body, width: '760px',
        buttons: [{text: 'Cancel'}, {text: 'Apply', primary: true, action: apply}]});
      else apply();
    }
    return { openSettings };
  }
  return { create };
})();
