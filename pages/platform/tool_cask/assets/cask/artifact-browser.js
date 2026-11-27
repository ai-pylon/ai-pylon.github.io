// Artifact archive browsing; transport and page element construction are injected.
export function createArtifactBrowser({ api, el, fmtBytes, root }) {
// ============ LEFT SIDEBAR: downloaded artifacts + zip browse =========
// Reuses the shared AppUITree (lazy onExpand) just like the workspace
// file explorer: roots = downloaded .agent artifacts; expanding one
// lists its ZIP entries (archive_list); a leaf click previews the inner
// file (archive_read) in the content body. All local — no VFS/SSH.
var ZIP_SEP = "!/";
var leftPane = document.getElementById("app-left");
var contentBody = document.getElementById("app-content-body") || root;
var caskTree = null;
var _artifacts = [];      // [{token,filename,bytes,download_url}]
var _entriesCache = {};   // token -> entries[]

function zipIcon(nm, dir) {
  if (dir) return "📁";
  var e = (String(nm).split(".").pop() || "").toLowerCase();
  if (/^(png|jpe?g|gif|webp|svg|bmp|ico)$/.test(e)) return "🖼";
  if (/^(md|markdown|txt|rst|log)$/.test(e)) return "📝";
  if (/^(json|ya?ml|xml|toml|ini|cfg)$/.test(e)) return "⚙";
  if (/^(js|ts|py|java|c|cpp|cs|go|rs|rb|sh)$/.test(e)) return "📜";
  if (/^(zip|tar|gz|tgz|agent|jar|whl)$/.test(e)) return "🗜";
  return "📄";
}

// Flat zip entry list -> immediate children of a folder `prefix`.
function zipChildren(token, entries, prefix) {
  var listing = entries || [];
  var partition = AppUIFileUtils.flatChildren(listing.filter(function (en) { return !en.dir; }), prefix, {
    folders: listing.filter(function (en) { return en.dir; }).map(function (en) { return en.name; }),
    normalize: function (name) { return String(name).replace(/\\/g, "/").replace(/\/+$/, ""); }
  });
  var out = [];
  partition.directories.sort().forEach(function (d) {
    var childPrefix = (prefix ? prefix + "/" : "") + d;
    out.push({ name: d, path: token + ZIP_SEP + childPrefix + "/", icon: "📁",
               hasChildren: true, data: { token: token, zipPrefix: childPrefix } });
  });
  partition.files.sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (f) {
    var entryPath = (prefix ? prefix + "/" : "") + f.name;
    out.push({ name: f.name + "  (" + fmtBytes(f.entry.size) + ")", path: token + ZIP_SEP + entryPath,
               icon: zipIcon(f.name, false), hasChildren: false,
               data: { token: token, zipEntry: entryPath, size: f.entry.size } });
  });
  if (!out.length) out.push({ name: "(empty)", path: token + ZIP_SEP + "__empty", icon: "·", hasChildren: false, data: {} });
  return out;
}

function onTreeExpand(node, cb) {
  var d = node.data || {};
  if (!d.token) { cb([]); return; }
  // expanding an artifact root OR a zip folder → list archive (cached)
  var cached = _entriesCache[d.token];
  var prefix = d.zipPrefix || "";
  if (cached) { cb(zipChildren(d.token, cached, prefix)); return; }
  api("archive_list", { token: d.token }).then(function (r) {
    if (!r || !r.ok) {
      cb([{ name: "⚠ " + ((r && r._error) || "cannot read archive"), path: d.token + ZIP_SEP + "__err",
            icon: "⚠", hasChildren: false, data: {} }]);
      return;
    }
    _entriesCache[d.token] = r.entries || [];
    cb(zipChildren(d.token, _entriesCache[d.token], prefix));
  });
}

var MEMBER_TEXT_RE = /\.(txt|md|markdown|json|ya?ml|xml|toml|ini|cfg|csv|log|py|js|ts|java|c|cpp|cs|go|rs|rb|sh|html?|css|rst|sql|properties|gradle|bat|ps1)$/i;
var MEMBER_IMG_RE = /\.(png|jpe?g|gif|webp|bmp|svg|ico)$/i;

