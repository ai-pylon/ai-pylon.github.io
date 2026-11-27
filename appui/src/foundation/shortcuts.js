/* One keyboard dispatcher with editable-target protection. */
var AppUIShortcuts = window.AppUIShortcuts || (function() {
  function normalize(shortcut) { return String(shortcut || '').toLowerCase().replace(/\s/g, ''); }
  function eventShortcut(event) {
    const parts = [];
    if (event.ctrlKey || event.metaKey) parts.push('ctrl');
    if (event.altKey) parts.push('alt');
    if (event.shiftKey) parts.push('shift');
    if (event.key && !['Control', 'Meta', 'Alt', 'Shift'].includes(event.key)) parts.push(event.key.toLowerCase());
    return parts.join('+');
  }
  function editable(target) { return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)); }
  function create({enabled = () => true} = {}) {
    const bindings = new Map();
    const listener = event => {
      if (!enabled() || editable(event.target)) return;
      const run = bindings.get(eventShortcut(event));
      if (!run) return;
      event.preventDefault(); event.stopImmediatePropagation(); run(event);
    };
    document.addEventListener('keydown', listener);
    return {
      bind(shortcut, run) { if (shortcut && typeof run === 'function') bindings.set(normalize(shortcut), run); },
      unbind(shortcut) { bindings.delete(normalize(shortcut)); },
      clear() { bindings.clear(); },
      destroy() { bindings.clear(); document.removeEventListener('keydown', listener); },
    };
  }
  return {create, normalize, eventShortcut, editable};
})();
window.AppUIShortcuts = AppUIShortcuts;
