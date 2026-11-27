/* AppUI sidebar dock/undock feature.
 *
 * Allows any sidebar (left or right) to be "popped out" into a draggable,
 * resizable floating panel, and snapped back ("docked") into its original
 * position.
 *
 * Usage from shell:
 *   AppUISidebarDock.create({
 *     side: 'left' | 'right',
 *     element: sidebarEl,         // the docked sidebar aside element
 *     main: mainEl,               // the ai-app-main container
 *     layout: layoutState,        // persistent layout object
 *     persist: () => {},          // save layout to storage
 *     title: 'Chapters',         // floating panel title
 *     onDock: () => {},           // called after re-docking
 *     onUndock: () => {},         // called after undocking
 *   })
 *
 * Returns:
 *   { undock(), dock(), toggle(), isFloating(), destroy() }
 *
 * The sidebar element's content is physically moved between the docked
 * region and the floating panel — no re-render needed.
 */
const AppUISidebarDock = (() => {
  const STORAGE_PREFIX = 'appui-sidebar-dock:';
  const instances = new Map();

  function create(opts = {}) {
    const { side, element, main, layout, persist, title, onDock, onUndock } = opts;
    if (!element) throw new Error('AppUISidebarDock: sidebar element required');

    const storageKey = STORAGE_PREFIX + (side || 'left');
    let floating = false;
    let destroyed = false, restoreFrame = null;
    let panel = null, floatScope = null;
    let originalWidth = null;

    // Restore state from layout
    if (layout?.[`${side}Floating`]) {
      // Defer undock until content is mounted
      restoreFrame = requestAnimationFrame(() => {restoreFrame = null; undock();});
    }

    function undock() {
      if (destroyed || floating) return;
      floating = true;
      const owner = AppUILifecycle.createScope();
      floatScope = owner;

      // Remember docked width
      originalWidth = parseInt(getComputedStyle(element).width, 10) || 260;

      // Read saved float position/size
      const saved = _readFloatState();
      const width = saved.width || originalWidth;
      const height = saved.height || 500;
      const top = saved.top ?? 60;
      const left = saved.left ?? (side === 'right' ? window.innerWidth - width - 24 : 24);

      const view = window._AppUISidebarDockView.create({
        side,title,element,owner,position:{width,height,top,left},
        onMinimize:minimize,onDock:dock,onRestore:restore,
      });
      panel = view.panel;

      // Hide the docked sidebar
      element.classList.add('ai-app-hidden');
      element.style.width = '0px';

      // Make header draggable
      _makeDraggable(view.header, panel);
      // Make resizable
      _makeResizable(view.resizeHandle, panel);

      // Persist state
      if (layout) layout[`${side}Floating`] = true;
      persist?.();
      onUndock?.();
    }

    function minimize() {
      if (!panel) return;
      panel.style.display = 'none';
      const bar = document.querySelector(`.appui-sidebar-dock-minbar-${side}`);
      if (bar) bar.hidden = false;
    }

    function restore() {
      if (!panel) return;
      panel.style.display = '';
      const bar = document.querySelector(`.appui-sidebar-dock-minbar-${side}`);
      if (bar) bar.hidden = true;
    }

    function dock() {
      if (!floating || !panel) return;
      floating = false;

      // Save float position before destroying
      _saveFloatState();
      floatScope?.destroy();
      floatScope = null;

      // Move content back to docked sidebar
      const content = panel.querySelector('.appui-sidebar-dock-content');
      if (content) {
        while (content.firstChild) element.appendChild(content.firstChild);
      }

      // Remove floating panel and minimized bar
      panel.remove();
      panel = null;
      const bar = document.querySelector(`.appui-sidebar-dock-minbar-${side}`);
      if (bar) bar.remove();

      // Restore docked sidebar
      element.classList.remove('ai-app-hidden');
      element.style.width = (originalWidth || layout?.[`${side}Width`] || 260) + 'px';

      // Persist state
      if (layout) layout[`${side}Floating`] = false;
      persist?.();
      onDock?.();
    }

    function toggle() {
      if (floating) dock();
      else undock();
    }

    function isFloating() { return floating; }

    function _readFloatState() {
      return AppUIStorage.getJSON(storageKey, {}) || {};
    }

    function _saveFloatState() {
      if (!panel) return;
      const rect = panel.getBoundingClientRect();
      AppUIStorage.setJSON(storageKey, {
        top: Math.round(rect.top), left: Math.round(rect.left),
        width: Math.round(rect.width), height: Math.round(rect.height),
      });
    }

    function _bindGesture(handle, target, options, className) {
      const binding = window.AppUIPointerGesture.bind(handle, {
        ...options,
        shouldStart: event => !destroyed && floating && panel === target &&
          (!options.shouldStart || options.shouldStart(event)),
        onStart(event) {
          options.onStart(event);
          target.classList.add(className);
        },
        onEnd() {
          target.classList.remove(className);
          _saveFloatState();
        },
      });
      floatScope.add(() => target.classList.remove(className));
      floatScope.add(binding);
    }

    function _makeDraggable(handle, target) {
      _bindGesture(handle, target, {
        cursor: 'move',
        shouldStart: event => !event.target.closest?.('button'),
        ...window.AppUIPointerGesture.positionHandlers(target),
      }, 'is-dragging');
    }

    function _makeResizable(handle, target) {
      let startX, startY, startW, startH;
      _bindGesture(handle, target, {
        cursor: 'nwse-resize',
        onStart(event) {
          const rect = target.getBoundingClientRect();
          startX = event.clientX; startY = event.clientY;
          startW = rect.width; startH = rect.height;
        },
        onMove(event) {
          target.style.width = Math.max(200, startW + event.clientX - startX) + 'px';
          target.style.height = Math.max(150, startH + event.clientY - startY) + 'px';
        },
      }, 'is-resizing');
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      if (restoreFrame !== null) cancelAnimationFrame(restoreFrame);
      try { if (floating) dock(); }
      finally { if (instances.get(side) === api) instances.delete(side); }
    }

    const api = { undock, dock, toggle, isFloating, destroy };
    instances.set(side, api);
    return api;
  }

  // Static helper: get instance for a side
  function get(side) { return instances.get(side) || null; }

  return { create, get };
})();
window.AppUISidebarDock = AppUISidebarDock;
