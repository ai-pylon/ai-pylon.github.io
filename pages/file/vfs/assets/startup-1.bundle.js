// VFS references panel: ALIASES (the current model) + legacy mounts (read-only).
// The mnt:// mount WRITE/management ops were removed (alias:// supersedes them);
// this panel now manages ALIASES (vfs.alias_add / alias_remove / alias_list) and
// shows any remaining legacy mounts READ-ONLY for back-compat.
(function (global) {
  "use strict";
  function create(deps) {
    var api = deps.api, esc = deps.esc, browse = deps.browse;

  // --- ALIASES (the current reference model) --------------------------------
  async function loadAliases(app, root) {
    var box = root.querySelector("#mounts-list");
    if (!box) return;
    var ar = await api("alias_list", {});
    var aliases = (ar.data && ar.data.aliases) || [];
    var al = aliases.map(function (a) {
      var k = a.kind || "";
      var badge = (k === "vis") ? "🧭" : (k === "gitlab") ? "🦊" : (k === "gerrit") ? "⎇"
                : (k === "github") ? "🐙" : (k === "ssh") ? "🖥" : (k === "provider") ? "📦" : "🔖";
      return '<div class="mount-row" data-alias="' + esc(a.name) + '">' +
        '<span class="badge">' + badge + '</span> <b>' + esc(a.name) + '</b> ' +
        '<span class="mp"><code>' + esc(a.url) + '</code></span>' +
        '<button class="unmnt sec" data-rmalias="' + esc(a.name) + '">remove</button></div>';
    }).join("");

    // legacy mounts (read-only, back-compat): list but no unmount/edit.
    var mr = await api("mounts", {});
    var ms = (mr.data && mr.data.mounts) || [];
    var ml = ms.map(function (m) {
      var badge = m.kind === "onedrive" || m.kind === "sharepoint" ? "☁"
                : (m.kind === "gitlab" ? "🦊" : "🔗");
      var sub = m.scope_label || (m.host_mount ? (m.origin || "") + " (host)" : (m.project || ""));
      return '<div class="mount-row legacy" data-mnt="' + esc(m.mount) + '" title="legacy mount (read-only)">' +
        '<span class="badge">' + badge + '</span> <b>' + esc(m.mount) + '</b> ' +
        '<span class="scope-tag">legacy</span> ' +
        '<span class="mp">' + esc(sub) + (m.ref && m.ref !== "HEAD" ? "@" + esc(m.ref) : "") + '</span></div>';
    }).join("");

    var html = "";
    html += '<div class="mounts-sec-title">Aliases</div>';
    html += al || '<div class="mounts-empty">No aliases yet. Add one below — a named shorthand for ANY vfs url (a gitlab/gerrit repo in any namespace, a public repo, a deep gerrit path, a vis node, an ssh path).</div>';
    if (ml) {
      html += '<div class="mounts-sec-title">Legacy mounts (read-only)</div>' + ml +
        '<div class="mounts-empty">Legacy mnt:// mounts are read-only. Re-create them as aliases (they list/read as before).</div>';
    }
    box.innerHTML = html;

    box.querySelectorAll("[data-alias]").forEach(function (el) {
      el.addEventListener("click", function (e) {
        if (e.target.getAttribute("data-rmalias")) return;
        browse(app, root, "vfs://alias://" + el.getAttribute("data-alias"));
      });
    });
    box.querySelectorAll("[data-mnt]").forEach(function (el) {
      el.addEventListener("click", function () {
        browse(app, root, "vfs://mnt://" + el.getAttribute("data-mnt"));
      });
    });
    box.querySelectorAll("[data-rmalias]").forEach(function (b) {
      b.addEventListener("click", async function (e) {
        e.stopPropagation();
        var nm = b.getAttribute("data-rmalias");
        if (!window.confirm("Remove alias '" + nm + "'?")) return;
        await api("alias_remove", { name: nm, confirm: true });
        loadAliases(app, root);
      });
    });
  }

  // Back-compat name used by the page controller.
  async function loadMounts(app, root) { return loadAliases(app, root); }

  // --- ADD an alias (replaces the old mount form) ---------------------------
  async function addMount(app, root) {
    var u = (root.querySelector("#mnt-url") || {}).value;
    u = (u || "").trim();
    if (!u) { app.setStatus("Enter a target vfs url (or a bare https/ssh url) to alias."); return; }
    var nm = ((root.querySelector("#mnt-name") || {}).value || "").trim();
    if (!nm) {
      // derive a default name from the url's last path segment
      nm = u.replace(/\/+$/, "").split("/").pop() || "ref";
    }
    app.setStatus("Adding alias " + nm + " → " + u + " …");
    var r = await api("alias_add", { name: nm, url: u, confirm: true });
    var d = r.data || {};
    if (!d.ok) { app.setStatus("Alias add failed: " + (d.error || r.status)); return; }
    if (root.querySelector("#mnt-url")) root.querySelector("#mnt-url").value = "";
    if (root.querySelector("#mnt-name")) root.querySelector("#mnt-name").value = "";
    app.setStatus("Alias added: vfs://alias://" + nm);
    await loadAliases(app, root);
    browse(app, root, "vfs://alias://" + nm);
  }

  // "What can I alias?" helper — examples for the common targets, incl. the ones
  // the tree can't surface (public / other-namespace repos, deep gerrit paths).
  async function toggleWizard(app, root) {
    var box = root.querySelector("#mnt-wizard-box");
    if (!box) return;
    if (box.style.display !== "none") { box.style.display = "none"; return; }
    box.style.display = "block";
    var examples = [
      ["GitLab repo (any namespace / public)", "vfs://https://gitlab.rnd.gic.ericsson.se/other-group/repo"],
      ["Gerrit project (not root-expandable)", "vfs://https://gerrit-review.gic.ericsson.se/my/project"],
      ["Public GitHub repo", "vfs://https://github.com/pallets/flask"],
      ["VIS node", "vis://mom"],
      ["SSH path", "vfs://ssh://host/home/you"],
      ["Provider path", "vfs://app://cpi/"]
    ];
    box.innerHTML =
      '<div class="wizard-title">Alias a location — pick an example to fill the URL box:</div>' +
      '<div class="wizard-grid">' + examples.map(function (e) {
        return '<button class="wizard-pick" data-ex="' + esc(e[1]) + '"><b>' + esc(e[0]) +
          '</b><span>' + esc(e[1]) + '</span></button>';
      }).join("") + '</div>' +
      '<div class="wizard-cred">An alias (vfs://alias://&lt;name&gt;) is a named shorthand for ANY vfs url — ' +
      'including repos NOT in your namespace and paths you can\'t reach by browsing the tree. ' +
      'A bare https:// / ssh:// url is accepted and normalized.</div>';
    box.querySelectorAll(".wizard-pick").forEach(function (b) {
      b.addEventListener("click", function () {
        if (root.querySelector("#mnt-url")) root.querySelector("#mnt-url").value = b.getAttribute("data-ex");
      });
    });
  }

    return { loadMounts: loadMounts, loadAliases: loadAliases, addMount: addMount, toggleWizard: toggleWizard };
  }
  global.VFSMounts = { create: create };
})(window);

