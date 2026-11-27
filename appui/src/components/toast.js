/**
 * UI Toast  --  non-blocking notification messages.
 *
 * Usage:
 *   AppUIToast.success('Saved!');
 *   AppUIToast.error('Failed to connect');
 *   AppUIToast.info('Processing...');
 *   AppUIToast.warn('Low disk space');
 *
 * When `window.AppUINotifications` is available (from the AppUI notifications
 * bundle), AppUIToast methods delegate to it so there is only one visual toast
 * system on screen. AppUINotifications.show() calls back into AppUIToast._showRaw()
 * which always renders directly, avoiding infinite loops.
 */
var AppUIToast = window.AppUIToast || (function() {
  let _container = null;

  function _ensureContainer() {
    if (_container) return;
    _container = document.createElement('div');
    _container.className = 'ui-toast-container';
    document.body.appendChild(_container);
  }

  function _show(message, type, duration) {
    _ensureContainer();
    const el = document.createElement('div');
    el.className = `ui-toast ui-toast-${type}`;
    const icons = {success:'✓', error:'✗', info:'ℹ', warn:'⚠'};
    el.innerHTML = `<span class="ui-toast-icon">${icons[type] || ''}</span><span class="ui-toast-text">${message}</span><button class="ui-toast-close" title="Dismiss" aria-label="Dismiss">×</button>`;
    el.querySelector('.ui-toast-text').style.cssText = 'user-select:text;cursor:text;flex:1;min-width:0';
    _container.appendChild(el);
    // Animate in
    requestAnimationFrame(() => el.classList.add('show'));
    // Auto dismiss
    let timer = setTimeout(() => _dismiss(el), duration || 3000);
    let pinned = false;
    // Click on toast body pins it (stops auto-dismiss)
    el.addEventListener('click', (e) => {
      if (e.target.closest('.ui-toast-close')) { clearTimeout(timer); _dismiss(el); return; }
      if (!pinned) { clearTimeout(timer); pinned = true; el.classList.add('pinned'); }
    });
    // Hovering pauses auto-dismiss
    el.addEventListener('mouseenter', () => { clearTimeout(timer); });
    el.addEventListener('mouseleave', () => { if (!pinned) timer = setTimeout(() => _dismiss(el), 2000); });
  }

  function _dismiss(el) {
    el.classList.remove('show');
    el.classList.add('hide');
    setTimeout(() => el.remove(), 300);
  }

  /** Delegate to AppUINotifications if loaded, otherwise render directly. */
  function _dispatch(msg, type, ms) {
    if (window.AppUINotifications?.show) {
      window.AppUINotifications.show(msg, type, ms);
    } else {
      _show(msg, type, ms);
    }
  }

  return {
    success: (msg, ms) => _dispatch(msg, 'success', ms),
    error: (msg, ms) => _dispatch(msg, 'error', ms || 5000),
    info: (msg, ms) => _dispatch(msg, 'info', ms),
    warn: (msg, ms) => _dispatch(msg, 'warn', ms || 4000),
    /** Direct render used internally by AppUINotifications.show(). */
    _showRaw: (msg, type, ms) => _show(msg, type, ms),
  };
})();
window.AppUIToast = AppUIToast;
