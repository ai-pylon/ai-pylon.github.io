/**
 * State  --  localStorage persistence layer with cross-tab sync.
 *
 * Usage:
 *   const state = State.create('doc_studio');
 *   state.set('content', {title: 'Hello'});
 *   state.get('content');  // {title: 'Hello'}
 *   state.clear('content');
 *   state.clearAll();
 *
 * Features:
 *   - Namespaced per page (no collisions between pages)
 *   - Debounced auto-save (batches rapid writes)
 *   - Cross-tab sync via storage event
 *   - save/load/clear direct functions
 */
var State = window.State || (function() {
  'use strict';

  const DEFAULT_DEBOUNCE_MS = 300;

  /**
   * Create a namespaced state instance.
   * @param {string} namespace  --  unique per page/app (e.g. 'doc_studio')
   * @param {object} opts  --  {debounce: ms, onChange: fn(key, value)}
   * @returns {StateInstance}
   */
  function create(namespace, opts) {
    opts = opts || {};
    const prefix = 'state:' + namespace + ':';
    const debounceMs = opts.debounce != null ? opts.debounce : DEFAULT_DEBOUNCE_MS;
    const listeners = Object.create(null);  // key -> [callback, ...]
    let pendingWrites = Object.create(null);
    let writeTimer = null;

    // --- Core persistence ---

    function _storageKey(key) {
      return prefix + key;
    }

    function save(key, data) {
      AppUIStorage.setJSON(_storageKey(key), data);
    }

    function load(key, defaultValue) {
      return AppUIStorage.getJSON(_storageKey(key), defaultValue !== undefined ? defaultValue : null);
    }

    function clear(key) {
      delete pendingWrites[key];
      if (!Object.keys(pendingWrites).length && writeTimer !== null) {
        clearTimeout(writeTimer);
        writeTimer = null;
      }
      AppUIStorage.remove(_storageKey(key));
    }

    function clearAll() {
      pendingWrites = Object.create(null);
      if (writeTimer !== null) clearTimeout(writeTimer);
      writeTimer = null;
      AppUIStorage.keys(prefix).forEach(key => AppUIStorage.remove(key));
    }

    // --- Debounced auto-save ---

    function _flushWrites() {
      const batch = pendingWrites;
      pendingWrites = Object.create(null);
      writeTimer = null;
      for (const key in batch) {
        save(key, batch[key]);
      }
    }

    function set(key, data) {
      pendingWrites[key] = data;
      if (writeTimer !== null) clearTimeout(writeTimer);
      writeTimer = setTimeout(_flushWrites, debounceMs);
      // Notify local listeners immediately (optimistic)
      _notify(key, data);
    }

    function get(key, defaultValue) {
      // Return pending write if exists (not yet flushed)
      if (key in pendingWrites) return pendingWrites[key];
      return load(key, defaultValue);
    }

    // --- Flush (force immediate write) ---

    function flush() {
      if (writeTimer !== null) {
        clearTimeout(writeTimer);
        _flushWrites();
      }
    }

    // --- Listeners ---

    function _notify(key, value) {
      (listeners[key] || []).forEach(fn => { try { fn(value, key); } catch(e) {} });
      (listeners['*'] || []).forEach(fn => { try { fn(value, key); } catch(e) {} });
      if (opts.onChange) { try { opts.onChange(key, value); } catch(e) {} }
    }

    function onChange(key, callback) {
      if (!listeners[key]) listeners[key] = [];
      listeners[key].push(callback);
    }

    function offChange(key, callback) {
      if (listeners[key]) {
        listeners[key] = listeners[key].filter(fn => fn !== callback);
      }
    }

    // --- Cross-tab sync ---

    function _handleStorage(e) {
      if (!e.key || !e.key.startsWith(prefix)) return;
      const key = e.key.slice(prefix.length);
      let value = null;
      try { value = e.newValue ? JSON.parse(e.newValue) : null; } catch(err) {}
      _notify(key, value);
    }

    window.addEventListener('storage', _handleStorage);

    // --- Cleanup ---

    function destroy() {
      flush();
      window.removeEventListener('storage', _handleStorage);
    }

    return {
      save, load, clear, clearAll,
      set, get, flush,
      onChange, offChange,
      destroy,
      get namespace() { return namespace; }
    };
  }

  return { create };
})();
