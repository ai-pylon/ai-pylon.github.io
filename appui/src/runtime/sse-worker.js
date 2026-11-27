// SharedWorker: single SSE connection shared across browser tabs
const ports = new Set();
let eventSource = null;
let channels = new Set();
let retryDelay = 1000;
let endpoint = '';
let replay = 0;  // last-N replay applied when the shared connection (re)opens
const BACKOFF_MAX = 30000;

function broadcastStatus(state) {
  const msg = JSON.stringify({ type: 'status', state: state });
  ports.forEach(port => port.postMessage(msg));
}

function connect() {
  const channelStr = [...channels].join(',');
  if (!channelStr || !endpoint) return;
  if (eventSource) { eventSource.close(); eventSource = null; }

  broadcastStatus('reconnecting');
  // Include replay so multi-tab (SharedWorker) mode matches direct mode. Replay
  // is a property of the SHARED connection: it applies when the worker's single
  // SSE stream (re)opens, not per late-joining tab (which would re-deliver old
  // events to every tab over the shared stream).
  const replayQuery = replay > 0 ? '&replay=' + replay : '';
  eventSource = new EventSource(endpoint + '/subscribe?channels=' + channelStr + replayQuery);

  eventSource.onopen = () => {
    retryDelay = 1000;
    broadcastStatus('connected');
  };

  eventSource.onmessage = (ev) => {
    ports.forEach(port => port.postMessage(ev.data));
  };

  eventSource.onerror = () => {
    eventSource.close();
    eventSource = null;
    broadcastStatus('reconnecting');
    setTimeout(connect, retryDelay);
    retryDelay = Math.min(retryDelay * 2, BACKOFF_MAX);
  };
}

self.onconnect = (e) => {
  const port = e.ports[0];
  ports.add(port);
  port.onmessage = (msg) => {
    if (msg.data.type === 'subscribe') {
      endpoint = msg.data.endpoint || endpoint;
      // Adopt a replay request from the first subscriber to set the replay
      // count for the shared connection (0 stays 0).
      if (msg.data.replay) replay = msg.data.replay;
      const newChannels = msg.data.channels || [];
      let changed = false;
      newChannels.forEach(ch => { if (!channels.has(ch)) { channels.add(ch); changed = true; } });
      if (changed) connect();
      // Send current status to new subscriber
      if (eventSource && eventSource.readyState === EventSource.OPEN) {
        port.postMessage(JSON.stringify({ type: 'status', state: 'connected' }));
      } else if (eventSource) {
        port.postMessage(JSON.stringify({ type: 'status', state: 'reconnecting' }));
      }
    } else if (msg.data.type === 'disconnect') {
      ports.delete(port);
      if (ports.size === 0 && eventSource) {
        eventSource.close();
        eventSource = null;
        channels.clear();
        replay = 0;  // reset so a fresh session doesn't inherit a stale replay
        broadcastStatus('disconnected');
      }
    }
  };
  // Auto-connect if channels already active
  if (channels.size > 0) {
    connect();
  }
};
