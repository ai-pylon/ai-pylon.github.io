/**
 * UI Keys  --  keyboard shortcut manager.
 * 
 * Usage:
 *   AppUIKeys.bind('ctrl+k', () => document.getElementById('search').focus());
 *   AppUIKeys.bind('escape', () => closeModal());
 *   AppUIKeys.bind('ctrl+shift+p', () => openCommandPalette());
 *   AppUIKeys.unbind('ctrl+k');
 */
const AppUIKeys = (function() {
  const _bindings = {};

  function _normalize(combo) {
    return combo.toLowerCase().split('+').sort().join('+');
  }

  function _getCombo(e) {
    const parts = [];
    if (e.ctrlKey || e.metaKey) parts.push('ctrl');
    if (e.shiftKey) parts.push('shift');
    if (e.altKey) parts.push('alt');
    const key = e.key.toLowerCase();
    if (!['control', 'shift', 'alt', 'meta'].includes(key)) parts.push(key);
    return parts.sort().join('+');
  }

  document.addEventListener('keydown', (e) => {
    // Don't capture when typing in inputs
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
      if (e.key === 'Escape') { /* allow escape always */ }
      else return;
    }
    const combo = _getCombo(e);
    if (_bindings[combo]) {
      e.preventDefault();
      _bindings[combo](e);
    }
  });

  function bind(combo, fn) {
    _bindings[_normalize(combo)] = fn;
  }

  function unbind(combo) {
    delete _bindings[_normalize(combo)];
  }

  return { bind, unbind };
})();
window.AppUIKeys = AppUIKeys;
