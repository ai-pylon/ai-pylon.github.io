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

