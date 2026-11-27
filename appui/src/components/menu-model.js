/* Menu definition policies, independent of DOM rendering and action dispatch. */
window._AppUIMenuModel=(function(){
    // Helper: menu value can be an array (old format) or {description, items} (new format)
    function _getItems(menuValue) {
        if (Array.isArray(menuValue)) return menuValue;
        if (menuValue && menuValue.items) return menuValue.items;
        return [];
    }

    function _getMenuDescription(menuValue) {
        if (menuValue && typeof menuValue === 'object' && !Array.isArray(menuValue)) return menuValue.description || '';
        return '';
    }

    function _menuId(name) { return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-'); }
    function _findItem(items, id) {
        for (let i = 0; i < items.length; i++) {
            if (items[i].id === id) return items[i];
            if (items[i].submenu) {
                const found = _findItem(items[i].submenu, id);
                if (found) return found;
            }
        }
        return null;
    }

    function getActions(definition) {
        /**
         * Get all available actions as a flat list.
         * Used to build LLM context about UI capabilities.
         */
        const actions = [];
        for (const [menuName, menuValue] of Object.entries(definition)) {
            for (const item of _getItems(menuValue)) {
                if (item.separator) continue;
                actions.push({
                    menu: menuName,
                    id: item.id,
                    label: item.label,
                    description: item.description || null,
                    action: item.action,
                    shortcut: item.shortcut || null,
                    params: item.params || null,
                });
            }
        }
        return actions;
    }

    return {items:_getItems,description:_getMenuDescription,id:_menuId,find:_findItem,actions:getActions};
})();
