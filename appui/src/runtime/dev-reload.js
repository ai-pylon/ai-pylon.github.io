/**
 * dev-reload.js — Live reload listener for page development.
 *
 * Subscribes to the 'dev' channel on AppUIEventBus and reloads the page when
 * a 'reload' event is received for the current page.
 *
 * Usage (auto-included in AppUI pages during development):
 *   Add this development-only module to a named bundle before loading it.
 *
 * Or manually in any page:
 *   await AppUIAssets.load('runtimeServices');
 *   // Then load the bundle containing dev-reload.
 *
 * The dev server (pylon/scripts/cli/dev_server.py) publishes events:
 *   { channel: 'dev', event: 'reload', data: { page: 'filebrowser', files: [...] } }
 *
 * This script only triggers reload if the page name matches the current page.
 * Set window.__DEV_RELOAD_ENABLED = false to disable without removing the script.
 */
(function () {
  'use strict';

  // Allow pages to opt out
  if (window.__DEV_RELOAD_ENABLED === false) return;

  // Derive current page name from URL path: /pages/<name>/ → <name>
  const pathMatch = location.pathname.match(/^\/pages\/([^/]+)/);
  const currentPage = pathMatch ? pathMatch[1] : null;

  if (!currentPage) return; // Not a page URL — skip

  let _bus = null;
  let _overlay = null;
  let _reloadTimer = null;

  function _showOverlay(files) {
    if (_overlay) return;
    _overlay = document.createElement('div');
    _overlay.id = 'dev-reload-overlay';
    _overlay.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'right:0',
      'z-index:999999', 'padding:6px 16px',
      'background:var(--color-success)',
      'color:var(--text-inverse, #fff)', 'font:12px/1.5 monospace',
      'text-align:center', 'opacity:0.95',
      'animation:dev-reload-fade 0.3s ease',
    ].join(';');
    const fileList = files?.length ? ` (${files.slice(0, 3).join(', ')}${files.length > 3 ? '...' : ''})` : '';
    _overlay.textContent = `↻ Reloading${fileList}`;
    document.body.appendChild(_overlay);

    // Inject keyframe if not already
    if (!document.getElementById('dev-reload-style')) {
      const style = document.createElement('style');
      style.id = 'dev-reload-style';
      style.textContent = '@keyframes dev-reload-fade { from { opacity:0; transform:translateY(-100%); } to { opacity:0.95; transform:translateY(0); } }';
      document.head.appendChild(style);
    }
  }

  function _connect() {
    if (typeof AppUIEventBus === 'undefined') {
      // Retry after a short delay — AppUIEventBus may not be loaded yet
      setTimeout(_connect, 200);
      return;
    }

    _bus = new AppUIEventBus(['dev']);
    _bus.on('dev', 'reload', function (data) {
      // Only reload if event is for this page (or no page filter — reload all)
      if (data.page && data.page !== currentPage) return;

      // Debounce rapid events (e.g. save triggers multiple file changes)
      if (_reloadTimer) return;
      _reloadTimer = setTimeout(function () {
        _showOverlay(data.files || []);
        // Small delay to show the overlay before reload
        setTimeout(function () { location.reload(); }, 150);
      }, 100);
    });

    // Log connection
    if (window.console && console.debug) {
      console.debug('[dev-reload] Listening for reload events on page:', currentPage);
    }
  }

  // Start connection
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _connect);
  } else {
    _connect();
  }

  // Expose for manual control
  window.__DevReload = {
    disable: function () {
      if (_bus) { _bus.close(); _bus = null; }
      if (_overlay) { _overlay.remove(); _overlay = null; }
      window.__DEV_RELOAD_ENABLED = false;
    },
    enable: function () {
      window.__DEV_RELOAD_ENABLED = true;
      if (!_bus) _connect();
    },
    page: currentPage,
  };
})();
