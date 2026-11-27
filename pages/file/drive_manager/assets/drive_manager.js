// file/drive_manager — the owner's Google Drive at a glance: sign-in, natural-language search over
// DriveManager's index, indexed folders and public shares. The full app (browse, galleries,
// upload, organize, sharing) is DriveManager itself at /drive.
(function () {
  "use strict";
  var API = "/v1/apps/file/drive_manager/";
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
  function css() {
    var st = node("style");
    st.textContent = [
      ".dm-main{padding:16px 20px;max-width:1100px}",
      ".dm-main h2{margin:22px 0 8px;font-size:15px;text-transform:uppercase;letter-spacing:.05em;opacity:.75}",
      ".dm-card{border:1px solid var(--appui-border,rgba(127,127,127,.3));border-radius:10px;padding:12px 14px;display:flex;gap:16px;align-items:center;flex-wrap:wrap}",
      ".dm-card .grow{flex:1;min-width:220px}.ok{color:#2f9e44}.bad{color:#d0453a}.muted{opacity:.7;font-size:12.5px}",
      ".dm-search{display:flex;gap:8px;margin:6px 0}.dm-search input{flex:1;padding:7px 10px}",
      ".dm-table{width:100%;border-collapse:collapse;font-size:13px}",
      ".dm-table th{text-align:left;opacity:.7;font-weight:600;padding:6px 8px;border-bottom:1px solid var(--appui-border,rgba(127,127,127,.3))}",
      ".dm-table td{padding:6px 8px;border-bottom:1px solid var(--appui-border,rgba(127,127,127,.15));vertical-align:top}",
    ].join("\n");
    document.head.appendChild(st);
  }
  function table(head, rows) {
    var t = node("table", null, {"class": "dm-table"}), tr = node("tr");
    head.forEach(function (h) { tr.appendChild(node("th", h)); });
    var th = node("thead"); th.appendChild(tr); t.appendChild(th);
    var tb = node("tbody");
    rows.forEach(function (r) {
      var row = node("tr");
      r.forEach(function (c) { row.appendChild(c instanceof Node ? (function () { var td = node("td"); td.appendChild(c); return td; })() : node("td", c == null ? "" : String(c))); });
      tb.appendChild(row);
    });
    t.appendChild(tb);
    return t;
  }

  function render(host) {
    css();
    var main = node("div", null, {"class": "dm-main"});
    host.appendChild(main);
    var card = node("div", null, {"class": "dm-card"});
    main.appendChild(card);
    var ocr = node("div", null, {"class":"dm-card","style":"margin-top:12px"});
    main.appendChild(ocr);
    var state = node("div","Checking managed OCR…",{"class":"grow","role":"status"});
    ocr.appendChild(state);
    ocr.appendChild(node("a","Daemon Manager",{href:"/apps/platform/daemon_manager/","class":"btn"}));
    var options=node("div",null,{"class":"grow"}),info=node("div",null,{"class":"grow","role":"status"}),saved=null,busy=false;
    ocr.appendChild(options);
    var save=node("button","Apply OCR device selection",{"class":"btn"});save.disabled=true;ocr.appendChild(save);
    var refresh=node("button","Refresh",{"class":"btn"});ocr.appendChild(refresh);ocr.appendChild(info);
    function refreshOCR(){
      save.disabled=true;
      api("ocr.status").then(function(r){
        if(!r.ok)throw Error("OCR status unavailable");
        saved=r;options.replaceChildren();
        state.textContent=r.configured ? "Selected OCR devices: "+r.endpoints.join(", ") : "Managed OCR disabled · existing worker / VM OCR";
        options.appendChild(node("p","Select up to four approved online Windows devices. Document image bytes may be sent only to those selected."));
        Array.from(new Set([...(r.endpoints||[]),...(r.candidates||[])])).forEach(function(id){
          var label=node("label",null,{"style":"display:block"}),check=node("input",null,{type:"checkbox",value:id});
          check.checked=r.endpoints.includes(id);label.append(check,document.createTextNode(" "+id+(r.candidates.includes(id)?" · online":" · unavailable")));options.append(label);
        });
        if(!options.querySelector("input"))options.append(node("p","No approved Windows OCR devices. Enroll and approve the OCR capability in Daemon Manager."));
        save.disabled=false;
      }).catch(function(){state.textContent="Managed OCR status unavailable";saved=null;});
      api("ocr.metrics").then(function(r){info.replaceChildren(node("strong","OCR processing · last 30 UTC days"));
        if(!r.available){info.append(node("p","Metrics unavailable"));return;}
        info.append(table(["Backend","Attempts","Success","Mean latency"],r.backends.map(function(b){return [b.backend,b.attempts,b.attempts?(100*b.successes/b.attempts).toFixed(0)+"%":"—",b.mean_ms==null?"—":(b.mean_ms/1000).toFixed(2)+" s"];})));
      }).catch(function(){info.textContent="Metrics unavailable";});
    }
    save.onclick=async function(){
      if(!saved||busy)return;var revision=saved.revision;var values=Array.from(options.querySelectorAll("input:checked")).map(function(e){return e.value;});
      if(values.length>4){state.textContent="Select up to four devices.";return;}
      if(!await AppUIDialog.confirmAsync(node("p",values.length?"Allow OCR images to be sent to: "+values.join(", ")+"?":"Disable managed OCR? Legacy worker and VM fallback remain available.")))return;
      busy=true;save.disabled=true;
      try{var r=await api("ocr.configure",{endpoints:values,revision:revision,confirm:true});if(!r.ok)throw Error(r.error||"Selection rejected");refreshOCR();}
      catch(e){state.textContent=e.message;save.disabled=false;}finally{busy=false;}
    };
    refresh.onclick=refreshOCR;refreshOCR();
    var sections = node("div");
    main.appendChild(sections);
    card.appendChild(node("span", "loading…", {"class": "muted"}));
    api("status").then(function (s) {
      card.replaceChildren();
      var left = node("div", null, {"class": "grow"});
      if (!s.ok) {
        left.appendChild(node("strong", "DriveManager unavailable", {"class": "bad"}));
        left.appendChild(node("div", s.error || "", {"class": "muted"}));
      } else if (!s.signed_in) {
        left.appendChild(node("strong", "No Google Drive owner signed in", {"class": "bad"}));
        left.appendChild(node("div", s.hint || "", {"class": "muted"}));
      } else {
        left.appendChild(node("strong", "Signed in: " + (s.owner || "?"), {"class": "ok"}));
        left.appendChild(node("div", "Drive access: " + (s.write_scope ? "read + write" : s.drive_scope ? "read only" : "none") +
          (s.worker ? " · desktop worker: " + JSON.stringify(s.worker) : ""), {"class": "muted"}));
      }
      card.appendChild(left);
      card.appendChild(node("a", "Open DriveManager ↗", {href: "./", "class": "btn primary"}));
      if (s.ok && s.signed_in) renderSections(sections);
    });
  }

  function renderSections(box) {
    box.appendChild(node("h2", "Search the index"));
    var f = node("form", null, {"class": "dm-search"});
    var q = node("input", null, {placeholder: "e.g. photos from Jeju in 2024, invoices pdf", maxlength: "200"});
    f.appendChild(q); f.appendChild(node("button", "Search", {type: "submit", "class": "btn primary"}));
    var res = node("div");
    f.onsubmit = function (e) {
      e.preventDefault();
      if (q.value.trim().length < 2) return;
      res.replaceChildren(node("p", "searching…", {"class": "muted"}));
      api("natural_search", {q: q.value.trim()}).then(function (r) {
        res.replaceChildren();
        if (!r.ok) { res.appendChild(node("p", r.error, {"class": "bad"})); return; }
        var items = r.files || [];
        if (r.interpreted) res.appendChild(node("p", "understood as: " + JSON.stringify(r.interpreted), {"class": "muted"}));
        res.appendChild(items.length ? table(["Name", "Type", "Date"], items.slice(0, 200).map(function (x) {
          return [x.name, x.mimeType || "", String(x.captureTime || x.createdTime || "").slice(0, 10)];
        })) : node("p", "No matches.", {"class": "muted"}));
      });
    };
    box.appendChild(f); box.appendChild(res);

    box.appendChild(node("h2", "Indexed folders"));
    var ix = node("div"); box.appendChild(ix);
    api("indexed_folders").then(function (r) {
      var roots = r.folders || [];
      ix.appendChild(!r.ok ? node("p", r.error, {"class": "bad"}) : roots.length ? table(["Folder", "Kind", "Items", "Id"], roots.map(function (x) {
        return [x.name || "(unnamed)", x.kind || "", x.count != null ? x.count : "", x.id];
      })) : node("p", "Nothing indexed yet: type a folder as a gallery or documents folder in DriveManager.", {"class": "muted"}));
    });

    box.appendChild(node("h2", "Public shares"));
    var sh = node("div"); box.appendChild(sh);
    api("shares").then(function (r) {
      var list = r.shares || [];
      sh.appendChild(!r.ok ? node("p", r.error, {"class": "bad"}) : list.length ? table(["Name", "Mode", "Download", "Expires", "Visits", "Views", "Downloads"], list.map(function (x) {
        return [x.name, x.mode, x.download ? "yes" : "no", x.expires ? new Date(x.expires * 1000).toLocaleDateString() : "never", x.visits, x.views, x.downloads];
      })) : node("p", "No shares. Create them in DriveManager.", {"class": "muted"}));
    });
  }

  window.AppUIReady.then(function () {
    AppUI.createApp({id: "file-drive_manager-overview", title: "Drive Manager · Index", content: {render: render}});
  });
})();
