/* Per-instance VIS cards, sections, headers and leaf rendering. */
const _AppUIVisExplorerView = (() => {
  function create({opts, R, api, sectionCache, open, getState, getApi, kindIcon, esc, providerOf}) {
    function deco(node, ctx) {
      let d = null;
      try { d = opts.decorate ? opts.decorate(node, ctx || {}) : null; } catch (e) { console.warn('[AppUIVisExplorer] decorate', e); }
      d = d || {};
      return {
        icon: d.icon || kindIcon(node.kind), hue: d.hue || '', title: d.title || node.title || node.path || node.uri,
        subtitle: d.subtitle != null ? d.subtitle : (node.path || ''), badges: d.badges || [], actions: d.actions || [],
        hidden: !!d.hidden, onClick: d.onClick || null,
      };
    }
    function actionsHtml(acts, btn) {
      return acts.map((a, i) => a.href
        ? '<a class="vx-act' + (btn ? ' btn' : '') + (a.primary ? ' primary' : '') + (a.cls ? ' ' + a.cls : '') + '" data-act="' + i + '" href="' + esc(a.href) + '"' +
          (a.title ? ' title="' + esc(a.title) + '"' : '') + (a.newTab ? ' target="_blank" rel="noopener"' : '') + '>' + a.label + '</a>'
        : '<button class="vx-act' + (btn ? ' btn' : '') + (a.primary ? ' primary' : '') + (a.cls ? ' ' + a.cls : '') + '" data-act="' + i + '"' +
          (a.title ? ' title="' + esc(a.title) + '"' : '') + '>' + a.label + '</button>').join('');
    }
    function wireActions(el, acts, node) {
      el.querySelectorAll('[data-act]').forEach(b => {
        const a = acts[+b.getAttribute('data-act')];
        b.addEventListener('click', e => {
          e.stopPropagation();
          if (a && a.run) { e.preventDefault(); a.run(node, e, getApi()); }
        });
      });
    }

    function card(node, ctx) {
      const d = deco(node, ctx);
      if (d.hidden) return null;
      const el = document.createElement('div');
      el.className = 'vx-card';
      el.tabIndex = 0;
      if (d.hue) el.style.setProperty('--vx-hue', d.hue);
      const count = (node.badge ? '<span class="vx-tag vx-badge" title="' + esc(node.badge) + '">' + esc(node.badge) + '</span>' : '') +
        (node.child_count ? '<span class="vx-tag">' + node.child_count + ' ' +
        (node.kind === 'app' ? 'tool' : 'item') + (node.child_count > 1 ? 's' : '') + '</span>' : '');
      el.innerHTML = '<div class="top"><span class="vx-ic"' + (d.hue ? ' style="--vx-hue:' + d.hue + '"' : '') + '>' + d.icon + '</span>' +
        '<div class="tt"><div class="t">' + esc(d.title) + '</div>' + (d.subtitle ? '<div class="p">' + esc(d.subtitle) + '</div>' : '') + '</div></div>' +
        '<div class="d">' + esc(node.description || '') + '</div>' +
        '<div class="ft">' + count + d.badges.join('') + '<span class="grow"></span>' + actionsHtml(d.actions) + '</div>';
      wireActions(el, d.actions, node);
      const go = e => {
        if (e && e.target.closest('a[href]')) return;            // real links navigate
        if (d.onClick && d.onClick(e, node, getApi()) === true) return;
        open(node.uri);
      };
      el.addEventListener('click', go);
      el.addEventListener('keydown', e => { if (e.key === 'Enter') go(e); });
      return el;
    }
    function grid(nodes, ctx) {
      const g = document.createElement('div');
      g.className = 'vx-grid';
      let n = 0;
      nodes.forEach(c => { const el = card(c, ctx); if (el) { g.appendChild(el); n++; } });
      return {el: g, count: n};
    }
    function msg(icon, text) { return '<div class="vx-msg"><div class="big">' + icon + '</div>' + text + '</div>'; }

    function renderProviders() {
      const {providers, cur} = getState();
      const box = R('prov');
      if (!opts.providers || providers.length < 2) { box.style.display = 'none'; return; }
      box.style.display = '';
      const p = providerOf(cur && cur.uri);
      box.innerHTML = providers.map(pr => '<span class="vx-prov' + (pr.name === p ? ' on' : '') + '" data-uri="' + esc(pr.root) +
        '" title="' + esc(pr.description || '') + '">' + esc(pr.icon || '') + ' ' + esc(pr.label || pr.name) + '</span>').join('');
      box.querySelectorAll('[data-uri]').forEach(x => x.onclick = () => open(x.getAttribute('data-uri')));
    }
    function renderCrumbs(node) {
      const {mode, lastQuery, cur} = getState();
      const box = R('crumbs');
      if (mode === 'search') {
        box.innerHTML = '<a href="#" data-uri="' + esc(cur ? cur.uri : '') + '">← back</a><span class="cur">Search: “' + esc(lastQuery) + '”</span>';
      } else {
        const anc = node.ancestors || [];
        box.innerHTML = anc.map(a => '<a href="#" data-uri="' + esc(a.uri) + '">' + esc(deco(a, {crumb: true}).title) + '</a><span>›</span>').join('') +
          '<span class="cur">' + esc(deco(node, {crumb: true}).title) + '</span>';
      }
      box.querySelectorAll('[data-uri]').forEach(a => a.onclick = e => { e.preventDefault(); open(a.getAttribute('data-uri')); });
    }
    function renderHead(node) {
      const {mode, providers, seq} = getState();
      const box = R('head');
      if (mode === 'search' || !(node.ancestors || []).length) { box.innerHTML = ''; return; }   // root/search: no header
      const d = deco(node, {header: true});
      // provider-declared external links (e.g. "open the original spec chapter")
      (node.links || []).forEach(lk => {
        if (lk && lk.href) d.actions.push({label: esc(lk.label || 'Open source') + ' ↗', href: lk.href,
          title: lk.title || lk.href, newTab: true});
      });
      const attrs = Object.entries(node.attributes || {}).filter(([k, v]) => v != null && typeof v !== 'object' && k !== 'app_id');
      const prov = providers.find(p => p.name === providerOf(node.uri));
      box.innerHTML = '<div class="vx-head"><span class="vx-ic"' + (d.hue ? ' style="--vx-hue:' + d.hue + '"' : '') + '>' + d.icon + '</span>' +
        '<div style="min-width:0;flex:1"><div class="t">' + esc(d.title) + ' <span class="vx-tag">' + esc(node.kind || '') + '</span>' +
        attrs.map(([k, v]) => ' <span class="vx-tag">' + esc(k.replace(/_/g, ' ')) + ': ' + esc(v) + '</span>').join('') + d.badges.join('') + '</div>' +
        '<div class="d">' + esc(node.description || '') + '</div>' +
        (d.actions.length ? '<div class="acts">' + actionsHtml(d.actions, true) + '</div>' : '') +
        '<div class="vx-rel" data-r="rel" hidden></div></div></div>';
      wireActions(box, d.actions, node);
      // RELATED: the provider's neighbors (cross-links, possibly into ANOTHER
      // provider — e.g. a 3GPP NRM class ↔ its Ericsson MOM class).
      if (prov && prov.has_neighbors) {
        const my = seq;
        api('neighbors', {uri: node.uri}).then(r => {
          const nb = (r && r.ok && r.neighbors) || [];
          const rel = box.querySelector('[data-r="rel"]');
          if (my !== getState().seq || getState().destroyed || !rel || !nb.length) return;
          rel.hidden = false;
          rel.innerHTML = '<span class="lbl">Related</span>' + nb.map((n, i) => {
            const p2 = providers.find(p => p.name === providerOf(n.uri));
            return '<a href="#" data-i="' + i + '" title="' + esc(n.description || n.uri) + '">' +
              esc((p2 && p2.icon) || '🔗') + ' ' + esc(n.title || n.uri) + '</a>';
          }).join('');
          rel.querySelectorAll('a[data-i]').forEach(a => a.onclick = e => {
            e.preventDefault(); open(nb[+a.getAttribute('data-i')].uri);
          });
        }).catch(() => {});
      }
    }

    async function renderBody(node, my) {
      const body = R('body');
      const kids = node.children || [];
      if (!kids.length) { renderLeafView(node, body); return; }
      // A BRANCH node can carry content too (e.g. an ASN.1 IE: its spec text,
      // definition, field descriptions) — show it above the children.
      const contentPanel = () => {
        if (!node.content) return null;
        const det = document.createElement('details');
        det.className = 'vx-content';
        det.open = node.content.length < 6000;
        det.innerHTML = '<summary>Spec text' + (node.trimmed ? ' (trimmed)' : '') + '</summary>' +
          '<pre class="vx-pre">' + esc(node.content) + '</pre>';
        return det;
      };
      // A node whose children themselves branch → SECTIONS (one expand depth=2),
      // so a catalog root shows every group with its apps in one view.
      const branchy = kids.filter(k => k.has_children).length;
      if (branchy >= 2 && branchy === kids.length && kids.length <= 24) {
        let ex = sectionCache.get(node.uri);
        if (!ex) {
          ex = await api('expand', {uri: node.uri, depth: 2});
          if (my !== getState().seq || getState().destroyed) return;
          // A section's sub-GROUPS (e.g. the tool catalog's categories platform/shell,
          // platform/tools) are opened in place, so a section lists its real items (the
          // apps), not one folder per category. Items and leaves stay as they are.
          if (ex && ex.ok) {
            await Promise.all((ex.children || []).map(async sec => {
              const subs = (sec.children || []).filter(c => c.kind === 'group' && c.has_children);
              if (!subs.length) return;
              const got = await Promise.all(subs.map(c =>
                Promise.resolve(api('expand', {uri: c.uri, depth: 1})).catch(() => null)));
              const inner = new Map(subs.map((c, i) => [c.uri, got[i] && got[i].ok ? got[i].children || [] : null]));
              sec.children = (sec.children || []).flatMap(c => inner.get(c.uri) || [c]);
            }));
            if (my !== getState().seq || getState().destroyed) return;
          }
          if (ex && ex.ok) sectionCache.set(node.uri, ex);
        }
        if (ex && ex.ok) {
          const frag = document.createDocumentFragment();
          let shown = 0;
          (ex.children || []).forEach(sec => {
            const d = deco(sec, {section: true});
            if (d.hidden) return;
            const g = grid(sec.children || [], {parent: sec});
            if (!g.count) return;
            shown += g.count;
            const wrap = document.createElement('div');
            wrap.className = 'vx-sec';
            wrap.innerHTML = '<div class="sh" title="Open ' + esc(d.title) + '"><span>' + d.icon + '</span>' + esc(d.title) +
              ' <span class="n">' + g.count + '</span><span class="go">open ›</span></div>';
            wrap.querySelector('.sh').onclick = () => open(sec.uri);
            wrap.appendChild(g.el);
            frag.appendChild(wrap);
          });
          body.replaceChildren(frag);
          if (!shown) body.innerHTML = msg('🔭', 'Nothing to show with the current filters.');
          const cp1 = contentPanel(); if (cp1) body.prepend(cp1);
          return;
        }
      }
      const g = grid(kids, {parent: node});
      body.replaceChildren(g.el);
      if (!g.count) body.innerHTML = msg('🔭', 'Nothing to show with the current filters.');
      const cp2 = contentPanel(); if (cp2) body.prepend(cp2);
      if (node.next_page != null || node.has_more) {
        const more = document.createElement('div');
        more.className = 'vx-more';
        more.innerHTML = '<button class="vx-act btn">Load more</button>';
        more.firstChild.onclick = async () => {
          const requestSeq = getState().seq;
          const button = more.firstChild;
          if (button.disabled) return;
          button.disabled = true;
          try {
            const r = await api('expand', {uri: node.uri, depth: 1, page: (node._page || 0) + 1});
            if (requestSeq !== getState().seq || getState().destroyed) return;
            if (r && r.ok) { node._page = (node._page || 0) + 1; node.children = kids.concat(r.children || []); renderBody(node, requestSeq); }
          } catch (_error) {
            // Keep the existing cards; the same page can be retried.
          } finally {
            button.disabled = false;
          }
        };
        body.appendChild(more);
      }
    }
    function renderLeafView(node, body) {
      const el = document.createElement('div');
      el.className = 'vx-leaf';
      const params = node.attributes && node.attributes.params;
      let h = '';
      if (params && typeof params === 'object' && Object.keys(params).length) {
        h += '<div><div class="lbl">Parameters</div><div class="vx-kv">' + Object.entries(params).map(([k, v]) =>
          '<span class="k">' + esc(k) + '</span><span class="v">' + esc(typeof v === 'string' ? v : JSON.stringify(v)) + '</span>').join('') + '</div></div>';
      } else if (node.kind === 'tool') {
        h += '<div><div class="lbl">Parameters</div><div class="v" style="color:var(--text-muted)">none</div></div>';
      }
      const other = Object.entries(node.attributes || {}).filter(([k, v]) => k !== 'params' && v != null && typeof v === 'object');
      other.forEach(([k, v]) => { h += '<div><div class="lbl">' + esc(k) + '</div><pre class="vx-pre">' + esc(JSON.stringify(v, null, 2)) + '</pre></div>'; });
      if (node.content && node.content !== node.description && !(params && node.kind === 'tool')) {
        h += '<div><div class="lbl">Content' + (node.trimmed ? ' (trimmed)' : '') + '</div><pre class="vx-pre">' + esc(node.content) + '</pre></div>';
      }
      el.innerHTML = h || msg('🍃', 'This is a leaf — no further detail.');
      body.replaceChildren(el);
      try { if (opts.renderLeaf) opts.renderLeaf(node, el, getApi()); } catch (e) { console.warn('[AppUIVisExplorer] renderLeaf', e); }
    }

    return {grid, msg, renderProviders, renderCrumbs, renderHead, renderBody};
  }
  return {create};
})();