function previewMember(node) {
  var d = node.data || {};
  if (!d.token || !d.zipEntry) return;
  var nm = String(d.zipEntry).split("/").pop() || d.zipEntry;
  contentBody.innerHTML = "";
  var hdr = el("div", { style: "padding:8px 12px;border-bottom:1px solid #2a2a2a;font-weight:600" });
  hdr.textContent = "🗜 " + nm;
  var body = el("div", { style: "padding:12px;overflow:auto" });
  body.textContent = "Extracting " + nm + "…";
  contentBody.appendChild(hdr); contentBody.appendChild(body);
  api("archive_read", { token: d.token, entry: d.zipEntry }).then(function (r) {
    if (!r || !r.ok) { body.textContent = "Could not extract: " + ((r && r._error) || "unknown"); return; }
    if (MEMBER_IMG_RE.test(nm)) {
      var ext = (nm.split(".").pop() || "").toLowerCase();
      var mime = ext === "svg" ? "image/svg+xml" : ("image/" + (ext === "jpg" ? "jpeg" : ext));
      body.innerHTML = "";
      var img = el("img", { style: "max-width:100%", alt: nm });
      img.src = "data:" + mime + ";base64," + r.b64;
      body.appendChild(img);
    } else if (MEMBER_TEXT_RE.test(nm) || (r.bytes || 0) < 256 * 1024) {
      var text = "";
      try { text = decodeURIComponent(escape(atob(r.b64))); }
      catch (e) { try { text = atob(r.b64); } catch (e2) { text = ""; } }
      body.innerHTML = "";
      var pre = el("pre", { style: "margin:0;font:12px/1.5 ui-monospace,monospace;white-space:pre-wrap" });
      pre.textContent = text;
      body.appendChild(pre);
    } else {
      body.textContent = "Binary member (" + fmtBytes(r.bytes || d.size || 0) +
        "). Preview not available — download the whole artifact instead.";
    }
  }).catch(function (e) { body.textContent = "Extract failed: " + e; });
}

function renderSidebar() {
  if (!leftPane) return;
  leftPane.innerHTML = "";
  var head = el("div", { style: "display:flex;align-items:center;gap:6px;padding:8px 10px;border-bottom:1px solid #2a2a2a" });
  head.appendChild(el("b", { style: "flex:1;font-size:13px" }, "Downloaded artifacts"));
  var refreshBtn = el("button", { style: "font-size:11px;padding:2px 8px", title: "Refresh" }, "⟳");
  refreshBtn.onclick = function () { refreshDownloads(); };
  head.appendChild(refreshBtn);
  leftPane.appendChild(head);
  var treeHost = el("div", { id: "cask-art-tree", style: "padding:4px 2px;overflow:auto" });
  leftPane.appendChild(treeHost);

  if (!_artifacts.length) {
    treeHost.appendChild(el("div", { style: "color:#888;font-size:12px;padding:10px" },
      "No artifacts yet. Download one above."));
    return;
  }
  if (!(window.AppUITree && window.AppUITree.create)) {
    // Graceful fallback: a flat list with download links if the tree
    // component isn't available in the loaded bundles.
    var ul = el("ul", { style: "list-style:none;padding:6px;margin:0;font-size:13px" });
    _artifacts.forEach(function (it) {
      var li = el("li", { style: "padding:3px 0" });
      var a = el("a", { href: it.download_url, download: it.filename, style: "color:#5ab0ff;text-decoration:none" });
      a.textContent = "⬇ " + it.filename + " (" + fmtBytes(it.bytes) + ")";
      li.appendChild(a); ul.appendChild(li);
    });
    treeHost.appendChild(ul);
    return;
  }
  caskTree = window.AppUITree.create({
    container: treeHost,
    storageKey: "caskArtifacts:expanded",
    onExpand: onTreeExpand,
    onSelect: function (node) {
      if (node.data && node.data.zipEntry) previewMember(node);
    },
  });
  caskTree.setRoots(_artifacts.map(function (it) {
    return { name: it.filename + "  (" + fmtBytes(it.bytes) + ")",
             path: it.token, icon: "🗜", hasChildren: true,
             data: { token: it.token, artifact: true } };
  }));
}

function refreshDownloads() {
  api("downloads", {}).then(function (r) {
    _artifacts = (r && r.downloads) || [];
    _entriesCache = {};   // artifacts changed → drop cached entry lists
    renderSidebar();
  }).catch(function (e) {
    if (leftPane) { leftPane.innerHTML = ""; var s = el("div", { style: "color:#c66;padding:10px" }); s.textContent = String(e); leftPane.appendChild(s); }
  });
}

  return { refreshDownloads };
}
