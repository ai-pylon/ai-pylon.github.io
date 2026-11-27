// resizer.js  --  AppUIResizer: Generic drag-to-resize
// Uses foundation pointer/lifecycle helpers; optional config API persistence.

const AppUIResizer = (function() {
  'use strict';

  /**
   * Create a resizer instance.
   * @param {object} opts
   * @param {HTMLElement|string} opts.handle - drag handle element or selector
   * @param {string} opts.direction - 'horizontal' or 'vertical'
   * @param {number} opts.min - minimum size in px
   * @param {number} opts.max - maximum size in px
   * @param {function} opts.onResize - called during drag: onResize(newSize)
   * @param {function} opts.onEnd - called on mouseup: onEnd(finalSize)
   * @param {object} [opts.persist] - {key: 'config.key'} to save/restore via config API
   */
  function create(opts) {
    const handle = typeof opts.handle === 'string'
      ? document.querySelector(opts.handle)
      : opts.handle;
    if (!handle) return;

    const direction = opts.direction || 'horizontal';
    const min = opts.min || 50;
    const max = opts.max || 2000;
    const onResize = opts.onResize || function() {};
    const onEnd = opts.onEnd || function() {};
    const persistKey = opts.persist && opts.persist.key;

    let _startPos = 0;
    let _startSize = 0;
    let _currentSize = 0;
    const owner = AppUILifecycle.createViewScope({host:handle});

    function clamp(val) {
      return Math.max(min, Math.min(max, val));
    }

    owner.add(() => handle.classList.remove('active'));
    owner.add(window.AppUIPointerGesture.bind(handle, {
      cursor: direction === 'horizontal' ? 'col-resize' : 'row-resize',
      shouldStart: () => owner.current(),
      onStart(event) {
        handle.classList.add('active');
        _startPos = direction === 'horizontal' ? event.clientX : event.clientY;
        _startSize = opts.getSize ? opts.getSize() : (_currentSize || min);
      },
      onMove(event) {
        const delta = (direction === 'horizontal' ? event.clientX : event.clientY) - _startPos;
        _currentSize = clamp(_startSize + delta);
        onResize(_currentSize);
      },
      onEnd() {
        handle.classList.remove('active');
        onEnd(_currentSize);
        if (persistKey) {
          fetch('/api/config.set', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({key: persistKey, value: _currentSize}),
          }).catch(function() {});
        }
      },
    }));

    // Restore from config if persist key provided
    if (persistKey) {
      fetch('/api/config.get', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: owner.signal,
        body: JSON.stringify({ key: persistKey })
      }).then(function(r) { return r.json(); })
        .then(function(d) {
          if (owner.current() && d.value) {
            _currentSize = clamp(d.value);
            onResize(_currentSize);
          }
        }).catch(function() {});
    }

    return {
      destroy: function() {
        owner.destroy();
      },
      getSize: function() { return _currentSize; },
      setSize: function(size) {
        if (!owner.current()) return;
        _currentSize = clamp(size);
        onResize(_currentSize);
      }
    };
  }

  return { create };
})();
window.AppUIResizer = AppUIResizer;
