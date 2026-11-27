// watcher.js  --  AppUIWatcher: Generic SSE file/event watcher with debounce and auto-reconnect
// Requires AppUILifecycle and AppUIStreamEvents (browserComponents dependencies).

const AppUIWatcher = (function() {
  'use strict';

  /**
   * Create a watcher instance.
   * @param {object} opts
   * @param {string} opts.url - SSE endpoint URL
   * @param {function} opts.onEvent - called on each parsed event: onEvent(data)
   * @param {number} [opts.debounce=2000] - debounce interval in ms
   * @param {boolean} [opts.autoReconnect=true] - auto-reconnect on failure
   * @param {number} [opts.reconnectMs=5000] - reconnect delay in ms
   * @param {object} [opts.indicator] - {element, activeText, inactiveText} for status display
   * @returns {{subscribe, unsubscribe, isActive}}
   */
  function create(opts) {
    const url = opts.url;
    const onEvent = opts.onEvent || function() {};
    const debounceMs = opts.debounce || 2000;
    const autoReconnect = opts.autoReconnect !== false;
    const reconnectMs = opts.reconnectMs || 5000;
    const indicator = opts.indicator || null;

    const subscriptions = AppUILifecycle.createKeyedScopes({pagehide: false});
    let _active = false;
    let _params = null;
    let _debounceTimer = null;
    let _reconnectTimer = null;

    function updateIndicator(active) {
      if (!indicator || !indicator.element) return;
      const el = typeof indicator.element === 'string'
        ? document.querySelector(indicator.element)
        : indicator.element;
      if (!el) return;
      el.textContent = active ? (indicator.activeText || '👁 Watching') : (indicator.inactiveText || '');
      el.style.display = active ? '' : 'none';
    }

    function scheduleReconnect(owner) {
      if (!owner.current()) return;
      if (_reconnectTimer) return;
      if (!_params || !autoReconnect) return;
      _reconnectTimer = setTimeout(function() {
        if (!owner.current()) return;
        _reconnectTimer = null;
        if (owner.current() && _params && !_active && document.visibilityState !== 'hidden') {
          subscribe(_params);
        }
      }, reconnectMs);
    }

    /**
     * Subscribe to events with the given params (sent as POST body JSON).
     */
    function subscribe(params) {
      unsubscribe();
      if (!params || subscriptions.destroyed) return;

      _params = params;
      const owner = subscriptions.begin('subscription');
      _active = true;
      updateIndicator(true);

      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        signal: owner.signal
      }).then(function(resp) {
        if (!owner.current()) {resp.body?.cancel().catch(() => {}); return;}
        if (!resp.ok) { _active = false; updateIndicator(false); return; }
        const reader = resp.body.getReader();
        let released = false;
        const release = () => {
          if (released) return;
          try {reader.releaseLock?.(); released = true;} catch (_) {}
        };
        owner.add(() => {
          if (!released) Promise.resolve().then(() => reader.cancel()).catch(() => {}).then(release);
        });
        const decoder = new TextDecoder();
        const parser = AppUIStreamEvents.create(frame => {
          if (!owner.current()) return;
          let message;
          try {message = JSON.parse(frame.data);}
          catch (_) {message = {type: 'change', raw: frame.data};}
          debouncedEvent(message, owner);
        });

        function pump() {
          if (!owner.current()) return;
          reader.read().then(function(result) {
            if (!owner.current()) return;
            if (result.done) { parser.push(decoder.decode()); parser.finish(); release(); _active = false; updateIndicator(false); return; }
            parser.push(decoder.decode(result.value, {stream: true}));
            pump();
          }).catch(function() {
            release();
            if (!owner.current()) return;
            _active = false;
            updateIndicator(false);
            scheduleReconnect(owner);
          });
        }

        pump();
      }).catch(function(err) {
        if (!owner.current() || err.name === 'AbortError') return;
        _active = false;
        updateIndicator(false);
        scheduleReconnect(owner);
      });
    }

    /**
     * Debounce event delivery to avoid rapid-fire updates.
     */
    function debouncedEvent(data, owner) {
      if (_debounceTimer) return;
      _debounceTimer = setTimeout(function() {
        if (!owner.current()) return;
        _debounceTimer = null;
        onEvent(data);
      }, debounceMs);
    }

    /**
     * Unsubscribe from events.
     */
    function unsubscribe() {
      subscriptions.destroy('subscription');
      if (_debounceTimer) { clearTimeout(_debounceTimer); _debounceTimer = null; }
      if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
      _params = null;
      _active = false;
      updateIndicator(false);
    }

    /**
     * Check if watcher is currently active.
     */
    function isActive() { return _active; }

    // Re-subscribe when tab becomes visible
    function handleVisibility() {
      if (document.visibilityState === 'visible' && _params && !_active && autoReconnect) {
        subscribe(_params);
      }
    }
    document.addEventListener('visibilitychange', handleVisibility);

    function destroy() {
      unsubscribe();
      subscriptions.destroy();
      document.removeEventListener('visibilitychange', handleVisibility);
    }

    return { subscribe: subscribe, unsubscribe: unsubscribe, isActive: isActive, destroy: destroy };
  }

  return { create: create };
})();
window.AppUIWatcher = AppUIWatcher;
