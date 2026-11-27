/* Private bounded batching and isolated handler delivery for EventBus. */
window._AppUIEventBusDispatch = {
  dispatch(bus, channel, event, data, ts) {
    // Debounce: batch events within the configured window
    if (bus._debounce > 0) {
      const key = `${channel}:${event}`;
      if (!bus._debouncePending[key]) {
        bus._debouncePending[key] = [];
        bus._debounceFirstTs[key] = Date.now();  // batch start (wall clock)
      }
      bus._debouncePending[key].push({ data, ts });

      const flush = () => {
        const batch = bus._debouncePending[key] || [];
        clearTimeout(bus._debounceTimers[key]);
        delete bus._debouncePending[key];
        delete bus._debounceTimers[key];
        delete bus._debounceFirstTs[key];
        const last = batch[batch.length - 1];
        if (!last) return;
        bus._emitToHandlers(channel, event, last.data, { channel, event, ts: last.ts, batch });
      };

      // Bounded delay: never defer a batch longer than _debounceMax past its
      // first event, even under a continuous stream that keeps resetting the
      // quiet-window timer (previously events could accumulate unbounded and
      // never deliver until traffic paused).
      const elapsed = Date.now() - bus._debounceFirstTs[key];
      const remainingCap = Math.max(0, bus._debounceMax - elapsed);
      const delay = Math.min(bus._debounce, remainingCap);

      clearTimeout(bus._debounceTimers[key]);
      bus._debounceTimers[key] = setTimeout(flush, delay);
      return;
    }
    bus._emitToHandlers(channel, event, data, { channel, event, ts });
  },

  emit(bus, channel, event, data, meta) {
    // Deliver to every handler in isolation: a throwing handler must NOT
    // prevent delivery to the remaining handlers (previously a single throw in
    // forEach aborted the whole dispatch).
    const safe = (fn, ...args) => {
      try { fn(...args); } catch (err) {
        try { console.error('[AppUIEventBus] handler error:', err); } catch (_e) { /* ignore */ }
      }
    };

    // Specific handlers
    const key = `${channel}:${event}`;
    (bus._handlers[key] || []).forEach(fn => safe(fn, data, meta));

    // Channel-level handlers (any event)
    (bus._handlers[`${channel}:*`] || []).forEach(fn => safe(fn, data, meta));

    // Global handlers
    bus._anyHandlers.forEach(fn => safe(fn, channel, event, data, meta.ts));
  }
};
