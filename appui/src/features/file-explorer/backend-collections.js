/*
 * AppUIFileCollections — a persisted, shareable registry of file COLLECTIONS.
 *
 * Aligns with pylon-server's federation model: a collection groups storage roots and
 * (recursively) OTHER collections, exactly as the PylonDB federation registry
 * composes databases, or VFS `mounts.json` composes data sources. A collection is
 * DEFINED ONCE in the registry and can then be ADDED to any explorer by id — and
 * because collections can reference other collections, they nest into parent
 * collections. Persisted via `config` (key `apps/file_storage/collections`) so the
 * definition survives reloads and can be shared.
 *
 * Registry entry:
 *   { id, name, icon?, members: [ <memberRef> … ] }
 * memberRef (one of):
 *   { kind:'storage', name, backend:'file_storage'|'vfs'|'local', path?, user?, shareScope?, ... }
 *   { kind:'collection', ref:<collectionId> }   // nested collection
 *
 * resolve(id) → an AppUIFileExplorer COLLECTION SPEC
 *   { type:'collection', name, icon, children:[ storageSpec | collectionSpec … ] }
 * with each storage member turned into a live backend via the matching
 * AppUIFileBackend factory, and nested collection refs resolved recursively.
 */
(function (global) {
  'use strict';

  var KEY = 'apps/file_storage/collections';

  function tool(name, params) {
    return fetch('/api/' + name.replace(/\./g, '/'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params || {}),
    }).then(function (r) { return r.json(); });
  }

  function load() {
    return tool('config.get', { key: KEY }).then(function (r) {
      return (r && !r._error && Array.isArray(r.collections)) ? r.collections : [];
    }).catch(function () { return []; });
  }
  function save(collections) {
    return tool('config.set', { key: KEY, value: { collections: collections } });
  }
  function add(coll) {
    return load().then(function (list) {
      if (!coll || !coll.id) return list;
      var i = list.findIndex(function (c) { return c.id === coll.id; });
      if (i >= 0) list[i] = coll; else list.push(coll);
      return save(list).then(function () { return list; });
    });
  }
  function remove(id) {
    return load().then(function (list) {
      var next = list.filter(function (c) { return c.id !== id; });
      return save(next).then(function () { return next; });
    });
  }

  // Build a live backend + storage spec from a storage memberRef.
  function _storageSpec(m, ctx) {
    var B = global.AppUIFileBackend || {};
    var backend = null;
    if (m.backend === 'vfs' && B.vfs) backend = B.vfs();
    else if (m.backend === 'local' && B.localDir) backend = B.localDir({ sources: [{ name: m.name, path: m.path }] });
    else if (B.fileStorage) backend = B.fileStorage({ user: (m.user || (ctx && ctx.user)), base: (ctx && ctx.base), shareScope: m.shareScope, ownerLabel: m.ownerLabel });
    return {
      name: m.name || m.path || 'storage',
      path: m.path != null ? m.path : (m.shareScope ? ('share:' + m.shareScope) : ''),
      icon: m.icon || (m.backend === 'vfs' ? '🔌' : m.backend === 'local' ? '🗄️' : '📁'),
      writable: m.writable === true,
      backend: backend,
    };
  }

  // Resolve a collection (by id or object) → an explorer collection spec.
  // `all` is the full registry list (for nested-ref lookup); `seen` guards cycles.
  function _resolve(coll, all, ctx, seen) {
    seen = seen || {};
    if (!coll) return null;
    if (seen[coll.id]) return { type: 'collection', name: coll.name + ' (cycle)', icon: '⚠️', children: [] };
    seen[coll.id] = true;
    var children = (coll.members || []).map(function (m) {
      if (m.kind === 'collection') {
        var sub = all.find(function (c) { return c.id === m.ref; });
        return sub ? _resolve(sub, all, ctx, Object.assign({}, seen)) : null;
      }
      return _storageSpec(m, ctx);
    }).filter(Boolean);
    return { type: 'collection', name: coll.name || coll.id, icon: coll.icon || '📚', children: children };
  }

  function resolve(id, ctx) {
    return load().then(function (all) {
      var coll = all.find(function (c) { return c.id === id; });
      return coll ? _resolve(coll, all, ctx || {}, {}) : null;
    });
  }

  global.AppUIFileCollections = {
    key: KEY, load: load, save: save, add: add, remove: remove, resolve: resolve,
    // resolve a collection OBJECT directly (not from the registry) — handy for previews.
    resolveObject: function (coll, all, ctx) { return _resolve(coll, all || [], ctx || {}, {}); },
  };
})(typeof window !== 'undefined' ? window : this);
