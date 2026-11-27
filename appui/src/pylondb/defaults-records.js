/* Default PylonDB type plugins; loaded in bundle order after the type registry. */
(function(){
  'use strict';
  var PT=window.AppUIPylonTypes;
  if(!PT)return;
  var esc=PT.util.esc,row=PT.util.row,badge=PT.util.badge;

  // ═══════════════════════════════════════════════════════════════
  // document.slide
  // ═══════════════════════════════════════════════════════════════

  PT.register('document.slide', {
    render: function (el, node) {
      var html = '<div style="font-size:11px">';
      html += '<div style="color:#c792ea;margin-bottom:4px">\uD83C\uDFAC Slide</div>';
      html += row('Name', esc(node.key || ''));
      if (node.content) html += '<div style="color:#ccc;margin-bottom:4px">' + esc(node.content.substring(0, 200)) + '</div>';
      html += '</div>';
      el.innerHTML = html;
    },
    icon: function () { return { emoji: '\uD83C\uDFAC', color: '#c792ea' }; },
  });

  // ═══════════════════════════════════════════════════════════════
  // workflow.step
  // ═══════════════════════════════════════════════════════════════

  PT.register('workflow.step', {
    render: function (el, node) {
      var meta = node.metadata || {};
      var html = '<div style="font-size:11px">';
      html += '<div style="color:#82aaff;margin-bottom:4px;font-weight:600">\u2699\uFE0F Step: ' + esc(node.key || '') + '</div>';
      if (meta.step_type) html += row('Type', '<code>' + esc(meta.step_type) + '</code>');
      if (meta.params && Object.keys(meta.params).length) {
        html += '<div style="margin-top:4px"><span style="color:#888">Params:</span></div><div style="margin-left:8px">';
        Object.keys(meta.params).forEach(function (k) {
          html += '<div style="padding:1px 0"><code style="color:#c3e88d;font-size:11px">' + esc(k) + '</code>: <span style="color:#ccc">' + esc(String(meta.params[k])) + '</span></div>';
        });
        html += '</div>';
      }
      if (meta.dependencies && meta.dependencies.length) {
        html += '<div style="margin-top:4px"><span style="color:#888">Dependencies:</span></div><div style="margin-left:8px">';
        meta.dependencies.forEach(function (d) { html += badge(d, '#4fc3f7'); });
        html += '</div>';
      }
      if (meta.status) {
        var statusColor = meta.status === 'ok' || meta.status === 'done' ? '#c3e88d' : meta.status === 'error' ? '#ff5370' : '#ffcb6b';
        html += row('Status', '<span style="color:' + statusColor + '">' + esc(meta.status) + '</span>');
      }
      html += '</div>';
      el.innerHTML = html;
    },
    icon: function () { return { emoji: '\u2699\uFE0F', color: '#82aaff' }; },
  });

  // ═══════════════════════════════════════════════════════════════
  // config.entry
  // ═══════════════════════════════════════════════════════════════

  PT.register('config.entry', {
    render: function (el, node) {
      var meta = node.metadata || {};
      var html = '<div style="font-size:11px">';
      html += '<div style="color:#ffcb6b;margin-bottom:4px;font-weight:600">\u2699 Config: ' + esc(node.key || '') + '</div>';
      if (meta.config_key) html += row('Key', '<code>' + esc(meta.config_key) + '</code>');
      if (meta.value != null) {
        var valStr = typeof meta.value === 'object' ? JSON.stringify(meta.value) : String(meta.value);
        html += row('Value', '<code style="font-size:10px">' + esc(valStr) + '</code>');
      }
      if (meta.source_file) html += row('Source', '<span style="word-break:break-all;font-size:10px">' + esc(meta.source_file) + '</span>');
      if (meta.has_overrides) {
        html += row('Overrides', '<span style="color:#ff5370">\u26A0 Has overrides</span>');
      } else {
        html += row('Overrides', '<span style="color:#888">None</span>');
      }
      html += '</div>';
      el.innerHTML = html;
    },
    icon: function () { return { emoji: '\u2699', color: '#ffcb6b' }; },
  });

  // ═══════════════════════════════════════════════════════════════
  // event.channel
  // ═══════════════════════════════════════════════════════════════

  PT.register('event.channel', {
    render: function (el, node) {
      var meta = node.metadata || {};
      var html = '<div style="font-size:11px">';
      html += '<div style="color:#c792ea;margin-bottom:4px;font-weight:600">\uD83D\uDCE1 Channel: ' + esc(node.key || '') + '</div>';
      if (meta.channel_name) html += row('Name', esc(meta.channel_name));
      if (meta.subscriber_count != null) html += row('Subscribers', '<span style="color:#c3e88d">' + meta.subscriber_count + '</span>');
      if (meta.recent_event_count != null) html += row('Recent events', '<span style="color:#82aaff">' + meta.recent_event_count + '</span>');
      html += '</div>';
      el.innerHTML = html;
    },
    icon: function () { return { emoji: '\uD83D\uDCE1', color: '#c792ea' }; },
  });

  // ═══════════════════════════════════════════════════════════════
  // edge.cross_ref + edge.* fallback
  // ═══════════════════════════════════════════════════════════════

  var _edgeRender = function (el, node) {
    var meta = node.metadata || {};
    var html = '<div style="font-size:11px">';
    html += '<div style="color:#4fc3f7;margin-bottom:4px;font-weight:600">\uD83D\uDD17 Edge: ' + esc(node.key || '') + '</div>';
    if (meta.source) html += row('Source', '<code style="font-size:10px">' + esc(meta.source) + '</code>');
    if (meta.target) html += row('Target', '<code style="font-size:10px">' + esc(meta.target) + '</code>');
    if (meta.confidence != null) {
      var pct = (meta.confidence * 100).toFixed(1) + '%';
      var confColor = meta.confidence >= 0.8 ? '#c3e88d' : meta.confidence >= 0.5 ? '#ffcb6b' : '#ff5370';
      html += row('Confidence', '<span style="color:' + confColor + '">' + pct + '</span>');
    }
    if (meta.edge_type) html += row('Type', badge(meta.edge_type, '#4fc3f7'));
    html += '</div>';
    el.innerHTML = html;
  };
  var _edgeIcon = function () { return { emoji: '\uD83D\uDD17', color: '#4fc3f7' }; };

  PT.register('edge.cross_ref', { render: _edgeRender, icon: _edgeIcon });
  PT.register('edge.*', { render: _edgeRender, icon: _edgeIcon });

  // ═══════════════════════════════════════════════════════════════
  // mkdoc.section
  // ═══════════════════════════════════════════════════════════════

  PT.register('mkdoc.section', {
    render: function (el, node) {
      var meta = node.metadata || {};
      var html = '<div style="font-size:11px">';
      var levelTag = meta.level ? 'H' + meta.level + ': ' : '';
      html += '<div style="color:#c3e88d;margin-bottom:4px;font-weight:600">\uD83D\uDCDD ' + levelTag + esc(node.key || '') + '</div>';
      if (meta.level) html += row('Level', meta.level);
      if (meta.backlink_count != null) html += row('Backlinks', '<span style="color:#c792ea">' + meta.backlink_count + '</span>');
      if (meta.cross_ref_count != null) html += row('Cross-refs', '<span style="color:#4fc3f7">' + meta.cross_ref_count + '</span>');
      if (node.content) {
        var preview = node.content.length > 200 ? node.content.substring(0, 200) + '\u2026' : node.content;
        html += '<div style="color:#ccc;margin-top:4px;white-space:pre-wrap;max-height:100px;overflow:auto;font-size:10px">' + esc(preview) + '</div>';
      }
      html += '</div>';
      el.innerHTML = html;
    },
    icon: function () { return { emoji: '\uD83D\uDCDD', color: '#c3e88d' }; },
  });


})();
