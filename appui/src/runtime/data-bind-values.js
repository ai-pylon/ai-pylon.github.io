/* Value paths and display policies for declarative DataBind; no source or DOM ownership. */
window._AppUIDataBindValues=(function(){
  'use strict';
  // ── Path resolution ──

  function _resolvePath(obj, path) {
    if (!path) return obj;
    var parts = path.split('.');
    var current = obj;
    for (var i = 0; i < parts.length; i++) {
      if (current === null || current === undefined) return undefined;
      var part = parts[i];
      // Support array.length, array.0, etc.
      if (Array.isArray(current) && part === 'length') return current.length;
      if (Array.isArray(current) && /^\d+$/.test(part)) { current = current[parseInt(part)]; continue; }
      // Support "last" for last array element
      if (Array.isArray(current) && part === 'last') { current = current[current.length - 1]; continue; }
      current = current[part];
    }
    return current;
  }

  // ── Formatters ──

  function _formatValue(value, format) {
    if (!format) return String(value);
    switch (format) {
      case 'number': return typeof value === 'number' ? value.toLocaleString() : String(value);
      case 'credits': return typeof value === 'number' ? value.toFixed(2) : String(value);
      case 'percent': return typeof value === 'number' ? value.toFixed(1) + '%' : String(value);
      case 'size':
        var bytes = parseInt(value) || 0;
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / 1048576).toFixed(1) + ' MB';
      case 'date':
        try { return new Date(value).toLocaleString(); } catch(e) { return String(value); }
      case 'ago':
        try {
          var ms = Date.now() - new Date(value).getTime();
          var h = ms / 3600000;
          if (h < 1) return Math.floor(ms / 60000) + 'm ago';
          if (h < 24) return Math.floor(h) + 'h ago';
          return Math.floor(h / 24) + 'd ago';
        } catch(e) { return String(value); }
      case 'tokens':
        var t = parseInt(value) || 0;
        if (t < 1000) return t + '';
        if (t < 1000000) return (t / 1000).toFixed(0) + 'K';
        return (t / 1000000).toFixed(2) + 'M';
      case 'json': return JSON.stringify(value, null, 2);
      default: return String(value);
    }
  }

  // ── Renderers (for complex values) ──

  function _renderValue(value, render) {
    var _esc = function(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); };
    switch (render) {
      case 'table':
        if (Array.isArray(value) && value.length) {
          var keys = Object.keys(value[0]);
          var html = '<table class="table"><tr>' + keys.map(function(k) { return '<th>' + _esc(k) + '</th>'; }).join('') + '</tr>';
          value.forEach(function(row) { html += '<tr>' + keys.map(function(k) { return '<td>' + _esc(row[k]) + '</td>'; }).join('') + '</tr>'; });
          return html + '</table>';
        }
        if (typeof value === 'object' && value) {
          var html2 = '<table class="table">';
          Object.keys(value).forEach(function(k) { html2 += '<tr><td style="color:var(--text-muted)">' + _esc(k) + '</td><td>' + _esc(JSON.stringify(value[k])) + '</td></tr>'; });
          return html2 + '</table>';
        }
        return _esc(String(value));
      case 'list':
        if (Array.isArray(value)) {
          return '<ul style="margin:0;padding-left:16px">' + value.map(function(v) { return '<li>' + _esc(typeof v === 'object' ? JSON.stringify(v) : v) + '</li>'; }).join('') + '</ul>';
        }
        return _esc(String(value));
      case 'raw':
        return String(value);
      default:
        return _esc(String(value));
    }
  }

  return {resolvePath:_resolvePath,formatValue:_formatValue,renderValue:_renderValue};
})();