;
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
        var primary = winLocal();
        var fallback = primary === "vfs://file:///C:/" ? "vfs://file:///" : "vfs://file:///C:/";
        return listKids(primary).then(function (kids) {
          if (kids && kids.length === 1 && kids[0] && kids[0].data && kids[0].data.err) {
            delete KIDS[primary];
            return listKids(fallback);
          }
          return kids;
        });
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

;
// VFS — AppUI file browser. Served at /apps/file/vfs/.
var APP = "file/vfs";

function esc(s){ return String(s==null?"":s).replace(/[&<>"]/g, function(c){
  return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]; }); }

window.addEventListener("error", function (e) {
  try {
    fetch("/v1/log", { method: "POST", headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ level:"error", source:"vfs.page",
        message: String(e.message || e), fields:{ at:"window.error" } }) });
  } catch (_) {}
});

async function api(op, body) {
  var r = await window.AppUIApi.requestResponse("/v1/apps/" + APP + "/" + op, body || {}, {
    method: "POST", timeout: null, decode: function (response) { return response.json(); }
  });
  return { status: r.status, data: r.data };
}

var CUR = "";   // current vfs:// url
var TREE_SYNC = null;   // set at mount: highlight the current url in the left tree

// --- deep-linking: the current vfs path rides in the page URL's ?path= param,
// so a location is shareable/bookmarkable and survives reload. readPathParam()
// reads it on load; syncUrlParam() writes it on every navigation (replaceState,
// so Back still exits the app rather than walking every folder step).
function readPathParam() {
  try {
    var p = new URLSearchParams(location.search);
    var v = (p.get("path") || p.get("url") || "").trim();
    return v || null;
  } catch (_) { return null; }
}

