/* Private markup for Menu bars, buttons, dropdowns and submenus. */
window._AppUIMenuView = {
  bar(container) {
    container.style.cssText = container.style.cssText || 'display:flex;background:var(--bg-secondary);border-bottom:1px solid var(--border);padding:0 8px;font-size:12px;position:relative;z-index:1000;user-select:none;';
    container.setAttribute('role', 'menubar');
  },
  button({menuName, id}) {
    const menuBtn = document.createElement('button');
    menuBtn.className = 'ai-menu-top';
    menuBtn.type = 'button';
    menuBtn.setAttribute('role', 'menuitem');
    menuBtn.setAttribute('aria-haspopup', 'true');
    menuBtn.setAttribute('aria-expanded', 'false');
    menuBtn.setAttribute('aria-controls', `ai-menu-${id}`);
    menuBtn.style.cssText = 'padding:6px 12px;cursor:pointer;color:var(--text-primary);position:relative;border:0;background:transparent;font:inherit;';
    menuBtn.textContent = menuName;
    return menuBtn;
  },
  dropdown({id,menuName,items}) {
    const dd = document.createElement('div');
    dd.className = 'ai-menu-dropdown';
    dd.id = `ai-menu-${id}`;
    dd.setAttribute('role', 'menu');
    dd._menuName = menuName;
    dd._items = items;
    dd.style.cssText = 'position:absolute;top:100%;left:0;background:var(--bg-elevated);border:1px solid var(--border);border-radius:4px;min-width:200px;padding:4px 0;box-shadow:var(--shadow-md, 0 4px 12px rgba(0,0,0,0.15));z-index:1001;';

    return dd;
  },
  submenu(rect) {
    const sub = document.createElement('div');
    sub.className = 'ai-menu-dropdown ai-menu-submenu';
    sub.setAttribute('role', 'menu');
    sub.style.cssText = 'position:fixed;background:var(--bg-elevated);border:1px solid var(--border);border-radius:4px;min-width:160px;padding:4px 0;box-shadow:var(--shadow-md, 0 4px 12px rgba(0,0,0,0.15));z-index:1002;';
    sub.style.left = rect.right + 'px';
    sub.style.top = rect.top + 'px';
    return sub;
  },
  positionSubmenu(element,anchor) {
    const {left,top}=window._AppUIPopupPlacement.submenu({anchor,width:element.offsetWidth,height:element.offsetHeight,
      viewportWidth:window.innerWidth,viewportHeight:window.innerHeight});
    element.style.left=`${left}px`;element.style.top=`${top}px`;
  },
  refreshChecked(dd, items) {
      // Re-evaluate checked functions and update checkmark display
      const rows = dd.querySelectorAll('[data-menu-item-idx]');
      rows.forEach(row => {
          const idx = parseInt(row.dataset.menuItemIdx, 10);
          const item = items[idx];
          if (!item || item.separator) return;
          if (item.checked === undefined) return;
          const isChecked = typeof item.checked === 'function' ? item.checked() : item.checked;
          const label = row.querySelector('.ai-menu-item-label');
          if (label) label.textContent = (isChecked ? '✓ ' : '   ') + item.label;
      });
  },
  separator() {
    const sep = document.createElement('div');
    sep.style.cssText = 'height:1px;background:var(--border);margin:4px 8px;';
    return sep;
  },
  row(item,{index,labelClass='',submenu=false}={}) {
    const row = document.createElement('div');
    row.tabIndex = -1;
    row.setAttribute('role', 'menuitem');
    if(index!==undefined)row.dataset.menuItemIdx=String(index);
    row.style.cssText = 'padding:6px 16px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;color:var(--text-primary);';
    const label = document.createElement('span');
    if(labelClass)label.className=labelClass;
    if (item.checked !== undefined) {
      const isChecked = typeof item.checked === 'function' ? item.checked() : item.checked;
      label.textContent = (isChecked ? '✓ ' : '   ') + item.label;
    } else {
      label.textContent = item.label;
    }
    row.appendChild(label);
    if (submenu&&item.submenu) {
      const arrow = document.createElement('span');
      arrow.style.cssText = 'color:var(--text-muted);font-size:10px;margin-left:20px;';
      arrow.textContent = '▸';
      row.appendChild(arrow);
    } else if (item.shortcut) {
      const sc = document.createElement('span');
      sc.style.cssText = 'color:var(--text-muted);font-size:10px;margin-left:20px;';
      sc.textContent = item.shortcut;
      row.appendChild(sc);
    }
    return row;
  }
};
