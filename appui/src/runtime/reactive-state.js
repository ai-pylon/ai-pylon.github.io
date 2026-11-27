/**
 * AppUIReactiveState — in-memory reactive store for cross-component communication.
 *
 * Unlike State (localStorage persistence), AppUIReactiveState is purely in-memory
 * and designed for same-page component coordination with automatic derived values.
 *
 * Usage:
 *   const store = AppUIReactiveState.create();
 *   store.set('transcript', entries);
 *   store.watch('transcript', (value) => updateUI(value));
 *   store.derived('context', ['transcript', 'selection'], (t, s) => buildContext(t, s));
 *   store.batch(() => { store.set('a', 1); store.set('b', 2); }); // single notification round
 */
var AppUIReactiveState = window.AppUIReactiveState || (function() {
  'use strict';

  function create() {
    const _data = Object.create(null);
    const _watchers = Object.create(null);    // key -> Set<fn>
    const _derivations = Object.create(null); // key -> {deps, compute}
    let _batchDepth = 0, _flushing = false;
    let _pending = new Map();
    let _order = [];

    function _dependencyOrder() {
      const visiting = new Set(), visited = new Set(), order = [];
      function visit(key) {
        if (visiting.has(key)) throw new Error('Derived state dependency cycle at ' + key);
        if (visited.has(key)) return;
        visiting.add(key);
        for (const dep of _derivations[key].deps) {
          if (_derivations[dep]) visit(dep);
        }
        visiting.delete(key);
        visited.add(key);
        order.push(key);
      }
      Object.keys(_derivations).forEach(visit);
      return order;
    }

    function _change(key, value, notify = true) {
      if (!_pending.has(key)) _pending.set(key, {prev: _data[key], notify});
      else if (notify) _pending.get(key).notify = true;
      _data[key] = value;
      if (!_batchDepth && !_flushing) _flush();
    }

    function set(key, value) { _change(key, value); }

    function get(key, defaultValue) {
      return key in _data ? _data[key] : defaultValue;
    }

    function watch(key, fn) {
      if (!_watchers[key]) _watchers[key] = new Set();
      _watchers[key].add(fn);
      return () => unwatch(key, fn);
    }

    function unwatch(key, fn) { _watchers[key]?.delete(fn); }

    function derived(key, deps, computeFn) {
      const previous = _derivations[key];
      const definition = {deps: [...deps], compute: computeFn};
      _derivations[key] = definition;
      let order, initial;
      try {
        order = _dependencyOrder();
        initial = computeFn(...deps.map(dep => _data[dep]));
      } catch (error) {
        if (previous) _derivations[key] = previous;
        else delete _derivations[key];
        throw error;
      }
      _order = order;
      // Registration stays silent for this key, but updates existing dependents.
      _change(key, initial, false);
      return () => {
        if (_derivations[key] !== definition) return;
        delete _derivations[key];
        _order = _dependencyOrder();
      };
    }

    function batch(fn) {
      _batchDepth++;
      try { return fn(); }
      finally {
        _batchDepth--;
        if (!_batchDepth && !_flushing) _flush();
      }
    }

    function _notify(key, value, prev) {
      const callbacks = [...(_watchers[key] || []), ...(_watchers['*'] || [])];
      for (const fn of callbacks) { try { fn(value, key, prev); } catch (_) {} }
    }

    function _flush() {
      _flushing = true;
      try {
        while (_pending.size) {
          const changes = _pending;
          _pending = new Map();
          const changed = new Set(changes.keys());
          for (const key of _order) {
            const definition = _derivations[key];
            if (!definition || !definition.deps.some(dep => changed.has(dep))) continue;
            const value = definition.compute(...definition.deps.map(dep => _data[dep]));
            if (!Object.is(value, _data[key])) {
              if (!changes.has(key)) changes.set(key, {prev: _data[key], notify: true});
              _data[key] = value;
              changed.add(key);
            }
          }
          // Every observer sees a fully recomputed graph. Reentrant writes
          // queue another round rather than recursively interrupting this one.
          const notifications = [...changes].map(([key, change]) => [key, _data[key], change]);
          for (const [key, value, change] of notifications) {
            if (change.notify) _notify(key, value, change.prev);
          }
        }
      } finally { _flushing = false; }
    }

    function keys() { return Object.keys(_data); }

    function destroy() {
      _pending.clear();
      _order = [];
      for (const key in _watchers) _watchers[key].clear();
      for (const key in _data) delete _data[key];
      for (const key in _derivations) delete _derivations[key];
    }

    return { set, get, watch, unwatch, derived, batch, keys, destroy };
  }

  return { create };
})();

if (typeof window !== 'undefined') window.AppUIReactiveState = AppUIReactiveState;
