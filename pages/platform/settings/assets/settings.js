window.AppUIReady.then(function () {
  "use strict";
  function mount(host){host.append(document.getElementById("settings-template").content.cloneNode(true));
  var BASE = "/v1/apps/platform/settings";
  function call(op, args) {
    return AppUIApi.operation("platform/settings",op,args||{}, {timeout:20000}).then(function(j){return {ok:j.ok,j:j};}).catch(function(){return {ok:false,j:{}};});
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function el(id) { return document.getElementById(id); }

  // --- settings ---
  function loadSettings() {
    call("get", {}).then(function (r) {
      var j = r.j || {};
      if (!j.ok) { return; }
      el("ws-root").value = j.workspace_root || "";
      el("ws-default").value = j.default_workspace || "";
      var meta = "config home: " + (j.config_home || "?") +
        "\nconfigured: " + (j.is_configured ? "yes" : "no (using defaults)");
      if (j.legacy_migrated_at) meta += "\nlegacy config migrated: " + j.legacy_migrated_at;
      el("settings-meta").textContent = meta;
    });
  }
  function setStatus(msg, ok) {
    var s = el("settings-status");
    s.textContent = msg; s.className = "status " + (ok ? "ok" : "err");
  }
  document.querySelectorAll("[data-save]").forEach(function (b) {
    b.addEventListener("click", function () {
      var key = b.getAttribute("data-save");
      var op = (key === "workspace_root") ? "set_workspace_root" : "set_default_workspace";
      var path = (key === "workspace_root" ? el("ws-root") : el("ws-default")).value.trim();
      if (!path) { setStatus("enter a path first", false); return; }
      setStatus("saving…", true);
      call(op, { path: path, confirm: true }).then(function (r) {
        var j = r.j || {};
        if (j.ok) { setStatus("saved " + key + " → " + (j.workspace_root || j.default_workspace), true); loadSettings(); }
        else { setStatus("failed: " + (j._error || "error"), false); }
      });
    });
  });
  el("btn-migrate").addEventListener("click", function () {
    el("migrate-out").textContent = "migrating…";
    call("migrate", { confirm: true }).then(function (r) {
      var j = r.j || {};
      if (j.ok) {
        el("migrate-out").textContent = "copied " + (j.copied || []).length +
          " file(s) → " + (j.config_home || "~/pylon-server/config");
        loadSettings();
      } else { el("migrate-out").textContent = "migrate failed"; }
    });
  });

  // --- launcher / home ---
  var ALL = [];
  var MK_ICON = { confluence: "🗎", onedrive: "☁", gdrive: "📁", gitlab: "🦊" };
  function groupIcon(group) {
    if (/ericsson/.test(group)) return "📡";
    if (/office/.test(group)) return "📧";
    if (/documents/.test(group)) return "📄";
    if (/file/.test(group)) return "🗂";
    if (/platform/.test(group)) return "⚙";
    if (/integrations/.test(group)) return "🔌";
    return "📦";
  }
  function renderLauncher(filter) {
    filter = (filter || "").toLowerCase();
    var box = el("launcher");
    var items = ALL.filter(function (a) {
      if (!filter) return true;
      return (a.title + " " + a.app_id + " " + a.description).toLowerCase().indexOf(filter) >= 0;
    });
    var byGroup = {};
    items.forEach(function (a) { (byGroup[a.group || ""] = byGroup[a.group || ""] || []).push(a); });
    var html = "";
    Object.keys(byGroup).sort().forEach(function (g) {
      html += '<div class="group-h">' + groupIcon(g) + " " + esc(g || "(root)") + "</div>";
      byGroup[g].forEach(function (a) {
        var eg = (a.example_prompts || [])[0];
        var surf = (a.workspace_surfaces || []).length;
        html += '<div class="app">' +
          '<div class="ico">' + groupIcon(a.group) + "</div>" +
          '<div class="body">' +
            '<div class="t">' +
              (a.url ? '<a href="' + esc(a.url) + '" target="_blank" rel="noopener">' + esc(a.title) + "</a>"
                     : esc(a.title) + ' <span class="nopage">(no page)</span>') +
              (surf ? '<span class="badge">' + surf + ' surface' + (surf > 1 ? "s" : "") + "</span>" : "") +
            "</div>" +
            '<div class="d">' + esc(a.description) + "</div>" +
            (eg ? '<div class="eg">e.g. "' + esc(eg) + '"</div>' : "") +
          "</div></div>";
      });
    });
    box.innerHTML = html || '<div class="hint">no apps match.</div>';
  }
  function loadApps() {
    call("apps", {}).then(function (r) {
      var j = r.j || {};
      ALL = j.apps || [];
      el("app-count").textContent = "(" + (j.count || ALL.length) + ")";
      renderLauncher("");
    });
  }
  el("app-filter").addEventListener("input", function () { renderLauncher(this.value); });

  async function healthStatus(){
    var host=el("system-health-status"),r=(await call("system_health",{})).j;
    host.replaceChildren();
    if(!r.ok||!r.storage){host.textContent="System health unavailable";return;}
    var rows=[
      ["Storage",r.storage.level+" · DB write "+String(r.storage.db_write)],
      ["Repository",(r.repository.matched??"?")+" / "+(r.repository.files??"?")+" · "+r.repository.status+" · conflicts "+(r.repository.conflicts??"?")],
      ["Improvement review",r.review.status+" · "+r.review.checks+" checks · "+r.review.issues+" issues"],
      ["Open TODOs",(r.todo.open??"unknown")+" across "+(r.todo.scopes??"?")+" scopes"],
      ["Owner password",r.owner.account_file_present?"Configured; login acceptance not yet verified":"Setup required"]
    ];
    for(var s of r.schedules||[])rows.push([s.id,(s.enabled?"enabled":"paused")+" · "+(s.last_result_status||s.last_status||"not run")]);
    if(r.unavailable.length)rows.push(["Unavailable",r.unavailable.join(", ")]);
    for(var [k,v] of rows){var line=document.createElement("div");line.className="setting-row";var label=document.createElement("strong");label.textContent=k+": ";line.append(label,document.createTextNode(v));host.append(line);}
  }
  el("system-health-refresh").onclick=healthStatus;
  healthStatus();
  function credentialLink(){
    var domain=el("ddns-domain").value;
    if(!/^[a-z0-9][a-z0-9-]{0,62}$/.test(domain)){el("ddns-credential-link").removeAttribute("href");return;}
    el("ddns-credential-link").href=AppUIUrlFields.link("/apps/platform/credential/",{name:"duckdns-"+domain,service:"custom",url:"https://www.duckdns.org",type:"bearer",product:"duckdns"},AppUIUrlFields.credentialSchema);
  }
  async function ddnsStatus(){
    var r=(await call("server_address",{action:"status"})).j;
    if(!r.ok){el("ddns-status").textContent="Status unavailable";return;}
    el("ddns-domain").value=r.domain;el("ddns-interval").value=r.schedule?.interval_s||300;el("ddns-enabled").checked=!!r.schedule?.enabled;credentialLink();
    el("ddns-credential").textContent="Credential: "+r.credential_name+" · "+(r.credential_configured?"configured":"not configured (register token in Credential Store)");
    el("ddns-status").textContent=JSON.stringify({hostname:r.hostname,enabled:!!r.schedule?.enabled,last_job:r.schedule?.last_job,last_status:r.schedule?.last_status,last_result:r.schedule?.last_result_status,next_at:r.schedule?.enabled?new Date(r.schedule.next_at*1000).toLocaleString():null},null,2);
  }
  el("ddns-domain").addEventListener("input",function(){el("ddns-credential").textContent="Credential name: duckdns-"+this.value;credentialLink();});
  for(var [id,action] of [["ddns-save","save"],["ddns-run","run_now"],["ddns-resolve","resolve"],["ddns-verify","verify"]]){
    (function(id,action){el(id).onclick=async function(){if(action!=="resolve"&&action!=="verify"&&!await AppUIDialog.confirmAsync("Confirm "+action+" for DuckDNS?"))return;this.disabled=true;try{
      var r=(await call("server_address",{action:action,domain:el("ddns-domain").value,interval_s:Number(el("ddns-interval").value),enabled:el("ddns-enabled").checked,confirm:true})).j;
      el("ddns-status").textContent=JSON.stringify(r,null,2);if(r.ok&&action==="save")await ddnsStatus();
    }finally{this.disabled=false;}};})(id,action);
  }
  el("ddns-refresh").onclick=ddnsStatus;
  loadSettings();
  loadApps();
  ddnsStatus();
  }
  AppUI.createApp({id:"platform-settings",title:"Settings & Home",content:{render:mount},statusbar:{}});
});
