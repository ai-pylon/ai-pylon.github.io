// knowledge/vis Bench — page-agent testbed (folded from platform/pageintrospect,
// NEXT5 #3). Demo + testbed for AppUIPageIntrospect.
// A page with a menu, a multi-tab right sidebar (with nested sub-areas), and a
// content area with sections/status/buttons — and an Assistant tab that drills
// into that structure ON DEMAND, NODE BY NODE, across turns via page.inspect.
(function () {
  "use strict";
  var APP = "knowledge/vis";
  function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
  function el(tag, attrs, html){var e=document.createElement(tag);if(attrs)Object.keys(attrs).forEach(function(k){e.setAttribute(k,attrs[k]);});if(html!=null)e.innerHTML=html;return e;}

  var appHandle = null;
  var _aiHost = null, _aiPanel = null;

  // ------------------------------------------------------- CONTENT ---------
  function renderContent(root){
    root.innerHTML = "";

    var intro = el("div", {class:"pi-card"});
    intro.innerHTML =
      '<h3>About</h3>'+
      '<div class="pi-sub">This page demonstrates <b>AppUIPageIntrospect</b> — the embedded assistant '+
      '(right sidebar → <b>Assistant</b> tab) can inspect THIS page\'s structure hierarchically and on demand. '+
      'It is shown only a top-level outline each turn and expands regions it needs via a <code>page.inspect</code> action. '+
      'Try asking it: “what regions does this page have?”, “look inside the sidebar”, or “what buttons are on screen?”.</div>';
    root.appendChild(intro);

    // a status card (gives the introspect content/status node something to read)
    var status = el("div", {class:"pi-card"});
    status.innerHTML = '<h3>Status</h3><div id="pi-status"></div>';
    root.appendChild(status);
    var sb = status.querySelector("#pi-status");
    function pill(n,on,txt){return '<span class="pi-pill '+(on?'on':'off')+'" title="'+(txt||'')+'">'+n+' '+(on?'✓':'✗')+'</span>';}
    sb.innerHTML = pill("Service", true, "demo app loaded")+" "+
                   pill("Assistant", true, "introspect profile available")+" "+
                   pill("Writes", false, "read-only demo");

    // a form card (gives content sections + buttons + a message to inspect)
    var form = el("div", {class:"pi-card"});
    form.innerHTML = '<h3>Sample form</h3>';
    var grid = el("div",{class:"pi-grid"});
    grid.innerHTML =
      '<div class="pi-grid-l">Name</div><div><input id="pi-name" placeholder="your name"></div>'+
      '<div class="pi-grid-l">Kind</div><div><select id="pi-kind"><option>alpha</option><option>beta</option></select></div>';
    form.appendChild(grid);
    var row = el("div",{class:"pi-row",style:"margin-top:10px"});
    row.innerHTML = '<span style="flex:1"></span><button id="pi-preview" class="btn">Preview</button><button id="pi-save" class="btn btn-primary">Save</button>';
    form.appendChild(row);
    var msg = el("div",{id:"pi-msg"}); form.appendChild(msg);
    root.appendChild(form);
    form.querySelector("#pi-preview").onclick=function(){ msg.innerHTML='<div class="pi-msg pi-ok">Preview: '+esc(document.getElementById("pi-name").value||"(empty)")+' · '+esc(document.getElementById("pi-kind").value)+'</div>'; };
    form.querySelector("#pi-save").onclick=function(){ msg.innerHTML='<div class="pi-msg pi-ok">Saved (demo — no write).</div>'; };
  }

  // ------------------------------------------------------- SIDEBAR TABS ----
  function renderOverviewTab(host){
    host.innerHTML =
      '<div style="padding:10px 12px">'+
      '<h3 style="font-size:12px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.04em;margin:0 0 8px">Overview</h3>'+
      '<div class="pi-sub">A simple read-only tab. The introspect tree sees this tab (its heading + text) when the assistant expands <code>sidebar/&lt;this tab&gt;</code>.</div>'+
      '</div>';
  }
  function renderSettingsTab(host){
    // a tab with NESTED sub-areas (sections + fields + buttons) so the introspect
    // deeper-scan has real structure to report.
    host.innerHTML =
      '<div style="padding:10px 12px">'+
      '<h3 style="font-size:12px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.04em;margin:0 0 8px">Settings</h3>'+
      '<h4 style="margin:6px 0 2px">Appearance</h4>'+
      '<div class="pi-row"><label class="pi-sub"><input type="checkbox" id="pi-dense"> dense layout</label></div>'+
      '<h4 style="margin:10px 0 2px">Notifications</h4>'+
      '<div class="pi-row"><input id="pi-email" placeholder="notify email"><button class="btn sm" id="pi-sub-save">Save</button></div>'+
      '</div>';
  }

  // ------------------------------------------------------- ASSISTANT -------
  function mountAssistant(host){
    _aiHost = host || _aiHost;
    if (!_aiHost) return;
    if (!(window.AppUIAssets && window.AppUIAssets.load)) { _aiHost.textContent = "Assistant unavailable."; return; }
    _aiHost.textContent = "Loading assistant…";
    window.AppUIAssets.load("feedback", "aiSidebar").then(function () {
      if (!(window.AppUIChatPanel && window.AppUIChatPanel.mountProfile && window.AppUIPageIntrospect)) {
        _aiHost.textContent = "Assistant unavailable (aiSidebar bundle did not load).";
        return;
      }
      try { if (_aiPanel && _aiPanel.destroy) _aiPanel.destroy(); } catch (e) {}
      _aiHost.textContent = "";
      // ONE-FLAG page agent: the profile declares `page_agent: true`, so
      // mountProfile auto-wires AppUIPageIntrospect (SEE the page as a
      // hierarchical, on-demand tree) + AppUIPageActions (ACT on the DOM:
      // fill/click/select/check/read) for us. We only pass the function bits a
      // manifest can't carry — the `root` scope (actions restricted to this
      // app's own regions) — via opts.pageAgent. No per-page introspect/action
      // wiring needed; this is the whole adoption cost for any app.
      _aiPanel = window.AppUIChatPanel.mountProfile(_aiHost, "knowledge/vis.pageagent", {
        pageAgent: {
          appId: APP,
          root: function () { return document.getElementById("app-main") || document.body; },
          onRead: function (out) {
            try { if (window.AppUIToast) AppUIToast.info("read: " + (Array.isArray(out) ? out.join(" | ") : String(out)).slice(0, 120)); } catch (e) {}
          },
        },
        examplePrompts: [
          "What regions does this page have?",
          "Append 3 to the name field (suffix)",
          "Set the Kind dropdown to beta",
          "Click the Preview button",
        ],
        hideHeader: true,
        ensureBundle: false,
      });
      // RECORD / SAVE / REPLAY toolbar (CDP-free page automation). Resolve the
      // panel handle (mountProfile is async) and use its pageAgent.actions to
      // record the assistant's (or your) fill/click/select steps and save them
      // as a replayable page_automation case — then replay in THIS page, no CDP.
      Promise.resolve(_aiPanel).then(function (h) {
        try { _mountRecordBar(_aiHost, h && h.pageAgent && h.pageAgent.actions); } catch (e) {}
      });
    }).catch(function () { if (_aiHost) _aiHost.textContent = "Assistant failed to load."; });
  }

  // A tiny Record/Save/Replay bar inserted at the top of the Assistant host.
  function _mountRecordBar(host, actions) {
    if (!host || !actions || !actions.startRecording) return;
    var bar = document.createElement("div");
    bar.style.cssText = "display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding:6px 8px;border-bottom:1px solid var(--border,#333);font-size:12px";
    bar.innerHTML =
      '<span style="color:var(--text-secondary)">🎬 Automation:</span>' +
      '<button id="pi-rec" class="btn sm">Record</button>' +
      '<button id="pi-save" class="btn sm" disabled>Save…</button>' +
      '<input id="pi-replay-id" placeholder="case id to replay" style="flex:1;min-width:90px">' +
      '<button id="pi-replay" class="btn sm">Replay</button>' +
      '<span id="pi-rec-status" style="color:var(--text-muted);flex-basis:100%"></span>';
    host.insertBefore(bar, host.firstChild);
    var recBtn = bar.querySelector("#pi-rec"), saveBtn = bar.querySelector("#pi-save"),
        st = bar.querySelector("#pi-rec-status");
    function status(t){ st.textContent = t || ""; }
    recBtn.onclick = function () {
      if (actions.isRecording()) {
        actions.stopRecording(); recBtn.textContent = "Record";
        var n = actions.getRecording().length; saveBtn.disabled = n === 0;
        status(n ? ("Recorded " + n + " step(s). Enter an id below is optional; click Save…") : "Nothing recorded.");
      } else {
        actions.startRecording(); recBtn.textContent = "Stop"; saveBtn.disabled = true;
        status("Recording — do the steps (type in a field, pick a dropdown, click a button), then Stop.");
      }
    };
    saveBtn.onclick = function () {
      var id = (bar.querySelector("#pi-replay-id").value || "").trim() || ("rec_" + Date.now().toString(36));
      actions.recordAndSave(id, { title: "Recorded on the VIS page-agent bench", url: location.pathname }).then(function () {
        status('Saved case "' + id + '". Type it in the box and click Replay to run it here (no CDP).');
        saveBtn.disabled = true;
      });
    };
    bar.querySelector("#pi-replay").onclick = function () {
      var id = (bar.querySelector("#pi-replay-id").value || "").trim();
      if (!id) { status("Enter a saved case id to replay."); return; }
      status("Replaying " + id + "…");
      actions.replayCaseById(id).then(function (r) {
        status(r && r.ok ? ("Replayed " + r.performed + " step(s) — no CDP.") : ("Replay failed: " + ((r && r.error) || "?")));
      });
    };
  }

  // ------------------------------------------------------- MOUNT -----------
  window.AppUIReady.then(function () {
    appHandle = AppUI.createApp({
      id: "knowledge-vis-pageagent",
      title: "Page Introspect",
      menubar: { theme: true },
      content: { render: renderContent },
      rightSidebar: { width: 380, tabs: [
        { id: "assistant", label: "🤖 Assistant", render: function(host){ mountAssistant(host); } },
        { id: "overview", label: "📄 Overview", active: true, render: renderOverviewTab },
        { id: "settings", label: "⚙ Settings", render: renderSettingsTab },
      ]},
      statusBar: {},
    });
    try { if (appHandle && appHandle.setStatus) appHandle.setStatus("Open the Assistant tab and ask it what's on the page."); } catch (e) {}
  }).catch(function (e) {
    var b=document.getElementById("app-content-body");
    if(b) b.innerHTML='<div style="padding:18px">AppUI failed to load: '+esc(e)+'</div>';
  });
})();
