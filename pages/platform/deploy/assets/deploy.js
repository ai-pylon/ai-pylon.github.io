// platform/deploy — one card per endpoint (AppForge, the Google VM, this machine): its live state,
// its steps (run all or one), and the running job's log.
(function () {
  "use strict";
  var API = "/v1/apps/platform/deploy/";
  var LABEL = {push_foundation: "Push foundation", build_deploy: "Build + deploy", upload: "Upload pylon-server",
               start_vm: "Start VM", upgrade_foundation: "Upgrade bootstrap", install_foundation: "Install / update bootstrap", install_daemon: "Install daemon"};
  var KIND = {appforge: "AppForge", vm: "Google VM", local: "This machine"};
  var main = null, timers = {};
  function api(op, args) {
    return fetch(API + op, {method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify(args || {})}).then(function (r) { return r.json(); });
  }
  function node(tag, text, attrs) {
    var e = document.createElement(tag);
    if (text != null) e.textContent = text;
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    return e;
  }
  function btn(label, fn, primary) {
    var b = node("button", label, {type: "button", "class": "btn" + (primary ? " primary" : "")}); b.onclick = fn; return b;
  }
  function css() {
    var st = node("style");
    st.textContent = [
      ".dp-main{padding:16px 20px;max-width:1200px}",
      ".dp-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:14px}",
      ".dp-card{border:1px solid var(--appui-border,rgba(127,127,127,.3));border-radius:12px;padding:14px 16px;display:flex;flex-direction:column;gap:8px}",
      ".dp-card h3{margin:0;font-size:16px}.dp-url{font-size:12px;opacity:.7;word-break:break-all}",
      ".dp-state{font-size:13px}.ok{color:#2f9e44}.bad{color:#d0453a}.muted{opacity:.7}",
      ".dp-steps{display:flex;flex-wrap:wrap;gap:6px}",
      ".dp-log{max-height:260px;overflow:auto;font:11.5px/1.45 var(--font-mono,ui-monospace,monospace);",
      "background:rgba(127,127,127,.08);border-radius:8px;padding:8px;white-space:pre-wrap;margin:0}",
      ".dp-note{font-size:12.5px;opacity:.75}",
      ".dt-side{display:flex;flex-direction:column;gap:6px;padding:8px;height:100%;box-sizing:border-box}",
      ".dt-side input[type=search]{width:100%;box-sizing:border-box;padding:5px 8px}",
      ".dt-legend{font-size:10.5px;opacity:.85;line-height:1.7}.dt-legend span{margin-right:6px}",
      ".dt-bar{display:flex;gap:6px}.dt-body{overflow:auto;flex:1;font-size:13px}",
      ".dt-row{display:flex;align-items:center;gap:4px;padding:2px 6px;border-radius:5px;cursor:pointer;white-space:nowrap}",
      ".dt-row:hover{background:rgba(127,127,127,.12)}.dt-row.sel{outline:1px solid var(--accent,#3b82f6);outline-offset:-1px}",
      ".dt-row.grp{font-weight:600}.dt-row .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}",
      ".dt-row .tw{display:inline-block;width:10px;opacity:.6;transition:transform .12s}.dt-row .tw.open{transform:rotate(90deg)}",
      ".dt-row .cnt{opacity:.55;font-size:11px;font-weight:400}",
      ".dep-all{color:#2f9e44}.dep-vm{color:#1c7ed6}.dep-af{color:#e8590c}.dep-block{color:#d92d3a;opacity:.8}",
      ".dm{flex:0 0 auto;font-size:9.5px;font-weight:600;padding:0 4px;border-radius:7px;border:1px solid currentColor;line-height:14px}",
      ".dm.plan{opacity:.6}.dm.live{color:#2f9e44}.dm.todo{color:#e8590c}.dm.extra{color:#d92d3a;background:rgba(217,45,58,.08)}",
      ".dm.block{color:#d92d3a;opacity:.55}.dm.lock{border-style:dotted}.dm.inh{border-style:dashed}",
      ".dt-empty{opacity:.7;padding:10px}",
      ".cr-box{max-height:60vh;overflow:auto;font-size:13px}.cr-tbl{border-collapse:collapse;width:100%;margin:6px 0}",
      ".cr-tbl th,.cr-tbl td{text-align:left;padding:3px 8px;border-bottom:1px solid rgba(127,127,127,.2)}",
      ".cr-none{opacity:.45}.cr-opt{display:block;margin:4px 0}",
      ".dp-tok{display:flex;flex-wrap:wrap;align-items:center;gap:6px;font-size:12px}",
      ".dp-tok code{padding:2px 6px;border-radius:6px;background:rgba(127,127,127,.14);font:11.5px/1.4 var(--font-mono,ui-monospace,monospace);user-select:all;word-break:break-all}",
      ".dp-url a{color:inherit;text-decoration:underline;text-underline-offset:2px}",
      ".dp-warn{font-size:12px;color:#d97706;background:rgba(217,119,6,.1);border-radius:6px;padding:4px 8px}",
      ".dp-diff{font-size:12px}.dp-diff summary{cursor:pointer;opacity:.85}.dp-diff-list{margin:4px 0 0;padding-left:18px;max-height:140px;overflow:auto}",
    ].join("\n");
    document.head.appendChild(st);
  }

  function stateText(s) {
    if (!s || !s.ok) return [(s && (s.error || s._error)) || "unknown", "bad"];
    var h = s.health || {};
    if (h.error || h.http) return ["not answering /health (" + (h.error || "HTTP " + h.http) + ")", "bad"];
    var buildNote = h.build ? " · build " + h.build + (s.local_build && h.build !== s.local_build ? " (local " + s.local_build + ")" : "") : "";
    if (!s.framework) return ["foundation up" + buildNote + "; framework not uploaded yet", "bad"];
    var miss = (s.missing || []).length;
    return [s.apps + " apps running" + buildNote +
            (miss ? " · " + miss + " planned app(s) missing" : " · up to date") +
            ((s.extra || []).length ? " · " + s.extra.length + " extra" : ""), miss ? "bad" : "ok"];
  }

  function tokenRow(name, t) {
    var row = node("div", null, {"class": "dp-tok"});
    var val = node("code", "", {hidden: ""});
    var cached = null, shown = false;
    var fetchTok = function () {
      return cached ? Promise.resolve(cached) : api("deploy_token", {target: name}).then(function (r) {
        if (r && r.ok && r.token) cached = r;
        return r;
      });
    };
    var showBtn = btn("Show deploy token", function () {
      if (shown) { shown = false; val.hidden = true; showBtn.textContent = "Show deploy token"; return; }
      fetchTok().then(function (r) {
        if (!r || !r.ok) { val.hidden = false; val.textContent = (r && (r.error || r._error)) || "unavailable"; return; }
        shown = true; val.hidden = false; val.textContent = r.token; showBtn.textContent = "Hide token";
      });
    });
    var copyBtn = btn("Copy token", function () {
      fetchTok().then(function (r) {
        if (!r || !r.ok || !r.token) { copyBtn.textContent = "No token"; setTimeout(function () { copyBtn.textContent = "Copy token"; }, 1800); return; }
        var done = function () { copyBtn.textContent = "Copied!"; setTimeout(function () { copyBtn.textContent = "Copy token"; }, 1500); };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(r.token).then(done, function () { shown = true; val.hidden = false; val.textContent = r.token; });
        } else {
          shown = true; val.hidden = false; val.textContent = r.token; showBtn.textContent = "Hide token";
        }
      });
    });
    row.appendChild(showBtn);
    row.appendChild(copyBtn);
    if (t.url) {
      var loginUrl = t.url.replace(/\/+$/, "") + "/_pylon/login";
      var loginBtn = btn("Sign in ↗", function () {
        fetchTok().then(function (r) {
          if (r && r.ok && r.token && navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(r.token).then(function () {
              toast("success", "Deploy token copied — paste it to sign in");
            }, function () {});
          }
          window.open(loginUrl, "_blank", "noopener");
        });
      });
      loginBtn.title = "Copies deploy token to clipboard and opens /_pylon/login";
      row.appendChild(loginBtn);
    }
    row.appendChild(val);
    return row;
  }

  function card(name, t) {
    var c = node("div", null, {"class": "dp-card"});
    c.appendChild(node("h3", (KIND[t.kind] || t.kind) + " — " + name));
    var urlEl = node("div", null, {"class": "dp-url"});
    if (t.url) urlEl.appendChild(node("a", t.url, {href: t.url, target: "_blank", rel: "noopener"}));
    c.appendChild(urlEl);
    var st = node("div", "checking…", {"class": "dp-state muted"}); c.appendChild(st);
    var warnEl = node("div", "", {"class": "dp-warn", hidden: ""}); c.appendChild(warnEl);
    var diffEl = node("div", null, {"class": "dp-diff", hidden: ""}); c.appendChild(diffEl);
    var lastStatus = null;
    var steps = node("div", null, {"class": "dp-steps"});
    var log = node("pre", "", {"class": "dp-log", hidden: ""});
    var refresh = function () {
      api("status", {target: name}).then(function (s) {
        lastStatus = s;
        var x = stateText(s); st.textContent = x[0]; st.className = "dp-state " + x[1];
        if (s && s.bridge) {
          var br = s.bridge;
          var brTxt = " · bridge: " + (br.state || "?") + (br.failures ? " (" + br.failures + " fail)" : "") +
            (br.error ? " — " + String(br.error).slice(0, 80) : "");
          st.textContent += brTxt;
        }
        var dirty = (s && s.foundation_dirty) || [];
        if (dirty.length && (t.steps || []).indexOf("push_foundation") >= 0) {
          warnEl.hidden = false;
          warnEl.textContent = "⚠ " + dirty.length + " uncommitted foundation file(s) (" + dirty.slice(0, 3).join(", ") +
            (dirty.length > 3 ? ", …" : "") + ") — commit before Push foundation (it pushes git HEAD).";
        } else {
          warnEl.hidden = true;
        }
        diffEl.innerHTML = "";
        var miss = (s && s.missing) || [], extra = (s && s.extra) || [];
        if (t.kind !== "local" && (miss.length || extra.length)) {
          diffEl.hidden = false;
          if (miss.length) {
            var det = node("details");
            det.appendChild(node("summary", miss.length + " missing planned app(s)"));
            var ul = node("ul", null, {"class": "dp-diff-list"});
            miss.forEach(function (a) { ul.appendChild(node("li", a)); });
            det.appendChild(ul);
            diffEl.appendChild(det);
            diffEl.appendChild(btn("↑ Upload " + miss.length + " missing only", function () {
              if (!confirm("Upload " + miss.length + " missing app(s) to " + name + "?")) return;
              api("deploy_apps", {target: name, apps: miss, confirm: true}).then(function (j) {
                if (!j.ok) { log.hidden = false; log.textContent = j.error || j._error; return; }
                follow(name, j.id, log, refresh, steps);
              });
            }));
          }
          if (extra.length) {
            var detE = node("details");
            detE.appendChild(node("summary", extra.length + " extra app(s) on target"));
            var ulE = node("ul", null, {"class": "dp-diff-list"});
            extra.forEach(function (a) { ulE.appendChild(node("li", a)); });
            detE.appendChild(ulE);
            diffEl.appendChild(detE);
          }
        } else {
          diffEl.hidden = true;
        }
      });
    };
    refresh();
    var prev = window.__deployRefreshCards;
    window.__deployRefreshCards = function () { if (prev) prev(); refresh(); };
    var runIt = function (list, what) {
      var extraWarn = (list.indexOf("push_foundation") >= 0 && lastStatus && (lastStatus.foundation_dirty || []).length)
        ? "\n\nWarning: " + lastStatus.foundation_dirty.length + " foundation file(s) have uncommitted local changes and will NOT be included (Push foundation packages git HEAD)." : "";
      if (!confirm("Run " + what + " on " + name + " (" + t.url + ")?" + extraWarn)) return;
      api("run", {target: name, steps: list, confirm: true}).then(function (j) {
        if (!j.ok) { log.hidden = false; log.textContent = j.error || j._error; return; }
        follow(name, j.id, log, refresh, steps);
      });
    };
    steps.appendChild(btn("▶ Run " + (t.default_run || []).map(function (s) { return LABEL[s] || s; }).join(" → "),
      function () { runIt(t.default_run, "the full deploy"); }, true));
    (t.steps || []).forEach(function (s) { steps.appendChild(btn(LABEL[s] || s, function () { runIt([s], LABEL[s] || s); })); });
    steps.appendChild(btn("↻", refresh));
    c.appendChild(steps);
    if (t.kind !== "local") {
      c.appendChild(tokenRow(name, t));
      var cr = node("div", null, {"class": "dp-steps"});
      cr.appendChild(btn("🔑 Credentials…", function () { credentialsDialog(name); }));
      cr.appendChild(btn('Preview selected data?', function () { selectedDataDialog(name); }));
      cr.appendChild(btn("⬇ Remote Changes (Import)…", function () { remoteImportDialog(name); }));
      cr.appendChild(btn("📦 Snapshots…", function () { snapshotsDialog(name); }));
      c.appendChild(cr);
      c.appendChild(node("div", "Uploads the committed apps + " + (t.apps || []).length +
        " app(s) the app tree on the left allows for this target (right-click a group or app).", {"class": "dp-note"}));
    }
    c.appendChild(log);
    api("jobs").then(function (r) {                        // resume following a run already in progress
      var j = (r.jobs || []).filter(function (x) { return x.target === name; })[0];
      if (j) follow(name, j.id, log, refresh, steps);
    });
    return c;
  }

  function remoteImportDialog(name) {
    var body = node('div'), listEl = node('div'), msg = node('p', 'Checking remote apps on ' + name + '…');
    var checks = [];
    var doImport = btn('Import selected → local', function () {
      var chosen = checks.filter(function (x) { return x.cb.checked; }).map(function (x) { return x.app; });
      if (!chosen.length) { msg.textContent = 'Select at least one app to import.'; return; }
      if (!confirm('Import ' + chosen.length + ' app(s) from ' + name + ' into local apps/?\n\nExisting local copies are backed up and local data/ folders are preserved.')) return;
      doImport.disabled = true;
      msg.textContent = 'Importing ' + chosen.length + ' app(s)…';
      api('import_apps', {target: name, apps: chosen, confirm: true, reload: true}).then(function (r) {
        doImport.disabled = false;
        if (!r || !r.ok) { msg.textContent = (r && (r.error || r._error)) || 'Import failed'; return; }
        var done = (r.apps || []).filter(function (a) { return a.imported; }).length;
        msg.textContent = 'Imported ' + done + ' app(s) into local source and reloaded.';
        if (window.__deployRefreshCards) window.__deployRefreshCards();
      });
    }, true);
    doImport.disabled = true;
    body.appendChild(node('p', 'Compare apps running on ' + name + ' against your local repo to pull evolved remote apps back into local source.'));
    body.appendChild(listEl); body.appendChild(doImport); body.appendChild(msg);
    api('diff_remote_apps', {target: name, detail: true}).then(function (r) {
      if (!r || !r.ok) { msg.textContent = (r && (r.error || r._error)) || 'Comparison failed'; return; }
      var changed = (r.apps || []).filter(function (a) { return a.status === 'different' || a.status === 'remote_only'; });
      listEl.replaceChildren(); checks = [];
      if (!changed.length) { msg.textContent = 'All ' + ((r.summary && r.summary.total) || 0) + ' remote apps match local source.'; return; }
      changed.forEach(function (a) {
        var row = node('div');
        row.style.cssText = 'padding:4px 0';
        var lbl = node('label'), cb = node('input', null, {type: 'checkbox'});
        var diffTxt = a.status === 'remote_only' ? 'remote only'
          : ('+' + (a.added || []).length + ' ~' + (a.modified || []).length + ' -' + (a.removed || []).length + ' files');
        lbl.appendChild(cb);
        lbl.appendChild(document.createTextNode(' ' + a.app + ' [' + diffTxt + ']'));
        row.appendChild(lbl);
        var files = [].concat(
          (a.added || []).map(function (f) { return '+ ' + f; }),
          (a.modified || []).map(function (f) { return '~ ' + f; }),
          (a.removed || []).map(function (f) { return '- ' + f; })
        );
        if (files.length) {
          var det = node('details');
          det.style.cssText = 'margin-left:20px;font-size:12px';
          det.appendChild(node('summary', 'Show ' + files.length + ' changed file(s)'));
          var ul = node('ul', null, {'class': 'dp-diff-list'});
          files.slice(0, 50).forEach(function (line) { ul.appendChild(node('li', line)); });
          if (files.length > 50) ul.appendChild(node('li', '… and ' + (files.length - 50) + ' more'));
          det.appendChild(ul);
          row.appendChild(det);
        }
        listEl.appendChild(row);
        checks.push({app: a.app, cb: cb});
      });
      doImport.disabled = false;
      msg.textContent = changed.length + ' app(s) differ from local source.';
    });
    if (window.AppUIModal) AppUIModal.open({title: 'Import Evolved Apps ← ' + name, content: body});
    else { main.appendChild(body); }
  }

  function snapshotsDialog(name) {
    var body = node('div'), listEl = node('div'), msg = node('p', '');
    function loadSnaps() {
      msg.textContent = 'Loading snapshots…';
      api('snapshot_list', {target: name}).then(function (r) {
        listEl.replaceChildren();
        if (!r || !r.ok) { msg.textContent = (r && (r.error || r._error)) || 'Failed to list snapshots'; return; }
        var snaps = r.snapshots || [];
        if (!snaps.length) { msg.textContent = 'No snapshots saved for ' + name + ' yet.'; return; }
        msg.textContent = snaps.length + ' saved snapshot(s).';
        snaps.forEach(function (s) {
          var row = node('div', null, {'class': 'dp-steps'});
          row.appendChild(node('span', s.name + ' (' + mb(s.bytes) + ')'));
          row.appendChild(btn('Restore → ' + name, function () {
            if (!confirm('Restore snapshot ' + s.name + ' onto ' + name + ' and run /v1/admin/discover?')) return;
            msg.textContent = 'Restoring ' + s.name + '…';
            api('snapshot_restore', {target: name, snapshot: s.name, confirm: true}).then(function (res) {
              if (!res || !res.ok) { msg.textContent = (res && (res.error || res._error)) || 'Restore failed'; return; }
              msg.textContent = 'Restored ' + ((res.restore && res.restore.count) || 0) + ' app(s) on ' + name + '.';
              if (window.__deployRefreshCards) window.__deployRefreshCards();
            });
          }));
          row.appendChild(btn('Delete', function () {
            if (!confirm('Delete saved snapshot ' + s.name + '?')) return;
            api('snapshot_delete', {snapshot: s.name, confirm: true}).then(function (res) {
              if (!res || !res.ok) { msg.textContent = (res && (res.error || res._error)) || 'Delete failed'; return; }
              msg.textContent = 'Deleted ' + s.name + '.';
              loadSnaps();
            });
          }));
          listEl.appendChild(row);
        });
      });
    }
    var bk = btn('📦 Backup Snapshot Now', function () {
      bk.disabled = true; msg.textContent = 'Downloading snapshot from ' + name + '…';
      api('snapshot_backup', {target: name}).then(function (r) {
        bk.disabled = false;
        if (!r || !r.ok) { msg.textContent = (r && (r.error || r._error)) || 'Backup failed'; return; }
        msg.textContent = 'Saved ' + r.snapshot + ' (' + mb(r.bytes) + ').';
        loadSnaps();
      });
    }, true);
    body.appendChild(node('p', 'Save or restore all installed apps on ' + name + ' in a single HTTP request (/_pylon/api/apps-snapshot).'));
    body.appendChild(bk); body.appendChild(listEl); body.appendChild(msg);
    loadSnaps();
    if (window.AppUIModal) AppUIModal.open({title: 'App Snapshots — ' + name, content: body});
    else { main.appendChild(body); }
  }

  function selectedDataDialog(name) {
    var body = node('div'), input = node('input', null, {type: 'text', placeholder: 'App IDs, separated by commas', 'aria-label': 'Apps whose data to preview'});
    input.style.width = '100%'; body.appendChild(input);
    body.appendChild(node('p', 'Preview app data separately from code. Select only the files to merge. Destination data is backed up; credential vaults and secret files are excluded.'));
    var table = node('div'), message = node('p'), selections = [], plan = null;
    var apply = btn('Copy selected files', function () {
      var chosen = selections.filter(function (r) { return r.input.checked; }).map(function (r) { return {app:r.row.app, path:r.row.path}; });
      if (!chosen.length) { message.textContent = 'Select at least one file.'; return; }
      apply.disabled = true;
      api('migrate_data', {id:plan.id, files:chosen, confirm:true}).then(function (result) {
        if (!result.ok) { message.textContent = result.error || result._error; apply.disabled = false; return; }
        message.textContent = 'Migration started. Progress is shown on the Deploy page.';
        var log = node('pre', '', {'class':'dp-log'}); main.appendChild(log);
        follow(name,result.id,log,function () { if(window.__deployRefreshCards) window.__deployRefreshCards(); },node('div'));
      }).catch(function (error) { message.textContent=String(error); apply.disabled=false; });
    }, true);
    apply.disabled = true;
    var preview = btn('Preview data', function () {
      preview.disabled = true; apply.disabled = true; message.textContent='Comparing data…';
      api('preview_data', {target:name, apps:input.value.split(',').map(function (v) { return v.trim(); }).filter(Boolean)}).then(function (result) {
        preview.disabled=false;
        if (!result.ok) { message.textContent=result.error || result._error; return; }
        plan=result; selections=[]; table.replaceChildren();
        result.files.forEach(function (row) {
          var label=node('label'), check=node('input',null,{type:'checkbox'});
          label.style.cssText='display:block;padding:4px;overflow-wrap:anywhere';
          label.appendChild(check); label.appendChild(document.createTextNode(' '+row.app+' / '+row.path+' · '+row.bytes+' bytes · '+row.comparison));
          table.appendChild(label); selections.push({row:row,input:check});
        });
        apply.disabled=!result.files.length;
        message.textContent=result.note+' Preview expires in 15 minutes.';
      }).catch(function (error) { preview.disabled=false; message.textContent=String(error); });
    });
    body.appendChild(preview); body.appendChild(table); body.appendChild(apply); body.appendChild(message);
    AppUIDialog.show({title:'Copy selected data to '+name,body:body,width:'850px',buttons:[{text:'Close'}]});
  }

  function follow(name, id, log, refresh, steps) {
    clearTimeout(timers[name]);
    log.hidden = false;
    var stop = btn('Stop deployment', function () {
      stop.disabled = true;
      api('stop', {id: id, confirm: true}).then(function (result) {
        if (!result.ok) { stop.disabled = false; stop.textContent = result.error || 'Stop failed'; }
        else stop.textContent = 'Stopping after current operation…';
      }).catch(function () { stop.disabled = false; stop.textContent = 'Retry stop'; });
    });
    log.parentNode.insertBefore(stop, log);
    var progressLabel = node('div', '', {'class': 'dp-note', 'aria-live': 'polite'});
    var progressBar = node('progress', null, {'aria-label': 'Completed apps'});
    log.parentNode.insertBefore(progressLabel, log);
    log.parentNode.insertBefore(progressBar, log);
    var reviewPanel = null, reviewRevision = null;
    function showReview(rows, revision) {
      if (reviewPanel && reviewRevision === revision) return;
      if (reviewPanel) reviewPanel.remove();
      reviewRevision = revision;
      reviewPanel = node('div');
      log.parentNode.insertBefore(reviewPanel, log.nextSibling);
      reviewPanel.appendChild(node('p', 'Review source versions (apps or framework/dependency/daemon trees). No reviewed source is installed until you continue. Missing version labels are shown as “not declared”; file comparison detects changes even when versions match.'));
      var scroll = node('div'); scroll.style.cssText = 'overflow:auto;max-height:420px';
      var table = node('table'); table.style.cssText = 'width:100%;text-align:left;font-size:12px';
      var head = node('tr');
      ['Source', 'Remote version / hash', 'Local version / hash', 'Files', 'Action'].forEach(function (label) { head.appendChild(node('th', label)); });
      table.appendChild(head);
      var selects = {};
      rows.forEach(function (row) {
        var tr = node('tr');
        [row.app, (row.remote_version == null ? 'not declared / absent' : row.remote_version) + ' / ' + (row.remote_hash || 'unavailable'),
          (row.local_version == null ? 'not declared' : row.local_version) + ' / ' + (row.local_hash || 'unavailable'), row.comparison].forEach(function (value) {
            var td = node('td', String(value)); td.style.cssText = 'max-width:220px;overflow-wrap:anywhere'; tr.appendChild(td);
          });
        var cell = node('td'), select = node('select', null, {'aria-label': 'Action for ' + row.app});
        select.appendChild(node('option', 'Skip', {value: 'skip'}));
        select.appendChild(node('option', 'Replace / install', {value: 'replace'}));
        selects[row.app] = select; cell.appendChild(select); tr.appendChild(cell); table.appendChild(tr);
      });
      scroll.appendChild(table); reviewPanel.appendChild(scroll);
      reviewPanel.appendChild(btn('Replace changed sources', function () { rows.forEach(function (row) { selects[row.app].value = row.comparison === 'identical' ? 'skip' : 'replace'; }); }));
      reviewPanel.appendChild(btn('Skip all', function () { Object.keys(selects).forEach(function (app) { selects[app].value = 'skip'; }); }));
      var message = node('p');
      var submit = btn('Continue with choices', function () {
        var choices = {}; Object.keys(selects).forEach(function (app) { choices[app] = selects[app].value; });
        submit.disabled = true;
        api('decide_apps', {id: id, choices: choices, review_revision: revision, confirm: true}).then(function (result) {
          if (!result.ok) { message.textContent = result.error || result._error; submit.disabled = false; }
        }).catch(function (error) { message.textContent = String(error); submit.disabled = false; });
      }, true);
      reviewPanel.appendChild(submit); reviewPanel.appendChild(message);
    }
    var tick = function () {
      api("job", {id: id}).then(function (j) {
        if (!j.ok) return;
        var elapsed = Math.max(0, Math.floor(((j.ended || Date.now() / 1000) - j.started)));
        var duration = Math.floor(elapsed / 60) + "m " + (elapsed % 60) + "s";
        var total = (j.planned_apps || []).length, complete = Object.keys(j.outcomes || {}).length;
        progressBar.hidden = !total; progressBar.max = total || 1; progressBar.value = complete;
        var phaseElapsed = Math.max(0, Math.floor((j.ended || Date.now()/1000) - (j.phase_started || j.started)));
        progressLabel.textContent = (j.phase || j.step || 'Starting') + ' ? ' + phaseElapsed + 's in phase ? ' + complete + '/' + total + ' apps processed ? total ' + duration + (j.operation ? '\n' + j.operation : '');
        log.textContent = j.log.join("\n") + (j.status === "running" ? "\n… " + (j.step || "") + " · elapsed " + duration : "\n[" + j.status + "] " + duration);
        log.scrollTop = log.scrollHeight;
        var active = j.status === 'running' || j.status === 'waiting' || j.status === 'stopping';
        stop.hidden = !active;
        stop.disabled = j.status === 'stopping' || !!j.stop_requested;
        if (j.status === 'waiting' && j.review) showReview(j.review, j.review_revision);
        else if (reviewPanel) { reviewPanel.remove(); reviewPanel = null; }
        Array.prototype.forEach.call(steps.querySelectorAll("button"), function (b) { b.disabled = active; });
        if (active) timers[name] = setTimeout(tick, 2000);
        else {
          var oldRetry = log.parentNode.querySelector('.dp-retry');
          if (oldRetry) oldRetry.remove();
          if (['failed','stopped','interrupted'].includes(j.status) &&
              (j.steps || []).every(function (s) { return !s.includes('data') && !s.startsWith('store'); })) {
            var retryBtn = btn('Resume unfinished work', function () {
              retryBtn.disabled = true;
              api('resume', {id: id, confirm: true}).then(function (rj) {
                if (!rj.ok) { retryBtn.disabled = false; toast('error', rj.error || rj._error); return; }
                retryBtn.remove(); stop.remove(); progressLabel.remove(); progressBar.remove();
                follow(name, rj.id, log, refresh, steps);
              }).catch(function (error) { retryBtn.disabled = false; toast('error', String(error)); });
            });
            retryBtn.className += ' dp-retry'; log.parentNode.insertBefore(retryBtn, log);
          }
          refresh(); loadLive();
        }
      });
    };
    tick();
  }


  // ======== left sidebar: every app, where it ships (plan) and where it runs (live) ========
  // Rules: deploy.rules / deploy.set_rule (deploy/targets.json). Live: deploy.status per target.
  //   name colour: green = every target, blue = VM only, amber = AppForge only, red = blocked, normal = local only
  //   markers: VM● running there, VM↑ to deploy, VM! there but not planned, VM✕ blocked, VM✓ planned (live unknown)
  var T = {apps: [], rules: null, live: {}, open: {}, q: '', host: null, sel: null};
  var SHORT = {vm: 'VM', appforge: 'AF'};
  function short(t) { return SHORT[t] || t.slice(0, 3).toUpperCase(); }
  function esc(x) { return String(x == null ? '' : x).replace(/[&<>"']/g, function (c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]; }); }
  function post(u, b) {
    return fetch(u, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(b || {})}).then(function (r) { return r.json(); });
  }
  function targets() { return T.rules ? Object.keys(T.rules.targets) : []; }
  function planned(a) { return !!(a && (a.committed || a.state === 'allow')); }
  function pathOf(a) { return a.path || a.app_id; }
  function toast(kind, msg) { if (window.AppUIToast && AppUIToast[kind]) AppUIToast[kind](msg); else console.log(msg); }

  function loadTree(live) {
    var jobs = [fetch('/v1/apps').then(function (r) { return r.json(); }).then(function (r) { T.apps = r.apps || []; }),
                post(API + 'rules').then(function (r) { T.rules = r && r.ok ? r : null; })];
    return Promise.all(jobs).then(function () {
      drawTree();
      if (live !== false) loadLive();
    });
  }
  function loadLive() {
    return Promise.all(targets().map(function (t) {
      return post(API + 'status', {target: t}).then(function (r) {
        T.live[t] = r && r.ok && Array.isArray(r.present) ? new Set(r.present) : null;
      }).catch(function () { T.live[t] = null; });
    })).then(drawTree);
  }

  function nameClass(appId) {
    if (!T.rules) return '';
    var to = [], blocked = false;
    targets().forEach(function (t) {
      var a = T.rules.targets[t].apps[appId];
      if (planned(a)) to.push(t); else if (a && a.state === 'block') blocked = true;
    });
    if (to.length && to.length === targets().length) return 'dep-all';
    if (to.length === 1) return to[0] === 'vm' ? 'dep-vm' : to[0] === 'appforge' ? 'dep-af' : 'dep-all';
    if (to.length > 1) return 'dep-all';
    return blocked ? 'dep-block' : '';
  }
  function appMarker(t, appId) {
    var R = T.rules.targets[t], a = R.apps[appId], L = T.live[t], on = L ? L.has(appId) : null;
    var want = planned(a), own = !!(a && a.source === 'app:' + appId);
    var style = a && a.committed ? ' lock' : (a && a.state && !own ? ' inh' : '');
    var why = a && a.committed ? 'committed (ships with the code)' : a && a.state ?
      a.state + (own ? ' (app rule)' : ' (from ' + String(a.source).replace(/^path:/, '') + ')') : 'no rule';
    var g, c, st;
    if (L) {
      if (want && on) { g = '●'; c = 'live'; st = 'running there'; }
      else if (want) { g = '↑'; c = 'todo'; st = 'to deploy'; }
      else if (on) { g = '!'; c = 'extra'; st = 'running there, not planned'; }
      else if (a && a.state === 'block') { g = '✕'; c = 'block'; st = 'blocked'; }
      else return '';
    } else if (want) { g = a.committed ? '' : '✓'; c = 'plan'; st = 'planned' + (L === null ? ' (target not reachable)' : ''); }
    else if (a && a.state === 'block') { g = '✕'; c = 'block'; st = 'blocked'; }
    else return '';
    return '<span class="dm ' + c + style + '" title="' + esc(t + ': ' + st + ' — ' + why) + '">' + short(t) + g + '</span>';
  }
  function appsUnder(path) {
    return T.apps.filter(function (a) { var p = pathOf(a); return p === path || p.indexOf(path + '/') === 0; });
  }
  function groupMarker(t, path) {
    var R = T.rules.targets[t], rule = R.rules['path:' + path] || null, L = T.live[t], want = 0, on = 0;
    appsUnder(path).forEach(function (a) { if (planned(R.apps[a.app_id])) { want++; if (L && L.has(a.app_id)) on++; } });
    var count = L && want ? ' ' + on + '/' + want : '';
    if (!rule && !count) return '';
    var c = rule === 'block' ? 'block' : count ? (on === want ? 'live' : 'todo') : 'plan';
    return '<span class="dm ' + c + '" title="' + esc(t + ': ' + (rule ? rule + ' (group rule)' : 'no group rule') +
      (count ? ' — ' + on + ' of ' + want + ' planned running there' : '')) + '">' + short(t) +
      (rule === 'allow' ? '✓' : rule === 'block' ? '✕' : '') + count + '</span>';
  }
  function groupClass(path) {
    var seen = null, mixed = false;
    appsUnder(path).forEach(function (a) { var c = nameClass(a.app_id); if (seen === null) seen = c; else if (seen !== c) mixed = true; });
    return mixed || !seen ? '' : seen;
  }

  function buildNode() {
    var root = {kids: {}, apps: []};
    T.apps.forEach(function (a) {
      if (T.q && (a.app_id + ' ' + (a.title || '')).toLowerCase().indexOf(T.q) < 0) return;
      var segs = pathOf(a).split('/'), n = root, acc = '';
      for (var i = 0; i < segs.length - 1; i++) {
        acc = acc ? acc + '/' + segs[i] : segs[i];
        n = n.kids[segs[i]] = n.kids[segs[i]] || {path: acc, kids: {}, apps: []};
      }
      n.apps.push({a: a, seg: segs[segs.length - 1]});
    });
    return root;
  }
  function count(n) { var c = n.apps.length; Object.keys(n.kids).forEach(function (k) { c += count(n.kids[k]); }); return c; }
  function drawTree() {
    if (!T.body) return;
    var html = [];
    (function walk(n, depth) {
      Object.keys(n.kids).sort().forEach(function (k) {
        var g = n.kids[k], open = T.q ? true : (g.path in T.open ? T.open[g.path] : depth === 0);
        html.push('<div class="dt-row grp' + (T.sel === 'g:' + g.path ? ' sel' : '') + '" data-key="g:' + esc(g.path) + '" style="padding-left:' + (6 + depth * 14) + 'px">' +
          '<span class="tw' + (open ? ' open' : '') + '">▸</span><span class="nm ' + groupClass(g.path) + '">' + esc(k) + '</span>' +
          (T.rules ? targets().map(function (t) { return groupMarker(t, g.path); }).join('') : '') + '<span class="cnt">' + count(g) + '</span></div>');
        if (open) walk(g, depth + 1);
      });
      n.apps.sort(function (x, y) { return x.seg.localeCompare(y.seg); }).forEach(function (it) {
        var a = it.a;
        html.push('<div class="dt-row app' + (T.sel === 'a:' + a.app_id ? ' sel' : '') + '" data-key="a:' + esc(a.app_id) + '" title="' + esc((a.title || '') + ' — ' + a.app_id) + '" style="padding-left:' + (20 + depth * 14) + 'px">' +
          '<span class="nm ' + nameClass(a.app_id) + '">' + esc(it.seg) + '</span>' +
          (T.rules ? targets().map(function (t) { return appMarker(t, a.app_id); }).join('') : '') + '</div>');
      });
    })(buildNode(), 0);
    T.body.innerHTML = html.join('') || '<div class="dt-empty">No apps' + (T.q ? ' match' : '') + '.</div>';
  }

  function mountTree(host) {
    var box = node('div', null, {'class': 'dt-side'});
    var q = node('input', null, {type: 'search', placeholder: 'Filter apps…'});
    q.oninput = function () { T.q = q.value.trim().toLowerCase(); drawTree(); };
    var legend = node('div', null, {'class': 'dt-legend'});
    legend.innerHTML = '<span class="dep-all">● all</span><span class="dep-vm">● VM</span><span class="dep-af">● AppForge</span>' +
      '<span class="dep-block">● blocked</span><span>● local only</span><br>' +
      '<span class="dm live">VM●</span>running <span class="dm todo">VM↑</span>to deploy <span class="dm extra">VM!</span>not planned <span class="dm block">VM✕</span>blocked';
    legend.title = 'Right-click a group or an app: allow / block per target, deploy now, remove';
    var bar = node('div', null, {'class': 'dt-bar'});
    bar.appendChild(btn('↻ Live state', function () { loadLive(); }));
    T.body = node('div', null, {'class': 'dt-body'});
    T.body.addEventListener('click', function (e) {
      var r = e.target.closest('.dt-row'); if (!r) return;
      var key = r.getAttribute('data-key');
      if (key.indexOf('g:') === 0) { var p = key.slice(2); T.open[p] = !(p in T.open ? T.open[p] : p.indexOf('/') < 0); }
      T.sel = key; drawTree();
    });
    T.body.addEventListener('contextmenu', onContext);
    [q, legend, bar, T.body].forEach(function (x) { box.appendChild(x); });
    host.appendChild(box);
    loadTree();
  }

  // ---- right-click: rules, deploy now, remove ----
  var ctxReady = null;
  function onContext(e) {
    var r = e.target.closest('.dt-row'); if (!r || !T.rules) return;
    e.preventDefault();
    var key = r.getAttribute('data-key'), isApp = key.indexOf('a:') === 0, val = key.slice(2);
    T.sel = key; drawTree();
    var items = [];
    targets().forEach(function (t, i) {
      var R = T.rules.targets[t], rkey = (isApp ? 'app:' : 'path:') + val, own = R.rules[rkey] || null, L = T.live[t];
      if (i) items.push({separator: true});
      var a = isApp ? R.apps[val] : null, lock = !!(a && a.committed);
      var tag = short(t) + (lock ? ' (committed: always ships)' : '');
      items.push({label: (own === 'allow' ? '● ' : '○ ') + tag + ' · Allow', action: function () { setRule(t, rkey, 'allow'); }});
      items.push({label: (own === 'block' ? '● ' : '○ ') + tag + ' · Block', action: function () { setRule(t, rkey, 'block'); }});
      items.push({label: (!own ? '● ' : '○ ') + tag + ' · Inherit', disabled: !own, action: function () { setRule(t, rkey, 'clear'); }});
      if (isApp) {
        var on = L ? L.has(val) : false;
        items.push({label: '🚀 ' + short(t) + ' · Deploy now' + (on ? ' (update)' : ''),
                    action: function () { deployNow(t, [val], val, planned(a) ? null : 'app:' + val); }});
        if (on) items.push({label: '🗑 ' + short(t) + ' · Remove from ' + short(t), disabled: lock,
                            action: function () { removeNow(t, val, planned(a) ? 'app:' + val : null); }});
        items.push({label: '⇡ ' + short(t) + ' · Push data here → ' + short(t), action: function () { syncData(t, [val], 'push', val); }});
        items.push({label: '⇣ ' + short(t) + ' · Pull data ' + short(t) + ' → here', action: function () { syncData(t, [val], 'pull', val); }});
        items.push({label: '⇡ ' + short(t) + ' store · Save data here → ' + short(t) + ' store', action: function () { storeMove(t, [val], 'push', val); }});
        items.push({label: '⇣ ' + short(t) + ' store · Restore data ' + short(t) + ' store → here', action: function () { storeMove(t, [val], 'pull', val); }});
      } else {
        var under = appsUnder(val).filter(function (x) { return planned(R.apps[x.app_id]); }).map(function (x) { return x.app_id; });
        var missing = L ? under.filter(function (x) { return !L.has(x); }) : under;
        items.push({label: '🚀 ' + short(t) + ' · Deploy ' + missing.length + ' missing planned app(s)', disabled: !missing.length,
                    action: function () { deployNow(t, missing, val + ' (' + missing.length + ' apps)'); }});
        items.push({label: '🚀 ' + short(t) + ' · Deploy all ' + under.length + ' planned app(s)', disabled: !under.length,
                    action: function () { deployNow(t, under, val + ' (' + under.length + ' apps)'); }});
        items.push({label: '⇡ ' + short(t) + ' · Push data of ' + under.length + ' planned app(s)', disabled: !under.length,
                    action: function () { syncData(t, under, 'push', val + ' (' + under.length + ' apps)'); }});
        items.push({label: '⇣ ' + short(t) + ' · Pull data of ' + under.length + ' planned app(s)', disabled: !under.length,
                    action: function () { syncData(t, under, 'pull', val + ' (' + under.length + ' apps)'); }});
        items.push({label: '⇡ ' + short(t) + ' store · Save data of ' + under.length + ' planned app(s)', disabled: !under.length,
                    action: function () { storeMove(t, under, 'push', val + ' (' + under.length + ' apps)'); }});
      }
    });
    if (!ctxReady) ctxReady = AppUIAssets.load('contextMenu');
    ctxReady.then(function () { AppUIContextMenu.show({x: e.clientX, y: e.clientY}, items); })
      .catch(function () { ctxReady = null; toast('error', 'Context menu unavailable'); });
  }
  function ask(text) {
    if (!(window.AppUIDialog && AppUIDialog.confirmAsync)) return Promise.resolve(window.confirm(text));
    var body = document.createElement('div');          // text, not HTML: names are not markup; keep line breaks
    body.style.whiteSpace = 'pre-wrap'; body.textContent = text;
    return AppUIDialog.confirmAsync(body);
  }
  function setRule(t, key, rule) {
    return post(API + 'set_rule', {target: t, key: key, rule: rule, confirm: true}).then(function (r) {
      if (!r || r.ok === false) { toast('error', 'Rule failed: ' + ((r && (r.error || r._error)) || '?')); return; }
      toast('success', short(t) + ': ' + (rule === 'clear' ? 'inherit' : rule) + ' ' + key.replace(/^(app|path):/, '') + ' — ' + r.apps.length + ' app(s) planned beyond the committed ones');
      return loadTree(false);
    });
  }
  function runApps(t, args, what, op) {
    post(API + (op || 'deploy_apps'), Object.assign({target: t, confirm: true}, args)).then(function (r) {
      if (!r || r.ok === false) { toast('error', what + ' failed: ' + ((r && (r.error || r._error)) || '?')); return; }
      toast('info', what + ' on ' + short(t) + '…');
      var log = node('pre', '', {'class': 'dp-log'});
      main.appendChild(log);
      follow(t, r.id, log, function () {
        loadLive();
        if (window.__deployRefreshCards) window.__deployRefreshCards();
      }, node('div'));

    });
  }
  // ---- credentials between this machine and a target: names on both sides, pick, copy either way ----
  // Each host seals what it receives with its own vault key; the page only ever sees names and counts.
  function credentialsDialog(t) {
    if (!(window.AppUIDialog && AppUIDialog.show)) { toast('error', 'Dialog unavailable'); return; }
    var body = node('div', null, {'class': 'cr-box'});
    body.appendChild(node('div', 'Reading the credentials here and on ' + t + '…', {'class': 'dp-note'}));
    var dlg = AppUIDialog.show({title: 'Credentials: this machine ⇄ ' + t, body: body, width: '640px', buttons: [{text: 'Close'}]});
    Promise.all([post('/v1/apps/platform/credential/list', {}), post(API + 'credentials_remote_list', {target: t})]).then(function (rs) {
      var here = rs[0] || {}, there = rs[1] || {};
      body.innerHTML = '';
      if (!here.ok) { body.appendChild(node('div', 'Here: ' + (here.error || here._error || '?'), {'class': 'dp-note'})); return; }
      var hn = {}, tn = {};
      (here.credentials || []).forEach(function (c) { hn[c.name] = c; });
      (there.credentials || []).forEach(function (c) { tn[c.name] = c; });
      if (!there.ok) body.appendChild(node('div', t + ': ' + (there.error || there._error || 'not reachable') +
        ' - copying needs the target running with platform/deploy.', {'class': 'dp-note'}));
      var names = Object.keys(Object.assign({}, hn, tn)).sort();
      var tbl = node('table', null, {'class': 'cr-tbl'});
      var head = node('tr');
      ['', 'Credential', 'Here', t].forEach(function (h) { head.appendChild(node('th', h)); });
      tbl.appendChild(head);
      var boxes = [];
      names.forEach(function (n) {
        var tr = node('tr'), cb = node('input', null, {type: 'checkbox'});
        cb.value = n; boxes.push(cb);
        var td = node('td'); td.appendChild(cb); tr.appendChild(td);
        tr.appendChild(node('td', n));
        [hn[n], tn[n]].forEach(function (c) {
          tr.appendChild(node('td', c ? (c.type || 'token') + (c.has_token ? '' : ' (empty)') : '—', {'class': c ? '' : 'cr-none'}));
        });
        tbl.appendChild(tr);
      });
      var all = node('label', null, {'class': 'cr-opt'}), allCb = node('input', null, {type: 'checkbox'});
      allCb.onchange = function () { boxes.forEach(function (b) { b.checked = allCb.checked; }); };
      all.appendChild(allCb); all.appendChild(document.createTextNode(' all'));
      var mst = node('label', null, {'class': 'cr-opt'}), mCb = node('input', null, {type: 'checkbox'});
      mst.appendChild(mCb); mst.appendChild(document.createTextNode(' + the shared master account'));
      var keep = node('label', null, {'class': 'cr-opt'}), kCb = node('input', null, {type: 'checkbox'});
      keep.appendChild(kCb); keep.appendChild(document.createTextNode(' keep entries the receiving side already has'));
      var res = node('div', '', {'class': 'dp-note'});
      var go = function (dir) {
        var pick = boxes.filter(function (b) { return b.checked; }).map(function (b) { return b.value; });
        if (!pick.length && !mCb.checked) { res.textContent = 'Pick credentials (or the master account) first.'; return; }
        var every = pick.length === boxes.length;
        ask((dir === 'push' ? 'Copy to ' + t : 'Copy from ' + t + ' to this machine') + ':\n\n' +
            (pick.length ? pick.join('\n') : '(no entries)') + (mCb.checked ? '\n+ the shared master account' : '') +
            '\n\nThe secrets travel over the deploy channel (deploy token, HTTPS) and are sealed with the receiving host\'s own vault key.' +
            (kCb.checked ? '' : ' Existing entries of the same name are replaced.'))
          .then(function (ok) {
            if (!ok) return;
            res.textContent = 'Copying…';
            post(API + 'copy_credentials', {target: t, direction: dir, names: every ? null : pick, master: mCb.checked,
                                            overwrite: !kCb.checked, confirm: true}).then(function (o) {
              if (!o || o.ok === false) { res.textContent = 'Failed: ' + ((o && (o.error || o._error)) || '?'); return; }
              res.textContent = (dir === 'push' ? '→ ' + t : '← ' + t) + ': ' + o.added.length + ' added, ' + o.replaced.length +
                ' replaced' + (o.kept.length ? ', ' + o.kept.length + ' kept' : '') + (o.missing.length ? ', missing: ' + o.missing.join(', ') : '') +
                (o.master ? ', master account set' : '');
              toast('success', 'Credentials ' + res.textContent);
            });
          });
      };
      var bar = node('div', null, {'class': 'dp-steps'});
      bar.appendChild(btn('Copy selected → ' + t, function () { go('push'); }, true));
      var pullB = btn('Copy selected ← ' + t, function () { go('pull'); });
      if (!there.ok) pullB.disabled = true;
      bar.appendChild(pullB);
      [all, tbl, mst, keep, bar, res].forEach(function (x) { body.appendChild(x); });
    });
    return dlg;
  }

  // ---- app data (data/apps/<id>): sizes first, then a confirmed push / pull job ----
  function mb(n) { return n >= 1e6 ? (n / 1e6).toFixed(1) + ' MB' : n >= 1e3 ? Math.round(n / 1e3) + ' KB' : (n || 0) + ' B'; }
  function sum(side, apps) {
    var f = 0, b = 0, has = 0, held = 0, newest = 0;
    apps.forEach(function (x) {
      var i = side && side[x]; if (!i || !i.exists) return;
      has++; f += i.files || 0; b += i.bytes || 0; held += i.secret_files_kept || 0; newest = Math.max(newest, i.mtime || 0);
    });
    return {has: has, text: has ? mb(b) + ' in ' + f + ' file(s)' + (newest ? ', changed ' + new Date(newest * 1000).toLocaleString() : '') : 'none',
            held: held};
  }
  function syncData(t, apps, dir, label) {
    toast('info', 'Checking data sizes on ' + short(t) + '…');
    post(API + 'data_info', {target: t, apps: apps}).then(function (r) {
      if (!r || r.ok === false) { toast('error', 'Data check failed: ' + ((r && (r.error || r._error)) || '?')); return; }
      if (r.error) { toast('error', short(t) + ': ' + r.error); return; }
      var here = sum(r.here, apps), there = sum(r.there, apps), from = dir === 'push' ? here : there;
      if (!from.has) { toast('info', 'No data ' + (dir === 'push' ? 'here' : 'on ' + short(t)) + ' for ' + label); return; }
      var held = from.held ? ' ' + from.held + ' token / credential / key file(s) are not sent; the receiving side keeps its own.' : '';
      ask((dir === 'push' ? 'Push data of ' + label + ' to ' + t : 'Pull data of ' + label + ' from ' + t + ' to here') + '?\n\n' +
          'Here: ' + here.text + '\n' + t + ': ' + there.text + '\n\n' +
          'The ' + (dir === 'push' ? t : 'local') + ' copy is replaced (its previous version is kept once in data/.prev-sync); ' +
          'the app is unloaded during the swap.' + held)
        .then(function (ok) {
          if (ok) runApps(t, {apps: apps, direction: dir}, (dir === 'push' ? 'Push data of ' : 'Pull data of ') + label, 'sync_data');
        });
    });
  }
  // ---- a target's data store (<vfs home>/<target>): the target restores from it and backs up to it ----
  function storeMove(t, apps, dir, label) {
    toast('info', 'Reading the ' + short(t) + ' data store…');
    post(API + 'store_status', {target: t, apps: apps}).then(function (r) {
      if (!r || r.ok === false) { toast('error', 'Data store: ' + ((r && (r.error || r._error)) || '?')); return; }
      var lines = apps.map(function (x) {
        var row = r.apps[x] || {}, s = row.store, h = row.here || {};
        return x + ': here ' + (h.files ? mb(h.bytes) : 'none') + ', store ' +
          (s ? mb(s.bytes) + ' saved by ' + s.by + ' ' + new Date(s.saved * 1000).toLocaleString() : 'none') +
          (row.state ? ' (' + row.state + ')' : '');
      });
      var text = (dir === 'push' ? 'Save this machine\'s data of ' + label + ' into the ' + t + ' data store?'
                                 : 'Restore ' + label + ' from the ' + t + ' data store into this machine?') +
        '\n\n' + r.store + '\n' + lines.join('\n') + '\n\n' +
        (dir === 'push' ? t + ' restores it at its next sync (at start and every 15 minutes). Token / credential / key files are not saved.'
                        : 'The local copy is replaced (its previous version kept once in data/.prev-sync); the app is unloaded during the swap.');
      ask(text).then(function (ok) {
        if (!ok) return;
        toast('info', (dir === 'push' ? 'Saving ' : 'Restoring ') + label + '…');
        post(API + (dir === 'push' ? 'store_push' : 'store_pull'), {target: t, apps: apps, confirm: true}).then(function (o) {
          if(o && o.ok && o.job_id){toast('info',label+': queued in Work Runner ('+o.job_id+')');return;}
          var bad = Object.keys((o && o.failed) || {});
          if (!o || o.ok === false || bad.length) toast('error', label + ': ' + ((o && (o.error || o._error)) || 'failed: ' + bad.join(', ')));
          else toast('success', label + ': ' + o.done.length + ' app(s) ' + (dir === 'push' ? 'saved to' : 'restored from') + ' the ' + short(t) + ' store' +
                     (o.skipped.length ? ', ' + o.skipped.length + ' without data' : ''));
        });
      });
    });
  }
  function deployNow(t, apps, label, allowKey) {
    ask('Deploy ' + label + ' to ' + t + ' now?' + (allowKey ? ' It is not planned for ' + t + ', so it is also allowed there.' : ''))
      .then(function (ok) {
        if (!ok) return;
        (allowKey ? setRule(t, allowKey, 'allow') : Promise.resolve()).then(function () { runApps(t, {apps: apps}, 'Deploy ' + label); });
      });
  }
  function removeNow(t, appId, blockKey) {
    ask('Remove ' + appId + ' from ' + t + ' now?' + (blockKey ? ' It is planned there, so it is also blocked for ' + t + '.' : ''))
      .then(function (ok) {
        if (!ok) return;
        (blockKey ? setRule(t, blockKey, 'block') : Promise.resolve()).then(function () { runApps(t, {apps: [appId], remove: true}, 'Remove ' + appId); });
      });
  }

  // Private Pages preparation uses the shared Work Runner, never a remote write.
  function pagesCard() {
    var card=node("section",null,{"class":"dp-card"});
    card.appendChild(node("h3","GitHub Pages · Music Player pilot"));
    card.appendChild(node("div","pylon-server.github.io · Private build preparation only",{"class":"dp-note"}));
    var out=node("pre","Checking reviewed frontend source…",{"class":"dp-log","aria-live":"polite"});
    var commit=null;
    var prepare=btn("Prepare Pages build",function(){
      if(!commit)return;
      ask("Build and screen the reviewed frontend commit "+commit+"? No public upload.").then(function(ok){
        if(!ok)return;
        prepare.disabled=true;out.textContent="Submitting to Work Runner…";
        api("pages_prepare",{action:"prepare",source_commit:commit,confirm:true}).then(function(r){
          out.textContent=JSON.stringify(r,null,2);
          if(r.ok&&r.job_id)poll(r.job_id,0);else prepare.disabled=false;
        }).catch(function(){out.textContent="Preparation request failed";prepare.disabled=false;});
      });
    },true);
    function poll(id,n){
      if(!card.isConnected)return;
      if(n>=90){out.textContent+="\nOpen Work Runner for final status.";prepare.disabled=false;return;}
      post("/v1/apps/platform/work_runner/get",{job_id:id}).then(function(r){
        var j=r.job;
        if(!r.ok||!j){out.textContent="Job status unavailable";prepare.disabled=false;return;}
        out.textContent=JSON.stringify({job_id:id,status:j.status,progress:j.progress,result:j.op_result},null,2);
        if(["pending","running","claimed"].includes(j.status))setTimeout(function(){poll(id,n+1);},2000);
        else prepare.disabled=false;
      }).catch(function(){out.textContent="Job status unavailable";prepare.disabled=false;});
    }
    prepare.disabled=true;
    card.appendChild(out);card.appendChild(prepare);
    card.appendChild(node("a","Open Work Runner",{"href":"/apps/platform/work_runner/"}));
    api("pages_prepare",{action:"status"}).then(function(r){
      out.textContent=JSON.stringify(r,null,2);
      if(r.ok&&r.source_commit){commit=r.source_commit;prepare.disabled=false;}
    }).catch(function(){out.textContent="Pages preparation unavailable";});
    return card;
  }

  function render(host) {
    css();
    main = node("div", null, {"class": "dp-main"});
    host.appendChild(main);
    main.appendChild(node("p", "Brings pylon-server up on an endpoint: the aiweb foundation first, then the framework, " +
      "dependencies and apps over HTTP. Which apps go where: right-click a group or app in the tree on the left.", {"class": "dp-note"}));
    var repoBox=node("section",null,{"class":"dp-card"});main.appendChild(repoBox);
    repoBox.appendChild(node("h3","Repository source management"));
    repoBox.appendChild(node("a","Open Code Sync · GitHub and Google Drive",{href:"/apps/platform/code_sync/"}));
    repoBox.appendChild(node("p","pylon-server/repo/source · individual files via VFS; no runtime DB, credentials, or Git metadata."));
    var repoReport=node("pre","");repoBox.appendChild(repoReport);
    function repoAction(action,extra){return api("repo_sync",Object.assign({action:action},extra||{})).then(function(r){repoReport.textContent=JSON.stringify(r,null,2);if(action==="status"&&r.manifest&&manifestInput&&!manifestInput.value)manifestInput.value=r.manifest;});}
    [["Status","status"],["Preview","preview"],["Sync next batch","sync"],["Enable automatic sync","configure"],["Disable automatic sync","configure"]].forEach(function(item,i){
      var b=node("button",item[0]);b.onclick=function(){if(i<2)return repoAction(item[1]);return ask("Confirm repository sync action: "+item[0]+"?").then(function(ok){if(ok)return repoAction(item[1],{confirm:true,enabled:i===3,limit:250});});};repoBox.appendChild(b);
    });
    repoBox.appendChild(node("a","Open Work Runner jobs",{href:"/apps/platform/work_runner/"}));
    var manifestInput=node("input",null,{placeholder:"Verified inventory SHA-256","aria-label":"Repository recovery manifest"});
    repoBox.appendChild(manifestInput);
    var previewRestore=node("button","Preview recovery");previewRestore.onclick=function(){repoAction("recover",{manifest:manifestInput.value});};repoBox.appendChild(previewRestore);
    var restore=node("button","Stage recovery");restore.onclick=function(){return ask("Stage the selected inventory into a separate local recovery folder? Active source is unchanged.").then(function(ok){if(ok)return repoAction("recover",{manifest:manifestInput.value,confirm:true});});};repoBox.appendChild(restore);
    repoAction("status");
    main.appendChild(pagesCard());
    var cards = node("div", null, {"class": "dp-cards"}); main.appendChild(cards);
    api("targets").then(function (r) {
      if (!r.ok) { cards.appendChild(node("p", r.error || r._error, {"class": "bad"})); return; }
      Object.keys(r.targets).forEach(function (n) { cards.appendChild(card(n, r.targets[n])); });
    });
  }
  window.AppUIReady.then(function () {
    AppUI.createApp({id: "platform-deploy", title: "Deploy",
      leftSidebar: {width: 320, tabs: [{id: "apps", label: "Apps", active: true, render: mountTree}]},
      content: {render: render}});
  });
})();
