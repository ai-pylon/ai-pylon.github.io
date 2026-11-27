(function () {
  'use strict';
  let scope, root, cards, table, editor, groupBar, stateBar, message, stateControls, groupControls, busy = false;
  const sample = {app: 'my-app', label: 'My app', order: 100,
    items: [{label: 'Open dashboard', url: '/'}]};
  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  async function api(op, args = {}) {
    const result = await AppUIApi.operation('system/tray', op, args, {signal: scope.signal});
    if (!result.ok) throw new Error(result.error || result._error || 'Tray operation failed');
    return result;
  }
  function show(text, error = false) {message.textContent = text; message.dataset.error = String(error);}
  function flatten(items, parent = '') {
    return items.flatMap((item, index) => {
      const path = parent ? parent + ' / ' + item.label : item.label;
      const row = {id: path + ':' + index, path, type: item.children ? 'Submenu' : item.url ? 'Open page' : 'Operation',
        action: item.op || item.url || '', args: item.arg ? JSON.stringify(item.arg) : '', confirm: item.confirm ? 'Yes' : ''};
      return item.children ? [row, ...flatten(item.children, path)] : [row];
    });
  }
  async function reload() {
    const [status, menu] = await Promise.all([api('status'), api('menu')]);
    if (!scope.current()) return;
    cards.setItems([{label: 'Desktop endpoint', value: status.available ? 'Connected' : 'Unavailable'},
      {label: 'Tray helper', value: status.running ? 'Running' : 'Stopped'},
      {label: 'Icon status', value: status.level || '?', description: String(status.unread || 0) + ' unread badge'},
      {label: 'Menu groups', value: menu.apps.length, description: menu.assembled.length + ' top-level entries'}]);
    table.setItems(flatten(menu.assembled));
    let level = status.level || 'ok', tooltip = status.tooltip || 'pylon-server';
    stateControls = AppUIToolbar.create({container: stateBar, signal: scope.signal, items: [
      {type: 'select', ariaLabel: 'Status level', value: level, options: ['ok','pending','ongoing','bad'], onChange: value => {level = value;}},
      {label: 'Set level', action: () => confirm('Set tray level to ' + level + '?', 'set_level', {level})},
      {type: 'input', ariaLabel: 'Tooltip', value: tooltip, onInput: value => {tooltip = value;}},
      {label: 'Set tooltip', action: () => confirm('Update the tray tooltip?', 'set_tooltip', {text: tooltip})},
    ]});
    groupControls = AppUIToolbar.create({container: groupBar, signal: scope.signal, items: [
      {type: 'select', ariaLabel: 'Registered menu group', options: [{value: '', label: 'Select a registered group?'},
        ...menu.apps.map(row => ({value: row.app, label: row.label || row.app}))], onChange(value) {
          const row = menu.apps.find(item => item.app === value);
          if (row) editor.setValue({app: row.app, label: row.label, order: row.order, items: row.items});
        }},
      {label: 'New group', action: () => editor.setValue(structuredClone(sample))},
    ]});
  }
  async function run(op, args = {}) {
    if (busy || !scope.current()) return;
    busy = true;
    root.querySelectorAll('button').forEach(button => {button.disabled = true;});
    show('Working?');
    try {
      const result = await api(op, {...args, confirm: true});
      const delivery = result.delivery || result.menu;
      if (delivery && !delivery.ok) show('Saved, but the tray update failed: ' + (delivery.error || 'Unknown error'), true);
      else show(result.note || (result.available === false ? 'Saved; no desktop endpoint is connected.' : 'Done.'));
      await reload();
    } catch (error) {if (error.name !== 'AbortError' && scope.current()) show(error.message, true);}
    finally {busy = false; if (scope.current()) root.querySelectorAll('button').forEach(button => {button.disabled = false;});}
  }
  function confirm(text, op, args = {}) {
    if (busy) return;
    AppUIDialog.show({title: 'System tray', body: text, signal: scope.signal,
      buttons: [{text: 'Cancel'}, {text: 'Apply', primary: true, action: () => {void run(op, args);}}]});
  }
  function save() {
    const value = editor.getValue();
    if (!value || !editor.isValid() || !value.app || !Array.isArray(value.items)) {
      show('Enter a valid group with app and items fields.', true); return;
    }
    confirm('Save the menu group for ' + value.app + '?', 'register_menu', value);
  }
  function remove() {
    const value = editor.getValue();
    if (!value?.app) {show('Select a menu group first.', true); return;}
    confirm('Remove the menu group for ' + value.app + '?', 'unregister_menu', {app: value.app});
  }
  function mount(host) {
    root = host; root.classList.add('tray-page');
    scope = AppUILifecycle.createViewScope({host, pagehide: true});
    const heading = el('div'); root.append(heading);
    scope.add(AppUIToolbar.create({container: heading, title: 'System Tray', subtitle: 'Desktop status and right-click menus', signal: scope.signal,
      items: [{label: 'Reload status', action: () => {void reload().then(() => show('Status reloaded.')).catch(error => show(error.message, true));}},
        {label: 'Start', action: () => confirm('Start the tray helper?', 'start')},
        {label: 'Stop', action: () => confirm('Stop the tray helper? Menu registrations will be kept.', 'stop')},
        {label: 'Restart', action: () => confirm('Restart the tray helper and restore its menu?', 'restart')},
        {label: 'Refresh menu', action: () => confirm('Push the assembled menu to the tray?', 'refresh')},
        {label: 'Clear icon status', action: () => confirm('Clear icon status and badge? Notification history is retained.', 'clear')}]}));
    message = el('p', 'Loading?', 'tray-message'); message.setAttribute('role', 'status'); root.append(message);
    const summary = el('div'); root.append(summary);
    cards = AppUIStatCards.create({container: summary, columns: 4, compact: true, signal: scope.signal}); scope.add(cards);
    stateBar = el('div'); root.append(stateBar);
    root.append(el('p', 'Notifications can update the icon level again. Reload reads status; Refresh menu sends the assembled menu to the desktop.', 'tray-note'));
    const columns = el('div', null, 'tray-columns'); root.append(columns);
    const groups = el('section', null, 'tray-panel'), preview = el('section', null, 'tray-panel'); columns.append(groups, preview);
    groups.append(el('h2', 'Menu registrations')); groupBar = el('div'); groups.append(groupBar);
    const editorHost = el('div', null, 'tray-editor'); groups.append(editorHost);
    editor = AppUIJsonEditor.create({container: editorHost, mode: 'edit', value: structuredClone(sample)}); scope.add(editor);
    const saveBar = el('div'); groups.append(saveBar);
    scope.add(AppUIToolbar.create({container: saveBar, signal: scope.signal, items: [{label: 'Save group', primary: true, action: save}, {label: 'Remove group', action: remove}]}));
    groups.append(el('p', 'Groups use app, label, order and items. Items have label and url or op; nested groups use children. Operation arguments go in arg.', 'tray-note'));
    preview.append(el('h2', 'Assembled menu preview'));
    const tableHost = el('div', null, 'tray-table'); preview.append(tableHost);
    table = AppUIDataTable.create({container: tableHost, signal: scope.signal, getId: row => row.id, maxRows: 1000,
      columns: [{id: 'path', label: 'Menu path', width: '320px', sortable: true}, {id: 'type', label: 'Type', width: '115px', sortable: true},
        {id: 'action', label: 'Action', width: '260px'}, {id: 'args', label: 'Arguments', width: '200px'}, {id: 'confirm', label: 'Confirm', width: '85px'}]}); scope.add(table);
    scope.add(() => {stateControls?.destroy(); groupControls?.destroy();});
    void reload().then(() => show('Ready.')).catch(error => show(error.message, true));
  }
  window.AppUIReady.then(() => AppUI.createApp({id: 'system-tray', title: 'System Tray', statusbar: {}, content: {render: mount}}));
})();
