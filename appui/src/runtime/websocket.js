/* WebSocket client with connection ownership, bounded queues and backpressure. */
const AppUIWebSocket = (() => {
  const DEFAULTS = {reconnect: true, binaryType: 'arraybuffer', protocols: [], reconnectDelay: 1000,
    maxReconnectDelay: 30000, heartbeatInterval: 25000, maxReconnectAttempts: 0,
    maxQueuedMessages: 256, maxQueuedBytes: 1048576, highWaterMark: 1048576,
    queueTtlMs: 30000, overflowPolicy: 'reject-newest', drainInterval: 50};
  function AppUIWebSocket(url, options) {
    if (!(this instanceof AppUIWebSocket)) return new AppUIWebSocket(url, options);
    this._url = url; this._opts = {...DEFAULTS, ...options};
    for (const key of ['maxQueuedMessages', 'maxQueuedBytes', 'highWaterMark', 'drainInterval']) {
      if (!Number.isSafeInteger(this._opts[key]) || this._opts[key] < 1) throw new RangeError(key + ' must be a positive safe integer');
    }
    if (!Number.isSafeInteger(this._opts.maxReconnectAttempts) || this._opts.maxReconnectAttempts < 0)
      throw new RangeError('maxReconnectAttempts must be a nonnegative safe integer');
    for (const key of ['reconnectDelay', 'maxReconnectDelay', 'heartbeatInterval', 'queueTtlMs']) {
      if (!(this._opts[key] >= 0) || (!Number.isFinite(this._opts[key]) && !(key === 'queueTtlMs' && this._opts[key] === Infinity)))
        throw new RangeError('Invalid ' + key);
    }
    if (!['reject-newest', 'drop-oldest'].includes(this._opts.overflowPolicy)) throw new Error('Invalid overflow policy');
    this._handlers = Object.create(null); this._ws = null; this._closed = false; this._generation = 0;
    this._reconnectAttempt = 0; this._reconnectDelay = this._opts.reconnectDelay;
    this._reconnectTimer = this._heartbeatTimer = this._drainTimer = null;
    this._queue = []; this._queuedBytes = 0; this._pressured = false;
    this._connect();
  }
  AppUIWebSocket.prototype._stopHeartbeat = function() {
    if (this._heartbeatTimer !== null) clearInterval(this._heartbeatTimer);
    this._heartbeatTimer = null;
  };
  AppUIWebSocket.prototype._clearDrain = function() {
    if (this._drainTimer !== null) clearTimeout(this._drainTimer);
    this._drainTimer = null;
  };
  AppUIWebSocket.prototype._retire = function(code = 1000, reason = '', notifyClose = false) {
    this._generation++;
    this._stopHeartbeat(); this._clearDrain();
    const socket = this._ws; this._ws = null;
    if (socket) {
      socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
      if (notifyClose) {
        const generation = this._generation;
        let emitted = false;
        socket.onclose = event => {
          if (emitted || !this._closed || generation !== this._generation) return;
          emitted = true; socket.onclose = null;
          this._emit('close', event.code, event.reason);
        };
      }
      try {socket.close(code, reason);} catch (_) {}
    }
  };
  AppUIWebSocket.prototype._connect = function() {
    if (this._closed) return;
    this._retire();
    const generation = this._generation;
    let socket;
    try {
      socket = this._opts.protocols.length ? new WebSocket(this._url, this._opts.protocols) : new WebSocket(this._url);
      socket.binaryType = this._opts.binaryType; this._ws = socket;
    } catch (error) {
      this._emit('error', error);
      if (generation === this._generation) {this._scheduleReconnect(); this._scheduleDrain();}
      return;
    }
    const current = () => !this._closed && this._generation === generation && this._ws === socket;
    socket.onopen = () => {
      if (!current()) return;
      this._reconnectAttempt = 0; this._reconnectDelay = this._opts.reconnectDelay;
      this._startHeartbeat(); this._flushQueue();
      if (current()) this._emit('open');
    };
    socket.onmessage = event => {
      if (!current()) return;
      if (event.data instanceof ArrayBuffer) this._emit('binary', event.data);
      else if (event.data instanceof Blob) {
        event.data.arrayBuffer().then(value => {if (current()) this._emit('binary', value);},
          error => {if (current()) this._emit('error', error);});
      } else {
        let parsed = null;
        try {parsed = JSON.parse(event.data);} catch (_) {}
        if (parsed?.type) this._emit(parsed.type, parsed.data, parsed);
        if (current()) this._emit('message', event.data, parsed);
      }
    };
    socket.onerror = event => {if (current()) this._emit('error', event);};
    socket.onclose = event => {
      if (!current()) return;
      this._stopHeartbeat(); this._clearDrain(); this._ws = null;
      const retired = ++this._generation;
      this._emit('close', event.code, event.reason);
      if (!this._closed && this._generation === retired) {this._scheduleReconnect(); this._scheduleDrain();}
    };
    this._scheduleDrain();
  };
  AppUIWebSocket.prototype._scheduleReconnect = function() {
    if (this._closed || !this._opts.reconnect || this._reconnectTimer !== null) return;
    if (this._opts.maxReconnectAttempts && this._reconnectAttempt >= this._opts.maxReconnectAttempts) {
      this._emit('exhausted', this._reconnectAttempt); return;
    }
    const generation = this._generation;
    const timer = setTimeout(() => {
      if (this._reconnectTimer !== timer || generation !== this._generation || this._closed) return;
      this._reconnectTimer = null; this._connect();
    }, this._reconnectDelay);
    this._reconnectTimer = timer;
    this._reconnectDelay = Math.min(this._reconnectDelay * 2, this._opts.maxReconnectDelay);
    this._emit('reconnecting', ++this._reconnectAttempt);
  };
  AppUIWebSocket.prototype._startHeartbeat = function() {
    this._stopHeartbeat();
    if (!this._opts.heartbeatInterval) return;
    const socket = this._ws, generation = this._generation;
    this._heartbeatTimer = setInterval(() => {
      if (this._closed || generation !== this._generation || this._ws !== socket) return;
      if (socket.readyState === WebSocket.OPEN && socket.bufferedAmount < this._opts.highWaterMark) {
        try {socket.send('');} catch (error) {this._emit('error', error);}
      }
    }, this._opts.heartbeatInterval);
  };
  AppUIWebSocket.prototype._expire = function() {
    const now = Date.now(), expired = [];
    this._queue = this._queue.filter(message => {
      if (message.expiresAt > now) return true;
      this._queuedBytes -= message.bytes; expired.push(message); return false;
    });
    if (expired.length) this._emit('expired', {messages: expired.length, bytes: expired.reduce((sum, message) => sum + message.bytes, 0)});
  };
  AppUIWebSocket.prototype._scheduleDrain = function() {
    this._clearDrain();
    if (this._closed || !this._queue.length) return;
    const expiry = this._queue.reduce((earliest, message) => Math.min(earliest, message.expiresAt), Infinity);
    let wait = Math.max(0, expiry - Date.now());
    if (this.connected) wait = Math.min(wait, this._opts.drainInterval);
    if (!Number.isFinite(wait)) return;
    const timer = setTimeout(() => {
      if (this._drainTimer !== timer) return;
      this._drainTimer = null; this._flushQueue();
    }, Math.min(wait, 2147483647));
    this._drainTimer = timer;
  };
  AppUIWebSocket.prototype._flushQueue = function() {
    this._expire();
    while (!this._closed && this._queue.length && this.connected) {
      const message = this._queue[0];
      if (this._ws.bufferedAmount + message.bytes > this._opts.highWaterMark) {
        if (!this._pressured) {this._pressured = true; this._emit('backpressure', {bufferedAmount: this._ws.bufferedAmount, queuedBytes: this._queuedBytes});}
        break;
      }
      try {this._ws.send(message.data);} catch (error) {this._emit('error', error); break;}
      this._queue.shift(); this._queuedBytes -= message.bytes;
    }
    if (this._pressured && !this._queue.length) {this._pressured = false; this._emit('drain');}
    this._scheduleDrain();
  };
  AppUIWebSocket.prototype.send = function(data, {ttlMs = this._opts.queueTtlMs} = {}) {
    if (this._closed) return false;
    if (!(ttlMs >= 0) || (!Number.isFinite(ttlMs) && ttlMs !== Infinity)) throw new RangeError('Invalid message TTL');
    this._expire();
    if (this._closed) return false;
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data).byteLength :
      data instanceof Blob ? data.size : data?.byteLength;
    if (!Number.isFinite(bytes)) throw new TypeError('Expected text, Blob, ArrayBuffer, or a typed array');
    if (!ttlMs) {this._emit('expired', {messages: 1, bytes}); return false;}
    if (bytes > this._opts.maxQueuedBytes || bytes > this._opts.highWaterMark) {
      this._emit('overflow', {policy: this._opts.overflowPolicy, rejected: true, bytes}); return false;
    }
    if (this._opts.overflowPolicy === 'drop-oldest') {
      let dropped = 0;
      while (this._queue.length && (this._queue.length >= this._opts.maxQueuedMessages || this._queuedBytes + bytes > this._opts.maxQueuedBytes)) {
        this._queuedBytes -= this._queue.shift().bytes; dropped++;
      }
      if (dropped) this._emit('overflow', {policy: 'drop-oldest', rejected: false, messages: dropped});
    }
    if (this._closed) return false;
    if (this._queue.length >= this._opts.maxQueuedMessages || this._queuedBytes + bytes > this._opts.maxQueuedBytes) {
      this._emit('overflow', {policy: 'reject-newest', rejected: true, bytes}); return false;
    }
    // Queued binary data must not change when the caller reuses its buffer.
    const snapshot = ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice() :
      data instanceof ArrayBuffer ? data.slice(0) : data;
    this._queue.push({data: snapshot, bytes, expiresAt: Date.now() + ttlMs}); this._queuedBytes += bytes;
    this._flushQueue(); return true;
  };
  AppUIWebSocket.prototype.sendBinary = function(data, options) {return this.send(data, options);};
  AppUIWebSocket.prototype.sendJSON = function(data, options) {return this.send(JSON.stringify(data), options);};
  AppUIWebSocket.prototype.on = function(event, fn) {(this._handlers[event] ||= []).push(fn); return this;};
  AppUIWebSocket.prototype.off = function(event, fn) {
    if (!fn) delete this._handlers[event];
    else if (this._handlers[event]) this._handlers[event] = this._handlers[event].filter(handler => handler !== fn);
    return this;
  };
  AppUIWebSocket.prototype._emit = function(event, ...args) {
    for (const handler of [...(this._handlers[event] || [])]) {try {handler(...args);} catch (error) {console.error('[AppUIWebSocket]', event, error);}}
  };
  AppUIWebSocket.prototype.close = function(code = 1000, reason = '') {
    this._closed = true;
    if (this._reconnectTimer !== null) clearTimeout(this._reconnectTimer);
    this._reconnectTimer = null; this._queue = []; this._queuedBytes = 0; this._pressured = false;
    this._retire(code, reason, true);
  };
  AppUIWebSocket.prototype.reconnect = function() {
    this._closed = false; this._reconnectAttempt = 0; this._reconnectDelay = this._opts.reconnectDelay;
    if (this._reconnectTimer !== null) clearTimeout(this._reconnectTimer);
    this._reconnectTimer = null; this._connect();
  };
  AppUIWebSocket.prototype.state = function() {
    if (this._closed || !this._ws) return 'closed';
    return ['connecting', 'open', 'closing', 'closed'][this._ws.readyState] || 'unknown';
  };
  Object.defineProperties(AppUIWebSocket.prototype, {
    connected: {get() {return !!this._ws && this._ws.readyState === WebSocket.OPEN;}},
    queueSize: {get() {return this._queue.length;}}, queuedBytes: {get() {return this._queuedBytes;}},
    bufferedAmount: {get() {return this._ws?.bufferedAmount || 0;}},
  });
  AppUIWebSocket.resolve = function(daemonName, path, params) {
    var base = null;
    if (typeof AppUIDaemonPorts !== 'undefined') {
      var httpUrl = AppUIDaemonPorts.url(daemonName);  // e.g. "http://127.0.0.1:8145"
      if (httpUrl) {
        // Convert http:// URL to ws:// URL
        base = httpUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
      }
    }
    if (!base) {
      var protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      base = protocol + '//' + window.location.host;
    }
    var url = base + (path || '');
    if (params) {
      var qs = Object.keys(params).map(function(k) {
        return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
      }).join('&');
      if (qs) url += '?' + qs;
    }
    return url;
  };

  return AppUIWebSocket;
})();

if (typeof window !== 'undefined') window.AppUIWebSocket = AppUIWebSocket;
