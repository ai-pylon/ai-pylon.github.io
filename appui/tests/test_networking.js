/* node --test framework/appui/tests/test_networking.js */
const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const tick = async () => {for (let i = 0; i < 12; i++) await Promise.resolve();};
function environment(files, extra = {}) {
  const sandbox = {URL, Headers, Request, Response, ReadableStream, AbortController, TextEncoder,
    ArrayBuffer, Uint8Array, Blob, console, setTimeout, clearTimeout, setInterval, clearInterval,
    location: {href: 'https://example.test/page', origin: 'https://example.test', protocol: 'https:', host: 'example.test'},
    document: {baseURI: 'https://example.test/page'}, ...extra};
  sandbox.window = sandbox; vm.createContext(sandbox);
  for (const name of files) vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/runtime', name + '.js'), 'utf8'), sandbox);
  return sandbox;
}
function clock() {
  let now = 0, next = 0; const tasks = new Map();
  const schedule = (fn, ms, interval) => {const id = next++; tasks.set(id, {fn, at: now + ms, interval}); return id;};
  return {tasks, Date: {now: () => now},
    setTimeout: (fn, ms) => schedule(fn, ms, 0), clearTimeout: id => tasks.delete(id),
    setInterval: (fn, ms) => schedule(fn, ms, ms), clearInterval: id => tasks.delete(id),
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...tasks].filter(([, item]) => item.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        const [id, item] = due; now = item.at;
        if (item.interval) item.at += item.interval; else tasks.delete(id);
        item.fn(); await tick();
      }
      now = end; await tick();
    },
  };
}
function deferred() {let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};}
const response = data => ({ok: true, status: 200, json: async () => data});
function config(fetch, storage = new Map()) {
  const time = clock(), events = {};
  const sandbox = environment(['config-cache'], {...time, fetch,
    addEventListener: (name, callback) => {events[name] = callback;},
    AppUIStorage: {get: key => storage.get(key) ?? null, setJSON: (key, value) => {storage.set(key, JSON.stringify(value)); return true;},
      remove: key => storage.delete(key), keys: prefix => [...storage.keys()].filter(key => key.startsWith(prefix))}});
  return {store: sandbox.AppUIConfigStore, storage, time, events};
}
test('late configuration initialization cannot write into a replacement namespace', async () => {
  const a = deferred(), b = deferred(); let calls = 0;
  const c = config(() => (++calls === 1 ? a : b).promise);
  const first = c.store.init('A'), second = c.store.init('B');
  a.resolve(response({theme: 'A'})); b.resolve(response({theme: 'B'}));
  await Promise.all([first, second]);
  assert.equal(c.store.get('theme'), 'B');
  assert.equal(c.storage.get('cfg:B.theme'), '"B"');
  assert.equal(c.storage.has('cfg:A.theme'), false);
});
test('pending configuration saves keep their original namespace and deletion value', async () => {
  const writes = [];
  const c = config(async (url, options) => {if (url.endsWith('config.set')) writes.push(JSON.parse(options.body)); return response({});});
  await c.store.init('A'); c.store.set('theme', 'dark'); c.store.remove('obsolete');
  await c.store.init('B'); c.store.set('theme', 'light');
  await c.time.advance(10000);
  assert.deepEqual(writes, [{key: 'A.theme', value: 'dark'}, {key: 'A.obsolete', value: null}, {key: 'B.theme', value: 'light'}]);
});
test('configuration failures remain dirty, retry with a bound, and expose status', async () => {
  let writes = 0;
  const c = config(async url => {if (url.endsWith('config.set')) {writes++; throw Error('offline');} return response({});});
  await c.store.init('A'); c.store.set('theme', 'dark');
  assert.deepEqual(Array.from(await c.store.flush()), [false]);
  assert.equal(c.store.getStatus().pending, 1); assert.equal(c.store.getStatus().state, 'error');
  await c.time.advance(100000);
  assert.equal(writes, 6); assert.equal(c.time.tasks.size, 0);
  assert.equal(c.store.get('theme'), 'dark');
});
test('acknowledging an older save cannot clear a newer edit, and saves serialize', async () => {
  const first = deferred(); const writes = [];
  const c = config((url, options) => {
    if (url.endsWith('config.get')) return Promise.resolve(response({}));
    writes.push(JSON.parse(options.body)); return writes.length === 1 ? first.promise : Promise.resolve(response({ok: true}));
  });
  await c.store.init('A'); c.store.set('theme', 'old'); const pending = c.store.flush(); await tick();
  c.store.set('theme', 'new'); const latest = c.store.flush();
  assert.equal(writes.length, 1);
  first.resolve(response({ok: true})); await pending; await latest;
  assert.deepEqual(writes.map(write => write.value), ['old', 'new']);
  assert.equal(c.store.getStatus().pending, 0); assert.equal(c.time.tasks.size, 0);
});
test('HTTP and application save failures are not treated as acknowledgments', async () => {
  for (const failure of [{ok: false, status: 503}, response({_error: 'denied'})]) {
    const c = config(async url => url.endsWith('config.get') ? response({}) : failure);
    await c.store.init('A'); c.store.set('key', 1); await c.store.flush();
    assert.equal(c.store.getStatus().pending, 1); assert.equal(c.store.getStatus().state, 'error');
  }
});
test('local deletion made during initialization is not resurrected by the server reply', async () => {
  const pending = deferred(); const c = config(() => pending.promise);
  const init = c.store.init('A'); c.store.remove('theme');
  pending.resolve(response({theme: 'server'})); await init;
  assert.equal(c.store.get('theme', 'absent'), 'absent');
});
test('unload flush uses keepalive and status subscriptions can be disposed', async () => {
  const calls = []; const c = config(async (url, options) => {calls.push(options); return response({});});
  await c.store.init('A'); let changes = 0;
  const dispose = c.store.onStatus(() => changes++); c.store.set('key', 1); assert.ok(changes > 1);
  dispose(); const before = changes; c.events.beforeunload(); await tick();
  assert.equal(changes, before); assert.equal(calls.at(-1).keepalive, true);
});
test('unacknowledged configuration edits survive a page reload and clear only after acknowledgment', async () => {
  const first = config(async url => {if (url.endsWith('config.set')) throw Error('offline'); return response({});});
  await first.store.init('A'); first.store.set('theme', 'dark'); first.store.remove('old'); await first.store.flush();
  const writes = [];
  const second = config(async (url, options) => {
    if (url.endsWith('config.set')) writes.push(JSON.parse(options.body));
    return response({});
  }, first.storage);
  await second.store.init('A'); assert.equal(second.store.getStatus().pending, 2);
  assert.equal(second.store.get('theme'), 'dark'); await second.store.flush();
  assert.equal(writes.length, 2); assert.equal(second.store.getStatus().pending, 0);
  assert.equal([...first.storage.keys()].filter(key => key.startsWith('appui.config.pending.')).length, 0);
});
test('an old tab acknowledgment cannot remove another tab journal entry', async () => {
  const pending = deferred();
  const first = config(url => url.endsWith('config.get') ? Promise.resolve(response({})) : pending.promise);
  await first.store.init('A'); first.store.set('theme', 'old'); const save = first.store.flush(); await tick();
  const second = config(async () => response({}), first.storage); await second.store.init('A'); second.store.set('theme', 'new');
  pending.resolve(response({})); await save;
  const journalKey = [...first.storage.keys()].find(key => key.startsWith('appui.config.pending.'));
  assert.equal(JSON.parse(first.storage.get(journalKey)).value, 'new');
});

