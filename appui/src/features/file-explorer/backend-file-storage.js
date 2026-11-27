/*
 * AppUIFileBackend.fileStorage — file-explorer backend over the file_storage app.
 *
 * The file_storage `/v1/files` endpoint returns a FLAT listing — files[] whose
 * `name` is a relative path (may contain "/") plus explicit folders[] — scoped to
 * a user (via the `X-User` header). This adapter fetches that flat list ONCE
 * (cached), then serves the explorer's per-folder `list(path)` by deriving the
 * immediate children (sub-folders + files) under each path. file_storage has
 * NATIVE rename + mkdir (unlike vfs).
 *
 * Multi-user: pass `user` (string or getter) for "my storage". For "another
 * user's storage" (a share), pass `shareScope` = the shared folder prefix (e.g.
 * "alice/project") and this adapter surfaces only names under that prefix from
 * the viewer's own listing's `shared[]` set.
 *
 * Base-URL resolution is delegated to FilesPanel.resolveBase (same fleet/registry
 * logic), so this adapter has no hard-coded file-storage URL.
 *
 * LARGE STORES (opt-in): pass ``lazyListing: true`` to fetch only ONE folder at a
 * time via the server's ``/v1/files?prefix=`` filter (per-folder cache) instead
 * of pulling the whole account listing up front. Off by default — the default
 * full-listing path is unchanged. Lazy mode targets own/common roots; it does
 * not surface ``shared[]`` entries (those live outside any single prefix), so
 * leave it off for ``shareScope`` roots.
 */