function syncUrlParam(url) {
  try {
    if (TREE_SYNC) TREE_SYNC(url);
    var u = new URL(location.href);
    u.searchParams.set("path", url);
    history.replaceState(null, "", u.toString());
  } catch (_) {}
}

function reachOf(url) {
  var u = (url || "").toLowerCase();
  if (u.indexOf("vfs://ssh://") === 0) return "ssh";
  if (u.indexOf("vfs://mnt://") === 0 || u === "vfs://mnt") return "mount";
  return "fs";
}

function fmtSize(n) {
  if (n == null) return "";
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n/1024).toFixed(1) + " K";
  return (n/1048576).toFixed(1) + " M";
}

function joinUrl(url, name) {
  if (name === "..") {
    // step up one path segment, keeping the vfs://endpoint prefix intact.
    // endpoint = ssh://host | file:// | mnt://name | self-host.
    var m = url.match(/^(vfs:\/\/(?:ssh:\/\/[^/]+|mnt:\/\/[^/]+|file:\/\/|[^/]+))(\/.*)?$/i);
    if (!m) return url;
    var ep = m[1], path = (m[2] || "/");
    var parts = path.replace(/\/+$/,"").split("/"); parts.pop();
    var np = parts.join("/") || "/";
    return ep + (np === "/" ? "/" : np);
  }
  return url.replace(/\/+$/,"") + "/" + name;
}

