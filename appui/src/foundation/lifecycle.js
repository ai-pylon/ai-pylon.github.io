/* Resource ownership helpers for AppUI services, components, and features. */
var AppUILifecycle = window.AppUILifecycle || (function() {
  function createScope() {
    let destroyed = false;
    const cleanups = [];
    return {
      add(cleanup) {
        const dispose = typeof cleanup === 'function' ? cleanup
          : typeof cleanup?.destroy === 'function' ? () => cleanup.destroy() : null;
        if (!dispose) return cleanup;
        let complete = false;
        const once = () => {
          if (complete) return;
          complete = true;
          dispose();
        };
        if (destroyed) once();
        else cleanups.push(once);
        return once;
      },
      listen(target, type, listener, options) {
        target.addEventListener(type, listener, options);
        return this.add(() => target.removeEventListener(type, listener, options));
      },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        let failed = false, firstError;
        cleanups.splice(0).reverse().forEach(cleanup => {
          try { cleanup(); }
          catch (error) { if (!failed) { failed = true; firstError = error; } }
        });
        if (failed) throw firstError;
      },
      get destroyed() { return destroyed; },
    };
  }

  // Coalesce work into one frame; canceled callbacks stay inert even if delivered late.
  function createFrameTask(callback, {fallbackDelay = 16} = {}) {
    let pending = null, destroyed = false;
    function cancel() {
      const task = pending;
      pending = null;
      if (!task) return;
      if (task.timer) clearTimeout(task.id);
      else if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(task.id);
    }
    function schedule() {
      if (destroyed || pending) return;
      const task = {id: null, timer: false};
      pending = task;
      const run = () => {
        if (destroyed || pending !== task) return;
        pending = null;
        callback();
      };
      try { task.id = requestAnimationFrame(run); }
      catch (error) {
        if (pending !== task) throw error;
        task.timer = true;
        task.id = setTimeout(run, fallbackDelay);
      }
    }
    return {schedule, cancel, destroy() {destroyed = true; cancel();}};
  }

  // A callable delayed task; a scope can own its cleanup via add(task.destroy).
  function debounce(callback, delay = 300) {
    let pending = null, destroyed = false;
    function cancel() {
      const task = pending;
      pending = null;
      if (task) clearTimeout(task.id);
    }
    function schedule(...args) {
      if (destroyed) return;
      cancel();
      const task = {id: null};
      pending = task;
      task.id = setTimeout(() => {
        if (destroyed || pending !== task) return;
        pending = null;
        callback.apply(this, args);
      }, delay);
    }
    schedule.cancel = cancel;
    schedule.destroy = () => {destroyed = true; cancel();};
    return schedule;
  }

  function generation() {
    let value = 0;
    return {next: () => ++value, current: () => value, isCurrent: candidate => candidate === value};
  }

  function createViewScope({host, parent, signal, isCurrent, pagehide = true, observeRemoval = true} = {}) {
    const scope = createScope(), controller = new AbortController();
    let mounted = !host || host.isConnected !== false;
    scope.signal = controller.signal;
    scope.current = () => !scope.destroyed && (!parent || parent.current()) && (!host || host.isConnected !== false) && (!isCurrent || !!isCurrent());
    scope.add(() => controller.abort());
    if (parent) {
      const cancel = () => scope.destroy();
      if (parent.signal.aborted) {scope.destroy();return scope;}
      parent.signal.addEventListener('abort', cancel, {once: true});
      scope.add(() => parent.signal.removeEventListener('abort', cancel));
    }
    if (signal) {
      if (signal.aborted) {scope.destroy();return scope;}
      scope.listen(signal,'abort',()=>scope.destroy(),{once:true});
    }
    if (pagehide) scope.listen(window, 'pagehide', event => {if (!event.persisted) scope.destroy();});
    if (host && observeRemoval && typeof MutationObserver === 'function') {
      const observer = new MutationObserver(() => {
        if (host.isConnected !== false) mounted = true;
        if (mounted && !scope.current()) scope.destroy();
      });
      const target = host.ownerDocument?.body || (typeof document !== 'undefined' && document.body);
      if (target) {observer.observe(target, {childList: true, subtree: true}); scope.add(() => observer.disconnect());}
    }
    return scope;
  }

  function createKeyedScopes(options = {}) {
    const lifetime = createViewScope(options), scopes = new Map();
    function clear() {
      const owned = Array.from(scopes.values()); scopes.clear();
      const cleanup=createScope();
      owned.reverse().forEach(scope=>cleanup.add(scope));
      cleanup.destroy();
    }
    lifetime.add(clear);
    return {
      signal: lifetime.signal,
      current: () => lifetime.current(),
      get destroyed() { return lifetime.destroyed; },
      get: key => scopes.get(key),
      begin(key, options = {}) {
        const previous = scopes.get(key), {isCurrent, parent, ...settings} = options;
        const scope = createViewScope({pagehide: false, ...settings, parent: parent || lifetime,
          isCurrent: () => scopes.get(key) === scope && lifetime.current() && (!isCurrent || !!isCurrent()),
        });
        scopes.set(key, scope);
        scope.add(() => {if (scopes.get(key) === scope) scopes.delete(key);});
        if (lifetime.destroyed) scope.destroy();
        previous?.destroy();
        return scope;
      },
      destroy(...keys) {if (keys.length) scopes.get(keys[0])?.destroy(); else lifetime.destroy();},
      destroyAll: clear,
    };
  }

  function wait(scope, milliseconds, {isCurrent} = {}) {
    if(scope.destroyed)return Promise.resolve(false);
    return new Promise(resolve=>{
      const timer=setTimeout(()=>resolve(!scope.destroyed&&(!isCurrent||!!isCurrent())),milliseconds);
      scope.add(()=>{clearTimeout(timer);resolve(false);});
    });
  }

  return {createScope, createViewScope, createKeyedScopes, generation, wait, createFrameTask, debounce};
})();
window.AppUILifecycle = AppUILifecycle;
