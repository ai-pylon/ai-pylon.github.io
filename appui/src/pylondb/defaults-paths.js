/* Private path metadata defaults; registration is invoked in the original order. */
window._AppUIPylonPathDefaults = {
  register(PT) {
    'use strict';
    var esc = PT.util.esc, row = PT.util.row, fmtSz = PT.util.formatSize;
    var lang = PT.util.langName, badge = PT.util.badge;
    // ═══════════════════════════════════════════════════════════════
    // path.namespace
    // ═══════════════════════════════════════════════════════════════

    PT.register('path.namespace', {
      render: function (el, node) {
        var meta = node.metadata || {};
        var html = '<div style="font-size:11px">';
        html += '<div style="color:#c792ea;margin-bottom:4px;font-weight:600">\uD83C\uDFE0 Namespace: ' + esc(node.key || '') + '</div>';
        if (meta.location) html += row('Location', esc(meta.location));
        if (meta.root) html += row('Root', '<span style="word-break:break-all;font-size:10px">' + esc(meta.root) + '</span>');
        html += '</div>';
        el.innerHTML = html;
      },
      icon: function () { return { emoji: '\uD83D\uDCE6', color: '#c792ea' }; },
    });

    // ═══════════════════════════════════════════════════════════════
    // path.folder
    // ═══════════════════════════════════════════════════════════════

    PT.register('path.folder', {
      render: function (el, node) {
        var meta = node.metadata || {};
        var html = '<div style="font-size:11px">';
        html += '<div style="color:#888;margin-bottom:4px">\uD83D\uDCC1 Folder</div>';
        html += row('Path', esc(meta.disk_path || node.key || ''));
        html += '</div>';
        el.innerHTML = html;
      },
      icon: function () { return { emoji: '\uD83D\uDCC1', color: '#888' }; },
    });

    // ═══════════════════════════════════════════════════════════════
    // path.item (file node)
    // ═══════════════════════════════════════════════════════════════

    PT.register('path.item', {
      render: function (el, node) {
        var meta = node.metadata || {};
        var html = '<div style="font-size:11px">';
        html += '<div style="color:#888;margin-bottom:4px">\uD83D\uDCC4 File</div>';
        if (meta.extension || meta.ext) html += row('Extension', '<code>' + esc(meta.extension || meta.ext) + '</code>');
        if (meta.disk_path) html += row('Path', '<span style="word-break:break-all">' + esc(meta.disk_path) + '</span>');
        if (meta.size != null) html += row('Size', fmtSz(meta.size));
        if (node.hash) html += row('Hash', '<code style="font-size:10px;word-break:break-all">' + esc(node.hash) + '</code>');
        if (meta.mtime) html += row('Modified', new Date(meta.mtime * 1000).toLocaleString());
        html += '</div>';
        el.innerHTML = html;
      },
      icon: function (node) {
        var kind = ((node.metadata || {}).kind || '');
        var map = {
          tool:     { emoji: '\u2699',        color: '#82aaff' },
          workflow: { emoji: '\u26A1',        color: '#ffcb6b' },
          agent:    { emoji: '\uD83E\uDD16',  color: '#c3e88d' },
          image:    { emoji: '\uD83D\uDDBC',  color: '#c3e88d' },
          document: { emoji: '\uD83D\uDCC4',  color: '#888'    },
          code:     { emoji: '\uD83D\uDCDD',  color: '#4fc3f7' },
        };
        return map[kind] || { emoji: '\uD83D\uDCC4', color: '#888' };
      },
    });

    // ═══════════════════════════════════════════════════════════════
    // path.item/tool
    // ═══════════════════════════════════════════════════════════════

    PT.register('path.item/tool', {
      render: function (el, node, opts) {
        var meta = node.metadata || {};
        var html = '<div style="font-size:11px">';
        html += '<div style="color:#82aaff;margin-bottom:6px;font-weight:600">\uD83D\uDD27 Tool: ' + esc(node.key || '') + '</div>';
        if (node.description || node.content) {
          html += '<div style="color:#ccc;margin-bottom:6px;font-style:italic">' + esc(node.description || node.content) + '</div>';
        }
        if (meta.params && meta.params.length) {
          html += '<div style="margin-bottom:4px"><span style="color:#888">Parameters:</span></div><div style="margin-left:8px">';
          meta.params.forEach(function (p) { html += '<div style="padding:1px 0"><code style="color:#c3e88d;font-size:11px">' + esc(p) + '</code></div>'; });
          html += '</div>';
        } else {
          html += row('Parameters', '<span style="opacity:0.5">none</span>');
        }
        if (meta.requires && meta.requires.length) {
          html += '<div style="margin-top:4px"><span style="color:#888">Requires:</span></div><div style="margin-left:8px">';
          meta.requires.forEach(function (r) { html += badge(r, '#ffcb6b'); });
          html += '</div>';
        }
        if (meta.source_file) {
          var lineInfo = '';
          if (meta.line && meta.end_line) lineInfo = ' (L' + meta.line + '\u2013' + meta.end_line + ', ' + (meta.end_line - meta.line + 1) + ' lines)';
          else if (meta.line) lineInfo = ' (L' + meta.line + ')';
          var sourceLink = esc(meta.source_file) + lineInfo;
          if (opts.sourceRoot) {
            html += '<div style="margin-top:6px"><span style="color:#888">Source:</span> ';
            html += '<a href="javascript:void(0)" onclick="window._openFile && window._openFile(\'' + esc(meta.source_file).replace(/'/g, '') + '\')" style="color:var(--accent,#4fc3f7);text-decoration:none;font-size:11px">' + sourceLink + '</a></div>';
          } else {
            html += row('Source', sourceLink);
          }
        }
        if (meta['function']) html += row('Function', '<code>' + esc(meta['function']) + '</code>');
        html += '</div>';
        el.innerHTML = html;
      },
      icon: function () { return { emoji: '\uD83D\uDD27', color: '#82aaff' }; },
    });

    // ═══════════════════════════════════════════════════════════════
    // path.item/code
    // ═══════════════════════════════════════════════════════════════

    PT.register('path.item/code', {
      render: function (el, node) {
        var meta = node.metadata || {};
        var html = '<div style="font-size:11px">';
        html += '<div style="color:#4fc3f7;margin-bottom:4px;font-weight:600">\uD83D\uDCBB Source: ' + esc(node.key || '') + '</div>';
        if (meta.extension) html += row('Language', lang(meta.extension));
        if (meta.disk_path) html += row('Path', '<span style="word-break:break-all">' + esc(meta.disk_path) + '</span>');
        if (meta.size != null) html += row('Size', fmtSz(meta.size));
        if (node.hash) html += row('Hash', '<code style="font-size:10px;word-break:break-all">' + esc(node.hash) + '</code>');
        if (meta.mtime) html += row('Modified', new Date(meta.mtime * 1000).toLocaleString());
        html += '</div>';
        el.innerHTML = html;
      },
      icon: function () { return { emoji: '\uD83D\uDCBB', color: '#4fc3f7' }; },
    });

    // ═══════════════════════════════════════════════════════════════
    // path.item/document
    // ═══════════════════════════════════════════════════════════════

    PT.register('path.item/document', {
      render: function (el, node) {
        var meta = node.metadata || {};
        var html = '<div style="font-size:11px">';
        html += '<div style="color:#888;margin-bottom:4px">\uD83D\uDCC3 Document: ' + esc(node.key || '') + '</div>';
        if (meta.extension) html += row('Type', lang(meta.extension));
        if (meta.disk_path) html += row('Path', '<span style="word-break:break-all">' + esc(meta.disk_path) + '</span>');
        if (meta.size != null) html += row('Size', fmtSz(meta.size));
        html += '</div>';
        el.innerHTML = html;
      },
      icon: function () { return { emoji: '\uD83D\uDCC3', color: '#888' }; },
    });
  },
};
