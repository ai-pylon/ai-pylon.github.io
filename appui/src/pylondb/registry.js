/* pylon/appui/pylondb/registry.js — PylonDB node type plugin system.
 *
 * Provides type-aware rendering, processing, icons, and validation for any
 * page that works with PylonDB nodes. Hierarchical type matching: most
 * specific plugin wins.
 *
 * Resolution order (first match wins):
 *   1. type/kind    e.g., 'path.item/tool'
 *   2. type         e.g., 'path.item'
 *   3. parent type  e.g., 'path' (first dot segment)
 *   4. kind alone   e.g., 'tool'
 *   5. '*'          fallback
 *
 * Plugin shape:
 *   AppUIPylonTypes.register('path.item/tool', {
 *     render: function(el, node, opts) {},    // UI renderer
 *     actions: function(node, opts) {},        // returns [{name, label, icon, run}]
 *     icon: function(node) {},                 // returns {emoji, color}
 *     validate: function(node) {},             // returns [] or [{field, message}]
 *   })
 *
 * Usage:
 *   AppUIPylonTypes.render(el, node, opts)     // render node detail
 *   AppUIPylonTypes.actions(node, opts)        // get available actions
 *   AppUIPylonTypes.icon(node)                 // get {emoji, color} for tree/list
 *   AppUIPylonTypes.validate(node)             // check metadata completeness
 *   AppUIPylonTypes.register(type, plugin)     // add/override a type plugin
 *   AppUIPylonTypes.resolve(node)              // get the matched plugin
 */
window.AppUIPylonTypes = (function () {
  'use strict';

  var _plugins = {};

  // ═══════════════════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════════════════

  function esc(s) {
    if (!s) return '';
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function row(label, value) {
    return '<div style="display:flex;gap:8px;padding:2px 0"><span style="color:#888;min-width:70px;flex-shrink:0">' + label + '</span><span>' + value + '</span></div>';
  }

  function formatSize(bytes) {
    if (!bytes && bytes !== 0) return '-';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  function langName(ext) {
    var map = {
      '.py': 'Python', '.js': 'JavaScript', '.ts': 'TypeScript', '.c': 'C', '.cpp': 'C++',
      '.h': 'C/C++ Header', '.java': 'Java', '.go': 'Go', '.rs': 'Rust', '.json': 'JSON',
      '.html': 'HTML', '.css': 'CSS', '.md': 'Markdown', '.sh': 'Shell', '.bat': 'Batch',
      '.yaml': 'YAML', '.yml': 'YAML', '.xml': 'XML', '.sql': 'SQL', '.toml': 'TOML',
    };
    return map[ext] || ext;
  }

  function badge(text, color) {
    return '<span style="display:inline-block;background:rgba(' + _hexToRgb(color) + ',0.12);color:' + color + ';padding:1px 6px;border-radius:3px;font-size:10px;margin:2px 2px 0 0">' + esc(text) + '</span>';
  }

  function _hexToRgb(hex) {
    var r = parseInt(hex.slice(1, 3), 16) || 0;
    var g = parseInt(hex.slice(3, 5), 16) || 0;
    var b = parseInt(hex.slice(5, 7), 16) || 0;
    return r + ',' + g + ',' + b;
  }

  // ═══════════════════════════════════════════════════════════════
  // Registry
  // ═══════════════════════════════════════════════════════════════

  function register(typePattern, plugin) {
    // Normalize: accept a function as shorthand for {render: fn}
    if (typeof plugin === 'function') {
      plugin = { render: plugin };
    }
    _plugins[typePattern] = plugin;
  }

  function _resolve(node) {
    var type = (node.type || node.type_name || '');
    var kind = ((node.metadata || {}).kind || '');

    // 1. type/kind (most specific)
    if (kind && _plugins[type + '/' + kind]) return _plugins[type + '/' + kind];
    // 2. exact type
    if (_plugins[type]) return _plugins[type];
    // 3. parent type (first segment before last dot)
    var dot = type.lastIndexOf('.');
    if (dot > 0 && _plugins[type.substring(0, dot)]) return _plugins[type.substring(0, dot)];
    // 4. kind alone
    if (kind && _plugins[kind]) return _plugins[kind];
    // 5. fallback
    return _plugins['*'] || {};
  }

  // ═══════════════════════════════════════════════════════════════
  // Public API
  // ═══════════════════════════════════════════════════════════════

  function render(el, node, opts) {
    var plugin = _resolve(node);
    if (!plugin.render) {
      el.innerHTML = '<div style="font-size:11px;color:#888">No renderer for type: ' + esc(node.type) + '</div>';
      return;
    }
    try {
      plugin.render(el, node, opts || {});
    } catch (e) {
      el.innerHTML = '<div style="color:#ff5370;font-size:11px">Render error: ' + esc(String(e)) + '</div>';
    }
  }

  function actions(node, opts) {
    var plugin = _resolve(node);
    if (!plugin.actions) return [];
    try {
      return plugin.actions(node, opts || {}) || [];
    } catch (e) {
      return [];
    }
  }

  function icon(node) {
    var plugin = _resolve(node);
    if (plugin.icon) {
      try { return plugin.icon(node); } catch (e) {}
    }
    return { emoji: '\uD83D\uDCC4', color: '#888' };
  }

  function validate(node) {
    var plugin = _resolve(node);
    if (!plugin.validate) return [];
    try {
      return plugin.validate(node) || [];
    } catch (e) {
      return [{ field: '_error', message: String(e) }];
    }
  }

  function resolve(node) {
    return _resolve(node);
  }

  function types() {
    return Object.keys(_plugins);
  }

  // ═══════════════════════════════════════════════════════════════
  // Exports — also expose helpers for type-defaults.js
  // ═══════════════════════════════════════════════════════════════

  return {
    register: register,
    render: render,
    actions: actions,
    icon: icon,
    validate: validate,
    resolve: resolve,
    types: types,
    // Shared helpers for plugin authors
    util: {
      esc: esc,
      row: row,
      formatSize: formatSize,
      langName: langName,
      badge: badge,
    },
  };
})();