async function browse(app, root, url) {
  CUR = url;
  root.querySelector("#url").value = url;
  syncUrlParam(url);
  var rb = root.querySelector("#reach");
  var rc = reachOf(url); rb.textContent = rc; rb.className = "reach " + rc;
  app.setStatus("Listing " + url + " …");
  // Paint an immediate spinner into the listing area so a slow cloud-mount root
  // doesn't leave the pane blank/stale while the backend round-trips (#30).
  var box = root.querySelector("#listing");
  box.innerHTML = '<div class="empty vfs-loading">Listing ' + esc(url) + ' …</div>';
  var r = await api("list", { url: url });
  var d = r.data || {};
  if (!d.ok) {
    // The target might be a FILE (deep-link to e.g. …/page.md): if a read
    // succeeds, preview it instead of showing the list error.
    if (d.is_dir !== true) {
      var fr = await api("read", { url: url });
      if (fr.data && fr.data.ok) {
        var out0 = root.querySelector("#out");
        out0.textContent = url + (fr.data.truncated ? " (truncated)" : "") + "\n\n" + (fr.data.text || "");
        app.setStatus("Read " + fr.data.bytes + " bytes (file deep-link)");
        return;
      }
    }
    box.innerHTML = '<div class="empty">' + esc(d.error || r.status) +
      (d.need_cred ? " — connect the host in the Connection app first" : "") + '</div>';
    app.setStatus("Error: " + (d.error || r.status));
    return;
  }
  var entries = d.entries || [];
  var up = '<tr data-dir=".."><td><span class="fs-icon">&#8617;</span> ..</td><td class="sz"></td><td class="mt"></td></tr>';
  box.innerHTML = '<table class="fs-table"><tbody>' + up + entries.map(function (e) {
    var icon = e.kind === "dir" ? "📁" : "📄";
    var attr = e.kind === "dir" ? ' data-dir="' + esc(e.name) + '"' : ' data-file="' + esc(e.name) + '"';
    return '<tr' + attr + '><td><span class="fs-icon">' + icon + '</span> ' + esc(e.title || e.name) +
      (e.link ? ' <span class="reach">link</span>' : '') + '</td>' +
      '<td class="sz">' + (e.kind === "dir" ? "" : fmtSize(e.size)) + '</td>' +
      '<td class="mt">' + esc(e.modified || "") + '</td></tr>';
  }).join("") + '</tbody></table>';
  app.setStatus(url + " · " + entries.length + " item(s)" + (d.truncated ? " (truncated)" : ""));
  box.querySelectorAll("[data-dir]").forEach(function (tr) {
    tr.addEventListener("click", function () { browse(app, root, joinUrl(url, tr.getAttribute("data-dir"))); });
  });
  box.querySelectorAll("[data-file]").forEach(function (tr) {
    tr.addEventListener("click", function () { readFile(app, root, joinUrl(url, tr.getAttribute("data-file"))); });
  });
  prefetchChildren(url, entries);
}

// --- depth-1 lookahead (#31): after listing a dir on an expensive backend
// (mount/ssh), warm the backend cache for the just-listed sub-dirs in the
// background so the common click-to-descend feels instant. Fire-and-forget,
// capped, and reach-gated (local 'fs' is already cheap so it is skipped).
var PREFETCHED = {};   // url -> true (don't re-prefetch the same dir)
function prefetchChildren(url, entries) {
  try {
    var rc = reachOf(url);
    if (rc === "fs") return;                       // local disk is free
    if (PREFETCHED[url]) return;
    PREFETCHED[url] = true;
    var dirs = (entries || []).filter(function (e) { return e.kind === "dir"; });
    dirs.slice(0, 8).forEach(function (e) {        // cap the fan-out
      var child = joinUrl(url, e.name);
      // fire-and-forget; the backend SWR cache keeps the result warm
      api("list", { url: child }).catch(function () {});
    });
  } catch (_) {}
}

async function readFile(app, root, url) {
  syncUrlParam(url);
  app.setStatus("Reading " + url + " …");
  var r = await api("read", { url: url });
  var out = root.querySelector("#out");
  var d = r.data || {};
  if (!d.ok) { out.textContent = ""; app.setStatus("Read failed: " + (d.error || r.status)); return; }
  out.textContent = url + (d.truncated ? " (truncated)" : "") + "\n\n" + (d.text || "");
  app.setStatus("Read " + d.bytes + " bytes");
}

// #19: route a deep-link deterministically using stat's definitive is_dir,
// instead of browse()'s try-list-then-read heuristic. Falls back to browse on
// an inconclusive stat so a bad/transient path still shows a listing error.
async function routeDeepLink(app, root, url) {
  var s = await api("stat", { url: url });
  var d = s.data || {};
  if (d.ok && d.is_dir === false) {
    readFile(app, root, url);
    app.setStatus("Opened file " + url + " (from the URL).");
  } else {
    browse(app, root, url);
    app.setStatus("Opened " + url + " (from the URL).");
  }
}

