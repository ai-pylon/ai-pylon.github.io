/**
 * AppUIEventBus  --  Subscribe to real-time server events via SSE.
 *
 * Uses a SharedWorker when available to maintain a single SSE connection
 * across all open tabs, falling back to direct EventSource per-tab.
 *
 * Usage:
 *   const bus = new AppUIEventBus(['files', 'daemons']);
 *   bus.on('files', 'changed', (data) => console.log('File changed:', data));
 *   bus.on('daemons', 'stopped', (data) => console.log('Daemon stopped:', data));
 *   bus.onAny((channel, event, data) => { ... });
 *   bus.onStatus((state) => console.log('Connection:', state));
 *   bus.close();
 *
 * Options:
 *   new AppUIEventBus(channels, {
 *     replay: 0,           // replay last N events on connect
 *     debounce: 0,         // ms — batch events within this window
 *     debounceMax: 0,      // ms — max time a batch may be deferred past its
 *                          //      first event (default 10x debounce, min 1s);
 *                          //      bounds latency under sustained traffic
 *     maxRetries: 0,       // 0 = unlimited retries
 *     onStatus: (state) => {}  // called with 'connected'|'reconnecting'|'disconnected'
 *   });
 *
 * Connection states: 'connected', 'reconnecting', 'disconnected'
 * On reconnect, a synthetic event is dispatched: channel='_system', event='reconnected'
 *
 * Publish (from page):
 *   AppUIEventBus.publish('notify', 'info', {msg: 'Hello'});
 */
class AppUIEventBus {
  constructor(channels = ['*'], opts = {}) {
    this._handlers = {};      // channel -> event -> [fn]
    this._anyHandlers = [];
    this._statusHandlers = [];
    this._channels = channels;
    this._replay = opts.replay || 0;
    this._debounce = opts.debounce || 0;  // ms — batch events within this window
    // Max time a batch may be deferred past its first event, even under a
    // continuous stream (default: 10x the window, min 1s) — bounds delivery
    // latency so sustained traffic cannot defer updates indefinitely.
    this._debounceMax = opts.debounceMax || Math.max(this._debounce * 10, 1000);
    this._debounceTimers = {};            // channel:event -> timer
    this._debouncePending = {};           // channel:event -> [data, ...]
    this._debounceFirstTs = {};           // channel:event -> ms when batch started
    this._maxRetries = opts.maxRetries || 0;  // 0 = unlimited
    this._retryCount = 0;
    this._backoffDelay = 1000;  // starts at 1s
    this._backoffMax = 30000;   // caps at 30s
    this._state = 'disconnected';
    this._es = null;
    this._worker = null;
    this._port = null;
    this._closed = false;
    this._wasConnected = false;  // tracks if we had a prior connection (for reconnect event)

    if (opts.onStatus) this._statusHandlers.push(opts.onStatus);

    this._connect();
  }

  _setState(state) {
    if (this._state === state) return;
    this._state = state;
    this._statusHandlers.forEach(fn => {
      try { fn(state); } catch (e) { /* ignore */ }
    });
  }

  /** Register a status change handler. Returns this for chaining. */
  onStatus(fn) {
    this._statusHandlers.push(fn);
    // Immediately call with current state
    try { fn(this._state); } catch (e) { /* ignore */ }
    return this;
  }

  /** Current connection state: 'connected'|'reconnecting'|'disconnected' */
  get state() { return this._state; }

  async _connect() {
    return window._AppUIEventBusTransport.connect(this);
  }

  _handleWorkerStatus(state) {
    return window._AppUIEventBusTransport.handleWorkerStatus(this,state);
  }

  _connectDirect() {
    return window._AppUIEventBusTransport.connectDirect(this);
  }

  _dispatch(channel,event,data,ts) {
    return window._AppUIEventBusDispatch.dispatch(this,channel,event,data,ts);
  }

  _emitToHandlers(channel,event,data,meta) {
    return window._AppUIEventBusDispatch.emit(this,channel,event,data,meta);
  }

  on(channel, event, fn) {
    const key = `${channel}:${event}`;
    if (!this._handlers[key]) this._handlers[key] = [];
    this._handlers[key].push(fn);
    return this;
  }

  onAny(fn) {
    this._anyHandlers.push(fn);
    return this;
  }

  offAny(fn) {
    this._anyHandlers = this._anyHandlers.filter(handler => handler !== fn);
    return this;
  }

  off(channel, event, fn) {
    const key = `${channel}:${event}`;
    const arr = this._handlers[key];
    if (arr) {
      const idx = arr.indexOf(fn);
      if (idx >= 0) arr.splice(idx, 1);
    }
    return this;
  }

  close() {
    this._closed = true;
    if (this._port) {
      this._port.postMessage({ type: 'disconnect' });
      this._port.close();
      this._port = null;
      this._worker = null;
    }
    if (this._es) this._es.close();
    this._setState('disconnected');
    // Clear debounce timers
    Object.values(this._debounceTimers).forEach(t => clearTimeout(t));
    this._debounceTimers = {};
    this._debouncePending = {};
    this._debounceFirstTs = {};
    this._handlers = {};
    this._anyHandlers = [];
    this._statusHandlers = [];
  }

  static publish(channel, event, data) {
    return fetch('/events/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, event, data })
    }).then(r => r.json()).catch(() => ({}));
  }
}

// Export for module or global
if (typeof window !== 'undefined') window.AppUIEventBus = AppUIEventBus;
