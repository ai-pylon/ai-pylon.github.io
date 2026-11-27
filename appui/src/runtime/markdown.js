/* Markdown display policy used by AppUICore; independent of streaming and DOM lifecycle.
 * Engine: marked (dependencies/marked, shipped in the foundation bundle) behind a hardened private instance - see safeMarked.
 * The regex renderer below is only the fallback for a page where marked did not load. */
window._AppUICoreMarkdown=(function(){
  // --- HTML Escape ---
  function escHtml(s) {
    if (!s) return '';
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // --- Lists ---
  // One <div> per item, indented by NESTING LEVEL. The level comes from the item's leading whitespace relative to
  // the items above it (2-, 3- or 4-space / tab indents all work): a deeper indent than the current item opens a
  // level, a shallower one pops back to the matching level. Bullets change with depth (\u2022 \u25e6 \u25aa); an
  // ordered item keeps its own number.
  const LIST_RE = /^([ \t]*)([-*+]|\d+[.)]) +(.+)$/;
  const BULLETS = ['\u2022', '\u25e6', '\u25aa'];
  function renderLists(html) {
    const lines = html.split('\n'), out = [];
    let stack = [];                                    // indent widths of the open levels
    let prev = 'blank';                                // blank | list | prose
    for (const line of lines) {
      const m = LIST_RE.exec(line);
      if (!m) {
        if (line.trim()) {                             // prose ends the list
          if (prev === 'list') out.push('');           // ... and starts its own paragraph block
          stack = []; prev = 'prose';
        } else prev = prev === 'list' ? 'list' : 'blank';   // a blank line keeps the list (and its nesting) open
        out.push(line);
        continue;
      }
      const indent = m[1].replace(/\t/g, '    ').length;
      while (stack.length && indent < stack[stack.length - 1]) stack.pop();
      if (!stack.length || indent > stack[stack.length - 1]) stack.push(indent);
      const level = stack.length - 1;
      const marker = /^\d/.test(m[2]) ? m[2] : BULLETS[level % BULLETS.length];
      if (prev === 'prose') out.push('');              // a list right after prose is its own block, not inside the <p>
      out.push('<div class="appui-md-li appui-md-li-' + level + '" style="padding-left:' + (12 + level * 18) + 'px">' +
        marker + ' ' + m[3] + '</div>');
      prev = 'list';
    }
    return out.join('\n');
  }

  // --- marked (the offline copy in dependencies/marked, part of the foundation bundle) ---
  // A PRIVATE marked instance, hardened for model / tool output (untrusted): the global `marked` is left alone for
  // the file previews, which render the user's own documents. Here
  //   * raw HTML in the text is shown as text (marked passes it through by default - <img onerror>, <script>),
  //   * links: only http(s) / mailto / relative / # targets, always opened in a new tab with noopener,
  //   * images: http(s) / relative / data:image / blob only,
  //   * and the elements carry the inline look the chat always had (the page CSS may reset ul/ol/pre/table).
  const SAFE_HREF = /^(?:https?:|mailto:|tel:|vfs:|#|\/|\.{1,2}\/|[^:]*$)/i;
  const SAFE_SRC = /^(?:https?:|data:image\/(?:png|jpe?g|gif|webp|svg\+xml|bmp);|blob:|\/|\.{1,2}\/|[^:]*$)/i;
  const attr = v => escHtml(String(v == null ? '' : v)).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const PRE = 'background:var(--bg-primary);border:1px solid var(--border);border-radius:4px;padding:8px;overflow-x:auto;font-size:11px;margin:6px 0;line-height:1.4';
  const CODE = 'background:var(--bg-secondary);padding:1px 4px;border-radius:3px;font-size:11px';
  let _safe;                                            // the built instance (undefined until marked is there)
  function safeMarked() {
    if (_safe) return _safe;
    const M = window.marked;
    if (!M || typeof M.Marked !== 'function') return null;   // not cached: marked may still be loading, retried on the next call
    const inst = new M.Marked({gfm: true, breaks: false});
    inst.use({renderer: {
      html(html) { return escHtml(String(html && html.raw != null ? html.raw : html)); },
      link(href, title, text) {
        if (!SAFE_HREF.test(String(href || '').trim())) return text;          // javascript: / data: / vbscript: -> plain text
        return '<a href="' + attr(href) + '"' + (title ? ' title="' + attr(title) + '"' : '') +
          ' target="_blank" rel="noopener noreferrer">' + text + '</a>';
      },
      image(href, title, text) {
        if (!SAFE_SRC.test(String(href || '').trim())) return escHtml(text || '');
        return '<img src="' + attr(href) + '" alt="' + attr(text) + '"' + (title ? ' title="' + attr(title) + '"' : '') +
          ' style="max-width:100%">';
      },
      code(code, lang) {
        const l = String(lang || '').trim().split(/\s+/)[0].replace(/[^\w+#.-]/g, '');
        const hdr = '<div class="appui-md-code-bar" style="display:flex;justify-content:space-between;align-items:center;font-size:10px;opacity:.75;margin-bottom:4px">' +
          '<span>' + escHtml(l || 'code') + '</span>' +
          '<button type="button" class="appui-md-copy" style="font:inherit;padding:1px 6px;border:1px solid var(--border);border-radius:3px;background:transparent;color:inherit;cursor:pointer" ' +
          'onclick="(function(b){var c=b.parentNode&&b.parentNode.nextElementSibling;if(!c)return;var t=c.textContent||\'\';(navigator.clipboard?navigator.clipboard.writeText(t):Promise.reject()).then(function(){b.textContent=\'Copied\';setTimeout(function(){b.textContent=\'Copy\';},1200);},function(){});})(this)">Copy</button></div>';
        return '<pre style="' + PRE + '">' + hdr + '<code' + (l ? ' class="language-' + l + '"' : '') + '>' +
          escHtml(String(code).replace(/\n$/, '')) + '</code></pre>';
      },
      codespan(code) { return '<code style="' + CODE + '">' + code + '</code>'; },
      paragraph(text) { return '<p style="margin:4px 0">' + text + '</p>\n'; },
      heading(text, level) {
        return '<h' + level + ' style="font-size:' + Math.max(11, 16 - level) +
          'px;font-weight:bold;color:var(--accent);margin:8px 0 4px">' + text + '</h' + level + '>\n';
      },
      list(body, ordered, start) {
        const tag = ordered ? 'ol' : 'ul';
        return '<' + tag + (ordered && start !== 1 && start !== '' ? ' start="' + attr(start) + '"' : '') +
          ' style="margin:4px 0;padding-left:22px;list-style-position:outside;list-style-type:' + (ordered ? 'decimal' : 'disc') +
          '">' + body + '</' + tag + '>\n';
      },
      table(header, body) {
        return '<table class="appui-markdown-table" border="1" cellpadding="4" cellspacing="0" ' +
          'style="border-collapse:collapse;font-size:12px;margin:8px 0"><thead>' + header + '</thead><tbody>' + body + '</tbody></table>\n';
      },
      blockquote(quote) { return '<blockquote style="margin:6px 0;padding:0 10px;border-left:3px solid var(--border)">' + quote + '</blockquote>\n'; },
      hr() { return '<hr style="border:0;border-top:1px solid var(--border);margin:8px 0">\n'; },
    }});
    return (_safe = inst);
  }

  // --- Markdown Rendering ---
  function renderMarkdown(text) {
    if (!text) return '';
    // marked, hardened (see safeMarked). breaks:FALSE - a single newline is a soft wrap, only a blank line starts a
    // new paragraph (standard markdown); breaks:true double-spaced every reply.
    const m = safeMarked();
    if (m) {
      try { return m.parse(text); } catch (e) { /* fall through to the built-in renderer */ }
    }
    // Fallback: regex-based rendering
    // First, extract code blocks to protect them
    const codeBlocks = [];
    let html = text.replace(/```(\w*)\n([\s\S]*?)```/g, function(_, lang, code) {
      const idx = codeBlocks.length;
      codeBlocks.push('<pre style="background:var(--bg-primary);border:1px solid var(--border);border-radius:4px;padding:8px;overflow-x:auto;font-size:11px;margin:6px 0;line-height:1.4"><code>' + escHtml(code.replace(/\n$/, '')) + '</code></pre>');
      return `\x00CODEBLOCK_${idx}\x00`;
    });
    // Keep image markup out of prose escaping and inline formatting.
    html = html.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, function(_, alt, src) {
      const attr = value => escHtml(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      const idx = codeBlocks.length;
      codeBlocks.push('<img src="' + attr(src) + '" alt="' + attr(alt) + '" style="max-width:100%">');
      return `\x00CODEBLOCK_${idx}\x00`;
    });
    // Protect inline code and links before formatting surrounding prose.
    const attr = value => escHtml(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    html = html.replace(/`([^`\n]+)`/g, function(_, code) {
      const idx = codeBlocks.length;
      codeBlocks.push('<code style="background:var(--bg-secondary);padding:1px 4px;border-radius:3px;font-size:11px">' + escHtml(code) + '</code>');
      return `\x00CODEBLOCK_${idx}\x00`;
    });
    html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function(match, label, href) {
      if (/^(javascript|data|vbscript):/i.test(href)) return match;
      const idx = codeBlocks.length;
      codeBlocks.push('<a href="' + attr(href) + '" target="_blank" rel="noopener noreferrer">' + escHtml(label) + '</a>');
      return `\x00CODEBLOCK_${idx}\x00`;
    });
    // Escape HTML in the rest (prose)
    html = escHtml(html);
    // Inline code

    // Semantic headings keep document navigation and page styling available.
    html = html.replace(/^(#{1,6}) (.+)$/gm, function(_, hashes, title) {
      const level = hashes.length;
      const size = Math.max(11, 16 - level);
      return '<h' + level + ' style="font-size:' + size + 'px;font-weight:bold;color:var(--accent);margin:8px 0 4px">' + title + '</h' + level + '>';
    });
    // Bold / Italic
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // a single-line span whose opening * is not followed by a space: "* item" bullet lines must not pair up
    // with the next bullet's * and turn the text between them into <em>
    html = html.replace(/(?<!\*)\*(?![\s*])([^*\n]+)\*(?!\*)/g, '<em>$1</em>');
    html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    html = html.replace(/(?<![\w_])_([^_]+)_(?![\w_])/g, '<em>$1</em>');
    html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    html = html.replace(/^&gt; ?(.+)$/gm, '<blockquote>$1</blockquote>');
    // Lists - nesting follows the source indentation (see renderLists)
    html = renderLists(html);
    // Markdown tables preserve empty cells and remain intact across newline handling.
    html = html.replace(/^(\|[^\n]+\|)\n\|[ \t:|-]+\|\n((?:\|[^\n]*\|(?:\n|$))*)/gm, function(_, header, rows) {
      const cells = row => row.trim().slice(1, -1).split('|').map(cell => cell.trim());
      const head = cells(header).map(cell => '<th>' + cell + '</th>').join('');
      const body = rows.trim().split('\n').filter(Boolean).map(row =>
        '<tr>' + cells(row).map(cell => '<td>' + cell + '</td>').join('') + '</tr>').join('');
      const idx = codeBlocks.length;
      codeBlocks.push('<table class="appui-markdown-table" border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse;font-size:12px;margin:8px 0"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table>');
      return `\x00CODEBLOCK_${idx}\x00`;
    });
    // PARAGRAPHS (breaks:false): split on BLANK lines → <p>; within a block a
    // single newline is a soft wrap (space). A block that is already a
    // block-level element (heading/list-div/blockquote/table placeholder) is
    // emitted as-is, not wrapped in <p>.
    const BLOCK_RE = /^\s*(<h[1-6]|<div|<blockquote|<pre|\x00CODEBLOCK_)/;
    html = html.split(/\n{2,}/).map(function(block) {
      const b = block.replace(/^\n+|\n+$/g, '');
      if (!b.trim()) return '';
      if (BLOCK_RE.test(b)) return b.replace(/\n/g, ' ');
      return '<p style="margin:4px 0">' + b.replace(/\n/g, ' ') + '</p>';
    }).join('');
    // Restore code blocks
    for (let i = codeBlocks.length - 1; i >= 0; i--) {
      html = html.replace(`\x00CODEBLOCK_${i}\x00`, () => codeBlocks[i]);
    }
    return html;
  }

  return {escHtml,renderMarkdown,renderLists};
})();
