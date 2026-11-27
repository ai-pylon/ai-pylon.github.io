// VFS left-sidebar TREE — a VIS-style browsable tree over every vfs reach:
//   • This PC            local disk root(s)         (vfs://file:///C:/ , /)
//   • VFS                reach backends grouped by PLUGIN (ssh/gitlab/ftp/…),
//                        each listing its mount aliases (vfs://mnt://<name>) +
//                        an "＋ add" leaf. Aligned with the workspace shell's
//                        Endpoint tree (a mount = an endpoint under its transport).
//   • Providers          each app-backed provider    (vfs://app://<name>)
// Lazy children come from the SAME vfs.list op the content browser uses, so the
// tree works uniformly across fs / ssh / mount / app. Selecting a dir browses it
// in the content area; selecting a file previews it. Mirrors knowledge/vis's
// left tree. Exposes VFSTree.create({api, esc, onOpenDir, onOpenFile}).
(function (global) {
  "use strict";

  function create(deps) {
    var api = deps.api, esc = deps.esc;
    var onOpenDir = deps.onOpenDir || function () {};
    var onOpenFile = deps.onOpenFile || function () {};
    var tree = null, box = null;
    var KIDS = {};   // url -> cached child nodes
    var PROV_APP = {};   // provider name -> owning app id (for sign-in deep links)

    function providerName(url) {
      var m = /^vfs:\/\/app:\/\/([^/#]+)/.exec(url || "");
      return m ? m[1] : "";
    }

    function winLocal() {
      return (navigator.platform || "").toLowerCase().indexOf("win") >= 0
        ? "vfs://file:///C:/" : "vfs://file:///";
    }
    function _joinUrl(parent, name) {
      var p = String(parent || "").replace(/\/+$/, "");
      return p + "/" + String(name || "").replace(/^\/+/, "");
    }
    function nodeFor(e, parentUrl) {
      // Build the child url: a provider/alias entry carries its own `url` (e.g.
      // gdrive's id-based path); a plain fs/ssh/mount entry does NOT, so derive
      // it from the PARENT url + the entry name. Without this, every local
      // sub-folder got path=undefined → expanding it listed url=undefined →
      // the file/vfs "url required" error (the reported bug on This PC).
      var childUrl = e.url || _joinUrl(parentUrl, e.name);
      return { name: e.title || e.name, path: childUrl, icon: e.kind === "dir" ? "📂" : "📄",
               hasChildren: e.kind === "dir", data: { entry: e, kind: e.kind } };
    }
    function listKids(url) {
      if (KIDS[url]) return Promise.resolve(KIDS[url]);
      return api("list", { url: url }).then(function (r) {
        var d = (r && r.data) || r || {};
        if (!d.ok) {
          var msg = d.error || d._error || "list failed";
          var needCred = d.need_cred || d.category === "need_cred";
          if (needCred) {
            var pn = providerName(url);
            return [{ name: "🔑 " + msg, path: url + "#signin", icon: "",
                      hasChildren: false,
                      data: { signin: true, provider: pn, app: PROV_APP[pn] || "",
                              open: d.open || "", product: d.product || pn } }];
          }
          return [{ name: "⚠ " + msg, path: url + "#err", icon: "",
                    hasChildren: false, data: { err: true } }];
        }
        var kids = (d.entries || []).map(function (e) { return nodeFor(e, url); });
        // an empty, login-free browse with a guidance hint → show it as a
        // clickable node that opens the owning app's page (e.g. CPI Store).
        if (!kids.length && d.hint) {
          var pn2 = providerName(url);
          kids = [{ name: "ℹ " + d.hint, path: url + "#hint", icon: "", hasChildren: false,
                    data: { hint: true, app: PROV_APP[pn2] || "", open: d.open || "" } }];
        }
        KIDS[url] = kids;
        return kids;
      }).catch(function () { return []; });
    }

    // roots: grouped "section" nodes (This PC / Mounts / Providers), each with
    // real vfs urls underneath. A section is a non-navigable grouping node whose
    // children we seed directly (no vfs.list on the group itself).
    function buildRoots() {
      var roots = [];
      // This PC — the local disk root (expands to its real listing)
      roots.push({ name: "This PC", path: "grp:thispc", icon: "🖥", hasChildren: true,
                   data: { group: "thispc" } });
      roots.push({ name: "Transports", path: "grp:transports", icon: "🗄", hasChildren: true,
                   data: { group: "transports" } });
      roots.push({ name: "Aliases", path: "grp:aliases", icon: "🔖", hasChildren: true,
                   data: { group: "aliases" } });
      roots.push({ name: "Providers", path: "grp:providers", icon: "📦", hasChildren: true,
                   data: { group: "providers" } });
      return roots;
    }

    // The reach transports a user can add an endpoint for (static — the
    // vfs.transports catalog op was removed with the mnt:// deprecation). Each is
    // a category under the Transports group; expanding it lists this kind's
    // aliases + legacy mounts + (for ssh) the hosts known to platform/auth_ssh,
    // plus an "+ add endpoint" leaf. Provider-app kinds (gdrive/onedrive) live
    // under Providers, not here.
    var KNOWN_TRANSPORTS = {
      ssh: { example: "ssh://host/home/you", hint: "A remote host over SSH/SFTP.", credential: "" },
      gitlab: { example: "https://gitlab.internal.ericsson.com/group/repo", hint: "A GitLab repo/group/host.", credential: "gitlab" },
      gerrit: { example: "https://gerrit-review.gic.ericsson.se/project", hint: "A Gerrit project.", credential: "gerrit" },
      github: { example: "https://github.com/owner/repo", hint: "A GitHub repo.", credential: "github" },
      ftp: { example: "ftp://ftp.example.com/pub", hint: "An FTP(S) host or sub-dir.", credential: "" },
      httpindex: { example: "httpidx://https://ftp.gnu.org/gnu/bash/", hint: "An HTTP directory index.", credential: "" },
      webdav: { example: "webdav://https://host/remote.php/dav/files/user/", hint: "A WebDAV/Nextcloud collection.", credential: "" },
      mediawiki: { example: "mediawiki://wiki.example.com/<title-prefix>", hint: "A MediaWiki page tree.", credential: "wiki" },
      s3: { example: "s3://bucket/prefix", hint: "An S3 / S3-compatible bucket.", credential: "aws" },
      confluence: { example: "https://eteamspace.internal.ericsson.com/pages/viewpage.action?spaceKey=KEY&title=Page", hint: "A Confluence space/page.", credential: "confluence" }
    };
    var _TRANSPORT_ORDER = ["ssh", "gitlab", "gerrit", "github", "ftp", "s3", "webdav", "httpindex", "mediawiki", "confluence"];

    var TKIND_ICON = { confluence: "🗎", onedrive: "☁", sharepoint: "☁", teams: "☁",
                       gdrive: "📁", gitlab: "🦊", gerrit: "⎇", ssh: "🖥",
                       ftp: "📡", httpindex: "🌐", webdav: "📄", mediawiki: "📖",
                       github: "🐙", s3: "🪣", path: "🔗" };
    function tIcon(k) { return TKIND_ICON[k] || "🔗"; }
    var TRANSPORT_CAT = {};   // kind -> catalog row {label,example,hint,credential}

    function groupChildren(which) {
      if (which === "thispc") {
        return listKids(winLocal());   // real disk listing at the drive root
      }
      if (which === "aliases") {
        // Aliases (the current reference model) + any legacy mounts (read-only).
        return Promise.all([
          api("alias_list", {}).then(function (r) { return ((r && r.data) || r || {}).aliases || []; }, function () { return []; }),
          api("mounts", {}).then(function (r) { return ((r && r.data) || r || {}).mounts || []; }, function () { return []; })
        ]).then(function (res) {
          var aliases = res[0], mounts = res[1];
          var out = aliases.map(function (a) {
            var k = a.kind || "";
            var ic = (k === "vis") ? "🧭" : (k === "gitlab") ? "🦊" : (k === "gerrit") ? "⎇"
                   : (k === "github") ? "🐙" : (k === "ssh") ? "🖥" : (k === "provider") ? "📦" : "🔖";
            return { name: a.name, path: "vfs://alias://" + a.name, icon: ic,
                     hasChildren: true, data: { kind: "dir", alias: true } };
          });
          // legacy mnt:// mounts (read-only back-compat) listed below the aliases.
          mounts.forEach(function (m) {
            if (!m || !m.mount) return;
            out.push({ name: m.mount + "  (legacy)", path: "vfs://mnt://" + m.mount,
                       icon: tIcon(m.kind), hasChildren: true,
                       data: { kind: "dir", mount: true, legacy: true } });
          });
          if (!out.length) out.push({ name: "(no aliases — add one in the panel)", path: "grp:aliases#none",
                                      icon: "", hasChildren: false, data: { info: true } });
          return out;
        }).catch(function () { return []; });
      }
      if (which === "providers") {
        return api("providers", {}).then(function (r) {
          var hs = ((r && r.data) || r || {}).handlers || [];
          if (!hs.length) return [{ name: "(no providers)", path: "grp:providers#none", icon: "",
                                    hasChildren: false, data: { info: true } }];
          hs.forEach(function (p) { if (p.app) PROV_APP[p.name] = p.app; });
          return hs.map(function (p) {
            return { name: p.label || p.name, path: "vfs://app://" + p.name, icon: p.icon || "📦",
                     hasChildren: true,
                     data: { kind: "dir", provider: p } };
          });
        }).catch(function () { return []; });
      }
      if (which === "transports") {
        // The reach-transport CATEGORIES (static known kinds). Each expands to
        // its endpoints (aliases/mounts/ssh-hosts) + an add leaf.
        return Promise.resolve(_TRANSPORT_ORDER.map(function (k) {
          return { name: k, path: "trcat:" + k, icon: tIcon(k), hasChildren: true,
                   data: { transportCat: k } };
        }));
      }
      return Promise.resolve([]);
    }

    // A transport CATEGORY → its endpoints of that kind: aliases, legacy mounts,
    // and (for ssh) the hosts KNOWN TO platform/auth_ssh (host_list), plus an
    // "+ add endpoint" leaf that opens the vfs page's add-reference (alias) form.
    function transportCatChildren(kind) {
      var fetches = [
        api("alias_list", {}).then(function (r) { return ((r && r.data) || r || {}).aliases || []; }, function () { return []; }),
        api("mounts", {}).then(function (r) { return ((r && r.data) || r || {}).mounts || []; }, function () { return []; })
      ];
      // ssh: also pull the auth_ssh saved-host registry (a bare cross-app fetch).
      if (kind === "ssh") {
        fetches.push(fetch("/v1/apps/platform/auth_ssh/host_list", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
          .then(function (r) { return r.ok ? r.json() : { hosts: [] }; })
          .then(function (j) { return (j && j.hosts) || []; })
          .catch(function () { return []; }));
      } else {
        fetches.push(Promise.resolve([]));   // keep res[2] slot aligned
      }
      // gitlab/gerrit/github: ALSO list the HOST(s) the user can access (from the
      // stored credentials' url), so the category browses AVAILABLE PROJECTS —
      // not just the aliased paths. Each host expands via the ad-hoc https
      // transport (vfs://https://<host> → gitlab_fetch.list_host → the user's
      // groups + personal namespace + projects). Credentials come from
      // platform/credential.list (read_only, http-callable, redacted — never a
      // secret); a gitlab cred is named 'gitlab'/'gitlab-<x>' or carries a url.
      var _wantsHosts = (kind === "gitlab" || kind === "gerrit" || kind === "github");
      if (_wantsHosts) {
        fetches.push(fetch("/v1/apps/platform/credential/list", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
          .then(function (r) { return r.ok ? r.json() : { credentials: [] }; })
          .then(function (j) { return (j && j.credentials) || []; })
          .catch(function () { return []; }));
      } else {
        fetches.push(Promise.resolve([]));
      }
      return Promise.all(fetches).then(function (res) {
        var aliases = res[0] || [], mounts = res[1] || [], sshHosts = res[2] || [], creds = res[3] || [];
        var out = [];
        var seen = {};
        // Host nodes FIRST (the primary way to browse projects), for
        // gitlab/gerrit/github — derived from the matching stored credentials'
        // url. De-duped by host; browsed via vfs://https://<host>.
        if (_wantsHosts) {
          var _hostSeen = {};
          creds.forEach(function (c) {
            var nm = String(c.name || "").toLowerCase();
            var isKind = (nm === kind || nm.indexOf(kind + "-") === 0 ||
                          String(c.url || "").toLowerCase().indexOf(kind) >= 0 ||
                          (c.domains || []).some(function (d) { return String(d).toLowerCase().indexOf(kind) >= 0; }));
            if (!isKind) return;
            // host candidates: the cred url's host + any domains aliases.
            var hosts = [];
            try { var u = String(c.url || ""); if (u) hosts.push(u.replace(/^https?:\/\//, "").replace(/\/.*$/, "")); } catch (e) {}
            (c.domains || []).forEach(function (d) { var h = String(d || "").replace(/^https?:\/\//, "").replace(/\/.*$/, ""); if (h) hosts.push(h); });
            hosts.forEach(function (h) {
              if (!h || _hostSeen[h]) return; _hostSeen[h] = 1; seen[h] = 1;
              out.push({ name: h, path: "vfs://https://" + h, icon: tIcon(kind), hasChildren: true,
                         data: { kind: "dir", host: true, authed: !!c.has_token },
                         title: kind + " server " + h + (c.has_token ? " (authenticated)" : " (no token)") });
            });
          });
        }
        aliases.filter(function (a) { return String(a.kind || "").toLowerCase() === kind; })
          .forEach(function (a) {
            if (seen[a.name]) return; seen[a.name] = 1;
            out.push({ name: a.name, path: "vfs://alias://" + a.name, icon: tIcon(kind),
                       hasChildren: true, data: { kind: "dir", alias: true } });
          });
        mounts.filter(function (m) { return m && m.mount && String(m.kind || "").toLowerCase() === kind; })
          .forEach(function (m) {
            if (seen[m.mount]) return; seen[m.mount] = 1;
            out.push({ name: m.mount + "  (legacy)", path: "vfs://mnt://" + m.mount, icon: tIcon(kind),
                       hasChildren: true, data: { kind: "dir", mount: true, legacy: true } });
          });
        sshHosts.forEach(function (h) {
          var host = (h.host || h.alias || "").trim();
          if (!host || seen[host]) return; seen[host] = 1;
          out.push({ name: host + (h.alias && h.alias !== host ? "  (" + h.alias + ")" : ""),
                     path: "vfs://ssh://" + host, icon: "🖥", hasChildren: true,
                     data: { kind: "dir", sshHost: true } });
        });
        var cat = KNOWN_TRANSPORTS[kind] || {};
        out.push({ name: "＋ add " + kind + " endpoint…", path: "trcat:" + kind + "#add", icon: "➕",
                   hasChildren: false,
                   data: { addTransport: kind, example: cat.example || "", hint: cat.hint || "", credential: cat.credential || "" } });
        return out;
      }).catch(function () { return []; });
    }

    // (Removed, TODO #3) the transport-CATEGORY children + "＋ add endpoint" leaf
    // — the mnt:// mount write path is gone; aliases (vfs.alias_add) replace it.

    function render(host) {
      host.classList.add("vfs-treewrap");
      host.innerHTML = '<div class="vfs-tree"><div class="empty" style="padding:10px;color:var(--text-muted)">loading…</div></div>';
      box = host.querySelector(".vfs-tree");
      return AppUIAssets.load("tree").then(function () {
        if (!(window.AppUITree && AppUITree.create)) {
          box.innerHTML = '<div class="empty" style="padding:10px">tree component unavailable</div>';
          return;
        }
        box.innerHTML = "";
        tree = AppUITree.create({
          container: box,
          searchable: true,
          searchPlaceholder: "Filter…",
          storageKey: "file-vfs:tree",
          onExpand: function (node, cb) {
            var d = node.data || {};
            if (d.err || d.info || d.addTransport) return cb([]);
            if (d.group) return groupChildren(d.group).then(cb, function () { cb([]); });
            if (d.transportCat) return transportCatChildren(d.transportCat).then(cb, function () { cb([]); });
            listKids(node.path).then(cb, function () { cb([]); });
          },
          onSelect: function (node) {
            var d = node.data || {};
            if (d.err || d.info || d.group || d.transportCat) return;   // groups/categories expand-only
            // "+ add <kind> endpoint" leaf → open the References panel's add form
            // (prefill the url box with this kind's example). The vfs page adds a
            // reference as an ALIAS (vfs.alias_add); for ssh the example is an
            // ssh:// url the user edits to their host.
            if (d.addTransport) {
              try {
                var root = document.querySelector(".vfs-content") || document;
                var urlIn = root.querySelector && root.querySelector("#mnt-url");
                if (urlIn && d.example) { urlIn.value = d.example; urlIn.focus(); }
                var wiz = root.querySelector && root.querySelector("#mnt-wizard");
                if (wiz) wiz.click();   // open the "Examples" helper
              } catch (_) {}
              return;
            }
            if (d.signin || d.hint) {
              // open the owning app's page (or an explicit 'open' url) so the
              // user can sign in / load the catalog / fetch there, then re-expand.
              var target = d.open || (d.app ? "/apps/" + d.app + "/" : "");
              if (target) { try { window.open(target, "_blank"); } catch (_) {} }
              return;
            }
            if (d.kind === "dir") onOpenDir(node.path); else onOpenFile(node.path);
          },
          decorateRow: function (node, row) {
            var d = node.data || {};
            if (d.provider && d.provider.source) {
              var t = document.createElement("span");
              t.className = "vfs-tree-tag"; t.textContent = d.provider.source;
              row.appendChild(t);
            }
          },
        });
        tree.setRoots(buildRoots());
      }).catch(function () {
        if (box) box.innerHTML = '<div class="empty" style="padding:10px">tree failed to load</div>';
      });
    }

    // reveal/highlight a url the content browser navigated to (best-effort —
    // highlights it if the node is already materialized in the tree).
    function setActive(url) { try { if (tree && tree.setActive) tree.setActive(url); } catch (_) {} }

    return { render: render, setActive: setActive };
  }

  global.VFSTree = { create: create };
})(window);
