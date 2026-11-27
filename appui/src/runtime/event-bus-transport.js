/* Private endpoint discovery and SharedWorker/direct-SSE transport for EventBus. */
window._AppUIEventBusTransport = {
  async connect(bus) {
    bus._eventsBase = (typeof AppUIDaemonPorts !== 'undefined')
      ? await AppUIDaemonPorts.urlAsync('apps/events') : '';
    // close() may have been called during the await above; do not open a
    // connection for an already-closed bus.
    if (bus._closed) return;
    if (!bus._eventsBase) {
      // Endpoint discovery failed (broker not up yet). Previously this gave up
      // silently; retry with the same bounded backoff as a transport error so
      // the bus recovers once the broker appears.
      bus._retryCount++;
      if (bus._maxRetries > 0 && bus._retryCount >= bus._maxRetries) {
        bus._setState('disconnected');
        return;
      }
      bus._setState('reconnecting');
      setTimeout(() => { if (!bus._closed) bus._connect(); }, bus._backoffDelay);
      bus._backoffDelay = Math.min(bus._backoffDelay * 2, bus._backoffMax);
      return;
    }
    // Try SharedWorker first — single SSE connection shared across tabs
    if (typeof SharedWorker !== 'undefined' && location.protocol !== 'file:') {
      try {
        // versioned URL (ROUND3 #33): served immutable instead of revalidated per page load; every tab on the
        // same build still resolves the same URL, so they keep sharing ONE worker
        const _sseUrl = (window.AppUIAssets && typeof AppUIAssets.versioned === 'function')
          ? AppUIAssets.versioned('/appui/src/runtime/sse-worker.js') : '/appui/src/runtime/sse-worker.js';
        bus._worker = new SharedWorker(_sseUrl);
        bus._port = bus._worker.port;
        bus._port.onmessage = (e) => {
          try {
            const msg = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
            if (msg.type === 'status') {
              bus._handleWorkerStatus(msg.state);
            } else {
              // Event data: {channel, event, data, ts}
              bus._dispatch(msg.channel, msg.event, msg.data, msg.ts);
            }
          } catch (err) { /* ignore malformed */ }
        };
        bus._worker.onerror = () => {
          // SharedWorker failed to load — fall back to direct
          bus._worker = null;
          bus._port = null;
          bus._connectDirect();
        };
        bus._port.start();
        bus._port.postMessage({ type: 'subscribe', channels: bus._channels, endpoint: bus._eventsBase, replay: bus._replay });
        return;
      } catch (err) {
        // SharedWorker construction failed — fall back
        bus._worker = null;
        bus._port = null;
      }
    }
    // Fallback: direct EventSource connection per-tab
    bus._connectDirect();
  },

  handleWorkerStatus(bus,state) {
    const prevState = bus._state;
    bus._setState(state);
    if (state === 'connected') {
      bus._retryCount = 0;
      bus._backoffDelay = 1000;
      if (bus._wasConnected) {
        // Reconnected after a disconnect — emit synthetic event
        bus._dispatch('_system', 'reconnected', { timestamp: Date.now() }, Date.now());
      }
      bus._wasConnected = true;
    }
  },

  connectDirect(bus) {
    if (bus._closed) return;

    // Check max retries
    if (bus._maxRetries > 0 && bus._retryCount >= bus._maxRetries) {
      bus._setState('disconnected');
      return;
    }

    const ch = bus._channels.join(',');
    // Connect directly to events daemon for SSE
    const url = `${bus._eventsBase}/subscribe?channels=${ch}&replay=${bus._replay}`;
    bus._es = new EventSource(url);

    bus._es.onopen = () => {
      const wasReconnect = bus._wasConnected;
      bus._setState('connected');
      bus._retryCount = 0;
      bus._backoffDelay = 1000;
      if (wasReconnect) {
        // Emit synthetic reconnect event so pages can re-fetch stale data
        bus._dispatch('_system', 'reconnected', { timestamp: Date.now() }, Date.now());
      }
      bus._wasConnected = true;
    };

    bus._es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        bus._dispatch(msg.channel, msg.event, msg.data, msg.ts);
      } catch (err) { /* ignore malformed */ }
    };

    bus._es.onerror = () => {
      bus._es.close();
      bus._es = null;
      bus._retryCount++;

      // Check max retries
      if (bus._maxRetries > 0 && bus._retryCount >= bus._maxRetries) {
        bus._setState('disconnected');
        return;
      }

      bus._setState('reconnecting');
      setTimeout(() => bus._connectDirect(), bus._backoffDelay);
      // Exponential backoff: 1s, 2s, 4s, 8s, 16s, max 30s
      bus._backoffDelay = Math.min(bus._backoffDelay * 2, bus._backoffMax);
    };
  }
};
