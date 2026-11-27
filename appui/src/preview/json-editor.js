/* Structured JSON editor companion for the shared preview framework. */
(function (AppUIPreview) {
  'use strict';
  function ensureStyle() {
    if (document.getElementById('shared-json-editor-style')) return;
    const style = document.createElement('style');
    style.id = 'shared-json-editor-style';
    style.textContent =
      '.json-editor{padding:12px;overflow:auto;font:13px/1.45 system-ui,sans-serif}.json-editor details{margin:4px 0 4px 14px}.json-editor summary{cursor:pointer;color:#83bfff;font-family:ui-monospace,Consolas,monospace}.json-editor-row{display:grid;grid-template-columns:minmax(120px,35%) 1fr;gap:8px;align-items:center;padding:3px 0}.json-editor-key{font:12px ui-monospace,Consolas,monospace;color:#aeb7c8;overflow-wrap:anywhere}.json-editor input,.json-editor select{width:100%;padding:5px 7px;background:#111319;color:#d9dde7;border:1px solid #3b4352;border-radius:3px;font:12px ui-monospace,Consolas,monospace}.json-editor .json-editor-bool{width:auto}';
    document.head.appendChild(style);
  }
  const mounted = new WeakMap();
  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }
  function setAt(root, path, value) {
    const key = path[path.length - 1],
      owner = path.slice(0, -1).reduce((value, key) => value[key], root);
    owner[key] = value;
  }
  function primitiveInput(value, onChange, schema, owner) {
    function listen(input, change) {
      owner.listen(input, 'change', () => {
        if (!owner.destroyed) change();
      });
      return input;
    }
    if (schema && Array.isArray(schema.enum)) {
      const select = document.createElement('select'),
        selected = JSON.stringify(value);
      schema.enum.forEach((option) => {
        const element = document.createElement('option');
        element.value = JSON.stringify(option);
        element.textContent = String(option);
        element.selected = element.value === selected;
        select.appendChild(element);
      });
      return listen(select, () => onChange(JSON.parse(select.value)));
    }
    const input = document.createElement('input');
    if (typeof value === 'boolean') {
      input.className = 'json-editor-bool';
      input.type = 'checkbox';
      input.checked = value;
      return listen(input, () => onChange(input.checked));
    }
    input.type = typeof value === 'number' ? 'number' : schema?.format==='password' ? 'password' : 'text';
    input.value = value === null ? '' : String(value);
    input.placeholder = value === null ? 'null' : '';
    return listen(input, () =>
      onChange(
        value === null
          ? input.value === ''
            ? null
            : input.value
          : typeof value === 'number'
            ? Number(input.value)
            : input.value
      )
    );
  }
  function createJSONEditor(container, value, options) {
    ensureStyle();
    mounted.get(container)?.destroy();
    const settings = options || {},
      lifetime = AppUILifecycle.createScope();
    let model = clone(value), rawMode=false, rawEditor,
      renderScope;
    function node(value, path, label, schema, owner) {
      if (value && typeof value === 'object') {
        const details = document.createElement('details'),
          summary = document.createElement('summary');
        details.open = path.length < 2;
        summary.textContent =
          (label === undefined ? 'root' : label) + (Array.isArray(value) ? ' []' : ' {}');
        details.appendChild(summary);
        Object.entries(value).forEach(([key, child]) =>
          details.appendChild(
            node(
              child,
              path.concat(key),
              key,
              Array.isArray(value)
                ? schema && schema.items
                : schema && schema.properties && schema.properties[key],
              owner
            )
          )
        );
        return details;
      }
      const row = document.createElement('label'),
        key = document.createElement('span');
      row.className = 'json-editor-row';
      key.className = 'json-editor-key';
      key.textContent = label === undefined ? 'value' : label;
      row.append(
        key,
        primitiveInput(
          value,
          (next) => {
            if (path.length) setAt(model, path, next);
            else model = next;
            settings.onChange?.(clone(model));
          },
          schema,
          owner
        )
      );
      return row;
    }
    function render() {
      if (lifetime.destroyed) return;
      renderScope?.destroy();
      const owner = AppUILifecycle.createScope(),
        root = document.createElement('div');
      renderScope = owner;
      root.className = 'json-editor';
      rawEditor=null;
      if(settings.allowRaw&&window.AppUIJsonEditor){
        const toggle=document.createElement('button');toggle.type='button';toggle.textContent=rawMode?'Use fields':'Edit JSON';
        owner.listen(toggle,'click',()=>{if(rawEditor&&!rawEditor.isValid())return;rawMode=!rawMode;render();});root.append(toggle);
      }
      if(rawMode){
        const rawHost=document.createElement('div');root.append(rawHost);
        rawEditor=AppUIJsonEditor.create({container:rawHost,mode:'edit',value:model,onChange:next=>{model=clone(next);settings.onChange?.(clone(model));}});owner.add(rawEditor);
      }else root.appendChild(node(model, [], undefined, settings.schema, owner));
      container.replaceChildren(root);
      owner.add(() => root.remove());
    }
    const instance = {
      getValue: () => {if(rawEditor&&!rawEditor.isValid())throw new Error('Correct the invalid JSON before continuing');return clone(model);},
      setValue(next) {
        if (!lifetime.destroyed) {
          model = clone(next);
          render();
        }
      },
      refresh: render,
      destroy: () => lifetime.destroy()
    };
    mounted.set(container, instance);
    lifetime.add(() => {
      renderScope?.destroy();
      if (mounted.get(container) === instance) mounted.delete(container);
    });
    if (settings.signal) {
      lifetime.listen(settings.signal, 'abort', instance.destroy, { once: true });
      if (settings.signal.aborted) instance.destroy();
    }
    render();
    return instance;
  }
  AppUIPreview.createJSONEditor = createJSONEditor;
  window.AppUIJsonForm = {
    create(options = {}) {
      if (!options.container) return null;
      return createJSONEditor(options.container, options.value ?? null, options);
    }
  };
})(window.AppUIPreview);
