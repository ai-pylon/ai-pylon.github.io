/* Private drag-source payloads, bindings and active ghost ownership. */
(function() {
  'use strict';
  window._AppUIDragSource = {
    create({clearAllDragOver}) {
      let _activeGhost = null, activeDragScope = null;
      const draggableBindings = new WeakMap();
      /**
       * Make an element draggable.
       * @param {HTMLElement} el - The element to make draggable
       * @param {object} opts - Options
       *   - type: string identifier for the drag type
       *   - getData(event): returns the data payload (will be JSON-stringified)
       *   - ghostLabel: text for the custom drag ghost
       *   - ghostIcon: icon for copy/move indication (auto-set based on ctrlKey)
       *   - onDragStart(event): called after dragstart setup
       *   - onDragEnd(event): called on dragend
       */
      function makeDraggable(el, opts) {
        draggableBindings.get(el)?.destroy();
        opts = opts || {};
        const scope = AppUILifecycle.createScope(), wasDraggable = el.draggable;
        draggableBindings.set(el, scope);
        el.draggable = true;
        scope.add(() => {
          el.draggable = wasDraggable; el.classList.remove('dragging');
          if (activeDragScope === scope) {
            clearAllDragOver(); _activeGhost?.remove(); _activeGhost = null; activeDragScope = null;
          }
          if (draggableBindings.get(el) === scope) draggableBindings.delete(el);
        });

        scope.listen(el, 'dragstart', (e) => {
          if (scope.destroyed) return;
          _activeGhost?.remove(); _activeGhost = null; activeDragScope = scope;
          const isCopy = e.ctrlKey;
          const data = opts.getData ? opts.getData(e) : {};
          const payload = JSON.stringify({ _type: opts.type || 'item', ...data });

          e.dataTransfer.setData('text/plain', payload);
          e.dataTransfer.effectAllowed = isCopy ? 'copy' : 'move';
          // Enable drag-to-desktop download (Chrome)
          if (data.path && !data.isDir) {
            const source = data.source || '';
            const downloadUrl = window.location.origin + '/api/file/download?source=' + encodeURIComponent(source) + '&path=' + encodeURIComponent(data.path);
            const mime = 'application/octet-stream';
            const filename = data.name || data.path.split('/').pop();
            try { e.dataTransfer.setData('DownloadURL', mime + ':' + filename + ':' + downloadUrl); } catch {}
            e.dataTransfer.setData('text/uri-list', downloadUrl);
          }
          el.classList.add('dragging');

          // Custom ghost
          if (opts.ghostLabel) {
            _activeGhost = document.createElement('div');
            _activeGhost.className = 'drag-ghost';
            const icon = isCopy ? '⊕' : '↗';
            _activeGhost.innerHTML = '<span class="drag-icon">' + icon + '</span>' + _escape(opts.ghostLabel);
            document.body.appendChild(_activeGhost);
            e.dataTransfer.setDragImage(_activeGhost, 0, 0);
          }

          if (opts.onDragStart) opts.onDragStart(e);
        });

        scope.listen(el, 'dragend', (e) => {
          if (scope.destroyed) return;
          el.classList.remove('dragging');
          if (activeDragScope === scope) {
            clearAllDragOver();
            activeDragScope = null;
            if (_activeGhost) {
              _activeGhost.remove();
              _activeGhost = null;
            }
          }
          if (opts.onDragEnd) opts.onDragEnd(e);
        });
        return scope;
      }

      function _escape(s) {
        return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      }
      function updateGhost(copy) {
        if (_activeGhost) {
          const iconEl = _activeGhost.querySelector('.drag-icon');
          if (iconEl) iconEl.textContent = copy ? '⊕' : '↗';
        }
      }
      return {makeDraggable,updateGhost};
    },
  };
})();
