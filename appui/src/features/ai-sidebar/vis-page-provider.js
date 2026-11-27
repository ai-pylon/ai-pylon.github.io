// vis-page-provider.js — the LIVE PAGE as a client-side VIS provider (VIS_TODO
// #9). AppUIPageIntrospect already lets a page's assistant drill into the page
// structure node by node ({label, value, children:[{key,label,hint}]}). This
// expresses that SAME tree in the canonical VIS node shape
// ({path, title, kind, description, child_count, has_children}) and the VIS
// primitive surface (children / node / search), so "what's on my screen"
// navigation and data navigation use ONE model: vis://page/<path>.
//
// It is a CLIENT-SIDE provider — served from the page's own JS, not the server
// vis_provider registry (which only sees manifest-declared, server-backed
// providers). A page's assistant that wants page-structure navigation in VIS
// terms calls these methods directly (or an adapter maps the vis.* tool calls
// onto them for a purely client-side chat). The addressing mirrors VIS exactly:
// vis://page/sidebar, vis://page/content/sec0, … with '/' the ONLY separator.
//
// Usage:
//   var prov = AppUIVisPage.create({ appId: 'knowledge/workspace' });  // DOM scan
//   prov.providers();                 // [{name:'page', label, root:'vis://page'}]
//   prov.children('');                // → children of the page root (VIS shape)
//   prov.node('sidebar');             // → one node (VIS shape)
//   prov.search('upload');            // → matching nodes as entry points
// A page can pass its OWN nodes(path) (same shape page-introspect takes) for a
// richer hierarchy than the DOM scan.
(function () {
  'use strict';

  var PROVIDER = 'page';

  function _clip(s, n) {
    s = (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n) + '…' : s;
  }
  function _visUri(path) {
    var p = String(path || '').replace(/^\/+|\/+$/g, '');
    return 'vis://' + PROVIDER + (p ? ('/' + p) : '');
  }

  // Map a page-introspect node ({label,value,children:[{key,label,hint}]}) at
  // `path` to the canonical VIS "opened node" view. A child's `key` is the next
  // path segment; its `hint` is the routing DESCRIPTION (VIS V4 — a parent
  // describes its children).
  function _toVisNode(path, piNode) {
    if (!piNode) {
      return { ok: false, error: 'node "' + path + '" not available', path: path };
    }
    var kids = (piNode.children || []).map(function (c) {
      var childPath = path ? (path + '/' + c.key) : c.key;
      return {
        path: childPath,
        uri: _visUri(childPath),
        title: c.label || c.key,
        kind: 'page-region',
        description: c.hint ? _clip(c.hint, 300) : '',
        child_count: null,            // page-introspect doesn't precount grandkids
        has_children: true            // a page node may always be inspected deeper
      };
    });
    return {
      ok: true,
      path: path,
      uri: _visUri(path),
      title: piNode.label || (path || 'PAGE'),
      kind: path ? 'page-region' : 'page',
      description: '',
      content: (piNode.value != null ? String(piNode.value) : ''),
      attributes: {},
      child_count: kids.length,
      has_children: kids.length > 0,
      children: kids
    };
  }

  function create(opts) {
    opts = opts || {};
    // Reuse page-introspect's node provider: an explicit nodes(path), else the
    // built-in DOM scanner over the standard AppUI regions.
    var PI = (typeof window !== 'undefined') && window.AppUIPageIntrospect;
    var nodesFn = (typeof opts.nodes === 'function')
      ? opts.nodes
      : (PI && PI.scanDomNodes
          ? PI.scanDomNodes(typeof opts.useDom === 'object' ? opts.useDom : { appId: opts.appId || '' })
          : null);

    function _nodes(path) {
      if (!nodesFn) return null;
      try { return nodesFn(path); } catch (_e) { return null; }
    }

    function providers() {
      return [{
        name: PROVIDER, label: (opts.label || 'This page'), icon: '🪟',
        description: 'The LIVE page structure (menu, sidebar, content) as a VIS '
          + 'tree — the same node-by-node page introspection, addressed as '
          + 'vis://page/<region>/<node>.',
        root: _visUri(''), has_search: true, has_neighbors: false,
        client_side: true, app_id: (opts.appId || '')
      }];
    }

    // VIS primitive: children(path) → {ok, children:[VIS node…], total}
    function children(path) {
      var p = String(path || '').replace(/^vis:\/\/page\/?/, '').replace(/^\/+|\/+$/g, '');
      var vn = _toVisNode(p, _nodes(p));
      if (!vn.ok) return { ok: false, error: vn.error, children: [], total: 0 };
      return { ok: true, children: vn.children, total: vn.children.length };
    }

    // VIS primitive: node(path) → opened node (content + children + routing).
    function node(path) {
      var p = String(path || '').replace(/^vis:\/\/page\/?/, '').replace(/^\/+|\/+$/g, '');
      return _toVisNode(p, _nodes(p));
    }

    // VIS primitive: search(query) → entry nodes whose title/description match.
    // Walks the page tree breadth-first to a bounded depth (the page tree is
    // small) and ranks by term overlap — the client-side analogue of a provider
    // search_op, so "where's the upload button" jumps straight to its region.
    function search(query, limit) {
      var terms = String(query || '').toLowerCase().match(/[a-z0-9]+/g) || [];
      if (!terms.length) return { ok: true, query: query, hits: [], count: 0 };
      var hits = [];
      var seen = {};
      var queue = ['']; // BFS from root
      var guard = 0;
      while (queue.length && guard < 200) {
        guard++;
        var cur = queue.shift();
        if (seen[cur]) continue;
        seen[cur] = 1;
        var vn = _toVisNode(cur, _nodes(cur));
        if (!vn.ok) continue;
        (vn.children || []).forEach(function (c) {
          var hay = ((c.title || '') + ' ' + (c.description || '')).toLowerCase();
          var score = 0;
          terms.forEach(function (t) { if (hay.indexOf(t) >= 0) score++; });
          if (score > 0) hits.push({ uri: c.uri, path: c.path, title: c.title,
                                     kind: c.kind, description: c.description, score: score });
          if (c.path && c.path.split('/').length < 3) queue.push(c.path);
        });
      }
      hits.sort(function (a, b) { return b.score - a.score; });
      hits = hits.slice(0, limit || 20);
      return { ok: true, query: query, hits: hits, count: hits.length };
    }

    return {
      PROVIDER: PROVIDER,
      providers: providers,
      children: children,
      node: node,
      search: search,
      // the vis:// uri helper, exposed for a page wiring its own citations
      uri: _visUri
    };
  }

  if (typeof window !== 'undefined') {
    window.AppUIVisPage = { create: create, PROVIDER: PROVIDER };
  }
})();
