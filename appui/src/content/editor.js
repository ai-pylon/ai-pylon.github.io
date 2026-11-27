/**
 * UI Editor  --  lightweight code textarea with line numbers and syntax hints.
 *
 * Usage:
 *   const editor = UIEditor.create('#container', {
 *     language: 'plantuml',  // plantuml | mermaid | markdown | json
 *     value: '@startuml\nA -> B\n@enduml',
 *     onChange: (value) => console.log(value),
 *     lineNumbers: true,
 *     height: '300px',
 *   });
 *   editor.getValue();
 *   editor.setValue(newCode);
 */
const UIEditor = (function() {

  function create(selector, opts) {
    const container = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (!container) return null;
    opts = opts || {};

    const wrap = document.createElement('div');
    wrap.className = 'ui-editor';
    wrap.style.cssText = `display:flex;border:1px solid var(--border,#444);border-radius:4px;overflow:hidden;height:${opts.height || '250px'};background:var(--bg-primary,#1a1a2e)`;

    // Line numbers
    const gutter = document.createElement('div');
    gutter.className = 'ui-editor-gutter';
    gutter.style.cssText = 'padding:8px 4px;background:#111;color:#555;font:11px/1.5 var(--font-mono,monospace);text-align:right;user-select:none;overflow:hidden;min-width:32px';

    // Textarea
    const textarea = document.createElement('textarea');
    textarea.className = 'ui-editor-textarea';
    textarea.spellcheck = false;
    textarea.style.cssText = 'flex:1;padding:8px;background:transparent;color:var(--text-primary,#eee);font:12px/1.5 var(--font-mono,monospace);border:none;outline:none;resize:none;tab-size:2;white-space:pre;overflow:auto';
    textarea.value = opts.value || '';

    function updateGutter() {
      const lines = textarea.value.split('\n').length;
      gutter.innerHTML = Array.from({length: lines}, (_, i) => `<div>${i + 1}</div>`).join('');
    }

    function syncScroll() { gutter.scrollTop = textarea.scrollTop; }

    textarea.oninput = () => { updateGutter(); if (opts.onChange) opts.onChange(textarea.value); };
    textarea.onscroll = syncScroll;
    textarea.onkeydown = (e) => {
      // Tab inserts 2 spaces
      if (e.key === 'Tab') {
        e.preventDefault();
        const s = textarea.selectionStart;
        textarea.value = textarea.value.substring(0, s) + '  ' + textarea.value.substring(textarea.selectionEnd);
        textarea.selectionStart = textarea.selectionEnd = s + 2;
        if (opts.onChange) opts.onChange(textarea.value);
      }
    };

    if (opts.lineNumbers !== false) wrap.appendChild(gutter);
    wrap.appendChild(textarea);
    container.appendChild(wrap);
    updateGutter();

    return {
      getValue() { return textarea.value; },
      setValue(v) { textarea.value = v; updateGutter(); },
      focus() { textarea.focus(); },
      element: wrap,
    };
  }

  return { create };
})();
