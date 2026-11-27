// VFS mount management; file navigation stays with the page controller.
(function (global) {
  "use strict";
  function create(deps) {
    var api = deps.api, esc = deps.esc, browse = deps.browse;
async function loadMounts(app, root) {
  var r = await api("mounts", {});
  var box = root.querySelector("#mounts-list");
  var ms = (r.data && r.data.mounts) || [];
  if (!ms.length) { box.innerHTML = '<div class="mounts-empty">No mounts. Mount a GitLab repo or your OneDrive (https://…-my.sharepoint.com/my) — tokens come from the Credential app.</div>'; return; }
  box.innerHTML = ms.map(function (m) {
    var badge = m.kind === "onedrive" || m.kind === "sharepoint" ? "☁"
              : (m.kind === "gitlab" ? "🦊" : "🔗");
    // scope-aware sub-label: host / group / repo / subpath (from the backend).
    var sub = m.scope_label || (m.kind === "onedrive" ? "OneDrive"
            : (m.host_mount ? (m.origin || "") + " (host)" : (m.project || "")));
    var scopeTag = m.scope ? '<span class="scope-tag scope-' + esc(m.scope) + '">' + esc(m.scope) + '</span> ' : '';
    return '<div class="mount-row" data-mnt="' + esc(m.mount) + '">' +
      '<span class="badge">' + badge + '</span> <b>' + esc(m.mount) + '</b> ' +
      '<span class="health-dot" data-hd="' + esc(m.mount) + '" title="checking…">○</span> ' +
      scopeTag +
      '<span class="mp">' + esc(sub) + (m.ref && m.ref !== "HEAD" ? "@" + esc(m.ref) : "") +
        (m.read_only ? '' : ' <span class="rw-tag" title="writable">rw</span>') + '</span>' +
      '<button class="mnt-info sec" data-info="' + esc(m.mount) + '" title="Mount info / edit">ⓘ</button>' +
      '<button class="unmnt sec" data-unmnt="' + esc(m.mount) + '">unmount</button></div>';
  }).join("");
  box.querySelectorAll("[data-mnt]").forEach(function (el) {
    el.addEventListener("click", function (e) {
      if (e.target.getAttribute("data-unmnt") || e.target.getAttribute("data-info")) return;
      browse(app, root, "vfs://mnt://" + el.getAttribute("data-mnt"));
    });
  });
  box.querySelectorAll("[data-info]").forEach(function (b) {
    b.addEventListener("click", function (e) {
      e.stopPropagation();
      showMountInfo(app, root, b.getAttribute("data-info"));
    });
  });
  box.querySelectorAll("[data-unmnt]").forEach(function (b) {
    b.addEventListener("click", async function (e) {
      e.stopPropagation();
      if (!window.confirm("Unmount '" + b.getAttribute("data-unmnt") + "'?")) return;
      await api("unmount", { name: b.getAttribute("data-unmnt") });
      loadMounts(app, root);
    });
  });
  loadMountHealth(root);
}

// Mount INFO / EDIT panel (steering): show a mount's details (scope/origin/
// base_path/ref/read_only/url) and allow a lightweight in-place edit — rename,
// toggle writable, change a gitlab ref — via vfs.mount_edit (no unmount/refetch).
async function showMountInfo(app, root, name) {
  var r = await api("mount_info", { name: name });
  var m = (r.data && r.data.mount) || null;
  var box = root.querySelector("#mnt-wizard-box");   // reuse the panel slot
  if (!box) return;
  if (!m) { box.style.display = "block"; box.innerHTML = '<div class="wizard-loading">No info for ' + esc(name) + '.</div>'; return; }
  box.style.display = "block";
  box.innerHTML =
    '<div class="wizard-title">Mount · ' + esc(m.mount) + '</div>' +
    '<table class="mnt-info-tbl">' +
      '<tr><td>kind</td><td>' + esc(m.kind) + '</td></tr>' +
      '<tr><td>scope</td><td>' + esc(m.scope || "") + (m.scope_label ? ' — ' + esc(m.scope_label) : '') + '</td></tr>' +
      '<tr><td>origin</td><td>' + esc(m.origin || "") + '</td></tr>' +
      (m.base_path ? '<tr><td>path</td><td>' + esc(m.base_path) + '</td></tr>' : '') +
      (m.project ? '<tr><td>project</td><td>' + esc(m.project) + '</td></tr>' : '') +
      '<tr><td>url</td><td><code>' + esc(m.url) + '</code></td></tr>' +
      '<tr><td>source</td><td class="mp">' + esc(m.source || "") + '</td></tr>' +
    '</table>' +
    '<div class="mnt-edit">' +
      '<input id="mi-name" placeholder="rename…" value="' + esc(m.mount) + '">' +
      (m.kind === "gitlab" ? '<input id="mi-ref" placeholder="ref (branch/tag)" value="' + esc(m.ref || "") + '">' : '') +
      '<label class="mi-ro"><input type="checkbox" id="mi-ro"' + (m.read_only ? '' : ' checked') + '> writable</label>' +
      '<button id="mi-save">Save</button>' +
      '<button id="mi-close" class="sec">Close</button>' +
    '</div><div id="mi-msg" class="wizard-cred"></div>';
  box.querySelector("#mi-close").addEventListener("click", function () { box.style.display = "none"; });
  box.querySelector("#mi-save").addEventListener("click", async function () {
    var body = { name: name };
    var nn = box.querySelector("#mi-name").value.trim();
    if (nn && nn !== name) body.new_name = nn;
    var roEl = box.querySelector("#mi-ro"); if (roEl) body.read_only = !roEl.checked;
    var refEl = box.querySelector("#mi-ref"); if (refEl && refEl.value.trim() !== (m.ref || "")) body.ref = refEl.value.trim();
    var er = await api("mount_edit", body);
    var ed = er.data || {};
    box.querySelector("#mi-msg").textContent = ed.ok
      ? ("saved" + (ed.changed && ed.changed.length ? " (" + ed.changed.join(", ") + ")" : ""))
      : ("edit failed: " + (ed.error || er.status));
    if (ed.ok) { box.style.display = "none"; await loadMounts(app, root); }
  });
}

// #20: probe each mount's liveness in the background and colour its dot —
// green=root listed, red=failed (missing credential / unreachable). Non-blocking
// so the mounts list paints instantly and the dots fill in.
async function loadMountHealth(root) {
  try {
    var r = await api("mounts_health", {});
    var h = (r.data && r.data.health) || {};
    root.querySelectorAll("[data-hd]").forEach(function (el) {
      var st = h[el.getAttribute("data-hd")];
      if (!st) return;
      if (st.ok) { el.textContent = "●"; el.className = "health-dot ok";
        el.title = "live · " + (st.entries || 0) + " item(s)"; }
      else { el.textContent = "●"; el.className = "health-dot bad";
        el.title = st.detail || "unreachable"; }
    });
  } catch (_) {}
}

async function addMount(app, root) {
  var u = root.querySelector("#mnt-url").value.trim();
  if (!u) { app.setStatus("Enter a URL to mount (or use the Wizard)."); return; }
  var nm = (root.querySelector("#mnt-name") || {}).value;
  nm = (nm || "").trim();
  app.setStatus("Mounting " + u + " …");
  var body = { url: u };
  if (nm) body.name = nm;        // optional user-chosen mount name
  var r = await api("mount", body);
  var d = r.data || {};
  if (!d.ok) { app.setStatus("Mount failed: " + (d.error || r.status)); return; }
  root.querySelector("#mnt-url").value = "";
  if (root.querySelector("#mnt-name")) root.querySelector("#mnt-name").value = "";
  app.setStatus("Mounted at " + d.url);
  await loadMounts(app, root);
  browse(app, root, d.url);
}

// #18: "mount a web service" wizard — a picker of known transports (from
// vfs.transports) that pre-fills the URL input with each transport's example and
// shows the credential it needs + a one-click link to the credential page.
async function toggleWizard(app, root) {
  var box = root.querySelector("#mnt-wizard-box");
  if (box.style.display !== "none") { box.style.display = "none"; return; }
  box.style.display = "block";
  box.innerHTML = '<div class="wizard-loading">Loading transports …</div>';
  var r = await api("transports", {});
  var ts = (r.data && r.data.transports) || [];
  if (!ts.length) { box.innerHTML = '<div class="wizard-loading">No transports.</div>'; return; }
  box.innerHTML =
    '<div class="wizard-title">Mount a web service — pick a type:</div>' +
    '<div class="wizard-grid">' + ts.map(function (t) {
      return '<button class="wizard-pick" data-tr="' + esc(t.transport) + '" ' +
        'data-ex="' + esc(t.example) + '" data-cred="' + esc(t.credential || "") + '">' +
        '<b>' + esc(t.label) + '</b><span>' + esc(t.hint || "") + '</span></button>';
    }).join("") + '</div>' +
    '<div id="wizard-detail" class="wizard-detail"></div>';
  box.querySelectorAll(".wizard-pick").forEach(function (b) {
    b.addEventListener("click", function () {
      var ex = b.getAttribute("data-ex"), cred = b.getAttribute("data-cred");
      root.querySelector("#mnt-url").value = ex;
      var det = root.querySelector("#wizard-detail");
      det.innerHTML = '<div>Example filled into the URL box above — edit it and click ' +
        '<b>Mount repo</b>.</div>' +
        (cred ? '<div class="wizard-cred">Needs a <b>' + esc(cred) + '</b> credential. ' +
          '<a href="/apps/platform/credential/" target="_blank">Open the Credential app →</a></div>'
              : '<div class="wizard-cred">No credential needed.</div>');
    });
  });
}

    return { loadMounts: loadMounts, addMount: addMount, toggleWizard: toggleWizard };
  }
  global.VFSMounts = { create: create };
})(window);

