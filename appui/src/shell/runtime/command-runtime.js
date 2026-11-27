/* Shell command registry and shortcut ownership, separate from layout orchestration. */
window.AppUIShellCommandRuntime=(function(){
  function create({getConfig,onPaletteChange,dispatchMenu}){
    let _commands=new Map(),_commandService=null,_shortcutService=null;
    const raw=()=>_commandService?_commandService.raw():[..._commands.values()];
    const init=()=>{_commandService=AppUICommands.create();};
    const destroyShortcuts=()=>{_shortcutService?.destroy();_shortcutService=null;};
    const clear=()=>{_commandService?.clear();_commandService=null;_commands.clear();};

    function _registerCommands(definitions) {
        if (_commandService) _commandService.clear();
        else _commands.clear();
        if (!definitions) return;
        const list = Array.isArray(definitions)
            ? definitions
            : Object.entries(definitions).map(([id, value]) => Object.assign({id}, typeof value === 'function' ? {run: value} : value));
        list.forEach(registerCommand);
    }

    function registerCommand(command) {
        if (!command || !command.id || typeof (command.run || command.action) !== 'function') {
            throw new Error('AppUI command requires id and run(action) function');
        }
        if (_commandService) _commandService.register(command);
        else _commands.set(command.id, Object.assign({}, command, {run: command.run || command.action}));
    }

    function runCommand(id, params, source) {
        if (_commandService) return _commandService.run(id, params || {}, source || {});
        const command = _commands.get(id);
        if (!command || !_isCommandAvailable(command)) return false;
        command.run(params || {}, source || {});
        return true;
    }

    function _isCommandAvailable(command) {
        return command.visible !== false && command.enabled !== false
            && (typeof command.visible !== 'function' || command.visible())
            && (typeof command.enabled !== 'function' || command.enabled());
    }

    function getCommands() {
        if (_commandService) return _commandService.all();
        return [..._commands.values()].filter(_isCommandAvailable).map(command => Object.assign({}, command));
    }

    function setCommandEnabled(id, enabled) {
        if (_commandService) {
            const updated = _commandService.setEnabled(id, enabled);
            if (updated) onPaletteChange();
            return updated;
        }
        const command = _commands.get(id);
        if (!command) return false;
        command.enabled = enabled;
        onPaletteChange();
        return true;
    }

    function _bindCommandShortcuts() {
        _shortcutService?.destroy();
        _shortcutService = null;
        _loadCustomShortcuts();
        const bindings = new Map();
        const commands=raw();
        for (const command of commands) {
            if (command.shortcut) bindings.set(window.AppUIShellCommands.normalizeShortcut(command.shortcut), () =>
                runCommand(command.id, {}, {type: 'shortcut'}));
        }
        AppUIMenu.getActions().forEach(item => {
            if (item.shortcut && !bindings.has(window.AppUIShellCommands.normalizeShortcut(item.shortcut))) {
                bindings.set(window.AppUIShellCommands.normalizeShortcut(item.shortcut), () =>
                    dispatchMenu(item.menu, item.id, item.params, item));
            }
        });
        _shortcutService = AppUIShortcuts.create({enabled: _areShortcutsEnabled});
        bindings.forEach((run, shortcut) => _shortcutService.bind(shortcut, run));
    }

    function _areShortcutsEnabled() {
        return window.AppUIShellCommands.areShortcutsEnabled(getConfig().id, getConfig());
    }

    function setShortcutsEnabled(enabled) {
        window.AppUIShellCommands.setShortcutsEnabled(getConfig().id, enabled);
    }

    function areShortcutsEnabled() {
        return _areShortcutsEnabled();
    }

    function _loadCustomShortcuts() {
        const stored = window.AppUIShellCommands.loadCustomShortcuts(getConfig().id);
        for (const [id, shortcut] of Object.entries(stored)) {
            if (_commandService) _commandService.update(id, {shortcut});
            else {
                const cmd = _commands.get(id);
                if (cmd) cmd.shortcut = shortcut;
            }
        }
    }

    function setShortcut(commandId, shortcut) {
        if (_commandService) {
            if (!_commandService.update(commandId, {shortcut})) return false;
        } else {
            const cmd = _commands.get(commandId);
            if (!cmd) return false;
            cmd.shortcut = shortcut;
        }
        window.AppUIShellCommands.saveCustomShortcut(getConfig().id, commandId, shortcut);
        return true;
    }

    function resetShortcuts() {
        window.AppUIShellCommands.resetCustomShortcuts(getConfig().id);
        // Re-register from original config
        _registerCommands(getConfig().commands || getConfig().actions);
    }

    function getShortcuts() {
        const commands=raw();
        return commands
            .filter(cmd => cmd.shortcut)
            .map(cmd => ({ id: cmd.id, label: cmd.label || cmd.id, shortcut: cmd.shortcut }));
    }

    return {init,clear,destroyShortcuts,raw,registerAll:_registerCommands,register:registerCommand,run:runCommand,
      all:getCommands,setEnabled:setCommandEnabled,bindShortcuts:_bindCommandShortcuts,
      setShortcutsEnabled,areShortcutsEnabled,setShortcut,resetShortcuts,getShortcuts};
  }
  return {create};
})();
