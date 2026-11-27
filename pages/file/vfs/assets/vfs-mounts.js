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