test('queue flush rejects pending callers and leaves active requests alone', async () => {
  const active = deferred(); let calls = 0;
  const c = environment(['api-queue'], {API_QUEUE_MAX: 1, fetch: () => {calls++; return active.promise;}});
  const first = c.fetch('/api/first');
  const second = assert.rejects(c.fetch('/v1/apps/example/do'), {name: 'AbortError'});
  c._apiQueue.flush(); await second; await tick();
  assert.equal(calls, 1); active.resolve(response({})); await first; await tick();
  assert.equal(c._apiQueue.active, 0); assert.equal(c._apiQueue.pending, 0);
});
test('aborting queued Request and init signals removes requests without dispatching', async () => {
  const active = deferred(); let calls = 0;
  const c = environment(['api-queue'], {API_QUEUE_MAX: 1, fetch: () => {calls++; return active.promise;}});
  const first = c.fetch('/api/first'); const controller = new AbortController();
  const second = assert.rejects(c.fetch(new Request('https://example.test/v1/apps/x/y', {signal: controller.signal})), {name: 'AbortError'});
  controller.abort(); await second;
  assert.equal(c._apiQueue.pending, 0); assert.equal(calls, 1);
  active.resolve(response({})); await first;
});
test('queue resizing starts distinct callers and rejects invalid limits', async () => {
  const calls = [];
  const c = environment(['api-queue'], {API_QUEUE_MAX: 1, fetch: url => {const item = deferred(); calls.push([url, item]); return item.promise;}});
  const requests = ['/api/a', '/api/b', '/api/c'].map(url => c.fetch(url));
  c._apiQueue.max = 3; await tick(); assert.equal(calls.length, 3);
  for (const [url, pending] of calls) pending.resolve(url);
  assert.deepEqual(await Promise.all(requests), ['/api/a', '/api/b', '/api/c']);
  for (const value of [0, -1, NaN, 1.5]) assert.throws(() => {c._apiQueue.max = value;}, /positive integer/);
});
test('queue recognizes URL, Request and v1 paths while keeping stream and cross-origin policies explicit', () => {
  const c = environment(['api-queue'], {fetch: async () => response({})});
  assert.equal(c._apiQueue.policy(new URL('https://example.test/v1/apps/x/y')), 'queue');
  assert.equal(c._apiQueue.policy(new Request('https://example.test/run/job')), 'queue');
  assert.equal(c._apiQueue.policy('/api/chat/stream'), 'bypass');
  assert.equal(c._apiQueue.policy('/api/chat', {headers: {Accept: 'text/event-stream'}}), 'bypass');
  assert.equal(c._apiQueue.policy('/api/chat/stream', {appuiQueue: 'default'}), 'queue');
  assert.equal(c._apiQueue.policy('https://other.test/api/x'), 'bypass');
  assert.equal(c._apiQueue.policy('/assets/x?next=/api/x'), 'bypass');
});
test('synchronous fetch exceptions release queue capacity', async () => {
  let calls = 0;
  const c = environment(['api-queue'], {API_QUEUE_MAX: 1, fetch: () => {if (++calls === 1) throw Error('sync'); return Promise.resolve(response({}));}});
  const first = assert.rejects(c.fetch('/api/a'), /sync/), second = c.fetch('/api/b');
  await first; await second; await tick(); assert.equal(c._apiQueue.active, 0);
});

