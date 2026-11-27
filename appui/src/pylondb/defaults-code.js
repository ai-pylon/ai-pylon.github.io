/* Default PylonDB type plugins; loaded in bundle order after the type registry. */
(function(){
  'use strict';
  var PT=window.AppUIPylonTypes;
  if(!PT)return;
  var esc=PT.util.esc,row=PT.util.row;

  // ═══════════════════════════════════════════════════════════════
  // code.function
  // ═══════════════════════════════════════════════════════════════

  PT.register('code.function', {
    render: function (el, node) {
      var meta = node.metadata || {};
      var html = '<div style="font-size:11px">';
      html += '<div style="color:#c3e88d;margin-bottom:4px;font-weight:600">\u0192 Function: ' + esc(node.key || '') + '</div>';
      if (node.content) html += '<div style="color:#aaa;margin-bottom:4px;font-style:italic">' + esc(node.content) + '</div>';
      if (meta.params && meta.params.length) {
        html += row('Params', meta.params.map(function (p) { return '<code>' + esc(p) + '</code>'; }).join(', '));
      }
      if (meta.line) html += row('Line', meta.line);
      html += '</div>';
      el.innerHTML = html;
    },
    icon: function () { return { emoji: '\u0192', color: '#c3e88d' }; },
  });

  // ═══════════════════════════════════════════════════════════════
  // code.class
  // ═══════════════════════════════════════════════════════════════

  PT.register('code.class', {
    render: function (el, node) {
      var meta = node.metadata || {};
      var html = '<div style="font-size:11px">';
      html += '<div style="color:#ffcb6b;margin-bottom:4px;font-weight:600">\u25C7 Class: ' + esc(node.key || '') + '</div>';
      if (node.content) html += '<div style="color:#aaa;margin-bottom:4px;font-style:italic">' + esc(node.content) + '</div>';
      if (meta.methods && meta.methods.length) {
        html += '<div style="margin-top:4px"><span style="color:#888">Methods (' + meta.methods.length + '):</span></div><div style="margin-left:8px">';
        meta.methods.forEach(function (m) { html += '<div style="padding:1px 0"><code style="color:#c3e88d;font-size:11px">' + esc(m) + '</code></div>'; });
        html += '</div>';
      }
      if (meta.line) html += row('Line', meta.line);
      html += '</div>';
      el.innerHTML = html;
    },
    icon: function () { return { emoji: '\u25C7', color: '#ffcb6b' }; },
  });

  // ═══════════════════════════════════════════════════════════════
  // code.folder (alias for path.folder in code index)
  // ═══════════════════════════════════════════════════════════════

  PT.register('code.folder', {
    render: function (el, node) {
      var html = '<div style="font-size:11px">';
      html += '<div style="color:#888;margin-bottom:4px">\uD83D\uDCC1 Folder</div>';
      html += row('Path', esc(node.key || ''));
      html += '</div>';
      el.innerHTML = html;
    },
    icon: function () { return { emoji: '\uD83D\uDCC1', color: '#888' }; },
  });


})();