;
// VFS left-sidebar TREE — a VIS-style browsable tree over every vfs reach:
//   • This PC            local disk root(s)         (vfs://file:///C:/ , /)
//   • Mounts             each mounted reference      (vfs://mnt://<name>)
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
    function nodeFor(e) {
      return { name: e.name, path: e.url, icon: e.kind === "dir" ? "📂" : "📄",
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
        var kids = (d.entries || []).map(nodeFor);
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
      roots.push({ name: "Mounts", path: "grp:mounts", icon: "🔗", hasChildren: true,
                   data: { group: "mounts" } });
      roots.push({ name: "Providers", path: "grp:providers", icon: "📦", hasChildren: true,
                   data: { group: "providers" } });
      return roots;
    }

    function groupChildren(which) {
      if (which === "thispc") {
        return listKids(winLocal());   // real disk listing at the drive root
      }
      if (which === "mounts") {
        return api("mounts", {}).then(function (r) {
          var ms = ((r && r.data) || r || {}).mounts || [];
          if (!ms.length) return [{ name: "(no mounts)", path: "grp:mounts#none", icon: "",
                                    hasChildren: false, data: { info: true } }];
          return ms.map(function (m) {
            var badge = (m.kind === "onedrive" || m.kind === "sharepoint") ? "☁"
                      : (m.kind === "gitlab" ? "🦊" : "🔗");
            return { name: m.mount, path: "vfs://mnt://" + m.mount, icon: badge,
                     hasChildren: true, data: { kind: "dir", mount: true } };
          });
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
      return Promise.resolve([]);
    }

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
            if (d.err || d.info) return cb([]);
            if (d.group) return groupChildren(d.group).then(cb, function () { cb([]); });
            listKids(node.path).then(cb, function () { cb([]); });
          },
          onSelect: function (node) {
            var d = node.data || {};
            if (d.err || d.info || d.group) return;   // groups are expand-only
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
    return '<tr' + attr + '><td><span class="fs-icon">' + icon + '</span> ' + esc(e.name) +
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
      '<div class="mounts-head"><b>Mounts</b>' +
        '<span class="spacer"></span>' +
        '<input id="mnt-url" placeholder="https://gitlab.rnd.gic.ericsson.se/group/repo  or  https://ericsson-my.sharepoint.com/my">' +
        '<input id="mnt-name" class="mnt-name" placeholder="name (optional)" title="Mount name — a short alias shown in the tree (e.g. TC_WoW). Auto-derived if left blank.">' +
        '<button id="mnt-wizard" class="sec">Wizard</button>' +
        '<button id="mnt-add" class="sec">Mount</button>' +
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
      browse(app, r, start);
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

