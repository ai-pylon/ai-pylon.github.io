/* Default PylonDB type plugins; loaded in bundle order after the type registry. */
(function(){
  'use strict';
  var PT=window.AppUIPylonTypes;
  if(!PT)return;
  var esc=PT.util.esc,row=PT.util.row;

  // ═══════════════════════════════════════════════════════════════
  // document.heading
  // ═══════════════════════════════════════════════════════════════

  PT.register('document.heading', {
    render: function (el, node) {
      var meta = node.metadata || {};
      var level = meta.level || 2;
      var html = '<div style="font-size:11px">';
      html += '<div style="color:#82aaff;margin-bottom:4px;font-weight:600">H' + level + ': ' + esc(node.key ? node.key.split('::').pop() : '') + '</div>';
      if (node.content) html += '<div style="color:#ccc;margin-bottom:4px">' + esc(node.content) + '</div>';
      html += row('Level', level);
      if (meta._detected) html += row('Detected by', esc(meta._detected));
      html += '</div>';
      el.innerHTML = html;
    },
    icon: function () { return { emoji: '\uD83D\uDCD6', color: '#82aaff' }; },
  });

  // ═══════════════════════════════════════════════════════════════
  // document.paragraph
  // ═══════════════════════════════════════════════════════════════

  PT.register('document.paragraph', {
    render: function (el, node) {
      var meta = node.metadata || {};
      var html = '<div style="font-size:11px">';
      html += '<div style="color:#888;margin-bottom:4px">\u00B6 Paragraph</div>';
      if (node.content) {
        var preview = node.content.length > 200 ? node.content.substring(0, 200) + '\u2026' : node.content;
        html += '<div style="color:#ccc;margin-bottom:4px;white-space:pre-wrap;max-height:120px;overflow:auto">' + esc(preview) + '</div>';
      }
      if (meta._page_break) html += row('Page break', '\u2714');
      if (meta.description_source) html += row('Description', esc(meta.description_source));
      html += '</div>';
      el.innerHTML = html;
    },
    icon: function () { return { emoji: '\uD83D\uDCDD', color: '#888' }; },
  });

  // ═══════════════════════════════════════════════════════════════
  // document.table
  // ═══════════════════════════════════════════════════════════════

  PT.register('document.table', {
    render: function (el, node) {
      var meta = node.metadata || {};
      var html = '<div style="font-size:11px">';
      html += '<div style="color:#ffcb6b;margin-bottom:4px">\uD83D\uDCCA Table</div>';
      if (node.content) html += '<div style="color:#ccc;margin-bottom:4px">' + esc(node.content.substring(0, 150)) + '</div>';
      if (meta.rows) html += row('Rows', meta.rows);
      if (meta.cols) html += row('Columns', meta.cols);
      html += '</div>';
      el.innerHTML = html;
    },
    icon: function () { return { emoji: '\uD83D\uDCCA', color: '#ffcb6b' }; },
  });

  // ═══════════════════════════════════════════════════════════════
  // document.image
  // ═══════════════════════════════════════════════════════════════

  PT.register('document.image', {
    render: function (el, node) {
      var meta = node.metadata || {};
      var html = '<div style="font-size:11px">';
      html += '<div style="color:#c3e88d;margin-bottom:4px">\uD83D\uDDBC Image</div>';
      if (meta.src) {
        html += '<div style="margin-bottom:6px;text-align:center"><img src="' + esc(meta.src) + '" style="max-width:100%;max-height:150px;border-radius:4px;border:1px solid var(--border,#333)" onerror="this.style.display=\'none\'"></div>';
        html += row('Source', '<span style="word-break:break-all;font-size:10px">' + esc(meta.src) + '</span>');
      }
      if (meta.width) html += row('Width', esc(meta.width));
      if (meta.height) html += row('Height', esc(meta.height));
      if (meta.object_type) html += row('Type', esc(meta.object_type));
      html += '</div>';
      el.innerHTML = html;
    },
    icon: function () { return { emoji: '\uD83D\uDDBC', color: '#c3e88d' }; },
  });


})();