function mountContent(el) {
  el.classList.add("vfs-content");
  el.innerHTML =
    '<div class="vfs-bar">' +
      '<input id="url" placeholder="vfs://file:///C:/ or vfs://ssh://host/home/you or vfs://mnt://<name>/...">' +
      '<span class="reach fs" id="reach">fs</span>' +
      '<button id="go">Open</button>' +
      '<button id="up" class="sec">Up</button>' +
    '</div>' +
    '<div class="vfs-hint">Examples: <code>vfs://file:///C:/</code> (local disk) · ' +
      '<code>vfs://ssh://host/home/you</code> (remote, via Connection) · ' +
      '<code>vfs://mnt://&lt;name&gt;/...</code> (a mounted GitLab host/repo or OneDrive). ' +
      'Click a folder to descend, a file to preview.</div>' +
    '<div class="mounts-box">' +
      '<div class="mounts-head"><b>References</b>' +
        '<span class="spacer"></span>' +
        '<input id="mnt-url" placeholder="target vfs url — e.g. vfs://https://gitlab.rnd.gic.ericsson.se/group/repo, vis://mom, vfs://ssh://host/path">' +
        '<input id="mnt-name" class="mnt-name" placeholder="alias name (optional)" title="Alias name — a short handle (e.g. ai-pylon). Auto-derived from the url if left blank.">' +
        '<button id="mnt-wizard" class="sec">Examples</button>' +
        '<button id="mnt-add" class="sec">Add alias</button>' +
      '</div>' +
      '<div id="mnt-wizard-box" class="wizard-box" style="display:none"></div>' +
      '<div id="mounts-list"></div>' +
    '</div>' +
    '<div id="listing"></div>' +
    '<div class="out" id="out"></div>';
  return el;
}

var mountsController = null;
function loadMounts(app, root) { return mountsController.loadMounts(app, root); }
function addMount(app, root) { return mountsController.addMount(app, root); }
function toggleWizard(app, root) { return mountsController.toggleWizard(app, root); }

window.AppUIReady.then(function () {
  mountsController = VFSMounts.create({ api: api, esc: esc, browse: browse });
  var contentEl = null;
  // the left-sidebar tree (This PC · Mounts · Providers) — VIS-style browse.
  var vfsTree = (window.VFSTree && VFSTree.create) ? VFSTree.create({
    api: api, esc: esc,
    onOpenDir: function (url) { if (contentEl) browse(app, contentEl, url); },
    onOpenFile: function (url) { if (contentEl) readFile(app, contentEl, url); },
  }) : null;
  var app = AppUI.createApp({
    id: "system-vfs",
    title: "VFS",
    menu: { View: [ { id: "refresh", label: "Refresh" } ] },
    onAction: function (_menu, id) { if (id === "refresh" && contentEl && CUR) browse(app, contentEl, CUR); },
    leftSidebar: vfsTree ? { width: 300, tabs: [ { id: "tree", label: "Browse", active: true,
      render: function (el) { vfsTree.render(el); } } ] } : undefined,
    // Right sidebar = the VFS assistant (manifest chat_profile "file/vfs.assistant"),
    // mounted as a REAL shell rightSidebar so it gets the resize handle + width
    // persistence (the former mountDeclaredSidebars path embedded into #app-right
    // out-of-band, so the shell never created a resize region → not adjustable).
    // A custom render reproduces exactly what mountDeclaredSidebars did
    // (AppUIChatPanel.mountProfile with the same profile + host hooks).
    rightSidebar: { width: 360, render: function (el) { renderAssistant(app, el); } },
    content: { render: function (el) { contentEl = mountContent(el); } },
    statusbar: {},
  });
  // keep the tree's highlight in sync with wherever the content browser goes
  TREE_SYNC = function (url) { if (vfsTree) vfsTree.setActive(url); };
  // expose a navigate hook for the assistant's vfs.open action (fired from the
  // right-sidebar chat, which is mounted by the shell, not this closure).
  window.__vfsBrowse = function (url) { if (contentEl) browse(app, contentEl, url); };
  function wire() {
    if (!contentEl) { setTimeout(wire, 20); return; }
    var r = contentEl;
    r.querySelector("#go").addEventListener("click", function () { browse(app, r, r.querySelector("#url").value.trim()); });
    r.querySelector("#up").addEventListener("click", function () { if (CUR) browse(app, r, joinUrl(CUR, "..")); });
    r.querySelector("#url").addEventListener("keydown", function (e) { if (e.key === "Enter") browse(app, r, r.querySelector("#url").value.trim()); });
    r.querySelector("#mnt-add").addEventListener("click", function () { addMount(app, r); });
    r.querySelector("#mnt-wizard").addEventListener("click", function () { toggleWizard(app, r); });
    r.querySelector("#mnt-url").addEventListener("keydown", function (e) { if (e.key === "Enter") addMount(app, r); });
    if (r.querySelector("#mnt-name")) r.querySelector("#mnt-name").addEventListener("keydown", function (e) { if (e.key === "Enter") addMount(app, r); });
    loadMounts(app, r);
    // Honor a ?path= deep-link; else default to the local drive root. Use stat
    // to route file-vs-dir DETERMINISTICALLY (#19) instead of try-list-then-read.
    var param = readPathParam();
    if (param) {
      routeDeepLink(app, r, param);
    } else {
      var start = (navigator.platform || "").toLowerCase().indexOf("win") >= 0 ? "vfs://file:///C:/" : "vfs://file:///";
      var alt = start === "vfs://file:///C:/" ? "vfs://file:///" : "vfs://file:///C:/";
      browse(app, r, start).then(function () {
        var errBox = r.querySelector("#listing .empty");
        if (errBox && CUR === start && /not found|no such file|cannot find|does not exist/i.test(errBox.textContent || "")) {
          browse(app, r, alt);
        }
      });
      app.setStatus("Enter a vfs:// url, browse the local disk, or mount a repo.");
    }
  }
  wire();
}).catch(function (e) {
  document.getElementById("app-content-body").innerHTML =
    '<div style="padding:18px">AppUI failed to load: ' + esc(e) + '</div>';
});

