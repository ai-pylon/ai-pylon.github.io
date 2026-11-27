/* Private native prompt and schema-form adapter for shared dialogs. */
var _AppUIDialogForms = window._AppUIDialogForms || {
  create({show, close}) {
    function confirm(msg, onYes, onNo, options = {}) {
      const body=msg&&typeof msg.nodeType==='number'?msg:'<p style="margin:0">'+msg+'</p>';
      const yes={text:options.confirmText||'OK',action:onYes};
      if(options.primary !== undefined)yes.primary=options.primary;
      if(options.danger !== undefined)yes.danger=options.danger;
      const no={text:options.cancelText||'Cancel',action:onNo};
      return show({title:options.title||'Confirm',body,signal:options.signal,onClose:options.onClose,
        ...(options.width !== undefined ? {width:options.width} : {}),
        buttons:options.cancelFirst?[no,yes]:[yes,no],
      });
    }
    function confirmAsync(msg, options = {}) {
      return new Promise(resolve => {
        let answered=false;
        const finish=value=>{if(!answered){answered=true;resolve(value);}};
        const overlay=confirm(msg,()=>finish(true),()=>finish(false),{...options,onClose:()=>{
          finish(false);options.onClose?.();
        }});
        if(!overlay)finish(false);
      });
    }
    let _promptSerial = 0;
    function prompt(msg, defaultVal, onOk, options = {}) {
      const input = document.createElement('input');
      input.id = 'ui-prompt-' + (++_promptSerial);
      input.value = defaultVal ?? '';
      input.style.cssText = 'width:100%;background:var(--bg-primary);color:var(--text-primary);border:1px solid var(--border);border-radius:4px;padding:8px 10px;font-size:13px;outline:none';
      const submit = () => onOk?.(input.value);
      const overlay = show({title: msg, body: input, signal:options.signal,onClose:options.onClose,
        buttons: [{text: 'OK', action: submit}, {text: 'Cancel'}]});
      if(!overlay)return null;
      input.addEventListener('keydown', event => {
        if (!overlay.isConnected || event.key !== 'Enter' || event.isComposing) return;
        event.preventDefault();if (submit() !== false) close(overlay);
      });
      return overlay;
    }

    /**
     * Generate a dialog with a form from field definitions.
     * @param {object} opts - {title, note?, fields: [{name, type, label, placeholder, options, default, showIf}], onSubmit: (values) => {}}
     *   note: a short muted line above the fields (scope / caveats of the form)
     */
    function form(opts) {
      const fields = opts.fields || [];
      const body = document.createElement('div');
      body.style.cssText = 'display:flex;flex-direction:column;gap:10px';
      if (opts.note) {
        const note = document.createElement('div');
        note.className = 'ui-dialog-note';
        note.style.cssText = 'font-size:11px;color:var(--text-muted)';
        note.textContent = opts.note;
        body.appendChild(note);
      }
      const inputs = new Map(), labels = new Map();
      fields.forEach(field => {
        const label = document.createElement('label');
        label.style.cssText = 'font-size:11px;color:var(--text-muted);display:block';
        label.textContent = field.label || field.name;
        const input = document.createElement(field.type === 'select' ? 'select' : field.type === 'textarea' ? 'textarea' : 'input');
        input.id = 'dlg-f-' + field.name;
        input.setAttribute('aria-label', field.label || field.name);
        input.className = field.type === 'select' ? 'ui-select' : 'ui-input';
        input.style.cssText = 'width:100%;margin-top:2px;font-size:11px';
        if (field.type === 'select') {
          (field.options || []).forEach(option => {
            const item = document.createElement('option');
            item.value = typeof option === 'object' ? (option.v ?? option.value) : option;
            item.textContent = typeof option === 'object' ? (option.l ?? option.label) : option;
            input.appendChild(item);
          });
          if (field.default != null) input.value = field.default;
        } else if (field.type === 'checkbox') {
          input.type = 'checkbox'; input.checked = !!field.default;
          input.style.width = 'auto';
        } else {
          if (field.type === 'textarea') {input.rows = field.rows || 3; input.style.resize = 'vertical';}
          else input.type = field.type || 'text';
          input.placeholder = field.placeholder || '';
          input.value = field.default ?? '';
        }
        input.required = !!field.required;
        if (field.disabled) input.disabled = true;
        for (const property of ['min', 'max', 'step', 'pattern', 'maxLength']) {
          if (field[property] != null) input[property] = field[property];
        }
        label.appendChild(input);body.appendChild(label);
        inputs.set(field.name, input);labels.set(field.name, label);
      });
      const values = () => Object.fromEntries(fields.map(field => [field.name,
        field.type === 'checkbox' ? inputs.get(field.name).checked : inputs.get(field.name).value]));
      const submit = () => {
        if (opts.signal?.aborted) return false;
        for (const field of fields) {
          const input = inputs.get(field.name);
          if (input.disabled || labels.get(field.name).style.display === 'none') continue;
          if (input.checkValidity?.() === false) {input.reportValidity?.(); return false;}
        }
        return opts.onSubmit?.(values());
      };
      const overlay = show({
        title: opts.title || 'Form', body, width: opts.width || '400px',
        buttons: [{text: opts.submitLabel || 'Submit', action: submit}, {text: 'Cancel'}],
        onClose: opts.onClose, signal:opts.signal
      });
      if (!overlay) return null;
      fields.forEach(field => {
        if (!field.showIf) return;
        const update = () => {labels.get(field.name).style.display = field.showIf(values()) ? '' : 'none';};
        inputs.forEach(input => input.addEventListener('change', update));
        update();
      });
      if (opts.submitOnEnter) {
        inputs.forEach(input => input.addEventListener('keydown', event => {
          if (!overlay.isConnected || event.key !== 'Enter' || event.isComposing || input.tagName !== 'INPUT' || input.type === 'checkbox') return;
          event.preventDefault();if (submit() !== false) close(overlay);
        }));
      }
      return overlay;
    }

    return {confirm, confirmAsync, prompt, form};
  }
};
