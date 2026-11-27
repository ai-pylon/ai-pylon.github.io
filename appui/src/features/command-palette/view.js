/* Private command-palette DOM; commands, filtering and keyboard state stay in core. */
window._AppUIPaletteView = {
  create() {
    const overlay = document.createElement('div');
    overlay.className = 'ui-palette-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Command palette');
    overlay.style.cssText = 'display:none;position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,0.6);align-items:flex-start;justify-content:center;padding-top:20vh';
    overlay.innerHTML = `
      <div class="ui-palette" style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:8px;width:500px;max-width:90vw;box-shadow:var(--shadow-lg,0 8px 24px rgba(0,0,0,0.5));overflow:hidden">
        <input class="ui-palette-input" type="text" placeholder="Type a command..." aria-label="Search commands" style="width:100%;padding:12px 16px;background:transparent;border:none;border-bottom:1px solid var(--border);color:var(--text-primary);font-size:15px;outline:none">
        <div class="ui-palette-list" role="listbox" aria-label="Commands" style="max-height:300px;overflow-y:auto"></div>
      </div>`;
    document.body.appendChild(overlay);
    const input = overlay.querySelector('.ui-palette-input');
    const list = overlay.querySelector('.ui-palette-list');
    return {overlay,input,list};
  },
  empty() {
    const empty = document.createElement('div');
      empty.className = 'ui-palette-empty';
      empty.style.cssText = 'padding:12px 16px;color:var(--text-muted);font-size:13px';
      empty.textContent = 'No matching commands';
    return empty;
  },
  row(command,index) {
    const item = document.createElement('div');
    item.className = 'ui-palette-item'; item.dataset.idx = String(index);
    item.setAttribute('role', 'option');
    item.style.cssText = 'padding:8px 16px;cursor:pointer;font-size:13px;color:var(--text-primary)';
    const name = document.createElement('span'); name.textContent = command.name;
    item.appendChild(name);
    const metadata = [command.category, command.shortcut].filter(Boolean).join(' \u00b7 ');
    if (metadata) {
      const category = document.createElement('span'); category.textContent = metadata;
      category.style.cssText = 'color:var(--text-muted);font-size:11px;margin-left:8px';
      item.appendChild(category);
    }
    return item;
  },
  paint(list,selected) {
    [...list.children].forEach(item => {
      if (item.dataset.idx === undefined) return;
      const active = Number(item.dataset.idx) === selected;
      item.style.background = active ? 'var(--bg-active)' : '';
      item.setAttribute('aria-selected', String(active));
      if (active) item.scrollIntoView?.({block: 'nearest'});
    });
  },
};
