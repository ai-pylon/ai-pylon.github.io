/*
 * AppUIFileBackend.vfs — file-explorer backend adapter over the vfs.* app.
 *
 * Wraps the vfs.* tools (vfs.mounts, vfs.ls, vfs.read, vfs.write, vfs.mkdir,
 * vfs.delete) behind the explorer's backend interface so AppUIFileExplorer can
 * render a hierarchical tree of the VFS mounts. Paths are vfs URIs
 * ("vfs:/<mount>/<sub>"); vfs.ls returns {entries:[{name,type}]} WITHOUT a full
 * path, so this adapter constructs each child's path as "<parent>/<name>".
 *
 * vfs has no native rename → emulated via read + write + delete.
 */
(function (global) {
  'use strict';

  function tool(name, params) {
    // Prefer the shared AppUI API helper; fall back to a direct fetch.
    if (global.AppUIApi && global.AppUIApi.tool) return global.AppUIApi.tool(name, params || {});
    return fetch('/api/' + name.replace(/\./g, '/'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params || {}),
    }).then(function (r) { return r.json(); });
  }

  function join(parent, name) {
    if (!parent) return name;
    return parent.replace(/\/+$/, '') + '/' + name;
  }

  function create(opts) {
    opts = opts || {};
    return {
      caps: { rename: true /* emulated */, mkdir: true, upload: true, multiUser: false },

      // Top-level nodes = the VFS mounts.
      roots: function () {
        return Promise.resolve(tool('vfs.mounts')).then(function (data) {
          var mounts = (data && data.mounts) || [];
          return mounts.map(function (m) {
            var vp = m.virtual_path || m.path || m.name || 'mount';
            var type = m.type || m.backend || '';
            var localTypes = { local: 1 };
            return {
              name: vp + (m.aliases && m.aliases.length ? ' (' + m.aliases.join(', ') + ')' : ''),
              path: 'vfs:/' + vp,
              icon: localTypes[type] ? '💾' : (type === 'github' ? '🐙' : type === 'ssh' ? '🖥️' : type === 'mediawiki' ? '📖' : type === 'confluence' ? '📘' : '🔌'),
              writable: m.writable !== false,
              data: { writable: m.writable !== false, mountType: type },
            };
          });
        });
      },

      // Directory listing → shape to the explorer's {entries:[{name,type,path}]}.
      list: function (path) {
        return Promise.resolve(tool('vfs.ls', { path: path, brief: true })).then(function (data) {
          var entries = (data && data.entries) || [];
          return {
            entries: entries.map(function (e) {
              return { name: e.name, type: e.type, path: join(path, e.name) };
            }),
          };
        });
      },

      read: function (node) {
        var p = (node && node.path) || node;
        return Promise.resolve(tool('vfs.read', { path: p })).then(function (data) {
          return { content: (data && (data.content != null ? data.content : data.text)) || '', encoding: 'text' };
        });
      },

      write: function (path, content) {
        return Promise.resolve(tool('vfs.write', { path: path, content: content }));
      },

      mkdir: function (path) {
        return Promise.resolve(tool('vfs.mkdir', { path: path }));
      },

      delete: function (node) {
        var p = (node && node.path) || node;
        return Promise.resolve(tool('vfs.delete', { path: p }));
      },

      // vfs has no native rename — emulate (read → write new → delete old).
      rename: function (from, to) {
        var self = this;
        return self.read(from).then(function (r) {
          return self.write(to, r.content).then(function () { return self.delete(from); });
        });
      },
    };
  }

  global.AppUIFileBackend = global.AppUIFileBackend || {};
  global.AppUIFileBackend.vfs = create;
})(typeof window !== 'undefined' ? window : this);
