/**
 * AppUI menu bar  --  renders application menus from pipeline definitions.
 * 
 * Menus are defined in pipeline JSON and serve three purposes:
 * 1. User-facing UI (clickable menu bar with dropdowns)
 * 2. LLM capability declaration (AI knows what actions exist)
 * 3. Keyboard shortcuts (dispatched centrally by AppUI)
 * 
 * Usage:
 *   <script src="/appui/loader.js"></script>
 *   <script>window.AppUIReady = AppUIAssets.load('shell');</script>
 *   <script>
 *     AppUIReady.then(() => AppUI.components.Menu.init({
 *       container: '#menu-bar',          // where to render
 *       pipeline: 'doc_studio',          // pipeline ID (loads from /api/pipeline.get)
 *       // OR
 *       definition: { menu: {...} },     // inline definition
 *       onAction: (menuId, itemId, params) => { ... },  // action handler
 *     }));
 *     
 *     // LLM can trigger:
 *     AppUI.components.Menu.trigger('File', 'save');
 *     AppUI.components.Menu.trigger('AI', 'review');
 *     
 *     // Get available actions (for LLM context):
 *     AppUI.components.Menu.getActions();  // [{menu, id, label, action, shortcut}, ...]
 *   </script>
 */
var AppUIMenu = window.AppUIMenu || (function() {
    const {items:_getItems,description:_getMenuDescription,id:_menuId,find:_findItem}=window._AppUIMenuModel;
    let _config = {};
    let _menuDef = {};
    let _container = null;
    let _createdContainer = false;
    let _actionHandler = null;
    let _outsideClickListener = null;
    let _source = null;
    const _generation=AppUILifecycle.generation();
    const popup=window._AppUIMenuPopup.create({generation:_generation,execute:_executeAction});

    function init(opts) {
        destroy();
        _config = opts;
        _actionHandler = opts.onAction || (() => {});

        if (opts.definition && opts.definition.menu) {
            _config._fullDef = opts.definition;
            _menuDef = opts.definition.menu;
            _render();
        } else if (opts.menu || opts.pipeline) {
            _source = window._AppUIMenuSource.create();
            _source.load(opts,definition=>{
                _config._fullDef=definition;
                _menuDef=definition.menu;
                _render();
            });
        }
    }

    function _render() {
        const generation=_generation.next();
        const current=()=>_generation.isCurrent(generation);
        popup.close();
        if(_createdContainer)_container?.remove();
        _createdContainer=false;
        _container = typeof _config.container === 'string'
            ? document.querySelector(_config.container)
            : _config.container;
        if (!_container) {
            _container = document.createElement('div');
            _container.id = 'ai-menu-bar';
            _createdContainer=true;
            document.body.prepend(_container);
        }

        window._AppUIMenuView.bar(_container);
        _container.innerHTML = '';

        for (const [menuName, menuValue] of Object.entries(_menuDef)) {
            const items = _getItems(menuValue);
            const menuBtn = window._AppUIMenuView.button({menuName, id: _menuId(menuName)});
            menuBtn.onmouseenter = () => { if (current() && popup.isOpen) popup.show(menuBtn, menuName, items); };
            menuBtn.onclick = (e) => {
                if(!current())return;
                e.stopPropagation();
                if (popup.name === menuName) {
                    popup.close();
                } else {
                    popup.show(menuBtn, menuName, items);
                }
            };
            menuBtn.onkeydown = (e) => {
                if(!current()||e.isComposing)return;
                if (['Enter', ' ', 'ArrowDown'].includes(e.key)) {
                    e.preventDefault();
                    popup.show(menuBtn, menuName, items);
                    popup.focus();
                } else if (e.key === 'Escape') {
                    popup.close();
                } else if (['ArrowLeft', 'ArrowRight'].includes(e.key)) {
                    e.preventDefault();
                    const buttons = [..._container.querySelectorAll('.ai-menu-top')];
                    const next = (buttons.indexOf(menuBtn) + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
                    buttons[next].focus();
                }
            };
            _container.appendChild(menuBtn);
        }

        // Close on outside click
        _outsideClickListener = (e) => {
            if(!current())return;
            if (popup.isOpen && !_container.contains(e.target)) {
                popup.close();
            }
        };
        document.addEventListener('click', _outsideClickListener);
    }

    function _executeAction(menuName, item) {
        _actionHandler(menuName, item.id, item.params || {}, item);
    }

    function destroy() {
        _generation.next();
        _source?.destroy(); _source=null;
        popup.close();
        if (_outsideClickListener) document.removeEventListener('click', _outsideClickListener);
        _outsideClickListener = null;
        if(_createdContainer)_container?.remove();
        _createdContainer=false;
        _container = null;
        _menuDef = {};
        _config = {};
        _actionHandler = null;
    }



    // --- Public API for LLM interaction ---

    function trigger(menuName, itemId) {
        /**
         * Trigger a menu action programmatically.
         * Used by LLM to drive the UI.
         */
        const menuValue = _menuDef[menuName];
        if (!menuValue) return {error: `Menu not found: ${menuName}`};
        const items = _getItems(menuValue);
        const item = _findItem(items, itemId);
        if (!item) return {error: `Item not found: ${menuName}.${itemId}`};
        _executeAction(menuName, item);
        return {ok: true, triggered: `${menuName}.${itemId}`};
    }

    function getActions() { return window._AppUIMenuModel.actions(_menuDef); }

    function setEnabled(menuName, itemId, enabled) {
        /** Enable/disable a menu item (visual + functional). */
        // For future implementation with DOM state tracking
    }

    return {
        init,
        destroy,
        trigger,
        getActions,
        setEnabled,
    };
})();
window.AppUIMenu = AppUIMenu;
