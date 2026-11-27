/**
 * AppUI command palette  --  fuzzy search across actions/pages (Ctrl+K).
 *
 * Usage:
 *   AppUIPalette.init({
 *     commands: [
 *       {name: 'Go to PPTX', action: () => switchTab('pptx'), category: 'Navigate'},
 *       {name: 'Re-run tests', action: () => runTests(), category: 'Actions'},
 *     ]
 *   });
 *   AppUIPalette.addCommand({name: 'New', action: fn});
 *   AppUIPalette.open();
 */
const AppUIPalette = (function() {
  let _commands = [];
  let _el = null;
  let _input = null;
  let _list = null;
  let _selected = 0;
  let _initialized = false;
  let _keyBound = false;
  let _keyListener = null;
  let _returnFocus = null;
  let _domScope = null, _rowScope = null;

  function init(opts) {
    opts = opts || {};
    _commands = Array.from(opts.commands || []);
    if (!_el || !_el.isConnected) _createDOM();
    else if(isOpen())_render();
    if (_initialized) return;
    _initialized = true;
    if (opts.bindShortcut === false) return;
    if (!_keyBound && typeof AppUIKeys !== 'undefined') { AppUIKeys.bind('ctrl+k', open); _keyBound = true; }
    else if (!_keyBound) {
      _keyListener = event => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); open(); }
      };
      document.addEventListener('keydown', _keyListener);
      _keyBound = true;
    }
  }

  function addCommand(cmd) { _commands.push(cmd); }
  function setCommands(cmds) {
    _commands = Array.from(cmds || []);
    if (_el && _el.style.display === 'flex') _render();
  }

  function _createDOM() {
    _domScope?.destroy();_rowScope?.destroy();_rowScope=null;
    const owner=AppUILifecycle.createScope();_domScope=owner;
    const {overlay,input,list}=window._AppUIPaletteView.create();
    _el=overlay;_input=input;_list=list;
    owner.add(()=>{input.oninput=null;input.onkeydown=null;overlay.onclick=null;});
    _input.oninput = () => { if(owner.destroyed||!isOpen())return; _selected = 0; _render(); };
    _input.onkeydown = (e) => {
      if(owner.destroyed||!isOpen())return;
      e.stopPropagation();
      if (e.key === 'ArrowDown') { e.preventDefault(); _selected++; _render(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); _selected--; _render(); }
      else if (e.key === 'Enter') { e.preventDefault(); _execute(); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    };
    _el.onclick = (e) => { if (!owner.destroyed && e.target === overlay) close(); };
  }

  function _filtered() {
    const query=(_input.value || '').toLowerCase();
    return query?_commands.filter(command=>command.name.toLowerCase().includes(query)||(command.category || '').toLowerCase().includes(query)):_commands;
  }

  function _render() {
    if (!_input || !_list) return;
    _rowScope?.destroy();const owner=AppUILifecycle.createScope();_rowScope=owner;
    const filtered = _filtered();
    if (_selected < 0) _selected = filtered.length - 1;
    if (_selected >= filtered.length) _selected = 0;
    _list.replaceChildren();
    if (!filtered.length) {
      const empty=window._AppUIPaletteView.empty();
      _list.appendChild(empty);
    }
    filtered.forEach((command, index) => {
      const item=window._AppUIPaletteView.row(command,index);
      owner.add(()=>{item.onmouseenter=null;item.onclick=null;});
      item.onmouseenter = () => { if(owner.destroyed||!isOpen())return; _selected = index; _paintSelection(); };
      item.onclick = () => { if(owner.destroyed||!isOpen())return; _selected = index; _execute(); };
      _list.appendChild(item);
    });
    _paintSelection();
  }

  function _paintSelection() {
    if (!_list) return;
    window._AppUIPaletteView.paint(_list,_selected);
  }

  function _execute() {
    if (!_input || !_el || !isOpen()) return;
    const filtered = _filtered();
    const command = filtered[_selected];
    if (!command) return;
    close();
    command.action?.();
  }

  function open() { if (!_el || !_input) return; if (document.activeElement !== _input) _returnFocus = document.activeElement; _el.style.display = 'flex'; _input.value = ''; _selected = 0; _render(); _input.focus(); }
  function close() { _rowScope?.destroy();_rowScope=null; if (_el) _el.style.display = 'none'; if (document.activeElement === _input) _input?.blur?.(); const target = _returnFocus; _returnFocus = null; target?.focus?.(); }

  function isOpen() {return !!_el?.isConnected && _el.style.display === 'flex';}

  function destroy() {
    _rowScope?.destroy();_rowScope=null;_domScope?.destroy();_domScope=null;
    if (_keyBound && typeof AppUIKeys !== 'undefined') AppUIKeys.unbind('ctrl+k');
    if (_keyListener) document.removeEventListener('keydown', _keyListener);
    _el?.remove();
    _commands = []; _el = null; _input = null; _list = null;
    _initialized = false; _keyBound = false; _keyListener = null; _returnFocus = null;
  }

  return { init, open, close, isOpen, destroy, addCommand, setCommands };
})();
window.AppUIPalette = AppUIPalette;
