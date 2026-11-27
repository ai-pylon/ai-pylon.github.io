// Issue Report - AppUI page. Served at /apps/platform/issue_report/.
// Tracker for feedback, rendering gaps and ERRORS FROM THE LOG: numbered issues (ISS-n), occurrences, an automatic
// triage class + reason, a comment thread, and "track recent log errors" (plan first, then apply).
(function () {
  "use strict";
  var API = "/v1/apps/platform/issue_report/";
  function api(op, args) {
    return fetch(API + op, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(args || {})})
      .then(function (r) { return r.json(); }).catch(function (e) { return {ok: false, _error: String(e)}; });
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]; });
  }
  function err(r) { return (r && (r._error || r.error)) || "failed"; }
  function when(ts) {
    if (!ts) return "";
    var d = new Date(Number(ts) * 1000);
    return isNaN(d) ? "" : d.toLocaleString([], {month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"});
  }
  function on(ctx, el, ev, fn) { if (ctx && ctx.listen) ctx.listen(el, ev, fn); else el.addEventListener(ev, fn); }

  var S = {app: null, root: null, table: null, rows: [], total: 0, more: null, seq: 0, sel: null,
           f: {status: "open", severity: "", kind: "", label: "", text: "", sort: "updated"}};
  var STATUSES = ["open", "in_review", "in_progress", "resolved", "wont_fix", "duplicate"];
  function q(sel) { return S.root && S.root.querySelector(sel); }
  function status(t) { try { S.app.setStatus(t); } catch (e) { /* shell not ready */ } }

  // ------------------------------------------------------------------ stats
  function loadStats() {
    return api("stats", {}).then(function (st) {
      var el = q("#ir-stats");
      if (!st.ok) { el.textContent = err(st); return; }
      var sev = st.open_by_severity || {}, lab = st.open_by_label || {};
      el.innerHTML = '<span><b>' + st.open + '</b> open</span><span>of <b>' + st.total + '</b></span>' +
        ["critical", "high", "medium", "low"].filter(function (k) { return sev[k]; }).map(function (k) {
          return '<span class="ir-sev ir-' + k + '">' + k + ' ' + sev[k] + '</span>'; }).join("") +
        Object.keys(lab).slice(0, 6).map(function (k) { return '<span class="tag">' + esc(k) + ' ' + lab[k] + '</span>'; }).join("") +
        ((st.top_recurring || []).length ? '<span class="hint">most recurring: ' + st.top_recurring.slice(0, 3).map(function (x) {
          return esc(x.ref) + " (" + x.occurrences + "x)"; }).join(", ") + '</span>' : "");
    });
  }

  // ------------------------------------------------------------------ list
  function makeTable() {
    S.table = AppUIDataTable.create({
      container: q("#ir-table"), items: [], getId: function (i) { return i.id; }, maxRows: 100000, empty: "No issues.",
      stickyHeader: true, sort: {column: "ref", direction: "desc"},
      onRowClick: function (i) { select(i.id); },
      columns: [
        {id: "ref", label: "Ref", width: "76px", sortable: true, getValue: function (i) { return i.number || 0; }, render: function (i) { return i.ref; }},
        {id: "status", label: "Status", width: "104px", sortable: true, getValue: function (i) { return i.status; },
         render: function (i) { var s = document.createElement("span"); s.className = "ir-st ir-st-" + i.status; s.textContent = i.status; return s; }},
        {id: "severity", label: "Sev", width: "78px", sortable: true,
         getValue: function (i) { return {critical: 4, high: 3, medium: 2, low: 1}[i.severity] || 0; },
         render: function (i) { var s = document.createElement("span"); s.className = "ir-sev ir-" + i.severity; s.textContent = i.severity; return s; }},
        {id: "title", label: "Title", sortable: true, getValue: function (i) { return (i.title || "").toLowerCase(); }, render: function (i) { return i.title; }},
        {id: "occurrences", label: "Seen", width: "64px", sortable: true, getValue: function (i) { return i.occurrences || 0; },
         render: function (i) { return (i.occurrences || 1) + "x"; }},
        {id: "last_seen", label: "Last", width: "104px", sortable: true, getValue: function (i) { return i.last_seen || 0; },
         render: function (i) { return when(i.last_seen); }},
        {id: "labels", label: "Labels", width: "150px", render: function (i) { return (i.labels || []).join(", "); }}
      ]});
  }
  function load(append) {
    var my = ++S.seq, off = append && S.more ? S.more.offset : 0;
    var args = {limit: 100, offset: off, sort: S.f.sort};
    ["status", "severity", "kind", "label", "text"].forEach(function (k) { if (S.f[k] && S.f[k] !== "all") args[k] = S.f[k]; });
    if (!append) status("loading…");
    return api("list", args).then(function (r) {
      if (my !== S.seq) return;                       // a newer filter change superseded this reply
      if (!r.ok) { status(err(r)); S.table.setItems([]); return; }
      S.rows = append ? S.rows.concat(r.issues || []) : (r.issues || []);
      S.total = r.total;
      S.more = r.has_more ? {offset: r.next_offset} : null;
      S.table.setItems(S.rows.slice());
      q("#ir-more").innerHTML = S.more ? '<button id="ir-more-b">Load more (' + (S.total - S.rows.length) + " remaining)</button>" : "";
      var mb = q("#ir-more-b"); if (mb) mb.onclick = function () { load(true); };
      status(S.rows.length + " of " + S.total + " issue(s)");
    });
  }
  function reload() { S.lastReload = Date.now(); return Promise.all([loadStats(), load(false)]); }

  // The tracker publishes every change on its event stream; an IDLE page does one tiny `events` call per poll and reloads only
  // when something changed (so several open tabs stay in sync, and a page nobody touches does no list/stats work at all).
  var evCursor = 0, evBusy = false, evPrimed = false, evTimer = null;
  function arm(ms) { clearTimeout(evTimer); evTimer = setTimeout(pollEvents, ms); }   // ONE chain, even with the watchdog
  // long-poll: the server holds the call (wait<=25 s) until the tracker changes, then the page asks again at once - an
  // idle page makes ~1 request per 25 s; a hidden tab stops and resumes on visibilitychange
  // Preferred: the host EventBus (one shared SSE connection for every channel and tab) carries the tracker's changes
  // as channel "app:platform/issue_report"; while it is connected the long-poll is parked, so this page holds no extra
  // request open. Any other state (no EventBus, reconnecting) falls back to the long-poll.
  var busLive = false, busChanged = null;
  function startBus() {
    if (!window.AppUIEventBus) return;
    try {
      var bus = new window.AppUIEventBus(["app:platform/issue_report"]);
      bus.onAny(function (channel) {
        if (channel !== "app:platform/issue_report") return;
        clearTimeout(busChanged);
        busChanged = setTimeout(function () {                    // a burst of changes = one reload
          if (Date.now() - (S.lastReload || 0) > 1500) reload().then(function () { if (S.sel) select(S.sel); });
        }, 250);
      });
      bus.onStatus(function (state) {
        var live = state === "connected";
        if (live === busLive) return;
        busLive = live;
        if (live) clearTimeout(evTimer);
        else arm(300);
      });
      window.addEventListener("pagehide", function () { try { bus.close(); } catch (_e) { /* closing */ } });
    } catch (_e) { busLive = false; }
  }
  function pollEvents() {
    if (document.hidden || evBusy || busLive) return;
    clearTimeout(evTimer);
    evBusy = true;
    api("events", evPrimed ? {cursor: evCursor, wait: 25} : {cursor: evCursor}).then(function (r) {
      evBusy = false;
      if (!r || !r.ok) { arm(6000); return; }
      var first = !evPrimed;
      evPrimed = true;
      evCursor = typeof r.cursor === "number" ? r.cursor : evCursor;
      if (r.changed && !first && Date.now() - (S.lastReload || 0) > 1500) {        // our own action already reloaded
        reload().then(function () { if (S.sel) select(S.sel); });
      }
      arm(300);
    }, function () { evBusy = false; arm(6000); });
  }

  // ------------------------------------------------------------------ detail
  function select(id) {
    S.sel = id;
    var box = q("#ir-detail");
    box.style.display = "block";
    box.innerHTML = '<span class="hint">loading…</span>';
    api("get", {id: id}).then(function (r) {
      if (S.sel !== id) return;
      if (!r.ok) { box.innerHTML = '<span class="bad">' + esc(err(r)) + "</span>"; return; }
      S.sel = r.issue.id;                  // a deep link may name the issue by ISS-n / number: from here on use its uuid
      drawDetail(r.issue, r.comments || []);
    });
  }
  function drawDetail(i, cm) {
    var box = q("#ir-detail");
    var logLink = i.fingerprint ? '<a href="/apps/platform/log/?report=' + encodeURIComponent(i.ref) + '" target="_blank">open in the log</a>' :
      (i.source ? '<a href="/apps/platform/log/?source=' + encodeURIComponent(i.source) + '&level=error,critical" target="_blank">open in the log</a>' : "");
    box.innerHTML =
      '<button class="x" id="ir-x" title="close">✕</button>' +
      '<h3>' + esc(i.ref) + ' <small>' + esc(i.kind) + ' · ' + esc(i.reporter) + ' · filed ' + esc(when(i.created)) + '</small></h3>' +
      '<div class="ir-title-big">' + esc(i.title) + '</div>' +
      '<div class="ir-meta"><span class="ir-st ir-st-' + esc(i.status) + '">' + esc(i.status) + '</span> <span class="ir-sev ir-' + esc(i.severity) + '">' + esc(i.severity) +
        '</span> seen <b>' + (i.occurrences || 1) + 'x</b> (first ' + esc(when(i.first_seen)) + ', last ' + esc(when(i.last_seen)) + ')' +
        (i.assignee ? ' · assignee <b>' + esc(i.assignee) + '</b>' : "") + (i.labels && i.labels.length ? ' · ' + i.labels.map(function (l) { return '<span class="tag">' + esc(l) + '</span>'; }).join(" ") : "") +
        (i.fingerprint ? ' · log <code>' + esc(i.fingerprint) + '</code> ' + logLink : "") + '</div>' +
      (reopens(cm) ? '<div class="ir-fix"><b>re-opened ' + reopens(cm) + 'x</b> after being closed (regressions / manual)</div>' : "") +
      (i.fingerprint ? '<div class="ir-samples"><div class="hint">occurrences, last 24h <span id="ir-spark"></span></div>' +
        '<details id="ir-logs"><summary class="hint">latest log entries of this error</summary><div id="ir-logbox" class="hint">loading...</div></details></div>' : "") +
      (i.fix ? '<div class="ir-fix"><b>fix:</b> ' + esc(i.fix) + '</div>' : "") +
      (i.resolution ? '<div class="ir-fix"><b>resolution:</b> ' + esc(i.resolution) + '</div>' : "") +
      '<pre class="ir-pre">' + esc(i.detail || "(no detail)") + '</pre>' +
      '<div class="ir-thread">' + (cm.length ? cm.map(function (c) {
        return '<div class="ir-c ir-c-' + esc(c.kind) + '"><span class="when">' + esc(when(c.created)) + '</span> <b>' + esc(c.author || "") + '</b> ' + esc(c.text) + '</div>'; }).join("") : '<span class="hint">no comments</span>') + '</div>' +
      '<div class="row"><input id="ir-c-text" placeholder="add a comment" style="flex:1"><button id="ir-c-add">Comment</button></div>' +
      '<div class="row"><select id="ir-st">' + STATUSES.map(function (s) { return '<option' + (s === i.status ? " selected" : "") + ">" + s + "</option>"; }).join("") + '</select>' +
        '<select id="ir-sv">' + ["low", "medium", "high", "critical"].map(function (s) { return '<option' + (s === i.severity ? " selected" : "") + ">" + s + "</option>"; }).join("") + '</select>' +
        '<input id="ir-as" placeholder="assignee" value="' + esc(i.assignee || "") + '" style="width:120px"><button id="ir-upd">Update</button></div>' +
      '<div class="row"><input id="ir-res" placeholder="resolution / why" style="flex:1"><input id="ir-fixi" placeholder="fix: what changed" style="flex:1">' +
        '<button id="ir-resolve">Resolve</button><button id="ir-wont" title="not a defect / will not fix">Won\'t fix</button><button id="ir-reopen">Re-open</button></div>' +
      '<div class="row"><button id="ir-prompt">Copy fix prompt</button><span id="ir-dmsg" class="hint"></span></div>';
    if (i.fingerprint) loadSamples(i);
    function done(p) { return p.then(function (r) { if (!r.ok) { q("#ir-dmsg").textContent = err(r); return r; } return reload().then(function () { select(i.id); return r; }); }); }
    q("#ir-x").onclick = function () { S.sel = null; box.style.display = "none"; };
    q("#ir-c-add").onclick = function () { var t = q("#ir-c-text").value.trim(); if (t) done(api("comment", {id: i.id, text: t})); };
    q("#ir-upd").onclick = function () { done(api("update", {id: i.id, status: q("#ir-st").value, severity: q("#ir-sv").value, assignee: q("#ir-as").value})); };
    q("#ir-resolve").onclick = function () { done(api("resolve", {id: i.id, status: "resolved", resolution: q("#ir-res").value, fix: q("#ir-fixi").value})); };
    q("#ir-wont").onclick = function () { done(api("resolve", {id: i.id, status: "wont_fix", resolution: q("#ir-res").value || "not a defect"})); };
    q("#ir-reopen").onclick = function () { done(api("reopen", {id: i.id, reason: q("#ir-res").value})); };
    q("#ir-prompt").onclick = function () {
      api("prompt", {id: i.id}).then(function (r) {
        if (!r.ok) { q("#ir-dmsg").textContent = err(r); return; }
        (navigator.clipboard ? navigator.clipboard.writeText(r.prompt) : Promise.reject()).then(function () { q("#ir-dmsg").textContent = "prompt copied"; },
          function () { q("#ir-dmsg").textContent = "copy failed - see console"; console.log(r.prompt); });
      });
    };
  }

  // how many times the issue went closed -> open (the thread records every status change)
  function reopens(cm) {
    return (cm || []).filter(function (c) {
      return c.kind === "status" && /^status (resolved|wont_fix|duplicate) -> (open|in_review|in_progress)/.test(c.text || "");
    }).length;
  }
  // an inline SVG sparkline: log entries of the fingerprint bucketed per hour over the last 24 h
  function spark(entries) {
    var now = Date.now() / 1000, n = 24, b = new Array(n).fill(0);
    entries.forEach(function (e) { var k = Math.floor((now - e.ts) / 3600); if (k >= 0 && k < n) b[n - 1 - k]++; });
    var max = Math.max.apply(null, b.concat([1])), w = 5, h = 22;
    var bars = b.map(function (v, k) {
      var bh = v ? Math.max(2, Math.round(v / max * h)) : 1;
      return '<rect x="' + (k * (w + 1)) + '" y="' + (h - bh) + '" width="' + w + '" height="' + bh + '" fill="' + (v ? "#ed4245" : "#555") + '"><title>' + v + ' in hour -' + (n - 1 - k) + "</title></rect>";
    }).join("");
    return '<svg width="' + (n * (w + 1)) + '" height="' + h + '" role="img" aria-label="occurrences per hour, last 24 hours">' + bars + "</svg>";
  }
  function loadSamples(i) {
    fetch("/v1/apps/platform/log/query", {method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({fingerprint: i.fingerprint, aggregate: true, level: "warn,error,critical", limit: 300, since: Date.now() / 1000 - 86400})})
      .then(function (r) { return r.json(); }).then(function (r) {
        if (S.sel !== i.id) return;
        var items = r.items || [], sp = q("#ir-spark"), lb = q("#ir-logbox");
        if (sp) sp.innerHTML = r.ok === false ? "" : spark(items) + ' <span class="hint">' + items.length + (r.has_more ? "+" : "") + " in 24h</span>";
        if (lb) lb.innerHTML = items.length ? items.slice(0, 5).map(function (e) {
          return '<div class="ir-c"><span class="when">' + esc(when(e.ts)) + "</span> " + esc(e.level) + " " + esc(e.source) + " - " + esc(String(e.message || "").slice(0, 220)) +
            (e.trace_id ? ' <a href="/apps/platform/log/?trace_id=' + encodeURIComponent(e.trace_id) + '" target="_blank">trace</a>' : "") + "</div>"; }).join("")
          : "no entries in the last 24h";
      }).catch(function () {});
  }

  // keyboard: j / ArrowDown, k / ArrowUp move through the list, Esc closes the detail, / focuses the search
  function onKey(ev) {
    var t = ev.target, tag = t && t.tagName;
    if (ev.key === "Escape") { var x = q("#ir-x"); if (x) x.click(); return; }
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (ev.key === "/") { ev.preventDefault(); q("#ir-text").focus(); return; }
    var dir = (ev.key === "j" || ev.key === "ArrowDown") ? 1 : (ev.key === "k" || ev.key === "ArrowUp") ? -1 : 0;
    if (!dir || !S.rows.length) return;
    ev.preventDefault();
    var order = (S.table && S.table.getDisplayItems ? S.table.getDisplayItems() : S.rows) || S.rows;
    var at = order.findIndex(function (r) { return r.id === S.sel; });
    var next = order[Math.max(0, Math.min(order.length - 1, at < 0 ? 0 : at + dir))];
    if (next) select(next.id);
  }

  // ------------------------------------------------------------------ export + saved filters
  function exportIssues(fmt) {
    var args = {format: fmt, limit: 500, sort: "number"};
    ["status", "severity", "kind", "label", "text"].forEach(function (k) { if (S.f[k] && S.f[k] !== "all") args[k] = S.f[k]; });
    api("export", args).then(function (r) {
      if (!r.ok) { status(err(r)); return; }
      (navigator.clipboard ? navigator.clipboard.writeText(r.text) : Promise.reject()).then(function () { status(r.count + " issue(s) copied as " + fmt); },
        function () { console.log(r.text); status("copy failed - see console"); });
    });
  }
  var SAVED = {};
  function loadSaved() {
    return api("filters", {action: "list"}).then(function (r) {
      SAVED = (r && r.filters) || {};
      var sel = q("#ir-saved"); if (!sel) return;
      sel.innerHTML = '<option value="">saved filters</option>' + Object.keys(SAVED).map(function (n) { return "<option>" + esc(n) + "</option>"; }).join("");
    });
  }
  function applyFilter(f) {
    S.f = Object.assign({status: "open", severity: "", kind: "", label: "", text: "", sort: "updated"}, f || {});
    q("#ir-text").value = S.f.text; q("#ir-fstatus").value = S.f.status || "open"; q("#ir-fsev").value = S.f.severity || "";
    q("#ir-fkind").value = S.f.kind || ""; q("#ir-fsort").value = S.f.sort || "updated";
    return load(false);
  }

  // ------------------------------------------------------------------ new issue + track from log
  function fileIssue() {
    var title = q("#ir-f-title").value.trim(), m = q("#ir-msg");
    if (!title) { m.textContent = "Enter a title."; return; }
    api("create", {kind: q("#ir-kind").value, title: title, detail: q("#ir-f-detail").value, severity: q("#ir-sev").value}).then(function (r) {
      m.textContent = r.ok ? "Filed " + r.issue.ref : "Failed: " + err(r);
      if (r.ok) { q("#ir-f-title").value = ""; q("#ir-f-detail").value = ""; reload().then(function () { select(r.issue.id); }); }
    });
  }
  function trackLog() {
    var since = q("#ir-since").value || "24h", box = q("#ir-track");
    box.style.display = "block";
    box.innerHTML = '<span class="hint">scanning the log…</span>';
    api("track_log", {since: since, limit: 200}).then(function (r) {
      if (!r.ok) { box.innerHTML = '<span class="bad">' + esc(err(r)) + "</span>"; return; }
      var s = r.summary || {};
      if (!(r.plan || []).length) { box.innerHTML = '<span class="hint">Nothing new in the last ' + esc(since) + ' (scanned ' + (s.groups_scanned || 0) + " groups).</span>"; return; }
      box.innerHTML = '<b>Plan</b> (nothing written yet): create ' + s.create + ', re-open ' + s.reopen + ' (regressions), refresh ' + s.refresh +
        '<table class="ir-plan">' + r.plan.slice(0, 60).map(function (p) {
          var c = p["class"] || {};
          return "<tr><td>" + esc(p.action) + "</td><td>" + (p.count || "") + "x</td><td>" + esc(c.rule || "") + "</td><td>" + esc(c.status || "") + "</td><td>" + esc((p.title || ("ISS-" + p.report)).slice(0, 100)) + "</td></tr>";
        }).join("") + "</table>" + (r.plan.length > 60 ? '<div class="hint">…' + (r.plan.length - 60) + " more</div>" : "") +
        '<div class="row"><button id="ir-apply">Apply</button><button id="ir-cancel">Cancel</button></div>';
      q("#ir-cancel").onclick = function () { box.style.display = "none"; };
      q("#ir-apply").onclick = function () {
        box.innerHTML = '<span class="hint">applying…</span>';
        api("track_log", {since: since, limit: 200, confirm: true}).then(function (a) {
          box.innerHTML = a.ok ? "Applied " + (a.summary && a.summary.applied) + " change(s)." : '<span class="bad">' + esc(err(a)) + "</span>";
          reload();
        });
      };
    });
  }

  // ------------------------------------------------------------------ shell
  function render(el) {
    S.root = el;
    el.innerHTML =
      '<style>.ir{padding:10px;font-size:13px}.ir .row{display:flex;gap:8px;align-items:center;margin:6px 0;flex-wrap:wrap}' +
      '.ir .card{border:1px solid var(--border,#3f4147);border-radius:6px;padding:8px 10px;margin:6px 0}.ir .hint{color:var(--text-muted,#9aa0a6);font-size:12px}' +
      '.ir .bad{color:#ed4245}.ir #ir-stats{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.ir .tag{border:1px solid var(--border,#3f4147);border-radius:10px;padding:0 7px;font-size:11px}' +
      '.ir-sev,.ir-st{border-radius:3px;padding:0 6px;font-size:11px}.ir-critical{background:#8b1a22;color:#fff}.ir-high{background:#b4531a;color:#fff}.ir-medium{background:#6b5b1a;color:#fff}.ir-low{background:#2f4a3a;color:#cfe}' +
      '.ir-st-open,.ir-st-in_review,.ir-st-in_progress{background:#1f4e79;color:#fff}.ir-st-resolved{background:#2f6b3a;color:#fff}.ir-st-wont_fix,.ir-st-duplicate{background:#555;color:#ddd}' +
      '.ir #ir-table{height:40vh;min-height:220px}.ir #ir-detail,.ir #ir-track{display:none;position:relative}.ir #ir-detail .x{position:absolute;right:6px;top:4px}' +
      '.ir .ir-title-big{font-weight:600;margin:4px 0}.ir .ir-pre{white-space:pre-wrap;max-height:200px;overflow:auto;background:rgba(0,0,0,.18);padding:6px;border-radius:4px;font-size:12px}' +
      '.ir .ir-thread{max-height:180px;overflow:auto;margin:6px 0}.ir .ir-c{padding:2px 0;border-bottom:1px solid rgba(255,255,255,.06)}.ir .ir-c .when{color:var(--text-muted,#9aa0a6);margin-right:6px}' +
      '.ir .ir-c-status,.ir .ir-c-log{color:var(--text-muted,#9aa0a6)}.ir .ir-fix{margin:3px 0}.ir .ir-samples{margin:4px 0}.ir-plan{width:100%;font-size:12px;margin-top:6px}.ir-plan td{padding:2px 8px 2px 0}</style>' +
      '<div class="ir">' +
        '<div class="card" id="ir-stats">…</div>' +
        '<div class="row"><input id="ir-text" placeholder="search (title, detail, source, ISS-12, fingerprint)" style="flex:1;min-width:220px">' +
          '<select id="ir-fstatus"><option value="open">open</option><option value="closed">closed</option><option value="all">all</option>' + STATUSES.map(function (s) { return "<option>" + s + "</option>"; }).join("") + '</select>' +
          '<select id="ir-fsev"><option value="">any severity</option><option>critical</option><option>high</option><option>medium</option><option>low</option></select>' +
          '<select id="ir-fkind"><option value="">any kind</option><option>bug</option><option>feature</option><option>rendering_gap</option><option>other</option></select>' +
          '<select id="ir-fsort"><option value="updated">recently updated</option><option value="occurrences">most recurring</option><option value="last_seen">last seen</option><option value="severity">severity</option><option value="created">newest</option><option value="number">number</option></select></div>' +
        '<div class="row"><span class="hint">from the log:</span><select id="ir-since"><option>1h</option><option>6h</option><option selected>24h</option><option>7d</option></select>' +
          '<select id="ir-saved" title="saved filters"><option value="">saved filters</option></select><button id="ir-save-f" title="save the current filters">Save filter</button>' +
          '<button id="ir-exp-md" title="copy the listed issues as a markdown table">Copy md</button><button id="ir-exp-csv" title="copy the listed issues as CSV">Copy csv</button>' +
          '<button id="ir-track-b" title="turn recent error groups into issues (plan first)">Track recent log errors…</button>' +
          '<details><summary class="hint">file an issue by hand</summary><div class="row"><select id="ir-kind"><option>bug</option><option>feature</option><option>rendering_gap</option><option>other</option></select>' +
          '<select id="ir-sev"><option>low</option><option selected>medium</option><option>high</option><option>critical</option></select><input id="ir-f-title" placeholder="title" style="flex:1">' +
          '<button id="ir-file">File</button></div><textarea id="ir-f-detail" rows="2" placeholder="detail (optional)" style="width:100%"></textarea><div id="ir-msg" class="hint"></div></details></div>' +
        '<div class="card" id="ir-track"></div>' +
        '<div id="ir-table"></div><div id="ir-more" style="margin:6px 0"></div>' +
        '<div class="card" id="ir-detail"></div>' +
      '</div>';
  }

  window.AppUIReady.then(function () {
    S.app = AppUI.createApp({id: "platform-issue-report", title: "Issue Report", content: {render: render}, statusbar: {}});
    (function wire() {
      if (!S.root || !q("#ir-table")) { setTimeout(wire, 30); return; }
      makeTable();
      var t = null;
      function changed() { clearTimeout(t); t = setTimeout(load, 200); }
      q("#ir-text").oninput = function () { S.f.text = this.value.trim(); changed(); };
      [["ir-fstatus", "status"], ["ir-fsev", "severity"], ["ir-fkind", "kind"], ["ir-fsort", "sort"]].forEach(function (p) {
        q("#" + p[0]).onchange = function () { S.f[p[1]] = this.value; load(); };
      });
      q("#ir-file").onclick = fileIssue;
      q("#ir-track-b").onclick = trackLog;
      q("#ir-exp-md").onclick = function () { exportIssues("md"); };
      q("#ir-exp-csv").onclick = function () { exportIssues("csv"); };
      q("#ir-saved").onchange = function () { if (this.value && SAVED[this.value]) applyFilter(SAVED[this.value]); };
      q("#ir-save-f").onclick = function () {
        var name = window.prompt("Name for this filter:"); if (!name) return;
        var query = {}; ["status", "severity", "kind", "label", "text", "sort"].forEach(function (k) { if (S.f[k]) query[k] = S.f[k]; });
        api("filters", {action: "save", name: name, query: query, confirm: true}).then(function (r) { if (r.ok) loadSaved(); else status(err(r)); });
      };
      document.addEventListener("keydown", onKey);
      startBus();
      pollEvents();
      setInterval(pollEvents, 60000);           // a watchdog only - the long-poll chain re-arms itself
      document.addEventListener("visibilitychange", function () { if (!document.hidden) pollEvents(); });
      loadSaved();
      // deep links: ?id=12 | ?report=ISS-12 opens the issue; ?status= ?label= ?severity= ?text= preset the list (the digest links ?status=open)
      var sp = new URLSearchParams(location.search), want = sp.get("id") || sp.get("report");
      var preset = {}; ["status", "severity", "kind", "label", "text", "sort"].forEach(function (k) { if (sp.get(k)) preset[k] = sp.get(k); });
      if (Object.keys(preset).length) { S.f = Object.assign(S.f, preset); q("#ir-text").value = S.f.text; q("#ir-fstatus").value = S.f.status || "open"; }
      reload().then(function () { if (want) select(want); });
    })();
  });
})();