const startup = () => new Response('{"status":"loading","retry_after":0}', {status: 503, headers: {'content-type': 'application/json'}});
function guard(fetch, extra = {}) {return environment(['api-guard'], {fetch, Toast: {info() {}, success() {}}, ...extra});}
test('startup retry network failures reject instead of resolving the earlier 503', async () => {
  let calls = 0;
  const c = guard(async () => {if (!calls++) return startup(); throw Error('network lost');});
  await assert.rejects(c.fetch('/api/test'), /network lost/); assert.equal(calls, 2);
});
test('aborting startup delay rejects promptly without issuing another request', async () => {
  let calls = 0; const controller = new AbortController(); const time = clock();
  const c = guard(async () => {calls++; return new Response('{"status":"loading","retry_after":30}', {status: 503});}, time);
  const pending = assert.rejects(c.fetch('/api/test', {signal: controller.signal}), {name: 'AbortError'});
  // Native response decoding runs outside the microtask-only clock.
  await new Promise(resolve => setTimeout(resolve, 20)); controller.abort(); await pending;
  assert.equal(calls, 1); assert.equal(time.tasks.size, 0);
});
test('Request POST bodies are cloned before consumption and replayed intact', async () => {
  const bodies = [];
  const c = guard(async request => {bodies.push(await request.text()); return bodies.length === 1 ? startup() : response({});});
  await c.fetch(new Request('https://example.test/api/test', {method: 'POST', body: 'payload'}));
  assert.deepEqual(bodies, ['payload', 'payload']);
});
test('streaming request bodies are not replayed and malformed 503 bodies are returned intact', async () => {
  let calls = 0;
  const c = guard(async () => {calls++; return startup();});
  const body = new ReadableStream({start(controller) {controller.close();}});
  assert.equal((await c.fetch('/api/test', {method: 'POST', body})).status, 503); assert.equal(calls, 1);
  const bad = guard(async () => new Response('plain error', {status: 503}));
  assert.equal(await (await bad.fetch('/api/test')).text(), 'plain error');
});

