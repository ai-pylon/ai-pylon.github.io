// platform/tool_todo — every app's TODO.md: the apps with their open counts on the left,
// the chosen app's items (by section) with state / done / note, and an add form.
// Served at /apps/platform/tool_todo/. ?app=<app id> opens an app.
(function () {
  "use strict";
  var API = "/v1/apps/platform/tool_todo/";
  var S = {apps: [], app: null, onlyOpen: true, filter: "", showDone: false};
  var listBox = null, content = null, status = null;

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
  function tell(msg, bad) {
    if (!status) return;
    status.textContent = msg || "";
    status.className = "td-status" + (bad ? " bad" : "");
  }
  function css() {
    var st = node("style");
    st.textContent = [
      ".td-side{display:flex;flex-direction:column;gap:8px;padding:10px;height:100%;box-sizing:border-box}",
      ".td-side input[type=search]{width:100%;box-sizing:border-box;padding:6px 8px}",
      ".td-apps{overflow:auto;flex:1;display:flex;flex-direction:column;gap:2px}",
      ".td-app{display:flex;justify-content:space-between;gap:8px;padding:5px 8px;border-radius:6px;cursor:pointer;font-size:13px}",
      ".td-app:hover{background:var(--appui-hover,rgba(127,127,127,.12))}",
      ".td-app.on{background:var(--appui-selected,rgba(80,120,255,.18));font-weight:600}",
      ".td-app .n{opacity:.75;font-variant-numeric:tabular-nums}",
      ".td-app.zero{opacity:.55}",
      ".td-main{padding:16px 20px;max-width:1000px}",
      ".td-main h2{margin:0 0 2px}.td-path{opacity:.65;font-size:12px;margin:0 0 12px;word-break:break-all}",
      ".td-add{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 14px}",
      ".td-add input,.td-add select{padding:6px 8px}.td-add input[name=text]{flex:1 1 320px}",
      ".td-sec{margin:16px 0 6px;font-size:13px;text-transform:uppercase;letter-spacing:.04em;opacity:.7}",
      ".td-item{display:grid;grid-template-columns:auto 1fr auto;gap:4px 10px;align-items:start;padding:8px 10px;",
      "border:1px solid var(--appui-border,rgba(127,127,127,.25));border-radius:8px;margin:6px 0}",
      ".td-item.done{opacity:.55}.td-item.done .t{text-decoration:line-through}",
      ".td-id{font-family:monospace;opacity:.7;padding-top:2px}",
      ".td-badge{display:inline-block;font-size:11px;padding:0 6px;border-radius:9px;margin-right:6px;",
      "border:1px solid currentColor;opacity:.85}",
      ".td-badge.wip{color:#2a7de1}.td-badge.blocked{color:#d0453a}.td-badge.prio{color:#b7791f}",
      ".td-notes{grid-column:2/4;margin:2px 0 0;padding-left:18px;font-size:12.5px;opacity:.8}",
      ".td-acts{display:flex;gap:6px;align-items:center}",
      ".td-noteform{grid-column:2/4;display:flex;gap:6px}.td-noteform input{flex:1;padding:5px 8px}",
      ".td-status{min-height:1.2em;font-size:12.5px;opacity:.8}.td-status.bad{color:#d0453a;opacity:1}",
      ".td-empty{opacity:.7;padding:20px 0}",
    ].join("\n");
    document.head.appendChild(st);
  }

  // ---- left: apps ----------------------------------------------------------------
  function loadApps() {
    return api("list", {}).then(function (r) {
      if (!r.ok) { tell(r.error || r._error, true); return; }
      S.apps = r.apps || [];
      renderApps();
    });
  }
  function renderApps() {
    if (!listBox) return;
    var f = S.filter.toLowerCase();
    var apps = S.apps.filter(function (a) {
      return (!S.onlyOpen || a.open || a.app === S.app) && (!f || a.app.toLowerCase().indexOf(f) >= 0);
    }).sort(function (x, y) { return (y.open - x.open) || x.app.localeCompare(y.app); });
    listBox.replaceChildren();
    apps.forEach(function (a) {
      var row = node("div", null, {"class": "td-app" + (a.app === S.app ? " on" : "") + (a.open ? "" : " zero"),
                                   tabindex: "0", title: a.path});
      row.appendChild(node("span", a.app));
      row.appendChild(node("span", String(a.open), {"class": "n"}));
      row.onclick = function () { openApp(a.app); };
      row.onkeydown = function (e) { if (e.key === "Enter") openApp(a.app); };
      listBox.appendChild(row);
    });
    if (!apps.length) listBox.appendChild(node("div", S.onlyOpen ? "No app has open TODOs." : "No app matches.", {"class": "td-empty"}));
  }
  function mountSide(host) {
    var box = node("div", null, {"class": "td-side"});
    var q = node("input", null, {type: "search", placeholder: "Filter apps…"});
    q.oninput = function () { S.filter = q.value; renderApps(); };
    var lab = node("label");
    var cb = node("input", null, {type: "checkbox"}); cb.checked = S.onlyOpen;
    cb.onchange = function () { S.onlyOpen = cb.checked; renderApps(); };
    lab.appendChild(cb); lab.appendChild(document.createTextNode(" only apps with open items"));
    listBox = node("div", null, {"class": "td-apps"});
    box.appendChild(q); box.appendChild(lab); box.appendChild(listBox);
    host.appendChild(box);
    renderApps();
  }

  // ---- right: one app's items --------------------------------------------------------
  function openApp(app) {
    S.app = app;
    var u = new URL(location.href); u.searchParams.set("app", app); history.replaceState(null, "", u);
    renderApps();
    return showApp();
  }
  function write(op, args, okMsg) {
    args.app = S.app; args.confirm = true;
    tell("saving…");
    return api(op, args).then(function (r) {
      if (!r.ok) { tell(r.error || r._error || "failed", true); return; }
      tell(okMsg || (r.message || []).join(" "));
      return Promise.all([showApp(true), loadApps()]);
    }).catch(function (e) { tell(e.message, true); });
  }
  function showApp(keepStatus) {
    if (!S.app) { content.replaceChildren(node("p", "Pick an app on the left.", {"class": "td-empty"})); return Promise.resolve(); }
    if (!keepStatus) tell("");
    return api("list", {app: S.app, all: S.showDone}).then(function (r) {
      content.replaceChildren();
      if (!r.ok) { content.appendChild(node("p", r.error || r._error, {"class": "td-empty"})); return; }
      var items = r.items || [];
      var open = items.filter(function (i) { return !i.done; }).length;
      content.appendChild(node("h2", r.app));
      content.appendChild(node("p", r.path + "  ·  " + open + " open · " + (r.archived_done||0) + " archived", {"class": "td-path"}));
      var scope=r.app;
      api("checkpoint",{app:scope}).then(function(c){
        if(S.app!==scope||!c.ok)return;
        var summary=node("p",c.actionable+" actionable · "+c.wip+" WIP · "+c.blocked+" blocked"+(c.next?" · Next #"+c.next.id+": "+c.next.title:""),{"class":"td-path"});
        content.insertBefore(summary,content.children[2]||null);
        if(c.linked_jobs&&c.linked_jobs.length){var linked=node("p",c.linked_jobs.slice(-5).map(function(j){return "#"+j.task_id+" "+j.phase+" "+j.status+" ("+j.id+")";}).join(" · "),{"class":"td-path"});content.insertBefore(linked,summary.nextSibling);}
      });
      content.appendChild(addForm(items));
      var sd = node("label"); var cb = node("input", null, {type: "checkbox"}); cb.checked = S.showDone;
      cb.onchange = function () { S.showDone = cb.checked; showApp(); };
      sd.appendChild(cb); sd.appendChild(document.createTextNode(" show done items still in the file"));
      content.appendChild(sd);
      if (!items.length) { content.appendChild(node("p", "Nothing to do here.", {"class": "td-empty"})); return; }
      if (r.needs_ids) {
        var hint = node("p", "Some items have no #id yet (plain checkboxes), so they cannot be completed or noted here. ",
                        {"class": "td-path"});
        var nb = node("button", "Number items", {type: "button", "class": "btn"});
        nb.onclick = function () { write("number", {}, "items numbered"); };
        hint.appendChild(nb); content.appendChild(hint);
      }
      var sec = null;
      items.forEach(function (it) {
        var s = it.section || "";
        if (s !== sec) { sec = s; if (s) content.appendChild(node("div", s, {"class": "td-sec"})); }
        content.appendChild(itemEl(it));
      });
    }).catch(function (e) { tell(e.message, true); });
  }
  function addForm(items) {
    var f = node("form", null, {"class": "td-add"});
    var text = node("input", null, {name: "text", placeholder: "New TODO (one line)", required: "", maxlength: "500"});
    var secs = {}; items.forEach(function (i) { if (i.section) secs[i.section] = 1; });
    var section = node("input", null, {name: "section", placeholder: "section (optional)", list: "td-secs"});
    var dl = node("datalist", null, {id: "td-secs"});
    Object.keys(secs).forEach(function (s) { dl.appendChild(node("option", null, {value: s})); });
    var tag = node("select", null, {name: "tag"});
    ["", "P1", "P2", "P3"].forEach(function (t) { tag.appendChild(node("option", t || "priority", {value: t})); });
    var btn = node("button", "＋ Add", {type: "submit", "class": "btn primary"});
    f.onsubmit = function (e) {
      e.preventDefault();
      var a = {text: text.value.trim()};
      if (!a.text) return;
      if (section.value.trim()) a.section = section.value.trim();
      if (tag.value) a.tag = tag.value;
      write("add", a);
    };
    [text, section, dl, tag, btn].forEach(function (x) { f.appendChild(x); });
    return f;
  }
  function itemEl(it) {
    var row = node("div", null, {"class": "td-item" + (it.done ? " done" : "")});
    row.appendChild(node("span", it.id != null ? "#" + it.id : "–", {"class": "td-id"}));
    var t = node("div");
    if (it.state === "wip" || it.state === "blocked") t.appendChild(node("span", it.state, {"class": "td-badge " + it.state}));
    if (it.priority) t.appendChild(node("span", it.priority, {"class": "td-badge prio"}));
    t.appendChild(node("span", it.title || it.text, {"class": "t"}));
    row.appendChild(t);
    var acts = node("div", null, {"class": "td-acts"});
    if (!it.done && it.id != null) {
      var sel = node("select", null, {title: "state"});
      ["todo", "wip", "blocked"].forEach(function (s) {
        var o = node("option", s, {value: s}); if (s === it.state) o.selected = true; sel.appendChild(o);
      });
      sel.onchange = function () {
        if(it.managed&&sel.value==="done"){completionForm(row,it);sel.value=it.state;return;}
        if(sel.value==="wip"){write("begin",{id:it.id});return;}
        if(it.managed&&sel.value==="blocked"){blockForm(row,it);sel.value=it.state;return;}
        write("state", {id: it.id, state: sel.value});
      };
      var note = node("button", "✎ Note", {type: "button", "class": "btn"});
      note.onclick = function () { noteForm(row, it); };
      var done = node("button", "✓ Done", {type: "button", "class": "btn primary", title: "move it to the done trail"});
      done.onclick = function () { if(it.managed)completionForm(row,it);else write("done", {ids: [it.id]}, "#" + it.id + " done"); };
      [sel, note, done].forEach(function (x) { acts.appendChild(x); });
    }
    row.appendChild(acts);
    if ((it.notes || []).length) {
      var ul = node("ul", null, {"class": "td-notes"});
      it.notes.forEach(function (n) { ul.appendChild(node("li", n)); });
      row.appendChild(ul);
    }
    return row;
  }
  function completionForm(row,it){
    if(row.querySelector(".td-completion"))return;
    var f=node("form",null,{"class":"td-noteform td-completion"});f.style.flexWrap="wrap";
    var source=node("select",null,{"aria-label":"Verification source"});
    [["job","Linked successful test job"],["manual","Manual verification attestation"]].forEach(function(x){source.appendChild(node("option",x[1],{value:x[0]}));});
    var ref=node("input",null,{placeholder:"Test job ID",required:"required","aria-label":"Evidence reference"});
    source.onchange=function(){ref.placeholder=source.value==="job"?"Test job ID":"Concrete evidence reference";};
    var acceptance=node("input",null,{placeholder:"Acceptance criterion",required:"required"});
    var observed=node("input",null,{placeholder:"Actual observed result",required:"required"});
    var b=node("button","Complete with evidence",{type:"submit","class":"btn primary"});
    f.onsubmit=function(e){e.preventDefault();var a={id:it.id,source:source.value,acceptance:acceptance.value.trim(),observed:observed.value.trim()};a[source.value==="job"?"test_job":"evidence_ref"]=ref.value.trim();write("complete",a);};
    [source,ref,acceptance,observed,b].forEach(function(x){f.appendChild(x);});row.appendChild(f);
  }
  function blockForm(row,it){
    if(row.querySelector(".td-block"))return;
    var f=node("form",null,{"class":"td-noteform td-block"});
    var reason=node("input",null,{placeholder:"Concrete blocker",required:"required"});
    var b=node("button","Record blocker",{type:"submit","class":"btn"});
    f.onsubmit=function(e){e.preventDefault();var app=S.app,text=reason.value.trim();if(!text)return;api("note",{app:app,id:it.id,text:"Blocker: "+text,confirm:true}).then(function(r){if(!r.ok){tell(r.error||r._error,true);return;}if(S.app===app)write("state",{id:it.id,state:"blocked"});});};
    f.appendChild(reason);f.appendChild(b);row.appendChild(f);
  }
  function noteForm(row, it) {
    if (row.querySelector(".td-noteform")) return;
    var f = node("form", null, {"class": "td-noteform"});
    var inp = node("input", null, {placeholder: "Note for #" + it.id + " (dated automatically)", required: ""});
    var b = node("button", "Add note", {type: "submit", "class": "btn"});
    f.onsubmit = function (e) { e.preventDefault(); if (inp.value.trim()) write("note", {id: it.id, text: inp.value.trim()}); };
    f.appendChild(inp); f.appendChild(b);
    row.appendChild(f); inp.focus();
  }

  css();
  window.AppUIReady.then(function () {
    AppUI.createApp({
      id: "platform-tool_todo", title: "TODO",
      leftSidebar: {width: 300, tabs: [{id: "apps", label: "Apps", active: true, render: mountSide}]},
      content: {render: function (host) {
        var main = node("div", null, {"class": "td-main"});
        status = node("p", "", {role: "status", "class": "td-status"});
        content = node("section");
        main.appendChild(status); main.appendChild(content);
        host.appendChild(main);
        var want = new URLSearchParams(location.search).get("app");
        loadApps().then(function () {
          if (want) return openApp(want);
          var first = S.apps.filter(function (a) { return a.open; }).sort(function (x, y) { return y.open - x.open; })[0];
          return first ? openApp(first.app) : showApp();
        });
      }},
    });
  });
})();
