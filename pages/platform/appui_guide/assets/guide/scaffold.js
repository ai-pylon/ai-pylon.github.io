import { dropCache, sectionHead } from "./helpers.js";
import { BUNDLES, api, app, btn, bundlesReady, el, esc, load } from "./state.js";

// ===================================================== SCAFFOLD ============
function renderScaffold(host) {
  host.innerHTML = "";
  var wrap = el("div", { class: "g-wrap" });
  sectionHead(wrap, "🛠️ Scaffold a new app",
    "Creates a contract-valid app skeleton (wraps <code>tools/new_app.py</code>), contract-checks just that app, hot-adds it live via <code>/v1/admin/discover</code>, and confirms it shows up in the App catalog — no restart.");
  var card = el("div", { class: "g-card" });
  card.innerHTML =
    '<div class="g-field"><label>App id</label><input id="g-appid" placeholder="group/name — e.g. file/notes"></div>' +
    '<div class="g-field"><label>Title</label><input id="g-title" placeholder="(optional)"></div>' +
    '<div class="g-field"><label>Description</label><input id="g-desc" placeholder="(optional)"></div>' +
    '<div class="g-field"><label>Ops</label><input id="g-ops" placeholder="comma-separated; prefix ! for a write op, e.g. list,!save"></div>' +
    '<div class="g-field"><label></label><div class="g-checks">' +
      '<label><input type="checkbox" id="g-page" checked> include a page</label>' +
      '<label title="declare a sidebar supply block + an embeddable renderer (shows in the Sidebars gallery)"><input type="checkbox" id="g-sidebar"> embeddable sidebar</label>' +
      '<label title="declare a chat_profile + sidebars_shown (the AGENTS.md AI-assistant recipe)"><input type="checkbox" id="g-chat"> AI assistant</label>' +
    '</div></div>' +
    '<div class="g-row"><button id="g-plan" class="btn">Preview</button><button id="g-create" class="btn btn-primary">Create app</button></div>' +
    '<div id="g-scaffold-msg"></div>';
  wrap.appendChild(card);
  var g = function (id) { return card.querySelector("#" + id); };
  var msg = g("g-scaffold-msg");
  // sidebar / chat imply a page — reflect that in the form
  function syncPage() { if (g("g-sidebar").checked || g("g-chat").checked) g("g-page").checked = true; }
  g("g-sidebar").onchange = syncPage; g("g-chat").onchange = syncPage;
  function collect() {
    var ops = (g("g-ops").value || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    return { app_id: (g("g-appid").value || "").trim(), title: (g("g-title").value || "").trim(),
             desc: (g("g-desc").value || "").trim(), ops: ops, page: g("g-page").checked,
             sidebar: g("g-sidebar").checked, chat: g("g-chat").checked };
  }
  g("g-plan").onclick = function () {
    var a = collect(); if (!a.app_id) { msg.innerHTML = '<div class="g-msg g-warn">Enter an app id.</div>'; return; }
    api("scaffold_app", a).then(function (r) {
      if (r.dry_run) msg.innerHTML = '<div class="g-msg g-ok">Would create:\n' + esc((r.dry_run.creates || []).join("\n")) + '</div>';
      else msg.innerHTML = '<div class="g-msg g-err">' + esc(r._error || "unexpected") + '</div>';
    });
  };
  g("g-create").onclick = function () {
    var a = collect(); if (!a.app_id) { msg.innerHTML = '<div class="g-msg g-warn">Enter an app id.</div>'; return; }
    confirmAsync("Create app '" + a.app_id + "'? This writes files under apps/" + a.app_id + "/.").then(function (ok) {
      if (!ok) return;
      a.confirm = true;
      msg.innerHTML = '<div class="g-msg g-warn">Creating…</div>';
      api("scaffold_app", a).then(function (r) {
        if (!r.ok) { msg.innerHTML = '<div class="g-msg g-err">' + esc(r._error || "failed") + '</div>'; return; }
        dropCache("apps"); dropCache("sidebars");   // the fleet just changed
        var c = r.contract || {};
        var lines = '✅ Created ' + r.app_id + ' (' + (r.created || []).length + ' files)' +
          (r.discovered ? ' and loaded it live.' : ' — run POST /v1/admin/discover to load it.') +
          '\ncontract check: ' + (c.ok ? 'pass' : (c.ok === false ? 'FAIL\n  ' + (c.app_findings || []).join('\n  ') : 'skipped')) +
          '\napp catalog: ' + (r.in_catalog ? 'listed ✓' : (r.in_catalog === false ? 'NOT listed' : 'unknown')) +
          '\n' + (r.created || []).join("\n");
        var links = '<div class="g-msg ' + (c.ok === false ? 'g-warn' : 'g-ok') + '">' + esc(lines) + '</div>';
        if (r.page_url) links += '<div class="g-row"><a class="btn sm" href="' + esc(r.page_url) + '" target="_blank" rel="noopener">Open ' + esc(r.page_url) + ' ↗</a></div>';
        msg.innerHTML = links;
        if (window.AppUIToast) AppUIToast.success("Scaffolded " + r.app_id);
      });
    });
  };

  // --- EXTEND AppUI: scaffold a shared component (#9) ---
  wrap.appendChild(el("h2", { style: "margin:18px 0 4px" }, "🧩 Scaffold a new AppUI component"));
  wrap.appendChild(el("div", { class: "g-sub", style: "margin-bottom:10px" },
    "Missing a widget? Don't hand-roll it in one page — add it to AppUI so every app gets it. Creates a <code>window.AppUI&lt;Name&gt;</code> skeleton in <code>framework/appui/src</code>, wires it into <code>loader.js</code> <code>_bundleDefs</code> (new bundle, or appended to an existing one), and adds a demo-card stub to this gallery."));
  var cc = el("div", { class: "g-card" });
  cc.innerHTML =
    '<div class="g-field"><label>Name</label><input id="c-name" placeholder="PascalCase — e.g. Rating → AppUIRating"></div>' +
    '<div class="g-field"><label>Bundle</label><input id="c-bundle" list="c-bundles" placeholder="(blank = new bundle named after it)"><datalist id="c-bundles"></datalist></div>' +
    '<div class="g-field"><label>Purpose</label><input id="c-what" placeholder="one line (optional)"></div>' +
    '<div class="g-row"><button id="c-plan" class="btn">Preview</button><button id="c-create" class="btn btn-primary">Create component</button></div>' +
    '<div id="c-msg"></div>';
  wrap.appendChild(cc);
  host.appendChild(wrap);
  var q = function (id) { return cc.querySelector("#" + id); };
  var cmsg = q("c-msg");
  bundlesReady().then(function () {
    q("c-bundles").innerHTML = Object.keys(BUNDLES).sort().map(function (b) { return '<option value="' + esc(b) + '">'; }).join("");
  });
  function ccollect() {
    return { name: (q("c-name").value || "").trim(), bundle: (q("c-bundle").value || "").trim(),
             what: (q("c-what").value || "").trim() };
  }
  function planLines(p) {
    return (p.global || "") + " → " + (p.file || "") + "\nbundle: " + (p.bundle || "") +
      (p.new_bundle ? " (new)" : " (existing)") + "\nedits: " + (p.edited || []).join(", ");
  }
  q("c-plan").onclick = function () {
    var a = ccollect(); if (!a.name) { cmsg.innerHTML = '<div class="g-msg g-warn">Enter a name.</div>'; return; }
    api("scaffold_component", a).then(function (r) {
      if (r.dry_run) cmsg.innerHTML = '<div class="g-msg g-ok">Would create:\n' + esc(planLines(r.dry_run)) + '</div>';
      else cmsg.innerHTML = '<div class="g-msg g-err">' + esc(r._error || "unexpected") + '</div>';
    });
  };
  q("c-create").onclick = function () {
    var a = ccollect(); if (!a.name) { cmsg.innerHTML = '<div class="g-msg g-warn">Enter a name.</div>'; return; }
    confirmAsync("Create AppUI" + a.name.replace(/^AppUI/, "") + "? This edits framework/appui (src + loader.js).").then(function (ok) {
      if (!ok) return;
      a.confirm = true;
      api("scaffold_component", a).then(function (r) {
        if (!r.ok) { cmsg.innerHTML = '<div class="g-msg g-err">' + esc(r._error || "failed") + '</div>'; return; }
        dropCache("catalog"); dropCache("bundles"); _bundlesP = null;
        cmsg.innerHTML = '<div class="g-msg g-ok">' + esc("✅ " + planLines(r) + "\n" + (r.next || "")) + '</div>';
        if (window.AppUIToast) AppUIToast.success("Scaffolded " + r.global);
      });
    });
  };
}
function confirmAsync(text) {
  if (window.AppUIDialog && AppUIDialog.confirmAsync) return AppUIDialog.confirmAsync(text);
  return Promise.resolve(window.confirm(text));
}

export { renderScaffold, confirmAsync };
