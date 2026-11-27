/*
 * AppUIFileBackend.localDir — file-explorer backend over a local DATA-SOURCE
 * directory (via the file.* tools: file.ls / file.read / file.write).
 *
 * This is the file-world analog of "a PylonDB created from a data source": a
 * data-source directory (e.g. "C:\Users\…\SP1292 Basic RRP in Scheduler")
 * becomes a storage root in the unified tree. Multiple data sources federate
 * into collections (see AppUIFileExplorer collection specs), mirroring how
 * PylonDBs federate into a federation.
 *
 * file.ls returns {entries:[{name,type,path}]} with ABSOLUTE child paths (the
 * local plugin normalises "\\"→"/"), so children already carry a usable path.
 *
 *   AppUIFileBackend.localDir({ sources: [{ name, path }] })
 */
(function (global) {
  'use strict';

  function tool(name, params) {
    // Use a direct /api fetch — robust across pages (AppUIApi.tool can hang for
    // some tools on pages where its transport isn't fully wired).
    return fetch('/api/' + name.replace(/\./g, '/'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params || {}),
    }).then(function (r) { return r.json(); });
  }

  function create(opt) {
    opt = opt || {};
    var sources = opt.sources || [];
    return {
      caps: { rename: false, mkdir: true, upload: true, multiUser: false, dataSource: true },

      // Top-level nodes = the registered data-source directories.
      roots: function () {
        return Promise.resolve(sources.map(function (s) {
          return {
            name: s.name || (s.path || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop(),
            path: s.path,
            icon: s.icon || '🗄️',  // data-source icon
            writable: s.writable === true,  // data sources default READ-ONLY (browse)
            data: { writable: s.writable === true, dataSource: true },
          };
        }));
      },

      list: function (path) {
        return Promise.resolve(tool('file.ls', { path: path })).then(function (r) {
          var entries = (r && r.entries) || [];
          // file.ls already returns {name,type,path}; pass through (filter temp/hidden lock files).
          return { entries: entries.filter(function (e) { return !(e.name || '').startsWith('~$'); }) };
        });
      },

      read: function (node) {
        var p = (node && node.path) || node;
        return Promise.resolve(tool('file.read', { path: p })).then(function (r) {
          return { content: (r && (r.content != null ? r.content : r.text)) || '', encoding: 'text' };
        });
      },

      write: function (path, content) {
        return Promise.resolve(tool('file.write', { path: path, content: content }));
      },

      mkdir: function (path) {
        // No dedicated mkdir tool for local; create via a .keep write (dir is implied).
        return Promise.resolve(tool('file.write', { path: path.replace(/\/+$/, '') + '/.keep', content: '' }));
      },

      // Expose the sources list so a registry/UI can manage it.
      sources: function () { return sources.slice(); },
      addSource: function (s) { if (s && s.path && !sources.some(function (x) { return x.path === s.path; })) sources.push(s); },
    };
  }

  global.AppUIFileBackend = global.AppUIFileBackend || {};
  global.AppUIFileBackend.localDir = create;

  // --- Data-source registry (persisted via config, mirrors VFS mounts.json /
  // the PylonDB federation registry). Key is owned by file_storage, since a data
  // source roots a file_storage-style instance. ---
  var REGISTRY_KEY = 'apps/file_storage/data_sources';
  global.AppUIFileBackend.dataSources = {
    key: REGISTRY_KEY,
    load: function () {
      return Promise.resolve(tool('config.get', { key: REGISTRY_KEY })).then(function (r) {
        return (r && !r._error && Array.isArray(r.sources)) ? r.sources : [];
      }).catch(function () { return []; });
    },
    save: function (sources) {
      return Promise.resolve(tool('config.set', { key: REGISTRY_KEY, value: { sources: sources } }));
    },
    add: function (src) {
      return this.load().then(function (list) {
        if (!src || !src.path) return list;
        if (list.some(function (s) { return s.path === src.path; })) return list;
        list.push({ name: src.name || src.path.replace(/[\\/]+$/, '').split(/[\\/]/).pop(), path: src.path });
        return global.AppUIFileBackend.dataSources.save(list).then(function () { return list; });
      });
    },
    remove: function (path) {
      return this.load().then(function (list) {
        var next = list.filter(function (s) { return s.path !== path; });
        return global.AppUIFileBackend.dataSources.save(next).then(function () { return next; });
      });
    },
  };
})(typeof window !== 'undefined' ? window : this);
