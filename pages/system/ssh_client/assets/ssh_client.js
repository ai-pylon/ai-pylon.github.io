// SSH Client — AppUI management page for system/ssh_client.
(function () {
  var APP = "system/ssh_client";
  var defaultOs = /Win/i.test(navigator.platform || navigator.userAgent || "") ? "windows" : "unix";
  var state = {
    tab: "gce",
    os: defaultOs,
    status: null,
    instances: [],
    hosts: [],
    keys: [],
    guide: {
      alias: "",
      host: "",
      user: "",
      port: 22,
      keyName: "gce_ed25519"
    }
  };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function keyBasename(pathStr) {
    if (!pathStr) return "";
    var parts = String(pathStr).replace(/\\/g, "/").split("/");
    return parts[parts.length - 1] || "";
  }

  async function callOp(op, body, confirm) {
    var payload = Object.assign({}, body || {});
    if (confirm) payload.confirm = true;
    var response = await window.AppUIApi.requestResponse(
      "/v1/apps/" + APP + "/" + op,
      payload,
      {
        method: "POST",
        timeout: null,
        decode: function (result) { return result.json(); }
      }
    );
    return response.data;
  }

  async function copyText(text, app) {
    try {
      if (window.AppUIClipboard && typeof window.AppUIClipboard.writeText === "function") {
        await window.AppUIClipboard.writeText(text);
      } else if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      }
      app.setStatus("Copied to clipboard.");
    } catch (err) {
      app.setStatus("Copy failed: " + err);
    }
  }

  function triggerFileDownload(filename, content) {
    var blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  async function downloadKey(name, part, app) {
    if (!name) {
      app.setStatus("Select or enter a key name first.");
      return;
    }
    var isPrivate = part !== "public";
    var promptMsg = isPrivate
      ? "Download PRIVATE SSH key '" + name + "' to this computer?\nKeep this file secret and restrict its file permissions."
      : "Download public SSH key '" + name + ".pub'?";
    if (!window.confirm(promptMsg)) return;
    app.setStatus("Downloading " + name + (isPrivate ? "" : ".pub") + "...");
    var res = await callOp("key_download", { name: name, part: isPrivate ? "private" : "public" }, true);
    if (!res || !res.ok) {
      app.setStatus("Download failed: " + ((res && res.error) || "unknown error"));
      return;
    }
    triggerFileDownload(res.filename, res.content);
    app.setStatus("Downloaded " + res.filename + ".");
  }

  function mountShell(el) {
    el.innerHTML =
      '<div class="sshc-wrap">' +
        '<div class="sshc-banner" id="sshc-banner">Loading SSH client status...</div>' +
        '<div class="sshc-tabs" role="tablist">' +
          '<button class="sshc-tab active" data-tab="gce" type="button">GCE Instances</button>' +
          '<button class="sshc-tab" data-tab="hosts" type="button">SSH Hosts</button>' +
          '<button class="sshc-tab" data-tab="keys" type="button">SSH Keys</button>' +
          '<button class="sshc-tab" data-tab="guide" type="button">Client Setup Guide</button>' +
          '<button class="sshc-tab" data-tab="exec" type="button">Remote Exec</button>' +
        '</div>' +

        '<section id="sshc-panel-gce" class="sshc-card">' +
          '<div class="sshc-card-head">' +
            '<h2>GCE Instances</h2>' +
            '<div class="sshc-actions">' +
              '<button class="sshc-btn" id="sshc-refresh-gce" type="button">Refresh Instances</button>' +
            '</div>' +
          '</div>' +
          '<div class="sshc-table-wrap" id="sshc-gce-table"></div>' +
          '<form class="sshc-form" id="sshc-gce-form">' +
            '<label class="sshc-field">Instance<input name="instance" required placeholder="instance-name"></label>' +
            '<label class="sshc-field">Zone (optional)<input name="zone" placeholder="us-central1-f"></label>' +
            '<label class="sshc-field">Linux User<input name="user" placeholder="frontjang"></label>' +
            '<label class="sshc-field">Key Name<input name="key_name" value="gce_ed25519"></label>' +
            '<label class="sshc-field">Host Alias (optional)<input name="host_alias" placeholder="defaults to instance"></label>' +
            '<button class="sshc-btn primary" type="submit">Setup SSH Key</button>' +
          '</form>' +
          '<pre class="sshc-output sshc-hidden" id="sshc-gce-out"></pre>' +
        '</section>' +

        '<section id="sshc-panel-hosts" class="sshc-card sshc-hidden">' +
          '<div class="sshc-card-head">' +
            '<h2>Configured SSH Hosts (~/.ssh/config)</h2>' +
            '<button class="sshc-btn" id="sshc-refresh-hosts" type="button">Refresh Hosts</button>' +
          '</div>' +
          '<div class="sshc-table-wrap" id="sshc-hosts-table"></div>' +
          '<form class="sshc-form" id="sshc-host-form">' +
            '<label class="sshc-field">Alias<input name="alias" required placeholder="my-vm"></label>' +
            '<label class="sshc-field">HostName / IP<input name="host_name" required placeholder="104.154.100.135"></label>' +
            '<label class="sshc-field">User<input name="user" required placeholder="frontjang"></label>' +
            '<label class="sshc-field">Port<input name="port" type="number" value="22" min="1" max="65535"></label>' +
            '<label class="sshc-field">Key Name<input name="key_name" value="gce_ed25519"></label>' +
            '<button class="sshc-btn primary" type="submit">Save Host</button>' +
          '</form>' +
          '<pre class="sshc-output sshc-hidden" id="sshc-host-out"></pre>' +
        '</section>' +

        '<section id="sshc-panel-keys" class="sshc-card sshc-hidden">' +
          '<div class="sshc-card-head">' +
            '<h2>SSH Keys (~/.ssh)</h2>' +
            '<button class="sshc-btn" id="sshc-refresh-keys" type="button">Refresh Keys</button>' +
          '</div>' +
          '<div class="sshc-table-wrap" id="sshc-keys-table"></div>' +
          '<form class="sshc-form" id="sshc-key-form">' +
            '<label class="sshc-field">Key Name<input name="name" required value="gce_ed25519"></label>' +
            '<label class="sshc-field">Comment (optional)<input name="comment" placeholder="frontjang@gce"></label>' +
            '<button class="sshc-btn primary" type="submit">Generate ed25519 Key</button>' +
          '</form>' +
          '<pre class="sshc-output sshc-hidden" id="sshc-key-out"></pre>' +
        '</section>' +

        '<section id="sshc-panel-guide" class="sshc-card sshc-hidden">' +
          '<div class="sshc-card-head">' +
            '<h2>Local SSH Client Setup Guide</h2>' +
            '<div class="sshc-os-switch">' +
              '<button class="sshc-os-btn' + (state.os === "windows" ? " active" : "") + '" data-os="windows" type="button">Windows (PowerShell)</button>' +
              '<button class="sshc-os-btn' + (state.os === "unix" ? " active" : "") + '" data-os="unix" type="button">macOS / Linux</button>' +
            '</div>' +
          '</div>' +
          '<div class="sshc-form" id="sshc-guide-form">' +
            '<label class="sshc-field">Preset Target<select id="sshc-guide-preset"></select></label>' +
            '<label class="sshc-field">SSH Key<select id="sshc-guide-key"></select></label>' +
            '<label class="sshc-field">Host Alias<input id="sshc-guide-alias" placeholder="instance-name"></label>' +
            '<label class="sshc-field">HostName / IP<input id="sshc-guide-host" placeholder="104.154.100.135"></label>' +
            '<label class="sshc-field">User<input id="sshc-guide-user" placeholder="frontjang"></label>' +
            '<label class="sshc-field">Port<input id="sshc-guide-port" type="number" value="22" min="1" max="65535"></label>' +
          '</div>' +
          '<div class="sshc-guide-steps" id="sshc-guide-steps"></div>' +
        '</section>' +

        '<section id="sshc-panel-exec" class="sshc-card sshc-hidden">' +
          '<div class="sshc-card-head"><h2>Remote Command Execution</h2></div>' +
          '<form class="sshc-form" id="sshc-exec-form">' +
            '<label class="sshc-field">Host Alias<select name="alias" id="sshc-exec-alias"></select></label>' +
            '<label class="sshc-field">Timeout (s)<input name="timeout" type="number" value="30" min="1" max="120"></label>' +
            '<label class="sshc-field" style="grid-column: 1 / -1">Command<input name="command" required placeholder="whoami && uptime"></label>' +
            '<button class="sshc-btn primary" type="submit">Run Command</button>' +
          '</form>' +
          '<pre class="sshc-output sshc-hidden" id="sshc-exec-out"></pre>' +
        '</section>' +
      '</div>';
    return el;
  }

  function showOut(root, selector, text) {
    var el = root.querySelector(selector);
    el.textContent = text;
    el.classList.remove("sshc-hidden");
  }

  function renderBanner(root) {
    var b = root.querySelector("#sshc-banner");
    var s = state.status;
    if (!s || !s.ok) {
      b.innerHTML = '<span class="sshc-pill bad">Error: ' + esc(s && s.error || "unavailable") + '</span>';
      return;
    }
    var t = s.tools || {};
    var g = s.gcloud || {};
    b.innerHTML =
      '<span class="sshc-pill ' + (t.ssh ? "ok" : "bad") + '">ssh: ' + (t.ssh ? "ok" : "missing") + '</span>' +
      '<span class="sshc-pill ' + (t.ssh_keygen ? "ok" : "bad") + '">ssh-keygen: ' + (t.ssh_keygen ? "ok" : "missing") + '</span>' +
      '<span class="sshc-pill ' + (t.gcloud ? "ok" : "warn") + '">gcloud: ' + (t.gcloud ? "ok" : "missing") + '</span>' +
      (g.project ? '<span class="sshc-pill">project: ' + esc(g.project) + '</span>' : "") +
      '<span class="sshc-pill">keys: ' + esc(s.key_count) + '</span>' +
      '<span class="sshc-pill">hosts: ' + esc(s.host_count) + '</span>';
  }

  function renderGce(root) {
    var box = root.querySelector("#sshc-gce-table");
    if (!state.instances.length) {
      box.innerHTML = '<div class="sshc-empty">No GCE instances returned (or gcloud unavailable).</div>';
      return;
    }
    var rows = state.instances.map(function (inst) {
      var stCls = inst.status === "RUNNING" ? "ok" : "warn";
      return (
        '<tr>' +
          '<td class="sshc-mono">' + esc(inst.name) + '</td>' +
          '<td>' + esc(inst.zone) + '</td>' +
          '<td><span class="sshc-pill ' + stCls + '">' + esc(inst.status) + '</span></td>' +
          '<td class="sshc-mono">' + esc(inst.external_ip || "—") + '</td>' +
          '<td class="sshc-mono">' + esc(inst.internal_ip || "—") + '</td>' +
          '<td class="sshc-mono">' + esc(inst.configured_alias || "—") + '</td>' +
          '<td><div class="sshc-actions">' +
            '<button class="sshc-btn primary" data-gce-fill="' + esc(inst.name) + '" data-gce-zone="' + esc(inst.zone) + '" type="button">Prepare Setup</button>' +
            '<button class="sshc-btn" data-open-guide-alias="' + esc(inst.configured_alias || inst.name) + '" data-open-guide-host="' + esc(inst.external_ip || "") + '" type="button">Client Guide</button>' +
            (inst.configured_alias ? '<button class="sshc-btn" data-test-alias="' + esc(inst.configured_alias) + '" type="button">Test</button>' : "") +
          '</div></td>' +
        '</tr>'
      );
    }).join("");
    box.innerHTML =
      '<table class="sshc-table"><thead><tr>' +
      '<th>Instance</th><th>Zone</th><th>Status</th><th>External IP</th><th>Internal IP</th><th>SSH Alias</th><th>Actions</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function renderHosts(root) {
    var box = root.querySelector("#sshc-hosts-table");
    var select = root.querySelector("#sshc-exec-alias");
    select.innerHTML = state.hosts.map(function (h) {
      return '<option value="' + esc(h.alias) + '">' + esc(h.alias) + ' (' + esc(h.user || "?") + '@' + esc(h.host_name || "?") + ')</option>';
    }).join("") || '<option value="">(no configured hosts)</option>';

    if (!state.hosts.length) {
      box.innerHTML = '<div class="sshc-empty">No hosts configured in ~/.ssh/config yet.</div>';
      return;
    }
    var rows = state.hosts.map(function (h) {
      return (
        '<tr>' +
          '<td class="sshc-mono">' + esc(h.alias) + (h.managed ? ' <span class="sshc-pill ok">managed</span>' : '') + '</td>' +
          '<td class="sshc-mono">' + esc(h.user ? h.user + "@" + h.host_name : h.host_name) + (h.port && h.port !== 22 ? ":" + esc(h.port) : "") + '</td>' +
          '<td class="sshc-mono">' + esc(h.identity_file || "default") + '</td>' +
          '<td><div class="sshc-actions">' +
            '<button class="sshc-btn" data-copy-cmd="' + esc(h.connect_cmd) + '" type="button">Copy ssh</button>' +
            '<button class="sshc-btn" data-open-guide-alias="' + esc(h.alias) + '" data-open-guide-host="' + esc(h.host_name || "") + '" data-open-guide-user="' + esc(h.user || "") + '" data-open-guide-port="' + esc(h.port || 22) + '" data-open-guide-key="' + esc(keyBasename(h.identity_file)) + '" type="button">Client Guide</button>' +
            '<button class="sshc-btn" data-test-alias="' + esc(h.alias) + '" type="button">Test</button>' +
            (h.managed ? '<button class="sshc-btn danger" data-del-alias="' + esc(h.alias) + '" type="button">Delete</button>' : '') +
          '</div></td>' +
        '</tr>'
      );
    }).join("");
    box.innerHTML =
      '<table class="sshc-table"><thead><tr>' +
      '<th>Alias</th><th>Target</th><th>Identity File</th><th>Actions</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function renderKeys(root) {
    var box = root.querySelector("#sshc-keys-table");
    if (!state.keys.length) {
      box.innerHTML = '<div class="sshc-empty">No public SSH keys found in ~/.ssh.</div>';
      return;
    }
    var rows = state.keys.map(function (k) {
      return (
        '<tr>' +
          '<td class="sshc-mono">' + esc(k.name) + '</td>' +
          '<td>' + esc(k.type) + '</td>' +
          '<td class="sshc-mono">' + esc(k.fingerprint || "—") + '</td>' +
          '<td>' + esc(k.comment || "—") + '</td>' +
          '<td><div class="sshc-actions">' +
            (k.has_private ? '<button class="sshc-btn primary" data-dl-key="' + esc(k.name) + '" data-dl-part="private" type="button">Download Private</button>' : '') +
            '<button class="sshc-btn" data-dl-key="' + esc(k.name) + '" data-dl-part="public" type="button">Download .pub</button>' +
            '<button class="sshc-btn" data-copy-pub="' + esc(k.public_key) + '" type="button">Copy .pub</button>' +
            '<button class="sshc-btn" data-guide-key="' + esc(k.name) + '" type="button">Setup Guide</button>' +
          '</div></td>' +
        '</tr>'
      );
    }).join("");
    box.innerHTML =
      '<table class="sshc-table"><thead><tr>' +
      '<th>Name</th><th>Type</th><th>Fingerprint</th><th>Comment</th><th>Actions</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function syncGuideSelects(root) {
    var presetSel = root.querySelector("#sshc-guide-preset");
    var keySel = root.querySelector("#sshc-guide-key");
    var options = ['<option value="">-- Custom / Select target --</option>'];
    state.instances.forEach(function (inst) {
      options.push(
        '<option value="gce:' + esc(inst.name) + '">[GCE] ' + esc(inst.name) +
        (inst.external_ip ? " (" + esc(inst.external_ip) + ")" : " (" + esc(inst.status) + ")") + '</option>'
      );
    });
    state.hosts.forEach(function (h) {
      options.push(
        '<option value="host:' + esc(h.alias) + '">[Host] ' + esc(h.alias) +
        (h.host_name ? " (" + esc(h.host_name) + ")" : "") + '</option>'
      );
    });
    presetSel.innerHTML = options.join("");

    var keyOpts = state.keys.map(function (k) {
      return '<option value="' + esc(k.name) + '">' + esc(k.name) + (k.has_private ? "" : " (pub only)") + '</option>';
    });
    if (!keyOpts.length) {
      keyOpts.push('<option value="gce_ed25519">gce_ed25519 (generate first)</option>');
    }
    keySel.innerHTML = keyOpts.join("");

    var defaultUser = (state.status && state.status.default_user) || "frontjang";
    if (!state.guide.alias && state.instances.length) {
      var first = state.instances.find(function (i) { return i.external_ip; }) || state.instances[0];
      state.guide.alias = first.configured_alias || first.name;
      state.guide.host = first.external_ip || "";
      state.guide.user = defaultUser;
    }
    if (!state.guide.user) state.guide.user = defaultUser;
    if (state.keys.length && !state.keys.some(function (k) { return k.name === state.guide.keyName; })) {
      state.guide.keyName = state.keys[0].name;
    }

    keySel.value = state.guide.keyName;
    root.querySelector("#sshc-guide-alias").value = state.guide.alias;
    root.querySelector("#sshc-guide-host").value = state.guide.host;
    root.querySelector("#sshc-guide-user").value = state.guide.user;
    root.querySelector("#sshc-guide-port").value = String(state.guide.port || 22);
    renderGuideSteps(root);
  }

  function renderGuideSteps(root) {
    var box = root.querySelector("#sshc-guide-steps");
    var alias = (state.guide.alias || "my-vm").trim();
    var host = (state.guide.host || "<EXTERNAL_IP>").trim();
    var user = (state.guide.user || "frontjang").trim();
    var port = Number(state.guide.port || 22);
    var keyName = (state.guide.keyName || "gce_ed25519").trim();
    var keyObj = state.keys.find(function (k) { return k.name === keyName; });
    var isWin = state.os === "windows";

    var identityPath = isWin ? "~/.ssh/" + keyName : "~/.ssh/" + keyName;
    var configLines = [
      "Host " + alias,
      "    HostName " + host,
      "    User " + user
    ];
    if (port && port !== 22) configLines.push("    Port " + port);
    configLines.push("    IdentityFile " + identityPath);
    configLines.push("    IdentitiesOnly yes");
    configLines.push("    ServerAliveInterval 60");
    var configBlock = configLines.join("\n");

    var movePermCmd = isWin
      ? [
          'New-Item -ItemType Directory -Force "$env:USERPROFILE\\.ssh" | Out-Null',
          'Move-Item -Force "$env:USERPROFILE\\Downloads\\' + keyName + '" "$env:USERPROFILE\\.ssh\\' + keyName + '"',
          'icacls "$env:USERPROFILE\\.ssh\\' + keyName + '" /inheritance:r /grant:r "$($env:USERNAME):R"'
        ].join("\n")
      : [
          "mkdir -p ~/.ssh && chmod 700 ~/.ssh",
          'mv ~/Downloads/' + keyName + ' ~/.ssh/' + keyName,
          "chmod 600 ~/.ssh/" + keyName
        ].join("\n");

    var appendConfigCmd = isWin
      ? [
          "$cfg = @'",
          "",
          configBlock,
          "'@",
          'Add-Content -Path "$env:USERPROFILE\\.ssh\\config" -Value $cfg -Encoding UTF8'
        ].join("\n")
      : [
          "cat <<'EOF' >> ~/.ssh/config",
          "",
          configBlock,
          "EOF",
          "chmod 600 ~/.ssh/config"
        ].join("\n");

    var configPathHint = isWin ? "%USERPROFILE%\\.ssh\\config (예: C:\\Users\\<사용자>\\.ssh\\config)" : "~/.ssh/config";
    var portFlag = port && port !== 22 ? " -p " + port : "";
    var connectCmds = [
      "# ~/.ssh/config 설정 후 간단 접속",
      "ssh " + alias,
      "",
      "# 또는 config 없이 키 경로를 직접 지정해 접속",
      isWin
        ? 'ssh -i "$env:USERPROFILE\\.ssh\\' + keyName + '"' + portFlag + " " + user + "@" + host
        : "ssh -i ~/.ssh/" + keyName + portFlag + " " + user + "@" + host
    ].join("\n");

    box.innerHTML =
      '<div class="sshc-warn-box">' +
        '보안 안내: 개인키(<code>' + esc(keyName) + '</code>)는 비밀번호와 동일합니다. 안전한 본인 PC의 <code>~/.ssh</code> 폴더에만 저장하고 외부에 공유하지 마세요.' +
      '</div>' +

      '<div class="sshc-step">' +
        '<div class="sshc-step-head">' +
          '<h3>1단계. SSH 키 다운로드</h3>' +
          '<div class="sshc-actions">' +
            '<button class="sshc-btn primary" data-dl-key="' + esc(keyName) + '" data-dl-part="private" type="button"' + (keyObj && !keyObj.has_private ? " disabled" : "") + '>Download Private Key (' + esc(keyName) + ')</button>' +
            '<button class="sshc-btn" data-dl-key="' + esc(keyName) + '" data-dl-part="public" type="button">Download Public Key (' + esc(keyName) + '.pub)</button>' +
          '</div>' +
        '</div>' +
        '<p>먼저 GCE 인스턴스에 키가 등록되어 있어야 합니다(<code>GCE Instances</code> 탭의 <b>Setup SSH Key</b> 실행). 그 다음 아래 버튼으로 개인키를 로컬 PC에 다운로드합니다.</p>' +
      '</div>' +

      '<div class="sshc-step">' +
        '<div class="sshc-step-head">' +
          '<h3>2단계. 개인키를 ~/.ssh 폴더로 이동 및 권한 설정</h3>' +
          '<button class="sshc-btn" data-copy-text="' + esc(movePermCmd) + '" type="button">Copy Commands</button>' +
        '</div>' +
        '<p>OpenSSH는 개인키 권한이 너무 열려 있으면 접속을 거부합니다. 다운로드한 키를 <code>~/.ssh</code>로 옮기고 본인 읽기 전용 권한으로 제한하세요.</p>' +
        '<pre class="sshc-output">' + esc(movePermCmd) + '</pre>' +
      '</div>' +

      '<div class="sshc-step">' +
        '<div class="sshc-step-head">' +
          '<h3>3단계. SSH config 파일 수정 (' + esc(configPathHint) + ')</h3>' +
          '<div class="sshc-actions">' +
            '<button class="sshc-btn primary" data-copy-text="' + esc(configBlock) + '" type="button">Copy Config Block</button>' +
            '<button class="sshc-btn" data-copy-text="' + esc(appendConfigCmd) + '" type="button">Copy Auto-Append Command</button>' +
          '</div>' +
        '</div>' +
        '<p>메모장 / VS Code / <code>nano</code>로 <code>' + esc(configPathHint) + '</code> 파일을 열어 아래 블록을 추가하거나, 오른쪽 <b>Copy Auto-Append Command</b>를 터미널에 붙여넣어 바로 추가할 수 있습니다. (VS Code Remote-SSH도 이 설정을 자동으로 인식합니다.)</p>' +
        '<pre class="sshc-output">' + esc(configBlock) + '</pre>' +
      '</div>' +

      '<div class="sshc-step">' +
        '<div class="sshc-step-head">' +
          '<h3>4단계. 일반 SSH 클라이언트로 접속</h3>' +
          '<button class="sshc-btn" data-copy-text="' + esc("ssh " + alias) + '" type="button">Copy ssh ' + esc(alias) + '</button>' +
        '</div>' +
        '<pre class="sshc-output">' + esc(connectCmds) + '</pre>' +
      '</div>';
  }

  function switchTab(root, tab) {
    state.tab = tab;
    root.querySelectorAll(".sshc-tab").forEach(function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-tab") === tab);
    });
    ["gce", "hosts", "keys", "guide", "exec"].forEach(function (name) {
      root.querySelector("#sshc-panel-" + name).classList.toggle("sshc-hidden", name !== tab);
    });
    if (tab === "guide") renderGuideSteps(root);
  }

  async function refreshAll(app, root) {
    app.setStatus("Refreshing SSH client data...");
    var results = await Promise.all([
      callOp("status", {}, false),
      callOp("hosts_list", {}, false),
      callOp("keys_list", {}, false),
      callOp("gce_instances", {}, false)
    ]);
    state.status = results[0];
    state.hosts = (results[1] && results[1].ok && results[1].hosts) || [];
    state.keys = (results[2] && results[2].ok && results[2].keys) || [];
    state.instances = (results[3] && results[3].ok && results[3].instances) || [];

    var defaultUser = state.status && state.status.default_user;
    if (defaultUser) {
      var gceUser = root.querySelector('#sshc-gce-form input[name="user"]');
      var hostUser = root.querySelector('#sshc-host-form input[name="user"]');
      if (gceUser && !gceUser.value) gceUser.value = defaultUser;
      if (hostUser && !hostUser.value) hostUser.value = defaultUser;
    }

    renderBanner(root);
    renderGce(root);
    renderHosts(root);
    renderKeys(root);
    syncGuideSelects(root);
    app.setStatus("Ready (" + state.instances.length + " GCE instances, " + state.hosts.length + " hosts, " + state.keys.length + " keys).");
  }

  window.AppUIReady.then(function () {
    var contentEl = null;
    var app = AppUI.createApp({
      id: "system-ssh-client",
      title: "SSH Client",
      menu: { View: [{ id: "refresh", label: "Refresh All" }] },
      onAction: function (_m, id) {
        if (id === "refresh" && contentEl) refreshAll(app, contentEl);
      },
      content: { render: function (el) { contentEl = mountShell(el); } },
      statusbar: {}
    });

    function wire() {
      if (!contentEl) { setTimeout(wire, 20); return; }
      var root = contentEl;

      root.addEventListener("click", async function (ev) {
        var tabBtn = ev.target.closest("[data-tab]");
        if (tabBtn) {
          switchTab(root, tabBtn.getAttribute("data-tab"));
          return;
        }
        var osBtn = ev.target.closest("[data-os]");
        if (osBtn) {
          state.os = osBtn.getAttribute("data-os") || "windows";
          root.querySelectorAll("[data-os]").forEach(function (b) {
            b.classList.toggle("active", b.getAttribute("data-os") === state.os);
          });
          renderGuideSteps(root);
          return;
        }
        var fillBtn = ev.target.closest("[data-gce-fill]");
        if (fillBtn) {
          var form = root.querySelector("#sshc-gce-form");
          form.querySelector('input[name="instance"]').value = fillBtn.getAttribute("data-gce-fill") || "";
          form.querySelector('input[name="zone"]').value = fillBtn.getAttribute("data-gce-zone") || "";
          app.setStatus("Filled GCE setup form for " + fillBtn.getAttribute("data-gce-fill"));
          return;
        }
        var openGuide = ev.target.closest("[data-open-guide-alias]");
        if (openGuide) {
          state.guide.alias = openGuide.getAttribute("data-open-guide-alias") || "";
          state.guide.host = openGuide.getAttribute("data-open-guide-host") || "";
          if (openGuide.getAttribute("data-open-guide-user")) {
            state.guide.user = openGuide.getAttribute("data-open-guide-user");
          }
          if (openGuide.getAttribute("data-open-guide-port")) {
            state.guide.port = Number(openGuide.getAttribute("data-open-guide-port") || 22);
          }
          if (openGuide.getAttribute("data-open-guide-key")) {
            state.guide.keyName = openGuide.getAttribute("data-open-guide-key");
          }
          syncGuideSelects(root);
          switchTab(root, "guide");
          return;
        }
        var guideKeyBtn = ev.target.closest("[data-guide-key]");
        if (guideKeyBtn) {
          state.guide.keyName = guideKeyBtn.getAttribute("data-guide-key") || state.guide.keyName;
          syncGuideSelects(root);
          switchTab(root, "guide");
          return;
        }
        var dlBtn = ev.target.closest("[data-dl-key]");
        if (dlBtn) {
          await downloadKey(dlBtn.getAttribute("data-dl-key"), dlBtn.getAttribute("data-dl-part"), app);
          return;
        }
        var copyCmd = ev.target.closest("[data-copy-cmd]");
        if (copyCmd) {
          await copyText(copyCmd.getAttribute("data-copy-cmd") || "", app);
          return;
        }
        var copyPub = ev.target.closest("[data-copy-pub]");
        if (copyPub) {
          await copyText(copyPub.getAttribute("data-copy-pub") || "", app);
          return;
        }
        var copyTxt = ev.target.closest("[data-copy-text]");
        if (copyTxt) {
          await copyText(copyTxt.getAttribute("data-copy-text") || "", app);
          return;
        }
        var testBtn = ev.target.closest("[data-test-alias]");
        if (testBtn) {
          var alias = testBtn.getAttribute("data-test-alias");
          app.setStatus("Testing SSH connection to " + alias + "...");
          var res = await callOp("test_connection", { alias: alias }, false);
          var outTarget = state.tab === "gce" ? "#sshc-gce-out" : "#sshc-host-out";
          showOut(root, outTarget, JSON.stringify(res, null, 2));
          app.setStatus(res.ok ? "SSH OK: " + res.whoami + "@" + res.hostname + " (" + res.latency_ms + "ms)" : "SSH failed: " + res.error);
          return;
        }
        var delBtn = ev.target.closest("[data-del-alias]");
        if (delBtn) {
          var delAlias = delBtn.getAttribute("data-del-alias");
          if (!window.confirm("Remove managed SSH host '" + delAlias + "' from ~/.ssh/config?")) return;
          var delRes = await callOp("host_delete", { alias: delAlias }, true);
          showOut(root, "#sshc-host-out", JSON.stringify(delRes, null, 2));
          await refreshAll(app, root);
        }
      });

      root.querySelector("#sshc-guide-preset").addEventListener("change", function (ev) {
        var val = ev.target.value || "";
        if (val.indexOf("gce:") === 0) {
          var name = val.slice(4);
          var inst = state.instances.find(function (i) { return i.name === name; });
          if (inst) {
            state.guide.alias = inst.configured_alias || inst.name;
            state.guide.host = inst.external_ip || "";
            state.guide.port = 22;
          }
        } else if (val.indexOf("host:") === 0) {
          var alias = val.slice(5);
          var h = state.hosts.find(function (x) { return x.alias === alias; });
          if (h) {
            state.guide.alias = h.alias;
            state.guide.host = h.host_name || "";
            if (h.user) state.guide.user = h.user;
            state.guide.port = h.port || 22;
            var kn = keyBasename(h.identity_file);
            if (kn) state.guide.keyName = kn;
          }
        }
        syncGuideSelects(root);
      });

      root.querySelector("#sshc-guide-key").addEventListener("change", function (ev) {
        state.guide.keyName = ev.target.value || "gce_ed25519";
        renderGuideSteps(root);
      });

      ["alias", "host", "user", "port"].forEach(function (field) {
        root.querySelector("#sshc-guide-" + field).addEventListener("input", function (ev) {
          state.guide[field] = field === "port" ? Number(ev.target.value || 22) : ev.target.value;
          renderGuideSteps(root);
        });
      });

      root.querySelector("#sshc-refresh-gce").addEventListener("click", function () { refreshAll(app, root); });
      root.querySelector("#sshc-refresh-hosts").addEventListener("click", function () { refreshAll(app, root); });
      root.querySelector("#sshc-refresh-keys").addEventListener("click", function () { refreshAll(app, root); });

      root.querySelector("#sshc-gce-form").addEventListener("submit", async function (ev) {
        ev.preventDefault();
        var fd = new FormData(ev.target);
        var body = {
          instance: fd.get("instance"),
          zone: fd.get("zone") || undefined,
          user: fd.get("user") || undefined,
          key_name: fd.get("key_name") || "gce_ed25519",
          host_alias: fd.get("host_alias") || undefined,
          update_config: true,
          verify: true
        };
        if (!window.confirm("Register SSH key '" + body.key_name + "' on GCE instance '" + body.instance + "'?")) return;
        app.setStatus("Provisioning SSH key on " + body.instance + "...");
        var res = await callOp("gce_setup", body, true);
        showOut(root, "#sshc-gce-out", JSON.stringify(res, null, 2));
        if (res && res.ok) {
          state.guide.alias = (res.config_entry && res.config_entry.alias) || body.host_alias || body.instance;
          state.guide.host = res.external_ip || "";
          state.guide.user = res.user || body.user || state.guide.user;
          state.guide.keyName = (res.key && res.key.name) || body.key_name;
        }
        await refreshAll(app, root);
      });

      root.querySelector("#sshc-host-form").addEventListener("submit", async function (ev) {
        ev.preventDefault();
        var fd = new FormData(ev.target);
        var body = {
          alias: fd.get("alias"),
          host_name: fd.get("host_name"),
          user: fd.get("user"),
          port: Number(fd.get("port") || 22),
          key_name: fd.get("key_name") || undefined
        };
        var res = await callOp("host_save", body, true);
        showOut(root, "#sshc-host-out", JSON.stringify(res, null, 2));
        await refreshAll(app, root);
      });

      root.querySelector("#sshc-key-form").addEventListener("submit", async function (ev) {
        ev.preventDefault();
        var fd = new FormData(ev.target);
        var body = {
          name: fd.get("name"),
          comment: fd.get("comment") || undefined
        };
        var res = await callOp("key_generate", body, true);
        showOut(root, "#sshc-key-out", JSON.stringify(res, null, 2));
        await refreshAll(app, root);
      });

      root.querySelector("#sshc-exec-form").addEventListener("submit", async function (ev) {
        ev.preventDefault();
        var fd = new FormData(ev.target);
        var body = {
          alias: fd.get("alias"),
          command: fd.get("command"),
          timeout: Number(fd.get("timeout") || 30)
        };
        if (!body.alias) {
          showOut(root, "#sshc-exec-out", "No SSH host configured.");
          return;
        }
        if (!window.confirm("Run command on '" + body.alias + "'?\n\n" + body.command)) return;
        app.setStatus("Running command on " + body.alias + "...");
        var res = await callOp("exec", body, true);
        var text = (res.stdout || "") + (res.stderr ? "\n[stderr]\n" + res.stderr : "") +
          "\n[exit=" + res.returncode + ", " + res.duration_ms + "ms]";
        showOut(root, "#sshc-exec-out", res.error ? "ERROR: " + res.error : text.trim());
        app.setStatus(res.ok ? "Command succeeded (" + res.duration_ms + "ms)" : "Command exited with " + res.returncode);
      });

      refreshAll(app, root);
    }

    wire();
  });
})();