function sockets(options = {}) {
  const time = clock(), created = [];
  class Socket {
    static OPEN = 1;
    constructor() {this.readyState = 0; this.bufferedAmount = 0; this.sent = []; created.push(this);}
    send(data) {this.sent.push(data);}
    close() {this.readyState = 3;}
    open() {this.readyState = 1; this.onopen?.();}
  }
  const sandbox = environment(['websocket'], {...time, WebSocket: Socket});
  const client = new sandbox.AppUIWebSocket('wss://example.test', {heartbeatInterval: 0, ...options});
  return {client, created, time};
}
test('old socket close/open/message callbacks cannot affect a replacement connection', () => {
  const {client, created, time} = sockets(); const old = created[0];
  const close = old.onclose, open = old.onopen, message = old.onmessage; let messages = 0;
  client.on('message', () => messages++); client.reconnect(); created[1].open();
  close({code: 1000}); open(); message({data: 'old'});
  assert.equal(created.length, 2); assert.equal(time.tasks.size, 0); assert.equal(messages, 0);
  assert.equal(client.connected, true); client.close();
});
test('manual reconnect stops the old heartbeat and explicit close clears all timers', () => {
  const {client, created, time} = sockets({heartbeatInterval: 100});
  created[0].open(); assert.equal(time.tasks.size, 1); client.reconnect(); assert.equal(time.tasks.size, 0);
  created[1].open(); assert.equal(time.tasks.size, 1); client.close(); assert.equal(time.tasks.size, 0);
});
test('explicit close preserves one close notification but suppresses it after a replacement', () => {
  const {client, created} = sockets(); let closes = 0;
  client.on('close', () => closes++); client.close();
  const close = created[0].onclose; close({code: 1000}); close({code: 1000});
  assert.equal(closes, 1);
  client.reconnect(); client.close(); const late = created[1].onclose; client.reconnect();
  late({code: 1000}); assert.equal(closes, 1); client.close();
});
test('late asynchronous binary conversion is ignored after reconnect', async () => {
  const {client, created} = sockets(); const pending = deferred(); let binaries = 0;
  const blob = new Blob(['x']); blob.arrayBuffer = () => pending.promise;
  client.on('binary', () => binaries++); created[0].onmessage({data: blob}); client.reconnect();
  pending.resolve(new ArrayBuffer(1)); await tick(); assert.equal(binaries, 0); client.close();
});
test('WebSocket queue enforces message and UTF-8 byte bounds with rejection reporting', () => {
  const {client} = sockets({maxQueuedMessages: 2, maxQueuedBytes: 6, highWaterMark: 6}); let overflows = 0;
  client.on('overflow', () => overflows++);
  assert.equal(client.send('한'), true); assert.equal(client.send('글'), true); assert.equal(client.send('x'), false);
  assert.equal(client.queueSize, 2); assert.equal(client.queuedBytes, 6); assert.equal(overflows, 1); client.close();
});
test('drop-oldest policy preserves the newest messages in order', () => {
  const {client, created} = sockets({maxQueuedMessages: 2, overflowPolicy: 'drop-oldest'});
  client.send('a'); client.send('b'); client.send('c'); created[0].open();
  assert.deepEqual(created[0].sent, ['b', 'c']); assert.equal(client.queuedBytes, 0); client.close();
});
test('expired disconnected commands are removed and never replayed', async () => {
  const {client, created, time} = sockets({queueTtlMs: 10}); let expired = 0;
  client.on('expired', event => {expired += event.messages;}); client.send('old');
  await time.advance(11); assert.equal(client.queueSize, 0); assert.equal(expired, 1);
  created[0].open(); assert.deepEqual(created[0].sent, []); client.close();
});
test('backpressure waits for bufferedAmount to fall and reports drain', async () => {
  const {client, created, time} = sockets({highWaterMark: 10, drainInterval: 5}); const socket = created[0];
  let pressured = 0, drained = 0;
  client.on('backpressure', () => pressured++).on('drain', () => drained++); socket.open(); socket.bufferedAmount = 10;
  client.send('queued'); assert.equal(socket.sent.length, 0); assert.equal(pressured, 1);
  socket.bufferedAmount = 0; await time.advance(5);
  assert.deepEqual(socket.sent, ['queued']); assert.equal(drained, 1); assert.equal(client.queueSize, 0); client.close();
});
test('queued binary data snapshots caller-owned buffers and respects per-message TTL', async () => {
  const {client, created, time} = sockets(); const data = new Uint8Array([1, 2]);
  client.sendBinary(data); data[0] = 9; client.sendJSON({old: true}, {ttlMs: 1});
  await time.advance(2); created[0].open();
  assert.equal(created[0].sent.length, 1); assert.deepEqual([...created[0].sent[0]], [1, 2]); client.close();
});
