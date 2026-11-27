/* Menu dropdown/submenu lifetime, shared navigation and popup placement. */
window._AppUIMenuPopup = (() => {
  function create({generation: _generation, execute: _executeAction}) {
    const _menuId = window._AppUIMenuModel.id;
    let _activeDropdown = null, _openMenuName = null;
    function _showDropdown(anchor, menuName, items) {
        _hideDropdown();
        const dd = window._AppUIMenuView.dropdown({id:_menuId(menuName),menuName,items});
        const generation=_generation.current();
        const current=()=>_generation.isCurrent(generation)&&_activeDropdown?.el===dd;

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.separator) {
                dd.appendChild(window._AppUIMenuView.separator());
                continue;
            }
            const row=window._AppUIMenuView.row(item,{index:i,labelClass:'ai-menu-item-label',submenu:true});
            row.onmouseenter = () => { if(!current())return;row.style.background = 'var(--bg-hover)'; _hideSubmenu(dd); if (item.submenu) _showSubmenu(row, menuName, item); };
            row.onmouseleave = () => { if (current() && !item.submenu) row.style.background = ''; };
            row.onclick = (e) => {
                if(!current())return;
                e.stopPropagation();
                if (item.submenu) { _showSubmenu(row, menuName, item); return; }
                _hideDropdown();
                _executeAction(menuName, item);
            };
            dd.appendChild(row);
        }

        // Re-evaluate all checked states now that the dropdown is freshly shown
        window._AppUIMenuView.refreshChecked(dd,items);

        _bindMenuKeys(dd, () => { _hideDropdown(); anchor.focus(); },current);

        anchor.style.background = 'var(--bg-hover)';
        anchor.setAttribute('aria-expanded', 'true');
        anchor.appendChild(dd);
        _activeDropdown = {el: dd, anchor};
        _openMenuName = menuName;
    }

    function _bindMenuKeys(menu,close,isCurrent) {
        menu._appuiMenuKeys=window._AppUIMenuNavigation.bind({container:menu,isCurrent,onClose:close,
            getItems:()=>[...menu.querySelectorAll('[role="menuitem"]')],
            afterActivate:()=>_activeSubmenu?.el.querySelector('[role="menuitem"]')?.focus(),
        });
    }

    function _hideDropdown() {
        _hideSubmenu();
        if (_activeDropdown) {
            _activeDropdown.el._appuiMenuKeys?.destroy();
            _activeDropdown.el.remove();
            _activeDropdown.anchor.style.background = '';
            _activeDropdown.anchor.setAttribute('aria-expanded', 'false');
            _activeDropdown = null;
        }
        _openMenuName = null;
    }

    let _activeSubmenu = null;
    function _hideSubmenu(parentDropdown) {
        if (_activeSubmenu) {
            _activeSubmenu.el._appuiMenuKeys?.destroy();
            _activeSubmenu.el.remove();
            if (_activeSubmenu.row) _activeSubmenu.row.style.background = '';
            _activeSubmenu = null;
        }
    }
    function _showSubmenu(row, menuName, item) {
        _hideSubmenu();
        const sub = window._AppUIMenuView.submenu(row.getBoundingClientRect());
        const generation=_generation.current(),dropdown=_activeDropdown;
        const current=()=>_generation.isCurrent(generation)&&_activeDropdown===dropdown&&_activeSubmenu?.el===sub;
        (item.submenu || []).forEach(subItem => {
            if (subItem.separator) {
                sub.appendChild(window._AppUIMenuView.separator());
                return;
            }
            const subRow=window._AppUIMenuView.row(subItem);
            subRow.onmouseenter = () => {if(current())subRow.style.background = 'var(--bg-hover)';};
            subRow.onmouseleave = () => {if(current())subRow.style.background = '';};
            subRow.onclick = (e) => {
                if(!current())return;
                e.stopPropagation();
                _hideDropdown();
                _executeAction(menuName, subItem);
            };
            sub.appendChild(subRow);
        });
        _bindMenuKeys(sub, () => { _hideSubmenu(); row.focus(); },current);
        document.body.appendChild(sub);
        window._AppUIMenuView.positionSubmenu(sub,row.getBoundingClientRect());
        row.style.background = 'var(--bg-hover)';
        _activeSubmenu = {el: sub, row: row};
    }

    return {show: _showDropdown, close: _hideDropdown,
      get isOpen() {return !!_activeDropdown;},
      get name() {return _openMenuName;},
      focus() {_activeDropdown?.el.querySelector('[role="menuitem"]')?.focus();},
    };
  }
  return {create};
})();
