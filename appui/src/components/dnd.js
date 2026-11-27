/**
 * AppUIDnD  --  drag and drop helpers
 *
 * Usage:
 *   AppUIDnD.makeDraggable(el, {
 *     type: 'file',
 *     getData: (e) => ({path: '/foo/bar.txt', name: 'bar.txt'}),
 *     ghostLabel: 'bar.txt',
 *     onDragStart: (e) => {},
 *     onDragEnd: (e) => {}
 *   });
 *
 *   AppUIDnD.makeDropZone(el, {
 *     accept: ['file', 'folder'],
 *     onDrop: (data, event) => { console.log('dropped', data); },
 *     onHover: (event) => {},
 *     onLeave: (event) => {},
 *     effectAllowed: 'move'
 *   });
 *
 *   AppUIDnD.onExternalDrop(el, (files, event) => {
 *     console.log('dropped', files.length, 'files from desktop');
 *   });
 *
 *   // Utility: prevent default browser drop behavior on document
 *   AppUIDnD.preventDefaults();
 *
 *   // Utility: clear all drag-over styling
 *   AppUIDnD.clearAllDragOver();
 */
const AppUIDnD = (function() {
  'use strict';

  const DRAG_OVER_CLASS = 'drag-over';
  const DRAG_ZONE_CLASS = 'drag-over-zone';
  const dropBindings = new WeakMap();
  let _defaultsBound = false;
  const _preventDefault = e => e.preventDefault();

  const dragSource = window._AppUIDragSource.create({clearAllDragOver});
  const makeDraggable = dragSource.makeDraggable;

  /**
   * Make an element a drop zone.
   * @param {HTMLElement} el - The drop zone element
   * @param {object} opts - Options
   *   - accept: array of type strings to accept (optional, accepts all if not set)
   *   - onDrop(data, event): called with parsed payload on drop
   *   - onHover(event): called during dragover
   *   - onLeave(event): called on dragleave
   *   - dropClass: CSS class for hover state (default: 'drag-over')
   *   - effectAllowed: 'move', 'copy', or 'all' (default: respects ctrlKey)
   *   - canDrop(event): optional predicate; false leaves the event for another drop target
   */
  function makeDropZone(el, opts) {
    dropBindings.get(el)?.destroy();
    opts = opts || {};
    const scope = AppUILifecycle.createScope();
    dropBindings.set(el, scope);
    const dropClass = opts.dropClass || DRAG_OVER_CLASS;

    scope.listen(el, 'dragover', (e) => {
      if (scope.destroyed) return;
      if (opts.canDrop && !opts.canDrop(e)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = e.ctrlKey ? 'copy' : (opts.effectAllowed || 'move');
      el.classList.add(dropClass);
      // Update ghost icon if present
      dragSource.updateGhost(e.ctrlKey);
      if (opts.onHover) opts.onHover(e);
    });

    scope.listen(el, 'dragleave', (e) => {
      if (scope.destroyed) return;
      if (!el.contains(e.relatedTarget)) {
        el.classList.remove(dropClass);
      }
      if (opts.onLeave) opts.onLeave(e);
    });

    scope.listen(el, 'drop', (e) => {
      if (scope.destroyed) return;
      if (opts.canDrop && !opts.canDrop(e)) return;
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove(dropClass);

      // Check for external files first
      if (e.dataTransfer.types.includes('Files') && e.dataTransfer.files.length > 0) {
        // External file drop  --  let onExternalDrop handlers deal with it if registered
        if (opts.onDrop) opts.onDrop({ _type: 'external', files: e.dataTransfer.files }, e);
        return;
      }

      // Internal drag
      const raw = e.dataTransfer.getData('text/plain');
      if (!raw) return;

      try {
        const data = JSON.parse(raw);
        // Type filtering
        if (opts.accept && opts.accept.length > 0) {
          if (!opts.accept.includes(data._type)) return;
        }
        if (opts.onDrop) opts.onDrop(data, e);
      } catch (err) {
        // Not valid JSON  --  ignore
      }
    });
    scope.add(() => {el.classList.remove(dropClass); if (dropBindings.get(el) === scope) dropBindings.delete(el);});
    return scope;
  }

  /**
   * Register a handler for external file drops (from desktop).
   * @param {HTMLElement} el - The drop zone element
   * @param {function} callback - (FileList, event) => void
   * @returns {object} Disposable binding with an idempotent destroy method.
   */
  function onExternalDrop(el, callback) {
    const scope = AppUILifecycle.createScope();
    scope.listen(el, 'dragover', (e) => {
      if (scope.destroyed) return;
      if (e.dataTransfer.types.includes('Files')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        el.classList.add(DRAG_ZONE_CLASS);
      }
    });

    scope.listen(el, 'dragleave', (e) => {
      if (scope.destroyed) return;
      if (!el.contains(e.relatedTarget)) {
        el.classList.remove(DRAG_ZONE_CLASS);
      }
    });

    scope.listen(el, 'drop', (e) => {
      if (scope.destroyed) return;
      e.preventDefault();
      el.classList.remove(DRAG_ZONE_CLASS);
      if (e.dataTransfer.files.length > 0) {
        callback(e.dataTransfer.files, e);
      }
    });
    scope.add(() => el.classList.remove(DRAG_ZONE_CLASS));
    return scope;
  }

  /**
   * Prevent default browser drag/drop behavior on the document.
   * Call once at page load.
   */
  function preventDefaults() {
    if (!_defaultsBound) {
      document.addEventListener('dragover', _preventDefault);
      document.addEventListener('drop', _preventDefault);
      _defaultsBound = true;
    }
    return restoreDefaults;
  }

  function restoreDefaults() {
    if (!_defaultsBound) return;
    document.removeEventListener('dragover', _preventDefault);
    document.removeEventListener('drop', _preventDefault);
    _defaultsBound = false;
  }

  /**
   * Clear all drag-over styling from the page.
   */
  function clearAllDragOver() {
    document.querySelectorAll('.' + DRAG_OVER_CLASS + ', .' + DRAG_ZONE_CLASS).forEach(el => {
      el.classList.remove(DRAG_OVER_CLASS, DRAG_ZONE_CLASS);
    });
  }



  return {
    makeDraggable,
    makeDropZone,
    onExternalDrop,
    preventDefaults,
    restoreDefaults,
    clearAllDragOver
  };
})();
window.AppUIDnD = AppUIDnD;
