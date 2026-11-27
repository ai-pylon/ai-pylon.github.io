/**
 * Content/WYSIWYG  --  lightweight rich text editor.
 * Uses contenteditable with a formatting toolbar.
 *
 * Usage:
 *   const editor = WYSIWYG.create('#container', {
 *     content: '<p>Hello</p>',
 *     placeholder: 'Start typing...',
 *     onChange: (html) => {},
 *     toolbar: true,
 *   });
 *   editor.getHTML();
 *   editor.setHTML('<p>New</p>');
 *   editor.getText();
 *   editor.focus();
 *   editor.exec('bold');
 */
const WYSIWYG = (function() {

  const TOOLBAR_ITEMS = [
    {cmd: 'bold', icon: 'B', title: 'Bold (Ctrl+B)', style: 'font-weight:bold'},
    {cmd: 'italic', icon: 'I', title: 'Italic (Ctrl+I)', style: 'font-style:italic'},
    {cmd: 'underline', icon: 'U', title: 'Underline (Ctrl+U)', style: 'text-decoration:underline'},
    {sep: true},
    {cmd: 'formatBlock:H2', icon: 'H2', title: 'Heading 2'},
    {cmd: 'formatBlock:H3', icon: 'H3', title: 'Heading 3'},
    {cmd: 'formatBlock:P', icon: '¶', title: 'Paragraph'},
    {sep: true},
    {cmd: 'insertUnorderedList', icon: '*', title: 'Bullet list'},
    {cmd: 'insertOrderedList', icon: '1.', title: 'Numbered list'},
    {sep: true},
    {cmd: 'insertTable', icon: '⊞', title: 'Insert table'},
    {cmd: 'createLink', icon: '🔗', title: 'Insert link'},
    {cmd: 'removeFormat', icon: '⊘', title: 'Clear formatting'},
    {sep: true},
    {cmd: 'undo', icon: '↩', title: 'Undo (Ctrl+Z)'},
    {cmd: 'redo', icon: '↪', title: 'Redo (Ctrl+Y)'},
  ];

  function create(container, opts) {
    opts = Object.assign({
      content: '',
      placeholder: 'Start typing...',
      onChange: null,
      toolbar: true,
      minHeight: '200px',
    }, opts);

    const el = typeof container === 'string' ? document.querySelector(container) : container;
    if (!el) return null;

    // Inject styles once
    if (!document.getElementById('wysiwyg-styles')) {
      const style = document.createElement('style');
      style.id = 'wysiwyg-styles';
      style.textContent = `
.wysiwyg-toolbar { display:flex; gap:2px; padding:4px 8px; border-bottom:1px solid var(--border,#333); background:var(--bg-secondary,#1e1e2e); flex-wrap:wrap; align-items:center; }
.wysiwyg-toolbar button { background:var(--bg-elevated,#333); border:1px solid var(--border,#444); color:var(--text-primary,#ddd); border-radius:3px; padding:3px 7px; font-size:11px; cursor:pointer; min-width:24px; text-align:center; }
.wysiwyg-toolbar button:hover { background:var(--bg-hover,#444); }
.wysiwyg-toolbar button.active { background:var(--accent-bg,#2a2a6a); border-color:var(--accent,#6c63ff); }
.wysiwyg-toolbar .sep { width:1px; height:18px; background:var(--border,#444); margin:0 4px; }
.wysiwyg-editor { flex:1; overflow-y:auto; padding:12px 16px; outline:none; color:var(--text-primary,#ddd); font:13px/1.6 var(--font-family, system-ui); min-height:200px; }
.wysiwyg-editor:empty::before { content:attr(data-placeholder); color:var(--text-muted,#666); pointer-events:none; }
.wysiwyg-editor h2 { font-size:16px; color:var(--accent,#4fc3f7); margin:12px 0 6px; }
.wysiwyg-editor h3 { font-size:14px; color:var(--accent,#4fc3f7); margin:10px 0 4px; }
.wysiwyg-editor p { margin:4px 0; }
.wysiwyg-editor ul, .wysiwyg-editor ol { padding-left:20px; margin:4px 0; }
.wysiwyg-editor a { color:#4fc3f7; text-decoration:underline; }
.wysiwyg-editor blockquote { border-left:3px solid var(--border,#444); padding-left:12px; color:var(--text-muted,#aaa); margin:8px 0; }
.wysiwyg-editor table { border-collapse:collapse; width:100%; margin:8px 0; font-size:12px; }
.wysiwyg-editor table td, .wysiwyg-editor table th { border:1px solid var(--border,#444); padding:6px 8px; min-width:60px; }
.wysiwyg-editor table th { background:var(--bg-secondary,#1e1e2e); font-weight:600; }
.wysiwyg-editor table tr:hover td { background:var(--bg-hover,#2a2a3a); }
`;
      document.head.appendChild(style);
    }

    // Build DOM
    el.style.cssText = (el.style.cssText || '') + ';display:flex;flex-direction:column;border:1px solid var(--border,#333);border-radius:6px;overflow:hidden;background:var(--bg-elevated,#1a1a2e);';
    el.innerHTML = '';

    // Toolbar
    let toolbarEl = null;
    if (opts.toolbar) {
      toolbarEl = document.createElement('div');
      toolbarEl.className = 'wysiwyg-toolbar';
      for (const item of TOOLBAR_ITEMS) {
        if (item.sep) {
          const sep = document.createElement('span');
          sep.className = 'sep';
          toolbarEl.appendChild(sep);
          continue;
        }
        const btn = document.createElement('button');
        btn.title = item.title;
        btn.innerHTML = `<span style="${item.style || ''}">${item.icon}</span>`;
        btn.onmousedown = (e) => e.preventDefault(); // keep focus in editor
        btn.onclick = () => exec(item.cmd);
        toolbarEl.appendChild(btn);
      }
      el.appendChild(toolbarEl);
    }

    // Editor
    const editorEl = document.createElement('div');
    editorEl.className = 'wysiwyg-editor';
    editorEl.contentEditable = 'true';
    editorEl.dataset.placeholder = opts.placeholder;
    editorEl.style.minHeight = opts.minHeight;
    editorEl.innerHTML = opts.content || '';
    el.appendChild(editorEl);

    // Events
    let _changeTimer = null;
    editorEl.oninput = () => {
      clearTimeout(_changeTimer);
      _changeTimer = setTimeout(() => {
        if (opts.onChange) opts.onChange(editorEl.innerHTML);
      }, 300);
    };

    // --- Commands ---
    function exec(cmd) {
      editorEl.focus();
      if (cmd.startsWith('formatBlock:')) {
        document.execCommand('formatBlock', false, '<' + cmd.split(':')[1] + '>');
      } else if (cmd === 'createLink') {
        const url = prompt('URL:');
        if (url) document.execCommand('createLink', false, url);
      } else if (cmd === 'insertTable') {
        _showTablePicker(editorEl);
        return; // don't update toolbar yet  --  async
      } else {
        document.execCommand(cmd, false, null);
      }
      _updateToolbarState();
    }

    function _showTablePicker(targetEl) {
      // Remove existing picker
      const existing = document.querySelector('.wysiwyg-table-picker');
      if (existing) { existing.remove(); return; }

      const picker = document.createElement('div');
      picker.className = 'wysiwyg-table-picker';
      picker.style.cssText = 'position:absolute;z-index:10000;background:var(--bg-elevated,#252535);border:1px solid var(--border,#444);border-radius:6px;padding:10px;box-shadow:0 4px 12px rgba(0,0,0,0.4);';

      // Grid of cells (8x8 max)
      const maxR = 8, maxC = 8;
      let hoverR = 0, hoverC = 0;
      const label = document.createElement('div');
      label.style.cssText = 'font-size:10px;color:var(--text-muted,#888);margin-bottom:6px;text-align:center;';
      label.textContent = 'Select size';
      picker.appendChild(label);

      const grid = document.createElement('div');
      grid.style.cssText = `display:grid;grid-template-columns:repeat(${maxC},18px);gap:2px;`;
      for (let r = 0; r < maxR; r++) {
        for (let c = 0; c < maxC; c++) {
          const cell = document.createElement('div');
          cell.style.cssText = 'width:16px;height:16px;border:1px solid var(--border,#444);border-radius:2px;cursor:pointer;';
          cell.dataset.r = r;
          cell.dataset.c = c;
          cell.onmouseenter = () => {
            hoverR = r; hoverC = c;
            label.textContent = `${r+1} × ${c+1}`;
            grid.querySelectorAll('div').forEach(d => {
              const dr = parseInt(d.dataset.r), dc = parseInt(d.dataset.c);
              d.style.background = (dr <= r && dc <= c) ? 'var(--accent,#6c63ff)' : '';
            });
          };
          cell.onclick = () => {
            picker.remove();
            _insertTable(targetEl, r + 1, c + 1);
          };
          grid.appendChild(cell);
        }
      }
      picker.appendChild(grid);

      // Position near the table button
      const tableBtn = toolbarEl.querySelector('button[title*="table"]');
      if (tableBtn) {
        const rect = tableBtn.getBoundingClientRect();
        picker.style.left = rect.left + 'px';
        picker.style.top = (rect.bottom + 4) + 'px';
        picker.style.position = 'fixed';
      }
      document.body.appendChild(picker);

      // Close on outside click
      setTimeout(() => {
        document.addEventListener('mousedown', function _close(e) {
          if (!picker.contains(e.target)) { picker.remove(); document.removeEventListener('mousedown', _close); }
        });
      }, 50);
    }

    function _insertTable(targetEl, rows, cols) {
      targetEl.focus();
      let html = '<table><thead><tr>';
      for (let c = 0; c < cols; c++) html += `<th>Col ${c+1}</th>`;
      html += '</tr></thead><tbody>';
      for (let r = 0; r < rows - 1; r++) {
        html += '<tr>';
        for (let c = 0; c < cols; c++) html += '<td>&nbsp;</td>';
        html += '</tr>';
      }
      html += '</tbody></table><p><br></p>';
      document.execCommand('insertHTML', false, html);
    }

    function _updateToolbarState() {
      if (!toolbarEl) return;
      toolbarEl.querySelectorAll('button').forEach((btn, i) => {
        const item = TOOLBAR_ITEMS.filter(t => !t.sep)[i];
        if (!item) return;
        const active = document.queryCommandState(item.cmd.split(':')[0]);
        btn.classList.toggle('active', active);
      });
    }

    editorEl.addEventListener('keyup', _updateToolbarState);
    editorEl.addEventListener('mouseup', _updateToolbarState);

    // --- Public API ---
    return {
      getHTML() { return editorEl.innerHTML; },
      setHTML(html) { editorEl.innerHTML = html; },
      getText() { return editorEl.innerText; },
      setText(text) { editorEl.innerText = text; },
      focus() { editorEl.focus(); },
      exec,
      get element() { return editorEl; },

      // --- Model-based API ---
      // Set content from document model paragraphs [{type, style, runs:[{text,bold,italic}]}, ...]
      setFromModel(paragraphs) {
        if (!paragraphs || !paragraphs.length) { editorEl.innerHTML = ''; return; }
        let html = '';
        for (const p of paragraphs) {
          if (p.type === 'table') {
            html += _tableModelToHtml(p);
          } else {
            const style = p.style || '';
            const text = _runsToHtml(p.runs || []);
            if (style === 'Heading2' || style === 'Heading 2') html += `<h2>${text}</h2>`;
            else if (style === 'Heading3' || style === 'Heading 3') html += `<h3>${text}</h3>`;
            else if (style.includes('ListBullet')) html += `<ul><li>${text}</li></ul>`;
            else if (style.includes('ListNumber')) html += `<ol><li>${text}</li></ol>`;
            else html += `<p>${text || '<br>'}</p>`;
          }
        }
        // Merge consecutive list items
        html = html.replace(/<\/ul>\s*<ul>/g, '').replace(/<\/ol>\s*<ol>/g, '');
        editorEl.innerHTML = html;
      },

      // Extract content back to document model paragraphs
      getAsModel() {
        const paragraphs = [];
        for (const node of editorEl.children) {
          if (!node.tagName) continue;
          const tag = node.tagName.toUpperCase();
          if (tag === 'TABLE') {
            paragraphs.push(_htmlTableToModel(node));
          } else if (tag === 'UL' || tag === 'OL') {
            const listStyle = tag === 'UL' ? 'ListBulletE-SS' : 'ListNumberE-SS';
            for (const li of node.children) {
              paragraphs.push({type: 'paragraph', style: listStyle, runs: _htmlToRuns(li)});
            }
          } else {
            const style = tag === 'H2' ? 'Heading2' : tag === 'H3' ? 'Heading3' : 'BodyText';
            paragraphs.push({type: 'paragraph', style, runs: _htmlToRuns(node)});
          }
        }
        return paragraphs;
      },
      // Convert plain text to simple HTML (paragraphs)
      setFromText(text) {
        if (!text) { editorEl.innerHTML = ''; return; }
        // If already HTML (has tags), set directly
        if (/<(p|h[1-6]|ul|ol|table|div|br)\b/i.test(text)) {
          editorEl.innerHTML = text;
          return;
        }
        // Convert markdown-like to HTML
        const html = text.split('\n\n').map(para => {
          para = para.trim();
          if (!para) return '';
          if (para.startsWith('### ')) return `<h3>${para.slice(4)}</h3>`;
          if (para.startsWith('## ')) return `<h2>${para.slice(3)}</h2>`;
          if (para.startsWith('# ')) return `<h2>${para.slice(2)}</h2>`;
          if (para.startsWith('- ')) {
            const items = para.split('\n').filter(l => l.startsWith('- ')).map(l => `<li>${l.slice(2)}</li>`);
            return `<ul>${items.join('')}</ul>`;
          }
          // Simple table detection: lines with | separators
          if (para.includes('|') && para.split('\n').length > 1) {
            const rows = para.split('\n').filter(l => l.trim() && !l.match(/^[\s|:-]+$/));
            if (rows.length >= 2) {
              let table = '<table>';
              rows.forEach((row, i) => {
                const cells = row.split('|').map(c => c.trim()).filter(c => c);
                const tag = i === 0 ? 'th' : 'td';
                const wrap = i === 0 ? 'thead' : (i === 1 ? 'tbody' : '');
                if (wrap === 'thead') table += '<thead>';
                if (wrap === 'tbody') table += '</thead><tbody>';
                table += '<tr>' + cells.map(c => `<${tag}>${c}</${tag}>`).join('') + '</tr>';
              });
              table += '</tbody></table>';
              return table;
            }
          }
          // Inline formatting
          para = para.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
          para = para.replace(/\*(.+?)\*/g, '<em>$1</em>');
          return `<p>${para.replace(/\n/g, '<br>')}</p>`;
        }).join('\n');
        editorEl.innerHTML = html;
      },
      // Get content as markdown-like text
      getAsText() {
        let text = '';
        for (const node of editorEl.children) {
          const tag = node.tagName;
          const inner = node.innerText.trim();
          if (!inner) continue;
          if (tag === 'H2') text += `## ${inner}\n\n`;
          else if (tag === 'H3') text += `### ${inner}\n\n`;
          else if (tag === 'UL') text += [...node.children].map(li => `- ${li.innerText}`).join('\n') + '\n\n';
          else if (tag === 'OL') text += [...node.children].map((li, i) => `${i+1}. ${li.innerText}`).join('\n') + '\n\n';
          else if (tag === 'TABLE') {
            const rows = node.querySelectorAll('tr');
            for (const row of rows) {
              const cells = [...row.querySelectorAll('th,td')].map(c => c.innerText.trim());
              text += '| ' + cells.join(' | ') + ' |\n';
            }
            text += '\n';
          }
          else text += inner + '\n\n';
        }
        return text.trim();
      },
    };
  }

  // --- Model ↔ HTML helpers (shared across instances) ---
  function _runsToHtml(runs) {
    if (!runs || !runs.length) return '';
    return runs.map(r => {
      let t = (r.text || '').replace(/&/g,'&amp;').replace(/</g,'&lt;');
      if (r.bold) t = `<strong>${t}</strong>`;
      if (r.italic) t = `<em>${t}</em>`;
      if (r.underline) t = `<u>${t}</u>`;
      return t;
    }).join('');
  }

  function _htmlToRuns(node) {
    // Convert a DOM node's content to runs array
    const runs = [];
    function walk(n) {
      if (n.nodeType === 3) { // text
        if (n.textContent) runs.push({text: n.textContent});
      } else if (n.nodeType === 1) { // element
        const tag = n.tagName.toUpperCase();
        if (tag === 'BR') { runs.push({text: '\n'}); return; }
        const isBold = tag === 'STRONG' || tag === 'B';
        const isItalic = tag === 'EM' || tag === 'I';
        const isUnderline = tag === 'U';
        if (isBold || isItalic || isUnderline) {
          // Wrap children in styled run
          const childText = n.innerText || '';
          const run = {text: childText};
          if (isBold) run.bold = true;
          if (isItalic) run.italic = true;
          if (isUnderline) run.underline = true;
          runs.push(run);
        } else {
          for (const child of n.childNodes) walk(child);
        }
      }
    }
    for (const child of node.childNodes) walk(child);
    return runs.length ? runs : [{text: node.innerText || ''}];
  }

  function _tableModelToHtml(table) {
    if (!table.rows || !table.rows.length) return '';
    let html = '<table>';
    table.rows.forEach((row, ri) => {
      html += '<tr>';
      for (const cell of row) {
        const tag = ri === 0 ? 'th' : 'td';
        const text = (cell.paragraphs || []).map(p => _runsToHtml(p.runs || [])).join('<br>') || '&nbsp;';
        html += `<${tag}>${text}</${tag}>`;
      }
      html += '</tr>';
    });
    html += '</table>';
    return html;
  }

  function _htmlTableToModel(tableEl) {
    const rows = [];
    for (const tr of tableEl.querySelectorAll('tr')) {
      const row = [];
      for (const cell of tr.querySelectorAll('th,td')) {
        row.push({paragraphs: [{type: 'paragraph', style: 'BodyText', runs: _htmlToRuns(cell)}]});
      }
      rows.push(row);
    }
    return {type: 'table', rows};
  }

  return { create };
})();
