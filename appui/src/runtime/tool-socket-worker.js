// SharedWorker: single WebSocket connection for tool calls across all tabs.
// Tabs send: {type:'call', id, tool, params}
// Worker responds: {type:'result', id, result} or {type:'error', id, error}

let ws = null;
let wsReady = false;
const ports = new Set();
const pending = new Map();  // id -> port (which port is waiting for this id)
const queue = [];           // messages queued while connecting
let reconnectDelay = 1000;
const MAX_RECONNECT = 15000;

function connect() {
  if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
  try {
    ws = new WebSocket((self.location.protocol === 'https:' ? 'wss://' : 'ws://') + self.location.host + '/ws/tools');
  } catch (e) {
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    wsReady = true;
    reconnectDelay = 1000;
    // Flush queue
    while (queue.length) ws.send(queue.shift());
    broadcast({type: 'status', connected: true});
  };

  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      const port = pending.get(msg.id);
      if (port) {
        pending.delete(msg.id);
        if (msg.error) {
          port.postMessage({type: 'error', id: msg.id, error: msg.error});
        } else {
          port.postMessage({type: 'result', id: msg.id, result: msg.result});
        }
      }
    } catch (err) { /* ignore */ }
  };

  ws.onclose = () => {
    wsReady = false;
    ws = null;
    broadcast({type: 'status', connected: false});
    scheduleReconnect();
  };

  ws.onerror = () => { /* onclose handles it */ };
}

function scheduleReconnect() {
  setTimeout(connect, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT);
}

function broadcast(msg) {
  ports.forEach(p => {
    try { p.postMessage(msg); } catch (e) { /* dead port */ }
  });
}

function sendCall(port, id, tool, params) {
  pending.set(id, port);
  const msg = JSON.stringify({id, tool, params});
  if (wsReady && ws) {
    ws.send(msg);
  } else {
    queue.push(msg);
    connect();
  }
}

self.onconnect = (e) => {
  const port = e.ports[0];
  ports.add(port);

  port.onmessage = (msg) => {
    const d = msg.data;
    if (d.type === 'call') {
      sendCall(port, d.id, d.tool, d.params);
    } else if (d.type === 'disconnect') {
      ports.delete(port);
      // Clean up pending calls for this port
      for (const [id, p] of pending) {
        if (p === port) pending.delete(id);
      }
      if (ports.size === 0 && ws) {
        ws.close();
        ws = null;
        wsReady = false;
      }
    }
  };

  // Start connection if not already connected
  connect();

  // Send current status
  port.postMessage({type: 'status', connected: wsReady});
};
