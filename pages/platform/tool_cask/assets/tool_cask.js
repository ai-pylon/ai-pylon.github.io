import { createArtifactBrowser } from "./cask/artifact-browser.js?v=2";

// platform/tool_cask — AppUI page. Served at /apps/platform/tool_cask/.
// Status + login probe + skill-version check + marketplace artifact DOWNLOAD
// (paste a cask-market URL -> fetched on the SSO host -> browser saves the file).
(function () {
  "use strict";
  var API = "/v1/apps/platform/tool_cask/";
  function api(op, args) {
    return fetch(API + op, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args || {}),
    }).then(function (r) { return r.json(); });
  }
  function el(tag, attrs, html) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (html != null) e.innerHTML = html;
    return e;
  }
  // Decode a base64 string to a Blob and trigger a browser "Save file".
  function saveB64(b64, filename) {
    var blob = AppUIFileUtils.blobFromBase64(b64 || "", "application/octet-stream");
    AppUICore.downloadBlob(blob, filename || "download.bin", { attach: true, revokeDelay: 1000 });
  }

  window.AppUIReady.then(function () {
    AppUI.createApp({
      id: "platform-tool_cask",
      title: "Tool Cask",
      content: {
        render: function (root) {
          root.innerHTML = "";
          var host = "seli";
          var loginCooldownUntil = 0; // #5: rate-limit debounce for Login

          // --- host + status row ---
          var top = el("div", { style: "display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px" });
          top.appendChild(el("label", null, "host:"));
          var hostInput = el("input", { value: host, style: "width:120px" });
          hostInput.value = host;
          hostInput.oninput = function () { host = hostInput.value.trim() || "seli"; };
          top.appendChild(hostInput);
          top.appendChild(mkBtn("Status", function () {
            return api("status", {}).then(show);
          }));
          top.appendChild(mkBtn("Login status", function () {
            return api("login_status", { host: host }).then(function (r) {
              show(r); renderLoginScope(r); return r;
            });
          }));
          top.appendChild(mkBtn("Login", function () {
            // #5: debounce — the token-URL mint is rate-limited, so block rapid
            // re-clicks for a cooldown after each attempt.
            if (loginCooldownUntil && Date.now() < loginCooldownUntil) {
              dlStatusTop.textContent = "⏳ please wait a moment before retrying login "
                + "(the token mint is rate-limited).";
              return;
            }
            loginCooldownUntil = Date.now() + 15000;
            dlStatusTop.textContent = "⏳ cask login on " + host + " (driving the managed Edge)…";
            return api("login", { host: host, confirm: true }).then(function (r) {
              show(r);
              if (r && r.rate_limited) {
                loginCooldownUntil = Date.now() + 60000; // back off harder
                dlStatusTop.innerHTML = "⏳ rate-limited — wait a minute and retry.";
                return;
              }
              if (r && r.already_authenticated) {
                dlStatusTop.innerHTML = "✅ already authenticated on " + host;
                return;
              }
              // auto=true: the server drove the managed Edge + clicked Approve.
              if (r && r.ok && (r.authenticated || r.read_authenticated)) {
                dlStatusTop.innerHTML = "✅ logged in automatically via the managed Edge" +
                  (r.write_authenticated ? " (read + write)." :
                   " (read scope; write/publish is a separate cask grant).");
                return;
              }
              // Fallback: auto didn't complete — give the user a CLICKABLE link
              // (an anchor they click = a user gesture, so no popup-blocker). We
              // do NOT window.open() here: that fires outside the click gesture
              // and the browser blocks it ("popup blocked").
              if (r && r.login_url) {
                dlStatusTop.innerHTML =
                  "🔑 auto-login didn't complete — " +
                  "<a href='" + r.login_url + "' target='_blank' rel='noopener'><b>click here to sign in</b></a>" +
                  " in your own browser (SSO), then click <b>Login status</b>." +
                  (r.error ? " <span style='color:#888'>(" + r.error + ")</span>" : "");
                // #7: auto-poll so the moment the user completes SSO in their
                // browser, the line flips to "signed in" without a manual click.
                autoPollLogin(8, 3000);
              } else {
                dlStatusTop.innerHTML = "❌ " + ((r && (r.error || r._error)) || "login failed");
              }
            });
          }));
          root.appendChild(top);
          var dlStatusTop = el("div", { style: "margin:4px 0 10px;font-size:13px;color:#bbb" }, "");
          root.appendChild(dlStatusTop);

          var statusBox = el("pre", { style: "background:#111;color:#ddd;padding:8px;border-radius:6px;max-height:200px;overflow:auto;white-space:pre-wrap" }, "…");
          function show(r) { statusBox.textContent = JSON.stringify(r, null, 2); return r; }
          root.appendChild(statusBox);

          // Summarize a login_status result into the top status line.
          function renderLoginScope(st) {
            if (!st) return;
            if (st.read_authenticated || st.authenticated) {
              dlStatusTop.innerHTML = "✅ signed in on " + host +
                (st.write_authenticated ? " (read + write)." :
                 " (read scope; write/publish is a separate cask grant).");
            } else if (st.needs_login) {
              dlStatusTop.innerHTML = "🔒 not signed in on " + host + " — click <b>Login</b>.";
            }
          }

          // #7: after Login / Download, briefly auto-poll login_status so the UI
          // reflects completion without a manual "Login status" click. Polls a
          // few times on a short interval, then stops (the server memoizes, so
          // these collapse cheaply). Cancels a prior poll before starting a new.
          var _pollTimer = null;
          function autoPollLogin(times, intervalMs) {
            if (_pollTimer) { clearTimeout(_pollTimer); _pollTimer = null; }
            var left = times || 5;
            function tick() {
              api("login_status", { host: host }).then(function (st) {
                renderLoginScope(st);
                if (st && (st.read_authenticated || st.authenticated)) return; // done
                if (--left > 0) _pollTimer = setTimeout(tick, intervalMs || 2500);
              });
            }
            _pollTimer = setTimeout(tick, intervalMs || 2500);
          }

          // --- MARKETPLACE panel: search -> install into the host's .kiro; installed; submit a skill folder ---
          root.appendChild(el("h3", { style: "margin:16px 0 6px" }, "Marketplace"));
          var mkRow = el("div", { style: "display:flex;gap:8px;flex-wrap:wrap;align-items:center" });
          var kindSel = el("select", { "aria-label": "kind" });
          ["skill", "agent", "all"].forEach(function (k) { var o = el("option", { value: k }, k === "all" ? "skills + agents" : k + "s"); kindSel.appendChild(o); });
          var qInput = el("input", { placeholder: "search (empty = all)", style: "flex:1;min-width:200px", "aria-label": "search the marketplace" });
          mkRow.appendChild(kindSel); mkRow.appendChild(qInput);
          var addRoot = el("label", { style: "font-size:12px" }, '<input type="checkbox" checked> show installs in Tool Kiro');
          var mkStatus = el("div", { style: "margin-top:6px;font-size:13px;color:#bbb" }, "");
          var mkBox = el("div", { style: "margin-top:6px" });
          function renderRows(items, installedMode) {
            mkBox.innerHTML = "";
            if (!items.length) { mkBox.appendChild(el("p", { style: "color:#888" }, installedMode ? "nothing installed" : "no matches")); return; }
            AppUIDataTable.create({ container: mkBox, items: items, stickyHeader: true, getId: function (x) { return x.kind + ":" + x.name; },
              columns: [{ id: "name", label: "Name", sortable: true, filterable: true, width: "200px" },
                        { id: "kind", label: "Kind", width: "60px" },
                        { id: "version", label: "Version", width: "80px" },
                        { id: "state", label: "Installed", width: "120px", render: function (x) {
                          if (installedMode || !x.installed) return installedMode ? "yes" : "";
                          return x.update_available ? "⬆ " + x.installed_version + " → " + x.version : "✓ " + (x.installed_version || "");
                        } },
                        { id: "description", label: "Description" },
                        { id: "act", label: "", actions: function (x) {
                          if (installedMode) return [{ label: "Uninstall", action: function () { return mkAct("uninstall", { kind: x.kind, name: x.name }); } }];
                          var inst = { kind: x.kind, name: x.name, add_root: addRoot.querySelector("input").checked };
                          if (x.update_available) return [{ label: "Update", action: function () { return mkAct("install", Object.assign({ version: x.version }, inst)); } },
                                                          { label: "Uninstall", action: function () { return mkAct("uninstall", { kind: x.kind, name: x.name }); } }];
                          if (x.installed) return [{ label: "Uninstall", action: function () { return mkAct("uninstall", { kind: x.kind, name: x.name }); } }];
                          return [{ label: "Install", action: function () { return mkAct("install", inst); } }];
                        } }] });
          }
          function mkAct(opName, args) {
            mkStatus.textContent = "⏳ " + opName + " " + args.name + " on " + host + "…";
            return api(opName, Object.assign({ host: host, confirm: true }, args)).then(function (r) {
              show(r);
              if (r && r.needs_login) { mkStatus.innerHTML = "🔒 not signed in on " + host + " — click <b>Login</b>."; return; }
              mkStatus.innerHTML = (r && r.ok ? "✅ " : "❌ ") + opName + " " + args.name +
                (r && r.kiro_root ? " → " + r.kiro_root + (r.root_added ? " (added to Tool Kiro)" : "") : "") +
                (r && !r.ok ? " — " + (r.error || r._error || "failed") : "");
            });
          }
          mkRow.appendChild(mkBtn("Search", function () {
            mkStatus.textContent = "⏳ searching on " + host + "…";
            return api("search", { kind: kindSel.value, query: qInput.value.trim(), host: host }).then(function (r) {
              show(r);
              if (r && r.needs_login) { mkStatus.innerHTML = "🔒 not signed in on " + host + " — click <b>Login</b>."; renderRows([], false); return; }
              mkStatus.textContent = (r.items || []).length + " " + (kindSel.value === "all" ? "items" : kindSel.value + "s") +
                ((r.items || []).filter(function (x) { return x.update_available; }).length ? " · updates available" : "");
              renderRows(r.items || [], false);
            });
          }));
          mkRow.appendChild(mkBtn("Installed", function () {
            var kinds = kindSel.value === "all" ? ["skill", "agent"] : [kindSel.value];
            return Promise.all(kinds.map(function (k) { return api("installed", { kind: k, host: host }); })).then(function (rs) {
              var items = [];
              rs.forEach(function (r) { show(r); items = items.concat((r && r.items) || []); });
              mkStatus.textContent = items.length + " installed on " + host;
              renderRows(items, true);
            });
          }));
          mkRow.appendChild(addRoot);
          root.appendChild(mkRow); root.appendChild(mkStatus); root.appendChild(mkBox);
          var subRow = el("div", { style: "display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px" });
          var subSrc = el("input", { placeholder: "skill folder with SKILL.md: local path, vfs://ssh://host/path, or a path on the host",
                                     style: "flex:1;min-width:340px", "aria-label": "skill folder to submit" });
          var subVer = el("input", { placeholder: "version (auto)", style: "width:110px", "aria-label": "version" });
          subRow.appendChild(subSrc); subRow.appendChild(subVer);
          subRow.appendChild(mkBtn("Submit skill", function () {
            var src = subSrc.value.trim(); if (!src) { mkStatus.textContent = "enter a skill folder"; return; }
            return new Promise(function (res) {
              AppUI.components.Dialog.confirm("Publish " + src + " to the CASK marketplace?", function () {
                mkStatus.textContent = "⏳ submitting " + src + "…";
                api("submit", { source: src, version: subVer.value.trim() || undefined, host: host, confirm: true }).then(function (r) {
                  show(r);
                  mkStatus.innerHTML = r && r.ok ? "✅ submitted " + (r.skill || "") + "@" + (r.version || "") +
                    (r.marketplace_url ? ' — <a target="_blank" rel="noopener" href="' + r.marketplace_url + '">marketplace</a>' : "") +
                    " (needs approval before others see it)" : "❌ " + ((r && (r.error || r._error)) || "submit failed");
                  res();
                }, function () { res(); });
              });
            });
          }));
          root.appendChild(subRow);

          // --- DOWNLOAD panel (the main feature) ---
          root.appendChild(el("h3", { style: "margin:16px 0 6px" }, "Download marketplace artifact"));
          root.appendChild(el("p", { style: "color:#888;font-size:12px;margin:0 0 8px" },
            "Paste a <code>cask-market.ericsson.net</code> URL (e.g. " +
            "<code>https://cask-market.ericsson.net/agents/fia-agent/latest</code>). " +
            "It's fetched on the host where the Cloudflare Access SSO lives, then your browser saves it."));
          var dlRow = el("div", { style: "display:flex;gap:8px;flex-wrap:wrap;align-items:center" });
          var urlInput = el("input", {
            placeholder: "https://cask-market.ericsson.net/agents/fia-agent/latest",
            style: "flex:1;min-width:340px",
          });
          dlRow.appendChild(urlInput);
          var dlBtn = el("button", null, "Download");
          dlRow.appendChild(dlBtn);
          root.appendChild(dlRow);
          var dlStatus = el("div", { style: "margin-top:8px;font-size:13px;color:#bbb" }, "");
          root.appendChild(dlStatus);

          function fmtBytes(n) {
            if (n == null) return "";
            if (n < 1024) return n + " B";
            if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
            return (n / 1048576).toFixed(2) + " MB";
          }

          var artifactBrowser = createArtifactBrowser({ api: api, el: el, fmtBytes: fmtBytes, root: root });
          function refreshDownloads() { return artifactBrowser.refreshDownloads(); }

          dlBtn.onclick = function () {
            var url = urlInput.value.trim();
            if (!url) { dlStatus.textContent = "Paste a marketplace URL first."; return; }
            dlBtn.disabled = true;
            dlStatus.textContent = "⏳ downloading on " + host + " (this can take a bit over SSH)…";
            api("download", { url: url, host: host }).then(function (r) {
              dlBtn.disabled = false;
              if (!r || !r.ok) {
                dlStatus.innerHTML = "❌ " + ((r && (r.error || r._error)) || "download failed");
                show(r || {});
                if (r && r.needs_login) autoPollLogin(8, 3000); // #7
                return;
              }
              if (r.too_large_to_stream) {
                dlStatus.innerHTML = "⚠️ " + r.note;
                show(r);
                return;
              }
              // #15/#8: prefer the same-origin download_url (zero-copy stream,
              // no base64) — navigate an <a download> to it. Fall back to the
              // base64 Blob save only if the server returned inline bytes.
              if (r.download_url) {
                var a = document.createElement("a");
                a.href = r.download_url; a.download = r.filename || "artifact.bin";
                document.body.appendChild(a); a.click();
                setTimeout(function () { a.remove(); }, 1000);
                dlStatus.innerHTML = "✅ saved <b>" + (r.filename || "artifact") + "</b> (" +
                  (r.bytes != null ? r.bytes + " bytes" : "") + ")";
                refreshDownloads();
              } else if (r.b64) {
                saveB64(r.b64, r.filename);
                dlStatus.innerHTML = "✅ saved <b>" + (r.filename || "artifact") + "</b> (" +
                  (r.bytes != null ? r.bytes + " bytes" : "") + ")" +
                  (r.truncated ? " <span style='color:#e80'>(truncated — exceeded cap)</span>" : "");
              } else {
                dlStatus.innerHTML = "⚠️ download reported ok but returned no file";
              }
              show(r);
            }).catch(function (e) {
              dlBtn.disabled = false;
              dlStatus.textContent = "❌ " + e;
            });
          };

          // --- skill version check ---
          root.appendChild(el("h3", { style: "margin:16px 0 6px" }, "Skill version (installed vs marketplace)"));
          var skRow = el("div", { style: "display:flex;gap:8px;align-items:center" });
          var skInput = el("input", { value: "sysdoc-converter", style: "width:220px" });
          skInput.value = "sysdoc-converter";
          skRow.appendChild(el("label", null, "skill:"));
          skRow.appendChild(skInput);
          skRow.appendChild(mkBtn("Check", function () {
            return api("status_skill", { host: host, skill: skInput.value.trim() }).then(show);
          }));
          root.appendChild(skRow);

          // initial status — ONE round-trip (#21): bootstrap returns service
          // status + hosts + the login scope for the default host, so first
          // paint is a single POST rather than status + login_status separately.
          api("bootstrap", { host: host }).then(function (r) {
            show(r);
            if (r && r.login) {
              renderLoginScope(r.login);
            }
          });
          refreshDownloads();

          function mkBtn(label, fn) {
            var b = el("button", null, label);
            b.onclick = function () { b.disabled = true; Promise.resolve(fn()).finally(function () { b.disabled = false; }); };
            return b;
          }
        },
      },
    });
  });
})();
