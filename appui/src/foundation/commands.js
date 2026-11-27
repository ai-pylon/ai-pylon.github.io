/* Command registry shared by menus, toolbars, palettes, and shortcuts. */
var AppUICommands = window.AppUICommands || (function() {
  function create(definitions) {
    const commands = new Map();
    const register = definition => {
      if (!definition?.id || typeof (definition.run || definition.action) !== 'function') {
        throw new Error('AppUI command requires id and run(action) function');
      }
      commands.set(definition.id, Object.assign({}, definition, {run: definition.run || definition.action}));
    };
    const registerAll = source => {
      const list = Array.isArray(source) ? source : Object.entries(source || {}).map(([id, value]) =>
        Object.assign({id}, typeof value === 'function' ? {run: value} : value));
      list.forEach(register);
    };
    const available = command => command.visible !== false && command.enabled !== false
      && (typeof command.visible !== 'function' || command.visible())
      && (typeof command.enabled !== 'function' || command.enabled());
    registerAll(definitions || []);
    return {
      register,
      registerAll,
      run(id, params = {}, source = {}) { const command = commands.get(id); if (!command || !available(command)) return false; command.run(params, source); return true; },
      get(id) { const command = commands.get(id); return command ? Object.assign({}, command) : null; },
      update(id, patch) { const command = commands.get(id); if (!command) return false; Object.assign(command, patch || {}); return true; },
      all() { return [...commands.values()].filter(available).map(command => Object.assign({}, command)); },
      raw() { return [...commands.values()].map(command => Object.assign({}, command)); },
      setEnabled(id, value) { const command = commands.get(id); if (!command) return false; command.enabled = value; return true; },
      clear() { commands.clear(); },
    };
  }
  return {create};
})();
window.AppUICommands = AppUICommands;