(function (global) {
  'use strict';

  function userOf(opt) {
    var u = opt.user;
    return (typeof u === 'function') ? (u() || 'default') : (u || 'default');
  }

  function resolveBase(opt) {
    // Reuse FilesPanel's resolver when present; else null (storage unavailable).
    if (global.FilesPanel && global.FilesPanel.resolveBase) {
      return global.FilesPanel.resolveBase(opt, 'file-storage');
    }
    return Promise.resolve(null);
  }

  // Normalize a path to a POSIX-ish relative key ("" = root).
  function norm(p) { return (p || '').replace(/^\/+|\/+$/g, ''); }

  function create(opt) {
    opt = opt || {};
    var _cache = null;      // { at, files:[{id,name,shared,perm}], folders:[] }
    var CACHE_TTL = 3000;
    // Per-folder (prefix) listing cache for the OPT-IN lazy mode (opt.lazyListing).
    // Keyed by normalized prefix ("" = root); each entry mirrors a full-listing
    // entry but holds ONLY the files/folders at/under that prefix. Off by
    // default — the full-listing path below is unchanged for existing consumers.
    var _dirCache = {};

    // Prefix-strip helpers shared by both the full and lazy paths: the server
    // namespaces stored names under the owner id (``<user>/path``), optionally
    // scoped to ``subPath``. Strip that prefix so files appear at the tree root.
    function _ownerPrefix(user) {
      var sub = norm(opt.subPath || '');
      return norm(user) + '/' + (sub ? sub + '/' : '');
    }
    function _stripRec(f, upfx) {
      var n = norm(f.name);
      return (n.indexOf(upfx) === 0) ? Object.assign({}, f, { name: n.slice(upfx.length) }) : f;
    }

    // Fetch ONE folder's immediate contents via the server's ?prefix= filter
    // (opt-in lazy mode). Returns the same {at,files,folders,base,user} shape as
    // fetchListing but scoped to `path`. The server re-qualifies the prefix with
    // the owner namespace; we strip it back off, same as the full path.
    function fetchDir(path) {
      var key = norm(path);
      var hit = _dirCache[key];
      if (hit && (Date.now() - hit.at) < CACHE_TTL) return Promise.resolve(hit);
      var user = userOf(opt);
      return resolveBase(opt).then(function (base) {
        if (!base) return { at: Date.now(), files: [], folders: [], unavailable: true };
        var upfx = _ownerPrefix(user);
        // Server prefix is owner-qualified; our tree path is prefix-stripped.
        var serverPrefix = upfx + (key ? key + '/' : '');
        // ``&level=1`` → the server returns ONLY this folder's immediate children
        // (files + distinct subfolder names), so the tree fetches one level at a
        // time instead of pulling the whole account subtree.
        var _q = '?user=' + encodeURIComponent(user) +
                 '&prefix=' + encodeURIComponent(norm(serverPrefix)) +
                 '&level=1';
        return fetch(base + '/v1/files' + _q, { credentials: 'same-origin', headers: { 'X-User': user } })
          .then(function (r) { return r.ok ? r.json() : { files: [], folders: [] }; })
          .then(function (j) {
            var files = (j.files || []).map(function (f) { return _stripRec(f, upfx); });
            var folders = (j.folders || []).map(function (fol) {
              var n = norm(fol);
              return (n.indexOf(upfx) === 0) ? n.slice(upfx.length) : n;
            }).filter(function (n) { return n; });
            var entry = { at: Date.now(), files: files, folders: folders, base: base, user: user };
            _dirCache[key] = entry;
            return entry;
          });
      });
    }

    // Resolve ONLY the base URL (+ user) without fetching the whole listing.
    // Opening a file whose `id` the tree already knows should not re-pull the
    // entire /v1/files listing just to read base+user (O(1) open vs O(listing)).
    // The underlying resolver (FilesPanel.resolveBase) is itself cached upstream.
    function baseUser() {
      var user = userOf(opt);
      return resolveBase(opt).then(function (base) { return { base: base, user: user }; });
    }

    function fetchListing() {
      if (_cache && (Date.now() - _cache.at) < CACHE_TTL) return Promise.resolve(_cache);
      var user = userOf(opt);
      return resolveBase(opt).then(function (base) {
        if (!base) return { at: Date.now(), files: [], folders: [], unavailable: true };
        // Pass the intended scope as ?user= too. An authenticated SESSION on the
        // server otherwise overrides the X-User header, so a shared/common root
        // (user:'common') would wrongly list the signed-in user's own files. The
        // server honours ?user=common as a PUBLIC read regardless of session.
        var _q = '?user=' + encodeURIComponent(user);
        return fetch(base + '/v1/files' + _q, { credentials: 'same-origin', headers: { 'X-User': user } })
          .then(function (r) { return r.ok ? r.json() : { files: [], folders: [] }; })
          .then(function (j) {
            // "my storage" = own files; "another user's" = shared[] under shareScope.
            var files;
            if (opt.shareScope) {
              var scope = norm(opt.shareScope);
              files = (j.shared || []).filter(function (f) {
                var n = norm(f.name);
                return n === scope || n.indexOf(scope + '/') === 0;
              });
            } else {
              // Own storage: the server namespaces stored names under the owner
              // id (``<user>/path``). Strip that leading ``<user>/`` so the user's
              // files appear at the ROOT of "My storage" instead of nested under a
              // redundant ``<user>`` folder (the "tree won't expand" symptom). The
              // real file id is unchanged, so read()/rename() still resolve.
              //
              // ``subPath`` (optional): scope this root to a SPECIFIC subfolder of
              // the account (e.g. common + subPath 'plantuml_python' shows only
              // that app's shared files, not the whole common namespace). We keep
              // only names under ``<user>/<subPath>/`` and strip that whole prefix
              // so the subfolder's contents appear at the root of this tree.
              var sub = norm(opt.subPath || '');
              var upfx = norm(user) + '/' + (sub ? sub + '/' : '');
              files = (j.files || []).filter(function (f) {
                return !sub || norm(f.name).indexOf(upfx) === 0;
              }).map(function (f) {
                var n = norm(f.name);
                return (n.indexOf(upfx) === 0) ? Object.assign({}, f, { name: n.slice(upfx.length) }) : f;
              });
            }
            var _sub = norm(opt.subPath || '');
            var _upfx = norm(user) + '/' + (_sub ? _sub + '/' : '');
            var folders = (j.folders || []).filter(function (fol) {
              return !_sub || norm(fol).indexOf(_upfx) === 0;
            }).map(function (fol) {
              var n = norm(fol);
              return (n.indexOf(_upfx) === 0) ? n.slice(_upfx.length) : n;
            }).filter(function (n) { return n; });
            var entry = { at: Date.now(), files: files, folders: folders, base: base, user: user };
            _cache = entry;
            return entry;
          });
      });
    }

    // Immediate children of `path` from the flat listing → {entries:[{name,type,path,id}]}.
    function childrenOf(listing, path) {
      var prefix = norm(path);
      var pfx = prefix ? prefix + '/' : '';
      var children = AppUIFileUtils.flatChildren(listing.files, prefix, {
        normalize: norm, folders: listing.folders || [], skipEmpty: false
      });
      var files = children.files.map(function (child) {
        return {name: child.name, id: child.entry.id, shared: child.entry.shared};
      });
      var entries = children.directories.sort().map(function (d) {
        return { name: d, type: 'dir', path: (prefix ? prefix + '/' : '') + d };
      });
      files.sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (f) {
        entries.push({ name: f.name, type: 'file', path: (prefix ? prefix + '/' : '') + f.name, id: f.id, shared: f.shared });
      });
      return { entries: entries };
    }

    return {
      // Distinct per-instance id so the explorer's backend-aware list cache
      // (keyed by __id + path) does NOT collide two fileStorage backends that
      // share a relative path ("") but target different accounts — otherwise the
      // first-cached account's listing leaks into the other root (e.g. the
      // Templates account showing under "My storage"). Keyed on user + shareScope.
      // ``v2`` marker: bumped when the request scoping changed (added ?user= so a
      // SESSION no longer shadows a shared root). It invalidates any stale
      // sessionStorage ``fe_ls_*`` listing cached under the old key (which could
      // hold an EMPTY common listing from before the fix → "folder won't expand").
      __id: 'fs2:' + userOf(opt) + ':' + (opt.shareScope || '') + ':' + (opt.subPath || ''),
      caps: { rename: true, mkdir: true, upload: true, multiUser: true },

      roots: function () {
        var label = opt.rootName || (opt.shareScope ? ("👥 " + (opt.ownerLabel || opt.shareScope))
                                     : ('📁 My storage (' + userOf(opt) + ')'));
        return Promise.resolve([{ name: label, path: '', icon: opt.shareScope ? '👥' : '📁', writable: !opt.shareScope }]);
      },

      list: function (path) {
        // OPT-IN lazy mode: fetch ONLY this folder via the server ?prefix=
        // filter, so a huge account doesn't pull its whole listing up front.
        if (opt.lazyListing) {
          return fetchDir(path).then(function (listing) {
            var out = childrenOf(listing, path);
            if (listing && listing.unavailable) out.unavailable = true;
            return out;
          });
        }
        return fetchListing().then(function (listing) {
          var out = childrenOf(listing, path);
          // Surface the cold/unavailable-base case so the explorer's cache does
          // NOT persist this empty result (base-resolution can be async on first
          // load; a cached empty would otherwise hide real files until refresh).
          if (listing && listing.unavailable) out.unavailable = true;
          return out;
        });
      },

      // Metadata for a node (for the Properties dialog): size/created/content_type
      // /id pulled from the cached flat listing. Matches by id first, else by the
      // (owner-prefix-stripped) relative path.
      fileMeta: function (node) {
        var id = node && node.id;
        var p = norm((node && node.path) || node && node.name || node);
        // In lazy mode, look in the file's PARENT folder listing (not the whole
        // account). Falls back to the full listing in the default mode.
        var src = opt.lazyListing
          ? fetchDir(p.indexOf('/') >= 0 ? p.slice(0, p.lastIndexOf('/')) : '')
          : fetchListing();
        return src.then(function (listing) {
          var hit = null;
          if (id) hit = listing.files.find(function (f) { return f.id === id; });
          if (!hit) hit = listing.files.find(function (f) { return norm(f.name) === p; });
          if (!hit) return {};
          return { id: hit.id, size: hit.size, modified: hit.created,
                   content_type: hit.content_type, sha256: hit.sha256 };
        });
      },

      read: function (node) {
        var id = node && node.id;
        // Fast path: id known → resolve base only, skip the whole-listing fetch.
        if (id) {
          return baseUser().then(function (bu) {
            if (!bu.base) return { content: '', encoding: 'text' };
            return fetch(bu.base + '/v1/files/' + id, { credentials: 'same-origin', headers: { 'X-User': bu.user } })
              .then(function (r) { return r.text(); })
              .then(function (t) { return { content: t, encoding: 'text' }; });
          });
        }
        var _p0 = norm(node && node.path || node);
        var _src = opt.lazyListing
          ? fetchDir(_p0.indexOf('/') >= 0 ? _p0.slice(0, _p0.lastIndexOf('/')) : '')
          : fetchListing();
        return _src.then(function (listing) {
          // resolve id by path
          var p = _p0;
          var hit = listing.files.find(function (f) { return norm(f.name) === p; });
          id = hit && hit.id;
          if (!id || !listing.base) return { content: '', encoding: 'text' };
          return fetch(listing.base + '/v1/files/' + id, { credentials: 'same-origin', headers: { 'X-User': listing.user } })
            .then(function (r) { return r.text(); })
            .then(function (t) { return { content: t, encoding: 'text' }; });
        });
      },

      // Binary read: resolve the file → fetch its BYTES as a Blob (for office
      // docs / images the text read can't handle). Returns {blob, name, id}.
      readBlob: function (node) {
        var id = node && node.id;
        // Fast path: id known → base-only resolve, no full-listing fetch.
        if (id) {
          return baseUser().then(function (bu) {
            if (!bu.base) return null;
            return fetch(bu.base + '/v1/files/' + id, { credentials: 'same-origin', headers: { 'X-User': bu.user } })
              .then(function (r) { return r.ok ? r.blob() : null; })
              .then(function (b) { return b ? { blob: b, name: (node && node.name) || id, id: id } : null; });
          });
        }
        var _pb0 = norm((node && node.path) || node);
        var _srcB = opt.lazyListing
          ? fetchDir(_pb0.indexOf('/') >= 0 ? _pb0.slice(0, _pb0.lastIndexOf('/')) : '')
          : fetchListing();
        return _srcB.then(function (listing) {
          var p = _pb0;
          var hit = listing.files.find(function (f) { return norm(f.name) === p; });
          id = hit && hit.id;
          if (!id || !listing.base) return null;
          return fetch(listing.base + '/v1/files/' + id, { credentials: 'same-origin', headers: { 'X-User': listing.user } })
            .then(function (r) { return r.ok ? r.blob() : null; })
            .then(function (b) { return b ? { blob: b, name: (node && node.name) || id, id: id } : null; });
        });
      },

      write: function (path, content, writeOpts) {
        var user = userOf(opt);
        return resolveBase(opt).then(function (base) {
          if (!base) throw new Error('file storage unavailable');
          var isB64 = writeOpts && writeOpts.b64;
          var body = isB64 ? atob(content) : content;
          return fetch(base + '/v1/files?name=' + encodeURIComponent(norm(path)), {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'X-User': user, 'Content-Type': (writeOpts && writeOpts.contentType) || 'text/plain' },
            body: body,
          }).then(function () { _cache = null; _dirCache = {}; });
        });
      },

      mkdir: function (path) {
        var user = userOf(opt);
        return resolveBase(opt).then(function (base) {
          if (!base) throw new Error('file storage unavailable');
          return fetch(base + '/v1/folders', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'X-User': user, 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: norm(path) }),
          }).then(function () { _cache = null; _dirCache = {}; });
        });
      },

      delete: function (node) {
        var user = userOf(opt);
        var id = node && node.id;
        return resolveBase(opt).then(function (base) {
          if (!base) return;
          var url = id ? (base + '/v1/files/' + id)
                       : (base + '/v1/folders?path=' + encodeURIComponent(norm(node && node.path || node)));
          return fetch(url, { method: 'DELETE', credentials: 'same-origin', headers: { 'X-User': user } }).then(function () { _cache = null; _dirCache = {}; });
        });
      },

      rename: function (from, to) {
        var user = userOf(opt);
        return resolveBase(opt).then(function (base) {
          if (!base) throw new Error('file storage unavailable');
          return fetch(base + '/v1/rename', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'X-User': user, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: norm(from), to: norm(to) }),
          }).then(function () { _cache = null; _dirCache = {}; });
        });
      },

      // Enumerate shares granted to this user → candidate "another user's storage"
      // roots. Returns [{owner, scope}] the caller can turn into addRoot specs.
      sharesForMe: function () {
        var user = userOf(opt);
        return resolveBase(opt).then(function (base) {
          if (!base) return [];
          return fetch(base + '/v1/shares', { credentials: 'same-origin', headers: { 'X-User': user } })
            .then(function (r) { return r.ok ? r.json() : {}; })
            .then(function (j) {
              var out = [];
              ((j && j.granted_to_me) || j.shares || []).forEach(function (s) {
                var res = s.resource || s.path || s.name || '';
                var owner = (res.split('/')[0]) || s.granted_by || 'user';
                out.push({ owner: owner, scope: norm(res) });
              });
              return out;
            });
        });
      },
    };
  }

  global.AppUIFileBackend = global.AppUIFileBackend || {};
  global.AppUIFileBackend.fileStorage = create;
})(typeof window !== 'undefined' ? window : this);
