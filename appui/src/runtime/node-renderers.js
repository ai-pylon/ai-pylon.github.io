/**
 * Pluggable node renderer system.
 * 
 * Usage:
 *   // Register a renderer
 *   AppUINodeRenderers.register('code.function', function(container, node, ctx) {
 *     container.innerHTML = '...';
 *   });
 *
 *   // Render a node (finds matching renderer)
 *   AppUINodeRenderers.render(container, node, ctx);
 *
 * ctx object: { root, api, esc, sourceRoot }
 */
window.AppUINodeRenderers = (function() {
  var _renderers = Object.create(null);  // type_pattern → render function

  function register(typePattern, renderFn) {
    _renderers[typePattern] = renderFn;
  }

  function _findRenderer(type) {
    // Exact match first
    if (_renderers[type]) return _renderers[type];
    // Prefix match (e.g., 'code.*' matches 'code.function')
    for (var pattern in _renderers) {
      if (pattern.endsWith('.*') && type.startsWith(pattern.slice(0, -1))) {
        return _renderers[pattern];
      }
    }
    // Kind match from metadata (e.g., 'kind:tool')
    return null;
  }

  function render(container, node, ctx) {
    if (!node) { container.innerHTML = ''; return false; }
    var type = node.type || '';
    var meta = node.metadata || {};
    
    // Try type match
    var renderer = _findRenderer(type);
    // Try kind match (e.g., 'kind:tool')
    if (!renderer && meta.kind) renderer = _renderers['kind:' + meta.kind];
    // Fallback
    if (!renderer) renderer = _renderers['*'];
    
    if (renderer) {
      renderer(container, node, ctx || {});
      return true;
    }
    return false;
  }

  function list() {
    return Object.keys(_renderers);
  }

  return { register: register, render: render, list: list };
})();
