/**
 * AppUIToolSocket — fast tool calls via SharedWorker + WebSocket.
 *
 * Usage:
 *   const ts = new AppUIToolSocket();
 *   const result = await ts.call('vfs.ls', {path: 'C:/...'});
 *
 * Architecture:
 *   All tabs share ONE WebSocket via SharedWorker.
 *   Tab1 ──port──┐
 *   Tab2 ──port──┼──→ SharedWorker ──→ 1 WebSocket ──→ :9090/ws/tools
 *   Tab3 ──port──┘
 *
 * Fallback chain:
 *   1. SharedWorker (single WS across all tabs)
 *   2. Direct WebSocket (per-tab, if SharedWorker unavailable)
 *   3. HTTP fetch (universal fallback)
 *
 * ~10ms per call (vs 22ms HTTP).
 */
class AppUIToolSocket {
  constructor(opts = {}) {
    this._timeout = opts.timeout || 10000;
    this._pending = {};  // id -> {resolve, reject, timer}
    this._idCounter = 0;
    this._port = null;
    this._ws = null;
    this._connected = false;
    this._closed = false;
    this._mode = 'none';  // 'worker' | 'ws' | 'http'
    this._queue = [];
    this._connect();
  }

  /**
   * Call a tool. Returns a Promise with the result dict.
   * @param {string} tool - Tool name (e.g. 'vfs.ls')
   * @param {object} params - Tool parameters
   * @returns {Promise<object>} Tool result
   */
  call(tool, params = {}) {
    return new Promise((resolve, reject) => {
      const id = String(++this._idCounter);
      const timer = setTimeout(() => {
        delete this._pending[id];
        reject(new Error(`AppUIToolSocket timeout: ${tool} (${this._timeout}ms)`));
      }, this._timeout);
      this._pending[id] = {resolve, reject, timer, tool, params};

      if (this._mode === 'http') {
        this._httpCall(id, tool, params);
      } else if (this._connected) {
        this._send(id, tool, params);
      } else {
        this._queue.push(id);
      }
    });
  }

  /** Close the connection. */
  close() {
    this._closed = true;
    if (this._port) {
      this._port.postMessage({type: 'disconnect'});
      this._port.close();
      this._port = null;
    }
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }
    for (const [id, p] of Object.entries(this._pending)) {
      clearTimeout(p.timer);
      p.reject(new Error('AppUIToolSocket closed'));
    }
    this._pending = {};
    this._queue = [];
  }

  get connected() { return this._connected; }
  get mode() { return this._mode; }

  _connect() {
    if (this._closed) return;
    // Try SharedWorker first
    if (typeof SharedWorker !== 'undefined' && location.protocol !== 'file:') {
      try {
        const worker = new SharedWorker('/appui/src/runtime/tool-socket-worker.js');
        this._port = worker.port;
        this._port.onmessage = (e) => this._onWorkerMessage(e.data);
        this._port.start();
        this._mode = 'worker';
        return;
      } catch (e) { /* fall through */ }
    }
    // Try direct WebSocket
    if (typeof WebSocket !== 'undefined') {
      this._connectDirectWs();
      return;
    }
    // HTTP fallback
    this._mode = 'http';
    this._connected = true;
    this._flushQueue();
  }

  _onWorkerMessage(msg) {
    if (msg.type === 'status') {
      this._connected = msg.connected;
      if (msg.connected) this._flushQueue();
    } else if (msg.type === 'result') {
      this._resolve(msg.id, msg.result);
    } else if (msg.type === 'error') {
      this._reject(msg.id, msg.error);
    }
  }

  _connectDirectWs() {
    const url = `ws://${location.host}/ws/tools`;
    try {
      this._ws = new WebSocket(url);
    } catch (e) {
      this._mode = 'http';
      this._connected = true;
      this._flushQueue();
      return;
    }
    this._mode = 'ws';
    this._ws.onopen = () => { this._connected = true; this._flushQueue(); };
    this._ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.error) this._reject(msg.id, msg.error);
        else this._resolve(msg.id, msg.result);
      } catch (err) { /* ignore */ }
    };
    this._ws.onclose = () => {
      this._connected = false;
      this._ws = null;
      if (!this._closed) {
        // Fallback to HTTP for remaining pending calls
        this._mode = 'http';
        this._connected = true;
        this._flushQueue();
      }
    };
  }

  _send(id, tool, params) {
    if (this._mode === 'worker') {
      this._port.postMessage({type: 'call', id, tool, params});
    } else if (this._mode === 'ws' && this._ws) {
      this._ws.send(JSON.stringify({id, tool, params}));
    } else {
      this._httpCall(id, tool, params);
    }
  }

  _flushQueue() {
    while (this._queue.length) {
      const id = this._queue.shift();
      const p = this._pending[id];
      if (p) this._send(id, p.tool, p.params);
    }
  }

  _resolve(id, result) {
    const p = this._pending[id];
    if (!p) return;
    delete this._pending[id];
    clearTimeout(p.timer);
    p.resolve(result);
  }

  _reject(id, error) {
    const p = this._pending[id];
    if (!p) return;
    delete this._pending[id];
    clearTimeout(p.timer);
    p.reject(new Error(error));
  }

  _httpCall(id, tool, params) {
    fetch(`/api/${tool.replace(/\./g, '/')}`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(params)
    }).then(r => r.json()).then(result => {
      if (result._error) this._reject(id, result._error);
      else this._resolve(id, result);
    }).catch(err => this._reject(id, err.message));
  }
}

// Export
if (typeof window !== 'undefined') window.AppUIToolSocket = AppUIToolSocket;

