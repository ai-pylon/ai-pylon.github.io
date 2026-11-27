/* Page Automation case/fragment authoring, independent of filmstrip rendering. */
window.PageAutomationEditors = (() => {
  function create({api, esc, getApp, getSelectedCase, showCase}) {
  // --- case/fragment editor (#16) -------------------------------------------
  // Non-devs author a case/fragment by editing its JSON in a dialog, with the
  // DSL vocabulary (from the schema op) shown as hints; save goes through the
  // same validated, version-snapshotted set/set_fragment ops. A JSON textarea
  // (not a bespoke form builder) keeps the full schema expressible + round-trips
  // cleanly through the existing ops.
  var _schemaCache = null;
  function loadSchema() {
    if (_schemaCache) return Promise.resolve(_schemaCache);
    return api("schema", {}).then(function (s) { _schemaCache = s || {}; return _schemaCache; });
  }
  function schemaHintsHtml(s) {
    s = s || {};
    function list(obj, render) {
      return Object.keys(obj || {}).map(render).join("");
    }
    var when = list(s.when, function (k) { return "<li><code>" + esc(k) + "</code> — " + esc(s.when[k]) + "</li>"; });
    var cls = list(s.classify, function (k) { return "<li><code>" + esc(k) + "</code> — " + esc(s.classify[k]) + "</li>"; });
    var acts = list(s.actions, function (k) {
      var a = s.actions[k] || {}; var p = a.params ? (" <span class=\"pa-hint-p\">{" + esc(Object.keys(a.params).join(", ")) + "}</span>") : "";
      return "<li><code>" + esc(k) + "</code>" + p + " — " + esc(a.doc || "") + "</li>";
    });
    return '<details class="pa-hints"><summary>DSL reference (schema v' + esc(s.version || "?") + ')</summary>' +
      '<div class="pa-hint-cols">' +
      '<div><b>when</b><ul>' + when + "</ul></div>" +
      '<div><b>classify</b><ul>' + cls + "</ul></div>" +
      '<div><b>actions</b><ul>' + acts + "</ul></div>" +
      "</div></details>";
  }
  function editorDialog(opts) {
    // opts: {title, json, hintsHtml, onSave(obj)->Promise}
    var Dialog = window.AppUIDialog;
    var ta_id = "pa-ed-ta", err_id = "pa-ed-err";
    var body =
      '<div class="pa-editor">' + (opts.hintsHtml || "") +
      '<textarea id="' + ta_id + '" spellcheck="false" rows="20">' + esc(opts.json) + "</textarea>" +
      '<div id="' + err_id + '" class="pa-ed-err"></div></div>';
    if (!Dialog || !Dialog.show) {
      // headless fallback: no dialog service — tell the user.
      if (getApp()) getApp().setStatus("editor needs the AppUI dialog service");
      return;
    }
    Dialog.show({
      title: opts.title, body: body, width: "720px",
      buttons: [
        { text: "Cancel" },
        { text: "Save", primary: true, action: function () {
          var ta = document.getElementById(ta_id);
          var errBox = document.getElementById(err_id);
          var obj;
          // JSON parse is validated SYNCHRONOUSLY — returning false keeps the
          // dialog open (the AppUIDialog contract only honours a sync `false`).
          try { obj = JSON.parse(ta.value); }
          catch (e) { if (errBox) errBox.textContent = "Invalid JSON: " + e.message; return false; }
          // Server-side validation (set/set_fragment) is async; the dialog will
          // close, so we report the outcome via a toast (and re-open on a
          // validation error so the user can fix it).
          opts.onSave(obj).then(function (r) {
            var okr = r && r.ok;
            try { window.AppUI && AppUI.toast &&
              AppUI.toast(okr ? ("Saved " + (r.id || "")) : ("Save failed: " + ((r && (r._error || r.error)) || "?")),
                okr ? "ok" : "bad"); } catch (e) {}
            if (!okr) {
              // re-open the editor with the same text + the error so it's fixable.
              setTimeout(function () {
                editorDialog({ title: opts.title, json: ta.value, hintsHtml: opts.hintsHtml,
                               onSave: opts.onSave, _error: (r && (r._error || r.error)) || "save failed" });
              }, 0);
            }
          });
          return true;   // close now; outcome handled via toast/re-open
        } },
      ],
    });
    // surface a carried-over error (from a failed save re-open)
    if (opts._error) {
      setTimeout(function () { var eb = document.getElementById(err_id); if (eb) eb.textContent = opts._error; }, 0);
    }
  }
  function openCaseEditor(id) {
    Promise.all([api("get", { id: id }), loadSchema()]).then(function (res) {
      var r = res[0];
      if (!r || !r.ok) { if (getApp()) getApp().setStatus("could not load case " + id); return; }
      editorDialog({
        title: "Edit case: " + id,
        json: JSON.stringify(r.case, null, 2),
        hintsHtml: schemaHintsHtml(res[1]),
        onSave: function (obj) {
          return api("set", { case: obj, confirm: true }).then(function (sr) {
            if (sr && sr.ok) { _schemaCache = null; showCase(id); }
            return sr;
          });
        },
      });
    });
  }
  function openFragmentPicker() {
    api("fragments", {}).then(function (r) {
      if (!r || !r.ok) return;
      var ids = r.fragments || [];
      var Dialog = window.AppUIDialog;
      if (!Dialog || !Dialog.show) return;
      var opts = ids.map(function (f) { return '<option value="' + esc(f) + '">' + esc(f) + "</option>"; }).join("");
      Dialog.show({
        title: "Edit a fragment", width: "420px",
        body: '<div class="pa-editor"><label>Pick a fragment to edit:</label>' +
          '<select id="pa-frag-sel">' + opts + "</select></div>",
        buttons: [
          { text: "Cancel" },
          { text: "Open", primary: true, action: function () {
            var sel = document.getElementById("pa-frag-sel");
            var fid = sel && sel.value;
            if (fid) setTimeout(function () { openFragmentEditor(fid); }, 0);
            return true;
          } },
        ],
      });
    });
  }
  function openFragmentEditor(fid) {
    Promise.all([api("fragments", { id: fid }), loadSchema()]).then(function (res) {
      var r = res[0];
      if (!r || !r.ok) return;
      editorDialog({
        title: "Edit fragment: " + fid,
        json: JSON.stringify(r.fragment, null, 2),
        hintsHtml: schemaHintsHtml(res[1]),
        onSave: function (obj) {
          return api("set_fragment", { id: fid, fragment: obj, confirm: true }).then(function (sr) {
            if (sr && sr.ok && getSelectedCase()) { _schemaCache = null; showCase(getSelectedCase()); }
            return sr;
          });
        },
      });
    });
  }

    return {openCaseEditor, openFragmentPicker};
  }
  return {create};
})();
