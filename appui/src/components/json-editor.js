/**
 * AppUIJsonEditor  --  shared JSON viewer/editor component.
 *
 * Modes:
 *   - view: read-only, syntax-highlighted JSON
 *   - edit: editable textarea with validation
 *
 * Usage:
 *   const editor = AppUIJsonEditor.create({
 *     container: el,
 *     mode: 'edit',        // 'view' | 'edit'
 *     value: {name: '/sleep', steps: []},
 *     onChange: (json) => { },   // called on valid edits
 *     onError: (msg) => { },     // called on invalid JSON
 *   });
 *   editor.setValue({...});
 *   editor.getValue();           // returns parsed object or null
 *   editor.setMode('view');
 */
const AppUIJsonEditor = (() => {
  'use strict';

  const mounted = new WeakMap();

  function create(opts) {
    const container = opts.container;
    if (!container) return null;

    mounted.get(container)?.destroy();
    const scope = AppUILifecycle.createScope();
    let renderScope, copyTimer;
    const hadClass = container.classList.contains('ai-json-editor');
    let _mode = opts.readOnly ? 'view' : (opts.mode || 'view');
    let _value = opts.value ?? null;
    let _valid = true;

    container.innerHTML = '';
    container.classList.add('ai-json-editor');

    const {toolbar, content} = window._AppUIJsonEditorView.frame(opts);
    container.appendChild(toolbar);
    container.appendChild(content);

    // Toolbar events
    scope.listen(toolbar, 'click', (e) => {
      const btn = e.target.closest('[data-mode]');
      if (btn) { setMode(btn.dataset.mode); return; }
      const action = e.target.closest('[data-action]');
      if (action) {
        if (action.dataset.action === 'format') _format();
        else if (action.dataset.action === 'copy') _copy();
      }
    });

    function _render() {
      if (scope.destroyed) return;
      renderScope?.destroy();
      renderScope = AppUILifecycle.createScope();
      toolbar.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === _mode));
      content.innerHTML = '';
      if (_mode === 'view') {
        const pre = document.createElement('pre');
        pre.className = 'ai-json-view';
        pre.innerHTML = _value != null ? window._AppUIJsonEditorView.highlight(_value) : '<span style="color:var(--text-muted)">No data</span>';
        content.appendChild(pre);
      } else {
        const textarea = document.createElement('textarea');
        textarea.className = 'ai-json-edit';
        textarea.value = _value != null ? JSON.stringify(_value, null, 2) : '';
        textarea.spellcheck = false;
        renderScope.listen(textarea, 'input', () => {
          try {
            _value = JSON.parse(textarea.value);
            _valid = true;
            _setStatus(true);
            if (opts.onChange) opts.onChange(_value);
          } catch (err) {
            _valid = false;
            _setStatus(false, err.message);
            if (opts.onError) opts.onError(err.message);
          }
        });
        content.appendChild(textarea);
      }
    }

    function _setStatus(valid, msg) {
      if (scope.destroyed) return;
      const status = toolbar.querySelector('#jsonStatus');
      if (status) {
        status.className = 'ai-json-toolbar-status ' + (valid ? 'valid' : 'invalid');
        status.textContent = valid ? '✓ Valid' : '✗ ' + (msg || 'Invalid').substring(0, 40);
      }
    }

    function _format() {
      if (_mode === 'edit' && _value != null) {
        const textarea = content.querySelector('textarea');
        if (textarea) textarea.value = JSON.stringify(_value, null, 2);
      }
    }

    function _copy() {
      const text = _value != null ? JSON.stringify(_value, null, 2) : '';
      AppUICore.copyText(text);
      const status = toolbar.querySelector('#jsonStatus');
      if (status) { status.textContent = '📋 Copied!'; clearTimeout(copyTimer); copyTimer = setTimeout(() => _setStatus(_valid), 1500); }
    }

    function setMode(mode) {
      if (scope.destroyed || (opts.readOnly && mode !== 'view')) return;
      _mode = mode;
      _render();
    }

    function setValue(val) {
      if (scope.destroyed) return;
      _value = val;
      _valid = true;
      _setStatus(true);
      _render();
    }

    function getValue() {
      return !scope.destroyed && _valid ? _value : null;
    }

    function isValid() { return !scope.destroyed && _valid; }

    _render();

    const instance = { setMode, setValue, getValue, isValid, destroy: () => scope.destroy() };
    mounted.set(container, instance);
    scope.add(() => {
      clearTimeout(copyTimer);
      renderScope?.destroy();
      toolbar.remove(); content.remove();
      if (mounted.get(container) === instance) {
        mounted.delete(container);
        if (!hadClass) container.classList.remove('ai-json-editor');
      }
    });
    return instance;
  }

  return { create };
})();

window.AppUIJsonEditor = AppUIJsonEditor;
