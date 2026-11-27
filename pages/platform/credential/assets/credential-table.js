// Credential table rendering, token health and visibility-aware refresh.
(function (global) {
  "use strict";
  function create(deps) {
    var STATE = deps.state, api = deps.api, apiH = deps.apiH, esc = deps.esc;
    var delCred = deps.delCred, editCred = deps.editCred;
    var refreshCred = deps.refreshCred, testCred = deps.testCred, poller = null;
function fmtDuration(secs) {
  secs = Math.max(0, Math.round(secs));
  if (secs >= 3600) return Math.floor(secs / 3600) + "h " + Math.round((secs % 3600) / 60) + "m";
  if (secs >= 60) return Math.round(secs / 60) + "m";
  return secs + "s";
}

function healthFor(name) {
  var s = STATE.statuses[name];
  if (!s) return { dot: "gray", text: "unknown", msal: "" };
  var txt = s.health;
  var msal = "";
  // Browser-bound MSAL token: show the live remaining lifetime as its own badge.
  if (s.token_source === "browser-msal") {
    if (s.expires_in != null && s.expires_in > 0) {
      var cls = s.expires_in < 300 ? "exp-soon" : "exp-ok";
      msal = '<span class="msal-exp ' + cls + '" title="MSAL token expires at ' +
             esc(s.expires_at || "") + '">⏱ ' + fmtDuration(s.expires_in) +
             (s.expires_at ? ' · ' + esc(s.expires_at) : '') + '</span>';
    } else if (s.expires_in != null) {
      msal = '<span class="msal-exp exp-soon">⏱ expired</span>';
    } else if (s.token_detail) {
      msal = '<span class="msal-exp exp-none" title="' + esc(s.token_detail) +
             '">no cached token — refresh to mint</span>';
    }
  } else if (s.detail) {
    txt += " · " + s.detail;
  } else if (s.expires_at) {
    txt += " · expires " + s.expires_at;
    if (typeof s.days_left === "number") txt += " (" + s.days_left + "d)";
  }
  return { dot: s.health || "gray", text: txt, msal: msal };
}

function renderTable(root) {
  var box = root.querySelector("#cred-list");
  if (!box) return;
  if (!STATE.creds.length) {
    box.innerHTML = '<div class="empty">No credentials yet. Add one below.</div>';
    return;
  }
  var rows = STATE.creds.map(function (c) {
    var h = healthFor(c.name);
    return '<tr>' +
      '<td><div class="cred-name">' + esc(c.name) + '</div>' +
          '<div class="cred-url">' + esc(c.url || "") + '</div></td>' +
      '<td>' + esc(c.type || "") + (c.product ? " · " + esc(c.product) : "") + '</td>' +
      '<td><span class="cred-hint">' + esc(c.token_hint || (c.has_token ? "set" : "—")) + '</span></td>' +
      '<td data-health="' + esc(c.name) + '"><span class="dot ' + h.dot + '"></span><span class="health-text">' + esc(h.text) + '</span>' +
        (h.msal || "") + '</td>' +
      '<td class="row-actions">' +
        '<button data-test="' + esc(c.name) + '">test</button>' +
        '<button data-rfr="' + esc(c.name) + '">refresh</button>' +
        '<button data-edit="' + esc(c.name) + '">edit</button>' +
        '<button class="danger" data-del="' + esc(c.name) + '">delete</button>' +
      '</td></tr>';
  }).join("");
  box.innerHTML =
    '<table class="cred-table"><thead><tr>' +
      '<th>Credential</th><th>Type</th><th>Token</th><th>Health</th><th></th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table>';

  box.querySelectorAll("[data-del]").forEach(function (b) {
    b.addEventListener("click", function () { delCred(root, b.getAttribute("data-del")); });
  });
  box.querySelectorAll("[data-edit]").forEach(function (b) {
    b.addEventListener("click", function () { editCred(root, b.getAttribute("data-edit")); });
  });
  box.querySelectorAll("[data-rfr]").forEach(function (b) {
    b.addEventListener("click", function () { refreshCred(root.__app, root, b.getAttribute("data-rfr")); });
  });
  box.querySelectorAll("[data-test]").forEach(function (b) {
    b.addEventListener("click", function () { testCred(root.__app, root, b.getAttribute("data-test"), b); });
  });
}

// #24: update ONLY the per-row Health cell (diff), not the whole table. The 30s
// live countdown previously re-rendered the entire table (full innerHTML rebuild
// + re-wiring every row's buttons) every tick. Here we rewrite just each row's
// data-health <td> when its rendered health text actually changed, leaving the
// rest of the DOM (and the wired button handlers) untouched.
function _updateHealthCells(root) {
  var box = root.querySelector("#cred-list");
  if (!box) return;
  (STATE.creds || []).forEach(function (c) {
    var sel = (window.CSS && CSS.escape) ? CSS.escape(c.name) : c.name.replace(/"/g, '\\"');
    var cell = box.querySelector('[data-health="' + sel + '"]');
    if (!cell) return;
    var h = healthFor(c.name);
    var html = '<span class="dot ' + h.dot + '"></span><span class="health-text">' +
      esc(h.text) + '</span>' + (h.msal || "");
    if (cell.innerHTML !== html) cell.innerHTML = html;   // diff: only touch on change
  });
}

async function refresh(app, root) {
  app.setStatus("Loading credentials …");
  var lst = await api("list", {});
  STATE.creds = (lst.data && lst.data.credentials) || [];
  // RENDER the credentials IMMEDIATELY — don't block the table on the (slow,
  // live-probing) auth_http.status call. A stale/failing status must never hide
  // the credential rows (that was the "no entries shown" bug). Load health
  // separately and re-render when it arrives.
  renderTable(root);
  app.setStatus(STATE.creds.length + " credential(s).");
  try {
    var st = await apiH("status", { probe: false });
    STATE.statuses = (st.data && st.data.statuses) || {};
    renderTable(root);
  } catch (e) {
    STATE.statuses = STATE.statuses || {};
  }
}

// Live countdown: tick the MSAL "expires in" every 30s and re-poll status every
// 2 min. #24: PAUSE when the tab/panel isn't visible (document.hidden) so a
// backgrounded workspace tab isn't doing periodic work, and update only the
// changed Health CELLS (diff) instead of rebuilding the whole table every tick.
function startAutoRefresh(app, root) {
  if (poller) poller.destroy();
  var sincePoll = 0;
  poller = deps.polling.create(async function () {
    sincePoll += 30;
    // tick the MSAL countdowns locally
    Object.keys(STATE.statuses).forEach(function (n) {
      var s = STATE.statuses[n];
      if (s && s.token_source === "browser-msal" && typeof s.expires_in === "number")
        s.expires_in = Math.max(0, s.expires_in - 30);
    });
    if (sincePoll >= 120) {
      sincePoll = 0;
      try {
        var st = await apiH("status", { probe: false });
        if (st.data && st.data.statuses) STATE.statuses = st.data.statuses;
      } catch (e) {}
    }
    _updateHealthCells(root);   // per-row diff, not a full renderTable
  }, 30000, { stopWhen: function () { return !root.isConnected; } });
  poller.start();
}

    return { renderTable: renderTable, refresh: refresh, startAutoRefresh: startAutoRefresh,
      destroy: function () { if (poller) poller.destroy(); poller = null; } };
  }
  global.CredentialTable = { create: create };
})(window);
