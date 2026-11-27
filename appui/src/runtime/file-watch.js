/**
 * AppUIFileWatch — File change listener backed by AppUIEventBus.
 *
 * Delegates all SSE/SharedWorker connection handling to AppUIEventBus,
 * which already manages a single shared connection across tabs.
 *
 * Usage:
 *   const watcher = AppUIFileWatch.create({
 *     paths: ['/data/apps/documents/sysdoc_converter_dev/inputs'],
 *     onChange(events) { ... },
 *     debounce: 300
 *   });
 *   watcher.destroy();
 */
const AppUIFileWatch = (() => {

  function create(opts) {
    const paths = (opts.paths || []).map(p => p.replace(/\\/g, '/'));
    const onChange = opts.onChange || function() {};
    const debounceMs = opts.debounce || 300;

    let debounceTimer = null;
    let pending = [];
    let bus = null;
    let destroyed = false;

    // Guard: AppUIEventBus must be loaded before AppUIFileWatch
    if (typeof AppUIEventBus === 'undefined') {
      console.warn('[AppUIFileWatch] AppUIEventBus not loaded — file watching disabled. ' +
        'Ensure event-bus.js is loaded before file-watch.js.');
      return { destroy: function() {} };
    }

    function handleEvent(data, meta) {
      if (destroyed) return;
      try {
        var filePath = (data && data.path ? data.path : '').replace(/\\/g, '/');
        var relevant = !paths.length || paths.some(function(p) { return filePath.includes(p); });
        if (relevant) {
          pending.push({ channel: meta.channel, event: meta.event, data: data, ts: meta.ts });
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(flush, debounceMs);
        }
      } catch (e) { /* ignore malformed */ }
    }

    function flush() {
      if (pending.length) {
        onChange(pending);
        pending = [];
      }
    }

    bus = new AppUIEventBus(['files']);
    bus.on('files', '*', handleEvent);

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      clearTimeout(debounceTimer);
      if (bus) { bus.close(); bus = null; }
      pending = [];
      window.removeEventListener('beforeunload', destroy);
    }

    window.addEventListener('beforeunload', destroy);
    return { destroy: destroy };
  }

  return { create: create };
})();
window.AppUIFileWatch = AppUIFileWatch;
