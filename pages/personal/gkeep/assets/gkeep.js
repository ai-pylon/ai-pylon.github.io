/* personal/gkeep — Google Keep notes page, built on the shared AppUI shell.
 *
 * AppUI.createApp (shell + left tree + content region) + AppUITree — no
 * hand-rolled DOM (AGENTS.md: reuse AppUI). Left sidebar = a searchable tree of
 * label groups → notes (children via the http-exposed gkeep.vis_children op);
 * content pane renders a note's text; the status bar shows collect/sign-in
 * state. The menubar carries Collect / Search actions.
 */
(function () {
  "use strict";
  var APP = "personal/gkeep";

  function api(op, body) {
    return fetch("/v1/apps/" + APP + "/" + op, {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {})
    }).then(function (r) { return r.json().catch(function () { return { ok: false }; }); });
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function setStatus(m) { try { if (_app && _app.setStatus) _app.setStatus(m); } catch (e) {} }

  var _app = null, _tree = null, _contentEl = null;

  // ---- tree (label groups → notes) -----------------------------------------
  function _toNode(c) {
    return { name: c.title || c.path, path: c.path || "",
             icon: c.kind === "note" ? "📄" : "🏷️",
             hasChildren: !!c.has_children, data: c,
             badge: c.badge || (c.child_count != null ? String(c.child_count) : "") };
  }
  function renderTree(host) {
    host.style.display = "flex";
    host.style.flexDirection = "column";
    host.style.overflow = "auto";
    var box = document.createElement("div");
    box.className = "gk-treebox";
    host.appendChild(box);
    _tree = AppUITree.create({
      container: box,
      searchable: true, searchPlaceholder: "Search notes…",
      storageKey: "gkeep.tree",
      onSelect: function (node) {
        if (node.data && node.data.kind === "note") openNote(node.path, node.data);
      },
      onExpand: function (node, cb) {
        api("vis_children", { path: node.path || "" }).then(function (r) {
          cb(((r && r.children) || []).map(_toNode));
        }).catch(function () { cb([]); });
      }
    });
    api("vis_children", { path: "" }).then(function (r) {
      var kids = (r && r.children) || [];
      if (!kids.length) {
        box.insertAdjacentHTML("beforeend",
          '<div class="gk-hint">No notes yet. Run <b>Keep ▸ Collect</b> ' +
          "(sign in to Google Keep in the managed browser first).</div>");
        return;
      }
      _tree.setRoots(kids.map(_toNode));
    });
  }

  // ---- note view (content region) ------------------------------------------
  function openNote(path, data) {
    if (!_contentEl) return;
    _contentEl.innerHTML = '<div class="gk-hint">Loading…</div>';
    api("vis_node", { path: path }).then(function (r) {
      if (!r || !r.ok) {
        _contentEl.innerHTML = '<div class="gk-hint gk-warn">' +
          esc((r && (r._error || r.error)) || "could not load") + "</div>";
        return;
      }
      var attrs = r.attributes || {};
      var labels = (attrs.labels || []).map(function (l) {
        return '<span class="gk-lbl">' + esc(l) + "</span>";
      }).join("");
      var link = attrs.link_url
        ? '<a class="gk-link" target="_blank" rel="noopener" href="' + esc(attrs.link_url) + '">' +
          esc(attrs.link_title || attrs.link_url) + " ↗</a>"
        : "";
      var bar = '<div class="gk-docbar">' +
        '<div class="gk-docttl">' + (attrs.pinned ? "📌 " : "") + esc(r.title || "(note)") + "</div>" +
        '<button class="gk-link" id="gk-copy" title="Copy note text">Copy</button>' +
        "</div>";
      var body = '<div class="gk-note">' +
        (labels ? '<div class="gk-lbls">' + labels + "</div>" : "") +
        '<pre class="gk-text">' + esc(r.content || "") + "</pre>" +
        (link ? '<div class="gk-noteln">' + link + "</div>" : "") +
        (attrs.updated ? '<div class="gk-meta">updated ' + esc(attrs.updated) + "</div>" : "") +
        "</div>";
      _contentEl.innerHTML = bar + body;
      var copy = document.getElementById("gk-copy");
      if (copy) copy.addEventListener("click", function () {
        try {
          if (navigator.clipboard && navigator.clipboard.writeText)
            navigator.clipboard.writeText(r.content || "");
          setStatus("Copied note text");
        } catch (e) {}
      });
    });
  }

  // ---- search --------------------------------------------------------------
  function doSearch() {
    var q = window.prompt("Search Keep notes for:", "");
    if (q == null || !q.trim()) return;
    q = q.trim();
    if (!_contentEl) return;
    _contentEl.innerHTML = '<div class="gk-hint">Searching “' + esc(q) + '”…</div>';
    api("vis_search", { query: q, limit: 50 }).then(function (r) {
      if (!r || !r.ok) {
        _contentEl.innerHTML = '<div class="gk-hint gk-warn">' + esc((r && (r._error || r.error)) || "search failed") + "</div>";
        return;
      }
      var hits = r.hits || [];
      var html = '<div class="gk-docttl">' + hits.length + " result(s) for “" + esc(q) + "”</div>";
      hits.forEach(function (h) {
        html += '<div class="gk-hit" data-path="' + esc(h.path) + '">' +
          '<div class="gk-hit-t">' + esc(h.title || "(note)") + "</div>" +
          (h.description ? '<div class="gk-hit-d">' + esc(h.description) + "</div>" : "") +
          "</div>";
      });
      _contentEl.innerHTML = html || '<div class="gk-hint">No matches.</div>';
      [].forEach.call(_contentEl.querySelectorAll(".gk-hit"), function (row) {
        row.addEventListener("click", function () { openNote(row.getAttribute("data-path"), null); });
      });
    });
  }

  var _urlJobs = new Map();
  async function savedUrls() {
    const result = await api('links', {});
    if (!result.ok) { setStatus(result._error || 'Could not load saved URLs'); return; }
    const selected = new Set(), rows = result.items.map(row => Object.assign({}, row, _urlJobs.get(row.id) || {}));
    const content = document.createElement('div');
    const help = document.createElement('p');
    help.textContent = 'Choose up to 10 URLs per batch (VM limit: 10 per minute). Files are saved on the VM under Downloads/pylon-server. No browser cookies are forwarded.';
    const notice = document.createElement('p'); notice.setAttribute('role', 'status');
    const host = document.createElement('div'); content.append(help, notice, host);
    let sending = false, closed = false, polling = false;
    const table = AppUIDataTable.create({container: host, items: rows, getId: row => row.id, maxRows: 5000, empty: 'No HTTP(S) URLs found in saved Keep notes.', columns: [
      {id:'selected', label:'Select', export:false, checkbox: row => ({checked:selected.has(row.id), disabled:sending || ['queued','running'].includes(row.status), onChange: (item, checked) => {if (checked) selected.add(item.id); else selected.delete(item.id);}})},
      {id:'title', label:'Keep note', sortable:true},
      {id:'url', label:'Saved URL', sortable:true, exportLink:row => row.url},
      {id:'status', label:'VM download', sortable:true},
      {id:'bytes', label:'Bytes', sortable:true},
      {id:'path', label:'Saved file'},
      {id:'error', label:'Error'}
    ]});
    const poller = AppUIPollRefresh.start(async () => {
      if (polling || closed) return;
      const pendingJobs = rows.filter(item => item.job_id && !['done','failed','error','interrupted'].includes(item.status));
      if (!pendingJobs.length) return;
      polling = true;
      try {
        for (const row of pendingJobs) {
          const response = await AppUIApi.request('/v1/apps/personal/googlevm/download.status', {job_id:row.job_id});
          if (closed) return;
          if (response.ok && response.job) {
            Object.assign(row, {status:response.job.status, bytes:response.job.bytes, path:response.job.path || response.job.filename || '', error:response.job.error || ''});
            _urlJobs.set(row.id, {job_id:row.job_id,status:row.status,bytes:row.bytes,path:row.path,error:row.error});
          } else row.error = response._error || response.error || 'Status unavailable';
        }
        if (!closed) table.setItems(rows);
      } catch (error) { if (!closed) notice.textContent = error.message; }
      finally { polling = false; }
    }, 3000, {stopWhen: () => closed});
    AppUIDialog.show({title:'Saved URLs ? Google VM', body:content, width:1100,
      onClose: () => {closed=true; table.destroy(); if (poller.stop) poller.stop();}, buttons:[
        {text:'Close'},
        {text:'Download selected', action: () => {
          if (sending) return false;
          if (!selected.size || selected.size > 10) {notice.textContent='Select 1..10 URLs.'; return false;}
          sending = true; table.setItems(rows); notice.textContent='Submitting to the VM...';
          api('download_urls', {ids:Array.from(selected), confirm:true}).then(response => {
            if (closed) return;
            if (!response.ok) throw new Error(response._error || response.error || 'Submission failed');
            let count = 0;
            for (const item of response.items) {
              const row = rows.find(value => value.id === item.id);
              if (item.ok && item.job) {
                row.job_id=item.job.id; row.status=item.job.status; row.error=''; count++;
                _urlJobs.set(row.id, {job_id:row.job_id,status:row.status}); selected.delete(row.id);
              } else row.error=item._error || item.error || 'Submission failed';
            }
            notice.textContent=count + ' download(s) queued on the VM.';
            table.setItems(rows); poller.refresh();
          }).catch(error => {if (!closed) notice.textContent=error.message;}).finally(() => {sending=false; if (!closed) table.setItems(rows);});
          return false;
        }}
      ]});
  }

  // ---- collect -------------------------------------------------------------
  function collect() {
    setStatus("⏳ Collecting Keep notes (via the signed-in managed browser)…");
    return api("refresh_catalog", { confirm: true }).then(function (r) {
      if (r && r.ok && !r.dry_run) {
        var s = r.stats || {};
        setStatus("✓ Collected " + (r.collected || 0) + " new / " + (r.updated || 0) +
                  " updated · " + (s.notes || 0) + " notes, " + (s.labels || 0) + " labels");
        if (_tree) api("vis_children", { path: "" }).then(function (rr) {
          _tree.setRoots(((rr && rr.children) || []).map(_toNode));
        });
      } else {
        var msg = (r && (r._error || r.error)) || "collect failed";
        setStatus("⚠ " + msg);
        if (r && r.category === "auth") {
          if (window.confirm("gkeep isn't signed into Google in the managed browser.\n\n" +
                             "Open the Google sign-in now? (A browser window opens; " +
                             "sign in once, then click Collect again.)")) {
            signin();
          }
        }
      }
      return r;   // so callers (the sign-in viewer) can react to the outcome
    });
  }

  // ---- sign in (IN-APP viewer) ---------------------------------------------
  var SIGNIN = "/apps/personal/gkeep/signin";

  // ---- Google account credential (id/password) dialog ----------------------
  // Save/confirm the 'accounts.google.com' credential the automated sign-in
  // uses. A WRONG stored password causes repeated login failures → Google's
  // "Too many failed attempts" lockout, so being able to verify/fix it here is
  // important. The password is sent once to gkeep.set_credential → the sealed
  // vault; it's never read back (the dialog only shows the saved id).
  function googleAccount() {
    if (!window.AppUIDialog) { setStatus("dialog unavailable"); return; }
    api("cred_status", {}).then(function (st) {
      var curUser = (st && st.user) || "";
      var pwNote = (st && st.saved && st.password_set)
        ? ("A password is saved (" + (st.password_len || 0) + " chars). Leave blank to keep it.")
        : "No password saved yet.";
      var g = (st && st.signin_guard) || {};
      var guardNote = g.cooling_down
        ? ("\u23F8 Sign-in paused ~" + Math.ceil((g.wait_s || 0) / 60) + " min (" + (g.reason || "cooling down") + ").")
        : ("Recent sign-in attempts: " + (g.attempts || 0) + (g.rejected_at ? " \u00B7 last rate-limited " + new Date(g.rejected_at * 1000).toLocaleString() : "") + ".");
      var wrap = document.createElement("div");
      // Fill the dialog box (NOT a fixed width wider than the box content area,
      // which overflowed). The dialog's own box width is set below.
      wrap.style.cssText = "display:flex;flex-direction:column;gap:10px;";
      wrap.innerHTML =
        '<div style="font-size:12px;color:var(--text-muted,#888);line-height:1.4">' +
        'The Google id + password used to sign in automatically. Stored in the ' +
        'sealed credential vault (name: accounts.google.com).</div>' +
        '<label style="font-size:12px">Google email / id' +
        '<input class="gk-ac-user" type="text" autocomplete="off" style="display:block;width:100%;box-sizing:border-box;margin-top:3px" /></label>' +
        '<label style="font-size:12px">Google password <span style="color:var(--text-muted,#999)">(' + esc(pwNote) + ')</span>' +
        '<input class="gk-ac-pw" type="password" autocomplete="new-password" style="display:block;width:100%;box-sizing:border-box;margin-top:3px" /></label>' +
        '<div style="font-size:12px">' + esc(guardNote) + ' <a href="https://accounts.google.com/" target="_blank" rel="noopener">Open accounts.google.com</a> ' +
        '(unlock / verify the password in your own browser)</div>' +
        '<div class="gk-ac-msg" style="font-size:12px;min-height:16px"></div>';
      var uIn = wrap.querySelector(".gk-ac-user"), pIn = wrap.querySelector(".gk-ac-pw");
      var msg = wrap.querySelector(".gk-ac-msg");
      uIn.value = curUser;
      var dlg = AppUIDialog.show({
        title: "Google account", body: wrap, width: "440px", closable: true,
        buttons: [
          { text: "Cancel", action: function (ov) { AppUIDialog.close(ov); } },
          { text: "Save", primary: true, action: function (ov) {
              var u = (uIn.value || "").trim(), p = pIn.value || "";
              if (!u) { msg.textContent = "Enter the Google email/id."; return; }
              if (!p && !(st && st.password_set)) { msg.textContent = "Enter the password."; return; }
              if (!p) {   // keep existing password: re-save with just the id would wipe it
                msg.textContent = "Enter the password to update (needed to re-save).";
                return;
              }
              msg.style.color = "var(--text-muted,#888)"; msg.textContent = "Saving…";
              api("set_credential", { user: u, password: p, confirm: true }).then(function (r) {
                if (r && r.ok && r.saved) {
                  try { AppUIDialog.close(ov); } catch (e) {}
                  setStatus("✓ Saved Google credential for " + u + ". You can Sign in now.");
                } else {
                  msg.style.color = "var(--color-danger,#ed4245)";
                  msg.textContent = (r && (r._error || r.error)) || "could not save";
                }
              });
            } }
        ]
      });
    });
  }

  function signin() {
    setStatus("⏳ Signing in to Google (automated)…");
    // a NEW user-started attempt gets a fresh resume budget (the counter only bounds the loop WITHIN one attempt)
    _resumeCount = 0; _seenChallenges = {};
    // show an immediate "working" dialog so the (up-to-180s) automated phase
    // isn't a silent wait; it's replaced by the interactive viewer if Google
    // needs a verification step, or by the result.
    _openBusyDialog("Signing in to Google…",
                    "Entering your saved credentials and handling the login. "
                    + "If Google needs a verification step, you'll be able to "
                    + "complete it here.");
    api("signin", {}).then(function (r) {
      if (r && r.ok && (r.already_signed_in || r.state === "completed")) {
        _signinBusyMsg("✓ Signed in — collecting notes…", "", true);
        if (r.state === "completed") refreshStatus();
        setTimeout(_closeSigninDialog, 1400);
      } else if (r && r.need_password) {
        // no password stored → don't attempt a blank-password login (which locks
        // the account). Close the busy dialog + open the Google-account dialog.
        _closeSigninDialog();
        setStatus("⚠ Set your Google password first (Keep ▸ Google account).");
        googleAccount();
      } else if (r && r.ok && r.needs_interaction && r.tab_id) {
        // the automated ladder filled email+password; Google needs a
        // verification step → swap the busy dialog for the interactive viewer
        // ATTACHED to the live login tab.
        setStatus("↗ " + (r.why ? ("Google: " + r.why) : "Google needs a verification step") + " — complete it in the viewer.");
        _closeSigninDialog();
        openSigninViewer({ attach_tab_id: r.tab_id, why: r.why });
      } else if (r && r.state === "denied") {
        _signinBusyMsg("Sign-in blocked", esc((r._error || "Google rejected the sign-in")).slice(0, 180), true);
        setStatus("⚠ " + ((r._error || "Google rejected the sign-in")));
        setTimeout(_closeSigninDialog, 3000);
      } else {
        var m = (r && (r._error || r.error)) || "sign-in did not complete";
        _signinBusyMsg("Sign-in didn't finish", esc(String(m)).slice(0, 180), true);
        setStatus("⚠ " + m);
        setTimeout(_closeSigninDialog, 3000);
      }
    }).catch(function (e) {
      _signinBusyMsg("Sign-in error", esc(String(e && e.message || e)).slice(0, 180), true);
      setTimeout(_closeSigninDialog, 3000);
    });
  }

  // A minimal "working…" dialog used during the automated login phase (before
  // the interactive viewer, if any). Reuses the progress panel markup.
  function _openBusyDialog(msg, sub) {
    if (!window.AppUIDialog) return;
    _closeSigninDialog();
    _signinBody = document.createElement("div");
    _signinBody.style.cssText = "min-width:360px;max-width:84vw;";
    _signinDlg = AppUIDialog.show({ title: "Sign in to Google Keep", body: _signinBody,
                                    width: "440px", closable: true,
                                    onClose: function () { _signinDlg = null; _signinBody = null; } });
    _showSigninProgress(msg, sub);
  }
  function _signinBusyMsg(msg, sub, done) { _showSigninProgress(msg, sub, done); }

  // Create a screencast viewer session (optionally ATTACHED to an existing login
  // tab) and open the floating dialog mirroring it. `opt` = a session-id string
  // (legacy) OR {attach_tab_id} to bind to the automation's live tab.
  function openSigninViewer(opt) {
    if (typeof opt === "string") { _mountViewer(opt); return; }
    var body = (opt && opt.attach_tab_id) ? { attach_tab_id: opt.attach_tab_id } : {};
    api2(SIGNIN + "/open", body).then(function (r) {
      if (r && r.ok && r.session) _mountViewer(r.session, opt && opt.why, (r.tab_id || (opt && opt.attach_tab_id)));
      else setStatus("⚠ could not open the sign-in viewer: " + ((r && r.error) || "?"));
    });
  }

  // Mirror the managed-Edge Google login in the shared AppUI remote-browser
  // viewer (AppUIRemoteBrowserViewer: JPEG frames over SSE + input relay). Only
  // the Google-specific POLICY lives here: step labels, the resume ladder
  // (_watchAdvance) and the post-login collect.
  var _viewer = null, _signinDoneFlag = false, _signinDlg = null, _signinBody = null, _signinTabId = null;
  function _detectStep(url) {
    var u = String(url || "").toLowerCase();
    if (u.indexOf("keep.google.com") >= 0) return "\u2713 Signed in \u2014 finishing\u2026";
    if (/\/signin\/rejected/.test(u)) return "Google rate-limited this account \u2014 wait a while, then retry";
    // GKEEP #18: once the resume cap is hit the automation no longer drives the page - say so on EVERY screen
    // (the per-frame step label used to overwrite the one-off note), so the user knows to finish here.
    var stop = (_resumeCount >= _RESUME_MAX) ? "Automatic resume stopped \u2014 finish here. " : "";
    var s = _stepFor(u);
    return stop + s;
  }
  function _stepFor(u) {
    if (/\/challenge\/recaptcha/.test(u) || /recaptcha/.test(u)) return "CAPTCHA \u2014 click \u201cI\u2019m not a robot\u201d, OR type the distorted text/audio shown, then click Next";
    if (/\/challenge\/pwd/.test(u)) return "Password \u2014 it\u2019s pre-filled; click \u201cNext\u201d";
    if (/\/challenge\/ipe|\/challenge\/ope/.test(u)) return "Email code \u2014 type the code Google emailed you, then Next";
    if (/\/signin\/identifier/.test(u)) return "Email \u2014 entering your Google id\u2026";
    if (/\/challenge\//.test(u)) return "Verification step \u2014 complete it here, then Next";
    if (u.indexOf("accounts.google.com") >= 0) return "Google sign-in \u2014 continue here";
    return "Sign in to Google in the viewer below.";
  }
  // `opt` = a session-id string (legacy) OR {attach_tab_id, why}: bind to the
  // automation's live login tab (the viewer opens/attaches the session itself).
  function openSigninViewer(opt) {
    if (typeof opt === "string") _mountViewer({ session: opt });
    else _mountViewer({ attachTabId: opt && opt.attach_tab_id, why: opt && opt.why });
  }
  function _mountViewer(o) {
    if (!window.AppUIRemoteBrowserViewer) {
      AppUIAssets.load("remoteBrowserViewer").then(function () { _mountViewer(o); });
      return;
    }
    _signinDoneFlag = false; _resuming = false;
    _signinTabId = o.attachTabId || null;
    _viewer = AppUIRemoteBrowserViewer.create({
      baseUrl: SIGNIN, session: o.session, attachTabId: o.attachTabId,
      title: "Sign in to Google Keep", why: o.why, allowHeadful: true,
      labels: { why: function (w) { return "Google: " + w; }, opening: "Opening the sign-in viewer\u2026",
                declined: "Google declined this sign-in. You can retry here or retry in background headed mode. " },
      detectStep: _detectStep,
      onFrame: function (d, v) {
        if (/\/challenge\/(ipe|ope)/i.test(d.url || "")) {
          if (d.hint) v.setStep("Email code \u2014 Google sent it to " + d.hint + ". Type it, then Next");
          if (!v._codeFocused) { v._codeFocused = true; try { v.focusInput(); } catch (e) {} }
        }
        if (d.captcha) v.setStep("Image CAPTCHA \u2014 click the text box, type the characters you see, then Next");
        _watchAdvance(d.url, v);
      },
      onDone: function () { _signinDone(); },
      onClose: function () { _viewer = null; }
    });
  }
  // After YOU solve the on-page challenge (reCAPTCHA / verification), the page
  // advances — hand control BACK to the automation so it continues the ladder
  // (e.g. fill the password page). BOUNDED: Google can loop
  // reCAPTCHA→password→code→reset→reCAPTCHA if the emailed code isn't entered,
  // and an unbounded auto-resume would re-drive that loop forever (the "keeps
  // flashing the password page" symptom). So we resume at most _RESUME_MAX times
  // and never re-resume into a challenge TYPE we've already resumed from — after
  // that we just leave the viewer open for YOU to finish manually.
  var _advUrl = null, _advSince = 0, _advTimer = null, _resuming = false;
  var _resumeCount = 0, _RESUME_MAX = 2, _seenChallenges = {};
  function _watchAdvance(url, hint) {
    url = String(url || "");
    if (!url || _resuming || _signinDoneFlag) return;
    var low = url.toLowerCase();
    // record which challenge types we've parked on (to detect a Google loop).
    var cm = low.match(/\/challenge\/([a-z0-9]+)/);
    if (cm) _seenChallenges[cm[1]] = (_seenChallenges[cm[1]] || 0) + 1;
    // still on a challenge/captcha step → keep waiting (reset the debounce).
    // /challenge/pwd is the PASSWORD step - the automation fills it, so it must NOT
    // count as a human challenge (the old bare /challenge\b/ matched it, so after you
    // solved the captcha the viewer never handed back and the password stayed empty).
    var onPwd = /\/challenge\/pwd/.test(low);
    var onChallenge = !onPwd && (/\/challenge\/(recaptcha|az|dp|ipp|totp|sk|iap|kpp|selection|ipe|ope)|\/challenge\b/.test(low)
                      || /recaptcha/.test(low));
    var onAccounts = low.indexOf("accounts.google.com") >= 0 || low.indexOf("accounts.youtube.com") >= 0;
    if (onChallenge || !onAccounts) { _advUrl = null; _advSince = 0; return; }
    if (_resumeCount >= _RESUME_MAX) {
      // we've already resumed enough — stop auto-driving; let the user finish in
      // the viewer. (Avoids the reCAPTCHA↔password↔code reset loop.) _detectStep keeps the note on every screen.
      if (hint && hint.setStep) hint.setStep("Automatic resume stopped \u2014 finish here. " + _stepFor(low));
      return;
    }
    // we're on a NON-challenge accounts page (likely the pwd/identifier step the
    // automation can drive). Debounce: require the same URL to hold ~1.5s.
    if (url !== _advUrl) { _advUrl = url; _advSince = Date.now(); }
    if (_advTimer) return;
    _advTimer = setTimeout(function () {
      _advTimer = null;
      if (_resuming || _signinDoneFlag || _resumeCount >= _RESUME_MAX) return;
      if (_advUrl && (Date.now() - _advSince) >= 1400) {
        _resuming = true;
        _resumeCount++;
        if (hint && hint.setStep) hint.setStep("Resuming the automated sign-in\u2026");
        _resumeAutomation();
      }
    }, 1600);
  }

  // Close the viewer stream (but DON'T stop the browser tab) + re-run the
  // automated ladder, which re-detects the current screen (password/…) and
  // continues. Shows the busy indicator meanwhile.
  function _resumeAutomation() {
    _showSigninProgress("Resuming sign-in…", "Continuing the automated login where you left off.");
    api("signin", { resume_tab_id: _signinTabId || undefined }).then(function (r) {
      if (r && r.ok && (r.state === "completed" || r.already_signed_in)) {
        _signinDone();
      } else if (r && r.ok && r.needs_interaction && r.tab_id) {
        // another human step → re-open the viewer attached to the (same) tab.
        _resuming = false; _signinDoneFlag = false;
        _closeSigninDialog();
        openSigninViewer({ attach_tab_id: r.tab_id, why: r.why });
      } else if (r && r.state === "denied") {
        _showSigninProgress("Sign-in blocked", esc((r._error || "Google rejected the sign-in")).slice(0, 180), true);
        setTimeout(_closeSigninDialog, 3000);
      } else {
        _showSigninProgress("Sign-in didn't finish",
          esc(((r && (r._error || r.error)) || "unknown")).slice(0, 180) +
          '  <button class="gk-link" id="gk-si-retry">Retry</button>', true);
        var rb = document.getElementById("gk-si-retry");
        if (rb) rb.addEventListener("click", function () { _resuming = false; signin(); _closeSigninDialog(); });
      }
    }).catch(function () { _resuming = false; });
  }

  function _signinDone() {
    if (_signinDoneFlag) return;
    _signinDoneFlag = true;
    // sign-in is complete; STOP the frame stream + input but KEEP the dialog
    // open, swapping its body to a PROGRESS indicator while gkeep captures the
    // Google cookies + collects notes (that phase is otherwise invisible — the
    // dialog used to just vanish and nothing showed it was working).
    if (_viewer) _viewer.stop();   // close stream + input, release the browser tab
    _showSigninProgress("Signed in — finishing up…",
                        "Capturing your Google session and loading your notes.");
    setStatus("Signed in — collecting notes…");
    // run the collect; report the outcome IN the dialog, then auto-close.
    collect().then(function (r) {
      var ok = r && r.ok && !r.dry_run;
      var s = (r && r.stats) || {};
      if (ok) {
        _showSigninProgress("✓ All set",
          "Collected " + (r.collected || 0) + " new / " + (r.updated || 0) +
          " updated · " + (s.notes || 0) + " notes, " + (s.labels || 0) + " labels.",
          true);
        setTimeout(_closeSigninDialog, 1600);
      } else {
        var msg = (r && (r._error || r.error)) || "collect did not complete";
        _showSigninProgress("Signed in, but collect needs a retry",
          esc(String(msg).slice(0, 160)) + '  <button class="gk-link" id="gk-retry-collect">Retry</button>', true);
        var rb = document.getElementById("gk-retry-collect");
        if (rb) rb.addEventListener("click", function () {
          _showSigninProgress("Collecting…", "Fetching your notes.");
          collect().then(function (r2) {
            if (r2 && r2.ok && !r2.dry_run) { _closeSigninDialog(); }
            else _showSigninProgress("Still couldn't collect",
              esc(((r2 && (r2._error || r2.error)) || "unknown")).slice(0, 160), true);
          });
        });
      }
    });
  }

  function _showSigninProgress(msg, sub, done) {
    if (_viewer) { _viewer.setProgress(msg, sub, done); return; }
    if (!_signinBody) return;
    _signinBody.innerHTML =
      '<div class="gk-progress' + (done ? ' gk-done' : '') + '">' +
      '<div class="gk-spinner">' + (done ? "\u2713" : "") + '</div>' +
      '<div class="gk-prog-msg">' + esc(msg) + '</div>' +
      '<div class="gk-prog-sub">' + (sub || "") + '</div></div>';
  }
  function _closeSigninDialog() {
    var v = _viewer; _viewer = null;
    if (v) { try { v.destroy(); } catch (e) {} }
    var dialog = _signinDlg; _signinDlg = null; _signinBody = null;
    try { if (dialog && window.AppUIDialog) AppUIDialog.close(dialog); } catch (e) {}
  }
  // a bare POST that doesn't go through the op api() (these are mount routes)
  function api2(path, body) {
    return fetch(path, { method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) })
      .then(function (r) { return r.json().catch(function () { return {}; }); })
      .catch(function () { return {}; });
  }
  function refreshStatus() {
    api("setup", {}).then(function (r) {
      if (!r || !r.ok) { setStatus("gkeep status unavailable"); return; }
      var s = r.stats || {};
      if (s.notes) setStatus("✓ " + s.notes + " notes, " + s.labels + " labels" +
                             (r.signed_in ? "" : " · signed out"));
      else setStatus(r.signed_in ? "Signed in — use Keep ▸ Collect to fetch notes."
                                  : (r.browser_import && r.browser_import.locked
                                     ? "Not signed in — tip: close all Edge windows once so Keep can reuse your browser\u2019s Google session (no login needed), or use Keep ▸ Sign in."
                                     : "Not signed in — sign in to Google Keep in the managed browser."));
      if (s.notes && r.session && r.session.days_left != null && r.session.days_left < 14)
        setStatus("\u26A0 Google session expires in ~" + r.session.days_left + " days (" + (r.session.source || "?") + ") — sign in again soon.");
    });
  }

  // ---- mount ---------------------------------------------------------------
  function boot() {
    _app = AppUI.createApp({
      id: "personal-gkeep",
      title: "Google Keep",
      menubar: { theme: true },
      menu: { "Keep": [
        { id: "urls", label: "Download saved URLs on VM..." },
        { id: "collect", label: "⟳ Collect / Refresh notes" },
        { id: "signin", label: "🔑 Sign in to Google…" },
        { id: "account", label: "👤 Google account (id/password)…" },
        { id: "search", label: "🔎 Search…" }
      ]},
      onAction: function (menu, id) {
        if (id === "urls") savedUrls().catch(error => setStatus(error.message));
        else if (id === "collect") collect();
        else if (id === "signin") signin();
        else if (id === "account") googleAccount();
        else if (id === "search") doSearch();
      },
      leftSidebar: { width: 300, tabs: [
        { id: "labels", label: "Labels", active: true, render: renderTree }
      ]},
      content: { render: function (el) {
        _contentEl = el;
        el.classList.add("gk-content");
        el.innerHTML = '<div class="gk-hint">Select a note on the left, or use Keep ▸ Search. ' +
          "If empty, run <b>Keep ▸ Collect</b> first.</div>";
      }},
      statusbar: {}
    });
    refreshStatus();
    // If a notification button brought us here:
    //  ?signin_tab=<tabId> — the automated login needs a verification step;
    //    open the viewer ATTACHED to that live login tab.
    //  ?signin=<session>   — a pre-existing viewer session to re-open.
    try {
      var _qs = new URLSearchParams(window.location.search);
      var _tab = _qs.get("signin_tab");
      var _sp = _qs.get("signin");
      if (_qs.get("account")) {
        setTimeout(function () { googleAccount(); }, 300);
      } else if (_tab) {
        setTimeout(function () { openSigninViewer({ attach_tab_id: _tab }); }, 300);
      } else if (_sp) {
        setTimeout(function () {
          fetch(SIGNIN + "/status?session=" + encodeURIComponent(_sp), {credentials: "same-origin"})
            .then(function (r) { return r.json(); })
            .then(function (r) { if (r && r.ok) openSigninViewer(_sp); else signin(); })
            .catch(signin);
        }, 300);
      }
    } catch (e) {}
  }

  if (window.AppUIReady && window.AppUIReady.then) {
    window.AppUIReady.then(boot).catch(function (e) {
      var b = document.getElementById("app-content-body");
      if (b) b.innerHTML = '<div style="padding:18px">AppUI failed to load: ' + esc(e) + "</div>";
    });
  } else { window.addEventListener("load", boot); }
})();
