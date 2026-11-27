// platform/tool_kiro - the user's .kiro folders: MCP servers (enable -> catalog tools), skills, agents, steering, roots.
// AppUI conventions: AppUI.createApp (left sidebar = the vis://kiro tree, content = the selected node, status bar),
// AppUIRouter (?path=<vis path>; back/forward work), AppUI.services.api.operation for every op.
(function () {
  "use strict";
  var APP = "platform/tool_kiro", NS = "tool_kiro";
  var router = null, app = null, tree = null, body = null;

  function op(name, args) {
    return AppUI.services.api.operation(APP, name, args || {}).then(function (r) {
      if (r && r.ok === false && !r.dry_run) throw new Error(r.error || r._error || "request failed");
      return r;
    });
  }
  function el(tag, text, cls) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function status(t) { if (app && app.setStatus) app.setStatus(t); }
  function btn(host, label, fn, cls) {
    var b = el("button", label, cls || ""); b.type = "button";
    b.addEventListener("click", function () { b.disabled = true; Promise.resolve(fn()).finally(function () { b.disabled = false; }); });
    host.appendChild(b); return b;
  }
  function kv(host, pairs) {
    var g = el("div", null, "tk-kv");
    pairs.forEach(function (p) { if (p[1] === undefined || p[1] === null || p[1] === "" || (Array.isArray(p[1]) && !p[1].length)) return;
      g.appendChild(el("b", p[0])); g.appendChild(el("span", Array.isArray(p[1]) ? p[1].join(", ") : String(p[1]))); });
    host.appendChild(g);
  }
  function fail(e) { body.replaceChildren(el("p", "Failed: " + (e && e.message || e), "tk-bad")); status("error"); }
  function go(path) { router.set("path", path || "", {silent: true}); route(); }

  // ── views ────────────────────────────────────────────────────────────────────
  function route() {
    var p = router.get("path") || "";
    if (tree && p) { try { tree.expandTo(p); tree.setActive(p); } catch (_e) { /* not loaded yet */ } }
    body.replaceChildren(el("p", "loading…", "tk-dim"));
    var parts = p.split("/");
    if (!p) return viewOverview();
    if (parts[0] === "mcp" && parts.length === 2) return viewServer(parts[1]);
    if (parts[0] === "skills" && parts.length === 2) return viewSkill(parts[1]);
    if (parts[0] === "agents" && parts.length === 2) return viewAgent(parts[1]);
    if (parts[0] === "roots") return viewRoots();
    return viewNode(p);
  }

  function viewOverview() {
    op("overview").then(function (r) {
      body.replaceChildren(el("h2", "Your .kiro"));
      body.appendChild(el("p", "MCP servers, skills, agents and steering from every .kiro root - put to work across the platform: an enabled MCP server's tools join the Tool Catalog (mcp/<server>.<tool>) and every assistant; skills become guides; agents become chat personas (the 🪁 button in any AI chat).", "tk-dim"));
      var cards = el("div", null, "tk-cards");
      [["mcp", "MCP servers"], ["skills", "Skills"], ["agents", "Agents"], ["steering", "Steering"]].forEach(function (k) {
        var c = el("button", null, "tk-card"); c.type = "button";
        c.appendChild(el("b", String((r.counts || {})[k[0]] || 0))); c.appendChild(el("span", k[1]));
        c.addEventListener("click", function () { go(k[0]); }); cards.appendChild(c);
      });
      body.appendChild(cards);
      kv(body, [["enabled servers", r.enabled_servers], ["catalog tools published", r.published_tools]]);
      body.appendChild(el("h3", "Roots (lowest precedence first)"));
      var ul = el("ul");
      (r.roots || []).forEach(function (x) { ul.appendChild(el("li", x.label + "  —  " + x.root + (x.exists ? "" : "  (missing)"))); });
      body.appendChild(ul);
      if ((r.errors || []).length) { body.appendChild(el("h3", "Problems")); (r.errors || []).forEach(function (e) { body.appendChild(el("p", e, "tk-bad")); }); }
      var b = el("div", null, "tk-btns");
      btn(b, "Rescan", function () { return op("refresh", {confirm: true, connect: false}).then(function () { reloadTree(); route(); }); });
      btn(b, "Manage roots", function () { go("roots"); });
      body.appendChild(b);
      status((r.counts || {}).skills + " skills · " + (r.counts || {}).agents + " agents · " + (r.counts || {}).mcp + " MCP servers");
    }).catch(fail);
  }

  // OAuth sign-in for an http MCP server: the tab is opened INSIDE the click (popup blockers), pointed at the
  // authorize_url once mcp_signin answers; the server redirects back to this app's /oauth/callback.
  function signIn(name) {
    var w = window.open("about:blank", "_blank");
    status("starting sign-in for " + name + "…");
    return op("mcp_signin", {name: name, redirect_base: location.origin, confirm: true}).then(function (r) {
      if (!r.authorize_url) throw new Error(r._error || "no authorize_url");
      if (w) { w.opener = null; w.location.href = r.authorize_url; } else window.open(r.authorize_url, "_blank", "noopener");
      status("complete the sign-in in the opened tab…");
      if (r.mode === "loopback") pasteBack(name);
      var tries = 0;
      return new Promise(function (resolve) {
        (function poll() {
          op("mcp_auth_status", {name: name}).then(function (x) {
            if (x.state === "authenticated") { status(name + ": signed in" + (x.tools ? " · " + x.tools + " tools" : "")); reloadTree(); route(); resolve(); }
            else if (x.state === "error") { status(name + ": sign-in failed: " + (x.error || "")); resolve(); }
            else if (++tries < 150) setTimeout(poll, 2000);
            else { status(name + ": sign-in timed out"); resolve(); }
          }).catch(function () { resolve(); });
        })();
      });
    }).catch(function (e) { if (w) w.close(); status("sign-in failed: " + (e.message || e)); });
  }

  // #10: a loopback redirect (http://127.0.0.1:<port>/callback) only loads when the browser runs on the host's
  // machine; from a pod the tab ends on "can't connect" - its address still carries the code: paste it here.
  function pasteBack(name) {
    var box = el("div", null, "tk-btns");
    box.setAttribute("data-tk-paste", name);
    var inp = el("input"); inp.placeholder = "http://127.0.0.1:…/callback?code=…&state=…"; inp.style.flex = "1"; inp.style.minWidth = "320px";
    inp.setAttribute("aria-label", "the address the sign-in tab ended on");
    box.appendChild(el("span", "If the sign-in tab ends on a page that cannot load, paste its address:", "tk-dim"));
    box.appendChild(inp);
    btn(box, "Finish sign-in", function () {
      return op("mcp_signin_complete", {redirect_url: inp.value.trim(), confirm: true}).then(function (x) {
        status((x.server || name) + ": signed in"); box.remove(); reloadTree(); route();
      }).catch(fail);
    }, "primary");
    var old = body.querySelector("[data-tk-paste]"); if (old) old.remove();
    body.insertBefore(box, body.firstChild ? body.firstChild.nextSibling : null);
  }

  function viewServer(name) {
    op("server", {name: name}).then(function (r) {
      var s = r.server || {};
      body.replaceChildren();
      var h = el("div", null, "tk-head"); h.appendChild(el("h2", s.name));
      h.appendChild(el("span", s.enabled ? "enabled" : "off", "tk-pill" + (s.enabled ? " on" : "")));
      if (s.needs_auth) h.appendChild(el("span", "needs sign-in", "tk-pill bad"));
      if (s.needs_env) h.appendChild(el("span", "needs env", "tk-pill bad"));
      if (s.signed_in) h.appendChild(el("span", "signed in", "tk-pill on"));
      if (s.registry) h.appendChild(el("span", "registry: " + s.registry, "tk-pill"));
      body.appendChild(h);
      if (s.description) body.appendChild(el("p", s.description, "tk-dim"));
      kv(body, [["kind", s.kind], ["runs on", s.runs_on ? s.runs_on + " (over SSH)" : ""], ["url", s.url], ["command", s.command], ["args", s.args], ["env keys", s.env_keys],
                ["header keys", s.header_keys], ["auto-approve", s.auto_approve], ["from", s.scope + " — " + s.origin],
                ["last connected", s.checked ? new Date(s.checked * 1000).toLocaleString() : ""], ["last error", s.last_error]]);
      if (s.self_loop) body.appendChild(el("p", "This is the platform's own MCP server - it cannot be enabled here (it would re-export the platform into itself).", "tk-bad"));
      if (s.disabled) body.appendChild(el("p", "Disabled in its mcp.json (\"disabled\": true).", "tk-dim"));
      var b = el("div", null, "tk-btns");
      if (!s.self_loop && !s.disabled) {
        btn(b, s.enabled ? "Disable" : "Enable (connects)", function () {
          var turnOn = !s.enabled;
          var doIt = function () {
            status(turnOn ? "connecting to " + s.name + "…" : "disabling…");
            return op("mcp_enable", {name: s.name, enabled: turnOn, confirm: true}).then(function (x) {
              status(x.enabled ? (s.name + ": " + x.tools + " tools" + (x.error ? " · " + x.error : "")) : s.name + " disabled");
              reloadTree(); route();
            }).catch(fail);
          };
          if (!turnOn) return doIt();
          return new Promise(function (res) {
            AppUI.components.Dialog.confirm("Connect to the MCP server '" + s.name + "' (" + (s.url || s.command) + ") and add its tools to the catalog?", function () { doIt().then(res); });
          });
        }, s.enabled ? "" : "primary");
        if (s.enabled) btn(b, "Reconnect", function () { return op("mcp_refresh", {name: s.name, confirm: true}).then(function () { route(); }); });
      }
      if (s.can_sign_in && !s.self_loop) {
        if (s.signed_in) btn(b, "Sign out", function () { return op("mcp_signout", {name: s.name, confirm: true}).then(function () { status(s.name + ": signed out"); route(); }).catch(fail); });
        else btn(b, "Sign in (OAuth)", function () { return signIn(s.name); }, s.needs_auth ? "primary" : "");
      }
      if (s.scope !== "registry" && s.scope !== "agent" && /mcp\.json$/.test(s.origin || "")) {
        btn(b, "Remove from mcp.json", function () {
          return new Promise(function (res) {
            AppUI.components.Dialog.confirm("Remove '" + s.name + "' from " + s.origin + "?", function () {
              var root = s.scope === "extra" || s.scope === "remote" ? String(s.origin).replace(/[\\/]settings[\\/]mcp\.json$/, "") : s.scope;
              op("mcp_config", {action: "remove", name: s.name, root: root, confirm: true})
                .then(function () { status("removed " + s.name); reloadTree(); go("mcp"); res(); }).catch(function (e) { fail(e); res(); });
            });
          });
        });
      }
      body.appendChild(b);
      envEditor(s);
      body.appendChild(el("h3", "Tools (" + (r.tools || []).length + ")"));
      if (!(r.tools || []).length) body.appendChild(el("p", s.enabled ? "No tools listed (see the last error)." : "Enable the server to list its tools.", "tk-dim"));
      else {
        var box = el("div"); body.appendChild(box);
        if (s.policy_in) body.appendChild(el("p", "Tool policy (autoApprove / disabledTools) is saved in " + s.policy_in + ".", "tk-dim"));
        var patch = function (t, extra, label) {
          status(label + " " + t.name + "…");
          return op("mcp_config", Object.assign({action: "patch", name: s.name, tool: t.name, confirm: true}, extra))
            .then(function () { status(label + " " + t.name + " - saved"); route(); }).catch(fail);
        };
        AppUIDataTable.create({container: box, items: r.tools, stickyHeader: true, getId: function (t) { return t.name; },
          columns: [{id: "name", label: "Tool", sortable: true, filterable: true, width: "220px"},
                    {id: "safety", label: "Safety", sortable: true, width: "110px", render: function (t) {
                      return (t.disabled ? "off" : t.safety) + (t.auto_approved ? " (override)" : t.read_only_hint ? " (server hint)" : ""); }},
                    {id: "description", label: "What it does"},
                    {id: "act", label: "", actions: function (t) {
                      var a = [];
                      if (!t.read_only_hint || t.auto_approved)
                        a.push(t.auto_approved
                          ? {label: "Unmark read-only", title: "remove from autoApprove (calls need confirm again)", action: function () { return patch(t, {read_only: false}, "unmark"); }}
                          : {label: "Mark read-only", title: "add to autoApprove: the tool runs without a confirm (only for tools that never change anything)", action: function () {
                              return new Promise(function (res) {
                                AppUI.components.Dialog.confirm("Mark '" + t.name + "' read-only? Assistants will call it WITHOUT asking.", function () { patch(t, {read_only: true}, "mark").then(res); });
                              }); }});
                      a.push(t.disabled
                        ? {label: "Enable tool", action: function () { return patch(t, {tool_disabled: false}, "enable"); }}
                        : {label: "Disable tool", title: "add to disabledTools: hidden from the catalog and chats", action: function () { return patch(t, {tool_disabled: true}, "disable"); }});
                      if (t.id) a.push({label: "Try", title: "open in the Tool Catalog (Try-It)", action: function () { location.href = "/apps/platform/tool_catalog/?tool=" + encodeURIComponent(t.id); }});
                      return a;
                    }}]});
      }
      status(s.name);
    }).catch(fail);
  }

  function viewSkill(name) {
    op("skill", {name: name}).then(function (r) {
      var s = r.skill;
      body.replaceChildren();
      var h = el("div", null, "tk-head"); h.appendChild(el("h2", s.name)); h.appendChild(el("span", s.scope, "tk-pill")); body.appendChild(h);
      body.appendChild(el("p", s.description, "tk-dim"));
      kv(body, [["folder", s.path], ["files", s.files], ["shadows", s.shadows]]);
      body.appendChild(el("pre", s.body, "tk-pre"));
      if ((s.files || []).length) {
        body.appendChild(el("h3", "Bundled files"));
        var out = el("pre", "", "tk-pre"); out.hidden = true;
        var b = el("div", null, "tk-btns");
        s.files.filter(function (f) { return f.slice(-1) !== "/"; }).slice(0, 20).forEach(function (f) {
          btn(b, f, function () { return op("skill_file", {name: s.name, path: f}).then(function (x) { out.hidden = false; out.textContent = x.text; }).catch(fail); });
        });
        body.appendChild(b); body.appendChild(out);
      }
      status(s.name);
    }).catch(fail);
  }

  function viewAgent(name) {
    op("agent", {name: name}).then(function (a) {
      body.replaceChildren();
      var h = el("div", null, "tk-head"); h.appendChild(el("h2", a.name)); h.appendChild(el("span", a.scope_source, "tk-pill")); body.appendChild(h);
      body.appendChild(el("p", a.description, "tk-dim"));
      kv(body, [["platform tool scope", a.scope], ["Kiro-only tools", a.unmapped_tools], ["MCP servers", a.mcp_servers],
                ["needs enabling", a.needs_enable], ["resources read", a.resources], ["missing resources", a.missing_resources],
                ["model", a.model], ["file", a.file]]);
      body.appendChild(el("p", "Use it in any AI chat: the 🪁 button → Agent. Workflows can run it as an agent step (tool_runner).", "tk-dim"));
      (a.needs_enable || []).forEach(function (n) {
        var b = el("div", null, "tk-btns"); btn(b, "Open MCP server " + n, function () { go("mcp/" + n); }); body.appendChild(b);
      });
      body.appendChild(el("h3", "System prompt the chat receives"));
      body.appendChild(el("pre", a.system, "tk-pre"));
      status(a.name);
    }).catch(fail);
  }

  function viewRoots() {
    op("roots").then(function (r) {
      body.replaceChildren(el("h2", ".kiro roots"));
      body.appendChild(el("p", "Read lowest precedence first: a later root's skill/agent/server of the same name wins (project over home, like Kiro).", "tk-dim"));
      var box = el("div"); body.appendChild(box);
      AppUIDataTable.create({container: box, items: r.roots || [], stickyHeader: true, getId: function (x) { return x.root; },
        columns: [{id: "scope", label: "Scope", width: "100px"}, {id: "root", label: "Folder"},
                  {id: "exists", label: "Found", width: "70px", render: function (x) { return x.exists ? "yes" : "no"; }},
                  {id: "act", label: "", actions: function (x) {
                    return (x.scope === "extra" || x.scope === "remote") ? [{label: "Remove", action: function () {
                      var orig = x.scope === "remote" ? x.root : (((r.state || {}).extra_roots || []).filter(function (p) { return x.root.indexOf(p.replace(/[\\/]+$/, "")) === 0; })[0] || x.root);
                      op("roots_set", {action: "remove", path: orig, kind: x.scope === "remote" ? "remote" : "local", confirm: true}).then(function () { reloadTree(); route(); }).catch(fail);
                    }}] : [];
                  }}]});
      body.appendChild(el("h3", "Add a root"));
      var f = el("div", null, "tk-form");
      var inp = el("input"); inp.placeholder = "a project folder (or its .kiro), or vfs://ssh://host/home/me/.kiro"; inp.setAttribute("aria-label", "Root to add");
      f.appendChild(inp);
      var b = el("div", null, "tk-btns"); f.appendChild(b);
      btn(b, "Add", function () {
        var v = inp.value.trim(); if (!v) return;
        return op("roots_set", {action: "add", path: v, kind: v.indexOf("vfs://") === 0 ? "remote" : "local", confirm: true})
          .then(function () { reloadTree(); route(); status("root added"); }).catch(fail);
      }, "primary");
      body.appendChild(f);
      viewAddServer(r.roots || []);
      viewRegistries();
    }).catch(fail);
  }

  // "Add an MCP server" -> written into the chosen root's settings/mcp.json (the file Kiro reads too)
  function viewAddServer(roots) {
    body.appendChild(el("h3", "Add an MCP server"));
    var f = el("div", null, "tk-form");
    var nm = el("input"); nm.placeholder = "name"; nm.setAttribute("aria-label", "Server name");
    var tgt = el("input"); tgt.placeholder = "https://…/mcp   or   uvx my-mcp --flag"; tgt.setAttribute("aria-label", "URL or command");
    var sel = el("select"); sel.setAttribute("aria-label", "Write to which .kiro");
    roots.filter(function (x) { return x.exists || x.remote; }).forEach(function (x) {
      var o = el("option", x.scope + " — " + x.root); o.value = x.scope === "extra" || x.scope === "remote" ? x.root : x.scope; sel.appendChild(o);
    });
    f.appendChild(nm); f.appendChild(tgt); f.appendChild(sel);
    var b = el("div", null, "tk-btns"); f.appendChild(b);
    btn(b, "Add to mcp.json", function () {
      var name = nm.value.trim(), v = tgt.value.trim();
      if (!name || !v) { status("name and url/command required"); return; }
      var server;
      if (/^https?:\/\//i.test(v)) server = {url: v};
      else { var parts = v.split(/\s+/); server = {command: parts[0]}; if (parts.length > 1) server.args = parts.slice(1); }
      return op("mcp_config", {action: "add", name: name, server: server, root: sel.value, confirm: true})
        .then(function (x) { status("added " + name + " to " + x.file); reloadTree(); go("mcp/" + name); }).catch(fail);
    }, "primary");
    body.appendChild(f);
  }

  // MCP registries (catalogs: the Ericsson bnew allowlist + user-added); their servers enable like .kiro ones
  function viewRegistries() {
    var sec = el("div"); body.appendChild(sec);
    op("registries").then(function (r) {
      sec.appendChild(el("h3", "MCP registries"));
      sec.appendChild(el("p", "Catalogs of servers you can enable (lowest precedence: a .kiro server of the same name wins). Registry stdio servers run on the SSH host below.", "tk-dim"));
      var box = el("div"); sec.appendChild(box);
      AppUIDataTable.create({container: box, items: r.registries || [], stickyHeader: true, getId: function (x) { return x.id; },
        columns: [{id: "label", label: "Registry"}, {id: "servers", label: "Servers", width: "70px"},
                  {id: "fetched", label: "Fetched", width: "150px", render: function (x) { return x.fetched ? new Date(x.fetched * 1000).toLocaleString() : (x.error || "not yet"); }},
                  {id: "act", label: "", actions: function (x) {
                    var a = [{label: x.enabled ? "Disable" : "Enable", action: function () { return regSet({action: x.enabled ? "disable" : "enable", id: x.id}); }},
                             {label: "Refresh", action: function () { return regSet({action: "refresh", id: x.id}); }}];
                    if (!x.builtin) a.push({label: "Remove", action: function () { return regSet({action: "remove", id: x.id}); }});
                    return a;
                  }}]});
      var f = el("div", null, "tk-form");
      var host = el("input"); host.value = r.registry_host || ""; host.placeholder = "seli (an auth_ssh host/alias; empty = this machine)";
      host.setAttribute("aria-label", "Host registry stdio servers run on");
      f.appendChild(el("label", "Run registry stdio servers on")); f.appendChild(host);
      var b = el("div", null, "tk-btns"); f.appendChild(b);
      btn(b, "Save host", function () { return regSet({action: "host", host: host.value.trim()}); });
      sec.appendChild(f);
      var g = el("div", null, "tk-form");
      var rid = el("input"); rid.placeholder = "id"; rid.setAttribute("aria-label", "Registry id");
      var url = el("input"); url.placeholder = "https://…/registry.json"; url.setAttribute("aria-label", "Registry URL");
      g.appendChild(rid); g.appendChild(url);
      var b2 = el("div", null, "tk-btns"); g.appendChild(b2);
      btn(b2, "Add registry", function () {
        if (!rid.value.trim() || !url.value.trim()) { status("id and url required"); return; }
        return regSet({action: "add", id: rid.value.trim(), label: rid.value.trim(), url: url.value.trim()});
      });
      sec.appendChild(g);
    }).catch(function (e) { sec.appendChild(el("p", "registries: " + (e.message || e), "tk-bad")); });
  }
  function regSet(args) {
    status("updating registries…");
    return op("registries_set", Object.assign({confirm: true}, args)).then(function (x) {
      status(x.servers + " MCP servers"); reloadTree(); route();
    }).catch(fail);
  }

  // Env values of a stdio server (registry placeholders / missing ${VAR}s) - values are write-only
  function envEditor(s) {
    var rows = s.env || [];
    if (!rows.length) return;
    body.appendChild(el("h3", "Environment" + (s.needs_env ? " — needs values" : "")));
    var f = el("div", null, "tk-form"), inputs = {};
    rows.forEach(function (k) {
      var lab = el("label", k.name + (k.required ? " *" : "") + (k.set ? "  (set)" : ""));
      var inp = el("input"); inp.type = k.secret ? "password" : "text"; inp.autocomplete = "off";
      inp.placeholder = k.set ? "•••• (leave empty to keep)" : (k.required ? "required" : "optional");
      inp.setAttribute("aria-label", k.name); inputs[k.name] = inp;
      f.appendChild(lab); f.appendChild(inp);
    });
    var b = el("div", null, "tk-btns"); f.appendChild(b);
    btn(b, "Save env", function () {
      var values = {};
      Object.keys(inputs).forEach(function (n) { if (inputs[n].value) values[n] = inputs[n].value; });
      if (!Object.keys(values).length) { status("nothing to save"); return; }
      return op("mcp_env_set", {name: s.name, values: values, confirm: true}).then(function (x) {
        status(s.name + ": env saved" + (x.tools ? " · " + x.tools + " tools" : "")); route();
      }).catch(fail);
    }, "primary");
    btn(b, "Clear all", function () {
      return op("mcp_env_set", {name: s.name, clear: true, confirm: true}).then(function () { route(); }).catch(fail);
    });
    body.appendChild(f);
  }

  function viewNode(path) {                 // sections, steering, MCP tools: the VIS node itself
    op("vis_node", {path: path}).then(function (n) {
      body.replaceChildren();
      var h = el("div", null, "tk-head"); h.appendChild(el("h2", n.title)); h.appendChild(el("span", n.kind, "tk-pill")); body.appendChild(h);
      body.appendChild(el("p", n.description, "tk-dim"));
      if (n.attributes && n.attributes.catalog_id) {
        var b = el("div", null, "tk-btns");
        btn(b, "Try in the Tool Catalog", function () { location.href = "/apps/platform/tool_catalog/?tool=" + encodeURIComponent(n.attributes.catalog_id); }, "primary");
        body.appendChild(b);
      }
      if (n.content) body.appendChild(el("pre", n.content, "tk-pre"));
      if (n.has_children) {
        op("vis_children", {path: path, page_size: 200}).then(function (c) {
          var ul = el("ul");
          (c.children || []).forEach(function (x) {
            var li = el("li"); var a = el("a", x.title); a.href = "?path=" + encodeURIComponent(x.path);
            a.addEventListener("click", function (e) { e.preventDefault(); go(x.path); });
            li.appendChild(a); li.appendChild(el("span", "  " + (x.description || "").slice(0, 140), "tk-dim")); ul.appendChild(li);
          });
          body.appendChild(ul);
        });
      }
      status(n.title);
    }).catch(fail);
  }

  // ── left sidebar: the vis://kiro tree ────────────────────────────────────────
  function shape(x) { return {name: x.title, path: x.path, hasChildren: !!x.has_children, data: {badge: x.badge}}; }
  function reloadTree() {
    if (!tree) return;
    op("vis_children", {path: "", page_size: 50}).then(function (r) { tree.setRoots((r.children || []).map(shape)); });
  }
  function mountTree(host) {
    var box = el("div"); host.appendChild(box);
    tree = AppUI.components.Tree.create({container: box, searchable: true, searchPlaceholder: "Filter…", storageKey: "tool_kiro.tree",
      decorateRow: function (node, row) { var b = (node.data || {}).badge; if (b) row.appendChild(el("span", b, "tk-badge" + (b === "on" ? " on" : ""))); },
      onSelect: function (node) { go(node.path); },
      onExpand: function (node, done) {
        op("vis_children", {path: node.path, page_size: 200}).then(function (r) { done((r.children || []).map(shape)); }).catch(function () { done([]); });
      }});
    reloadTree();
    return function () { if (tree) tree.destroy(); tree = null; };
  }

  window.AppUIReady.then(function () {
    AppUIRouter.alias(NS, "path", "path");
    router = AppUIRouter.create(NS, route);
    app = AppUI.createApp({
      id: "platform-tool_kiro", title: "Tool Kiro", menubar: {theme: true}, statusBar: {},
      menu: {View: [{id: "home", label: "Overview"}, {id: "mcp", label: "MCP servers"}, {id: "skills", label: "Skills"},
                    {id: "agents", label: "Agents"}, {id: "roots", label: "Roots"}],
             Kiro: [{id: "rescan", label: "Rescan"}, {id: "reconnect", label: "Reconnect enabled servers"}],
             Open: [{id: "catalog", label: "Tool Catalog"}, {id: "guides", label: "Tool Guides"}]},
      onAction: function (_m, id) {
        if (id === "home") go("");
        else if (id === "rescan") op("refresh", {confirm: true, connect: false}).then(function () { reloadTree(); route(); });
        else if (id === "reconnect") op("mcp_refresh", {confirm: true}).then(function (r) { status("reconnected " + Object.keys(r.refreshed || {}).length + " server(s)"); route(); });
        else if (id === "catalog") location.href = "/apps/platform/tool_catalog/";
        else if (id === "guides") location.href = "/apps/platform/tool_guides/";
        else go(id);
      },
      leftSidebar: {width: 320, tabs: [{id: "kiro", label: ".kiro", active: true, render: mountTree}]},
      content: {body: function (host) { body = el("div", null, "tk-body"); host.replaceChildren(body); route(); }}
    });
  });
})();
