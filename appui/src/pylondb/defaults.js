/* pylon/appui/pylondb/defaults.js — Default AppUIPylonTypes plugins.
 *
 * Registers renderers, icons, and validators for the standard PylonDB node
 * types used across file_nav, pylondb explorer, and federation pages.
 *
 * Load after type-registry.js, before type-processors.js.
 */
(function () {
  'use strict';

  var PT = window.AppUIPylonTypes;
  if (!PT) return;

  var esc   = PT.util.esc;
  var row   = PT.util.row;
  var fmtSz = PT.util.formatSize;
  var lang  = PT.util.langName;

  // ═══════════════════════════════════════════════════════════════
  // Fallback '*'
  // ═══════════════════════════════════════════════════════════════

  PT.register('*', {
    render: function (el, node) {
      var meta = node.metadata || {};
      var html = '<div style="font-size:11px">';
      html += '<div style="color:#888;margin-bottom:4px">Node Details</div>';
      if (node.hash) html += row('Hash', '<code style="font-size:10px">' + esc(node.hash) + '</code>');
      if (meta.size != null) html += row('Size', fmtSz(meta.size));
      if (meta.mtime) html += row('Modified', new Date(meta.mtime * 1000).toLocaleString());
      var skip = { kind:1, size:1, mtime:1, path:1, ext:1, hash:1, params:1, requires:1,
                   source_file:1, line:1, end_line:1, 'function':1, methods:1, disk_path:1 };
      Object.keys(meta).filter(function (k) { return !skip[k] && meta[k] != null; }).forEach(function (k) {
        var v = meta[k];
        html += row(k, typeof v === 'object' ? '<code style="font-size:10px">' + esc(JSON.stringify(v)) + '</code>' : esc(String(v)));
      });
      html += '</div>';
      el.innerHTML = html;
    },
    icon: function () { return { emoji: '\uD83D\uDCC4', color: '#888' }; },
  });

  window._AppUIPylonPathDefaults.register(PT);

  // ═══════════════════════════════════════════════════════════════
  // file.document
  // ═══════════════════════════════════════════════════════════════

  PT.register('file.document', {
    render: function (el, node) {
      var meta = node.metadata || {};
      var html = '<div style="font-size:11px">';
      html += '<div style="color:#c792ea;margin-bottom:4px;font-weight:600">\uD83D\uDCD6 Document Root</div>';
      html += row('Name', esc(node.key || ''));
      if (meta.total_files) html += row('Files', meta.total_files);
      if (meta.source) html += row('Source', '<span style="word-break:break-all">' + esc(meta.source) + '</span>');
      html += '</div>';
      el.innerHTML = html;
    },
    icon: function () { return { emoji: '\uD83D\uDCD6', color: '#c792ea' }; },
  });

  // ═══════════════════════════════════════════════════════════════
  // file.code
  // ═══════════════════════════════════════════════════════════════

  PT.register('file.code', {
    render: function (el, node) {
      var meta = node.metadata || {};
      var html = '<div style="font-size:11px">';
      html += '<div style="color:#888;margin-bottom:4px">\uD83D\uDCBB Source File</div>';
      if (meta.ext) html += row('Language', lang(meta.ext));
      if (meta.size != null) html += row('Size', fmtSz(meta.size));
      if (meta.path) html += row('Path', '<span style="word-break:break-all">' + esc(meta.path) + '</span>');
      if (meta.mtime) html += row('Modified', new Date(meta.mtime * 1000).toLocaleString());
      html += '</div>';
      el.innerHTML = html;
    },
    icon: function () { return { emoji: '\uD83D\uDCBB', color: '#4fc3f7' }; },
  });


})();
