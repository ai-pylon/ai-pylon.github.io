/* Private JSON editor presentation; parsing, callbacks and lifetime stay in the controller. */
window._AppUIJsonEditorView = (() => {
  const _style = document.createElement('style');
  _style.textContent = `
    .ai-json-editor { display: flex; flex-direction: column; height: 100%; font-family: Consolas, 'Courier New', monospace; }
    .ai-json-toolbar { display: flex; align-items: center; gap: 6px; padding: 6px 10px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
    .ai-json-toolbar-btn { padding: 3px 8px; border: 1px solid var(--border); border-radius: 3px; background: var(--bg-elevated); color: var(--text-primary); font-size: 11px; cursor: pointer; }
    .ai-json-toolbar-btn:hover { background: var(--bg-hover); }
    .ai-json-toolbar-btn.active { background: var(--accent); color: var(--text-inverse); border-color: var(--accent); }
    .ai-json-toolbar-status { margin-left: auto; font-size: 11px; }
    .ai-json-toolbar-status.valid { color: var(--color-success); }
    .ai-json-toolbar-status.invalid { color: var(--color-error); }
    .ai-json-content { flex: 1; overflow: auto; position: relative; }
    .ai-json-view { padding: 12px; font-size: 12px; line-height: 1.6; white-space: pre-wrap; word-break: break-all; color: var(--text-primary); }
    .ai-json-edit { width: 100%; height: 100%; border: none; resize: none; padding: 12px; font-size: 12px; line-height: 1.6; font-family: inherit; background: var(--bg-elevated); color: var(--text-primary); box-sizing: border-box; outline: none; }
    .ai-json-edit:focus { box-shadow: inset 0 0 0 1px var(--accent); }
    .ai-json-key { color: var(--color-info); }
    .ai-json-string { color: var(--color-success); }
    .ai-json-number { color: var(--color-info); }
    .ai-json-bool { color: var(--color-error); }
    .ai-json-null { color: var(--color-warning); }
  `;
  if (!document.querySelector('style[data-ai-json-editor]')) {
    _style.setAttribute('data-ai-json-editor', '');
    document.head.appendChild(_style);
  }

  function _highlight(json) {
    const str = JSON.stringify(json, null, 2);
    const token = /"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\b(?:true|false|null)\b/g;
    let html = '', end = 0, match;
    while ((match = token.exec(str))) {
      html += AppUITextUtils.esc(str.slice(end, match.index));
      const value = match[0];
      const kind = value.startsWith('"') ? (/^\s*:/.test(str.slice(token.lastIndex)) ? 'key' : 'string')
        : value === 'null' ? 'null' : /^(true|false)$/.test(value) ? 'bool' : 'number';
      html += '<span class="ai-json-' + kind + '">' + AppUITextUtils.esc(value) + '</span>';
      end = token.lastIndex;
    }
    return html + AppUITextUtils.esc(str.slice(end));
  }

  function frame(opts) {
    // Toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'ai-json-toolbar';
    toolbar.innerHTML = `
      <button class="ai-json-toolbar-btn" data-mode="view" title="View mode">👁 View</button>
      ${opts.readOnly ? '' : '<button class="ai-json-toolbar-btn" data-mode="edit" title="Edit mode">✏️ Edit</button><button class="ai-json-toolbar-btn" data-action="format" title="Format/prettify">Format</button>'}
      <button class="ai-json-toolbar-btn" data-action="copy" title="Copy to clipboard">📋 Copy</button>
      <span class="ai-json-toolbar-status valid" id="jsonStatus">✓ Valid</span>
    `;

    // Content
    const content = document.createElement('div');
    content.className = 'ai-json-content';

    return {toolbar, content};
  }
  return {frame, highlight: _highlight};
})();
