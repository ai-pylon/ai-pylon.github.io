  // ---- AppUIDialog: one framework-level modal primitive -------------------
  // So every app's dialogs share ONE design (overlay + card + title + body +
  // right-aligned actions + an inline error line) instead of bespoke per-page
  // boxes. API:
  //   var dlg = AppUIDialog.open({
  //     title, render(body, dlg) | bodyHTML,
  //     actions: [{ label, primary, danger, onClick(dlg) }],  // onClick may return
  //                                                            // false to keep open
  //     onClose, width });
  //   dlg.error(msg) -> show inline error (keeps dialog open)
  //   dlg.close()
  // AppUIDialog.form({title, fields:[{name,label,type,placeholder,value}],
  //                   submitLabel, onSubmit(values, dlg)}) -> builds a form dialog.
  var _openDialog = null;
  var AppUIDialog = {
    open: function (opts) {
      opts = opts || {};
      if (_openDialog) { try { _openDialog.close(); } catch (e) {} }
      var ov = document.createElement('div');
      ov.className = 'ai-dialog-ov';
      var card = document.createElement('div');
      card.className = 'ai-dialog';
      if (opts.width) card.style.maxWidth = (typeof opts.width === 'number' ? opts.width + 'px' : opts.width);
      var head = document.createElement('div'); head.className = 'ai-dialog-head';
      var h = document.createElement('h3'); h.className = 'ai-dialog-title'; h.textContent = opts.title || '';
      var x = document.createElement('button'); x.type = 'button'; x.className = 'ai-dialog-x'; x.textContent = '\u2715'; x.title = 'Close';
      head.append(h, x);
      // Use a <form> for the body so password inputs are form-contained (quiets
      // the Chromium "Password field is not contained in a form" warning and
      // lets password managers work). Submit is prevented; the primary action
      // handles Enter.
      var body = document.createElement('form'); body.className = 'ai-dialog-body';
      body.addEventListener('submit', function (e) {
        e.preventDefault();
        var prim = foot.querySelector('.ai-dialog-primary'); if (prim) prim.click();
      });
      var err = document.createElement('div'); err.className = 'ai-dialog-err'; err.setAttribute('role', 'alert'); err.hidden = true;
      var foot = document.createElement('div'); foot.className = 'ai-dialog-foot';
      card.append(head, body, err, foot);
      ov.appendChild(card);
      document.body.appendChild(ov);

      var dlg = {
        el: ov, body: body,
        error: function (msg) { err.textContent = msg || ''; err.hidden = !msg; },
        close: function () { try { document.body.removeChild(ov); } catch (e) {} if (_openDialog === dlg) _openDialog = null; if (typeof opts.onClose === 'function') opts.onClose(); },
      };
      _openDialog = dlg;

      if (typeof opts.render === 'function') opts.render(body, dlg);
      else if (opts.bodyHTML != null) body.innerHTML = opts.bodyHTML;

      (opts.actions || []).forEach(function (a) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'ai-dialog-btn' + (a.primary ? ' ai-dialog-primary' : '') + (a.danger ? ' ai-dialog-danger' : '');
        b.textContent = a.label;
        b.addEventListener('click', function () {
          dlg.error('');
          var keep = (typeof a.onClick === 'function') ? a.onClick(dlg) : undefined;
          if (keep !== false && !a.keepOpen) dlg.close();
        });
        foot.appendChild(b);
      });

      x.addEventListener('click', function () { dlg.close(); });
      ov.addEventListener('mousedown', function (e) { if (e.target === ov && opts.dismissable !== false) dlg.close(); });
      ov.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') dlg.close();
        // Enter is handled by the <form> submit (so it fires once, and a
        // textarea's Enter stays a newline).
      });
      // Focus the first input or the primary action.
      setTimeout(function () {
        var f = body.querySelector('input,select,textarea') || foot.querySelector('.ai-dialog-primary');
        if (f) f.focus();
      }, 0);
      return dlg;
    },
    form: function (opts) {
      opts = opts || {};
      return AppUIDialog.open({
        title: opts.title, width: opts.width,
        render: function (body) {
          if (opts.intro) { var p = document.createElement('p'); p.className = 'ai-dialog-hint'; p.textContent = opts.intro; body.appendChild(p); }
          (opts.fields || []).forEach(function (f) {
            var wrap = document.createElement('label'); wrap.className = 'ai-dialog-field';
            if (f.label) { var lb = document.createElement('span'); lb.className = 'ai-dialog-label'; lb.textContent = f.label; wrap.appendChild(lb); }
            var inp;
            if (f.type === 'textarea') { inp = document.createElement('textarea'); }
            else { inp = document.createElement('input'); inp.type = f.type || 'text'; }
            inp.id = 'aidlg-' + f.name; inp.name = f.name;
            if (f.placeholder) inp.placeholder = f.placeholder;
            if (f.value != null) inp.value = f.value;
            // Per-field autocomplete so password managers label fields correctly
            // (e.g. 'username' + 'current-password'); defaults to 'off'.
            inp.setAttribute('autocomplete', f.autocomplete || 'off');
            wrap.appendChild(inp);
            body.appendChild(wrap);
          });
        },
        actions: [
          { label: opts.cancelLabel || 'Cancel' },
          { label: opts.submitLabel || 'OK', primary: true, keepOpen: true, onClick: function (dlg) {
              var values = {};
              (opts.fields || []).forEach(function (f) { var el = document.getElementById('aidlg-' + f.name); values[f.name] = el ? el.value : ''; });
              if (typeof opts.onSubmit === 'function') opts.onSubmit(values, dlg);
            } },
        ],
      });
    },
    // --- shared-AppUI-compatible API ------------------------------------
    // The platform `pylon/appui` dialog exposes show/confirm/prompt (+ form).
    // Mirroring that surface here (mapped onto `open`) keeps call sites
    // PORTABLE: code written against show/confirm/prompt works against both
    // this shim and the shared component, so an eventual convergence onto the
    // shared dialog is a drop-in rather than a rewrite. See IMPROVEMENTS_TODO
    // "convergence". `open`/`form` remain the native (richer) API.
    show: function (opts) {
      opts = opts || {};
      // Shared contract: {title, body, buttons:[{text, action, primary}], width, closable}
      var actions = (opts.buttons || [{ text: 'OK' }]).map(function (btn) {
        return {
          label: btn.text, primary: btn.primary, danger: btn.danger,
          keepOpen: btn.keepOpen,
          onClick: function (dlg) { if (typeof btn.action === 'function') return btn.action(dlg); },
        };
      });
      return AppUIDialog.open({
        title: opts.title, width: opts.width,
        dismissable: opts.closable !== false,
        bodyHTML: (typeof opts.body === 'string') ? opts.body : undefined,
        render: (typeof opts.body === 'function') ? opts.body
              : (opts.body && opts.body.nodeType ? function (b) { b.appendChild(opts.body); } : undefined),
        actions: actions,
      });
    },
    confirm: function (message, onYes, opts) {
      opts = opts || {};
      return AppUIDialog.show({
        title: opts.title || 'Confirm',
        body: '<p class="ai-dialog-hint">' + String(message == null ? '' : message)
              .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</p>',
        buttons: [
          { text: opts.cancelLabel || 'Cancel' },
          { text: opts.okLabel || 'OK', primary: true, action: function () { if (typeof onYes === 'function') onYes(); } },
        ],
      });
    },
    prompt: function (message, def, onValue, opts) {
      opts = opts || {};
      return AppUIDialog.form({
        title: opts.title || message || 'Enter a value',
        intro: opts.title ? message : undefined,
        fields: [{ name: 'value', label: opts.label || '', value: def || '', placeholder: opts.placeholder || '' }],
        submitLabel: opts.okLabel || 'OK', cancelLabel: opts.cancelLabel || 'Cancel',
        onSubmit: function (vals, dlg) { if (typeof onValue === 'function') onValue(vals.value); dlg.close(); },
      });
    },
    close: function () { if (_openDialog) _openDialog.close(); },
  };
  window.AppUIDialog = AppUIDialog;
})();