// AI assistant = the MANIFEST chat_profile "file/vfs.assistant". Rendered INTO
// the shell's rightSidebar region (so it's resizable + width-persistent) rather
// than embedded out-of-band via mountDeclaredSidebars. Registers the live host
// hooks (current vfs url as context; a vfs.open action that navigates the
// browser) and mounts the profile with AppUIChatPanel.mountProfile — the same
// call mountDeclaredSidebars made, just targeted at the sidebar element.
function renderAssistant(app, el) {
  if (window.AppUIHostHooks && window.AppUIHostHooks.register) {
    window.AppUIHostHooks.register("vfs.assistant", {
      context: function () { return CUR ? ("Current vfs url: " + CUR) : "No path open yet."; },
      onAction: function (type, payload) {
        if (type === "vfs.open") {
          var u = payload && (payload.url || payload.path);
          if (u && window.__vfsBrowse) window.__vfsBrowse(String(u));
        }
      },
    });
  }
  el.textContent = "Loading assistant…";
  if (!(window.AppUIAssets && window.AppUIAssets.load)) { el.textContent = "Assistant unavailable."; return; }
  window.AppUIAssets.load("feedback", "aiSidebar").then(function () {
    if (!(window.AppUIChatPanel && window.AppUIChatPanel.mountProfile)) {
      el.textContent = "Assistant unavailable."; return;
    }
    el.textContent = "";
    window.AppUIChatPanel.mountProfile(el, "file/vfs.assistant", {
      title: "Files Assistant",
      configKey: "pages/file_vfs",
      context: function () { return CUR ? ("Current vfs url: " + CUR) : "No path open yet."; },
      onAction: function (type, payload) {
        if (type === "vfs.open") {
          var u = payload && (payload.url || payload.path);
          if (u && window.__vfsBrowse) window.__vfsBrowse(String(u));
        }
      },
    });
  }).catch(function () { el.textContent = "Assistant failed to load."; });
}


