/* node --test framework/appui/tests/test_services.js */
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function load(files, extra = {}) {
  const sandbox = {URL, AbortController, TextDecoder, setTimeout, clearTimeout, console, ...extra};
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  for (const file of files) vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/runtime', file + '.js'), 'utf8'), context);
  return context;
}
function persistent() {
  const values = new Map(), timers = new Map();
  let id = 0;
  const sandbox = load(['state'], {addEventListener() {}, removeEventListener() {},
    setTimeout(fn) {const key = id++; timers.set(key, fn); return key;}, clearTimeout: key => timers.delete(key),
    AppUIStorage: {setJSON: (k, v) => values.set(k, v), getJSON: (k, d) => values.has(k) ? values.get(k) : d,
      remove: k => values.delete(k), keys: prefix => [...values.keys()].filter(k => k.startsWith(prefix))}});
  return {state: sandbox.State.create('test'), values, timers};
}
test('clearing one pending write preserves other writes and permits a later replacement', () => {
  const {state, timers} = persistent();
  state.set('a', 1); state.set('b', 2); state.clear('a');
  assert.equal(state.get('a'), null);
  state.flush();
  assert.equal(state.get('a'), null);
  assert.equal(state.get('b'), 2);
  state.set('a', 3); state.flush();
  assert.equal(state.get('a'), 3);
  assert.equal(timers.size, 0);
});
test('clearAll cancels pending-only values and leaves other namespaces intact', () => {
  const {state, values, timers} = persistent();
  values.set('state:other:saved', 4);
  state.save('saved', 1); state.set('pending', 2);
  state.clearAll(); state.flush(); state.destroy();
  assert.equal(values.size, 1);
  assert.equal(values.get('state:other:saved'), 4);
  assert.equal(timers.size, 0);
});
test('state accepts prototype-like keys and can clear timer ID zero', () => {
  const {state, timers} = persistent();
  state.set('__proto__', 42); state.clear('__proto__');
  assert.equal(state.get('__proto__'), null);
  assert.equal(timers.size, 0);
});

function reactive() {return load(['reactive-state']).AppUIReactiveState.create();}
test('derived chains and diamonds recompute once in dependency order before notification', () => {
  const store = reactive();
  store.set('a', 1);
  store.derived('end', ['left', 'right'], (l = 0, r = 0) => l + r);
  store.derived('left', ['a'], a => a * 2);
  store.derived('right', ['a'], a => a * 3);
  let observations = [], endComputes = 0;
  store.derived('end', ['left', 'right'], (l, r) => {endComputes++; return l + r;});
  endComputes = 0;
  store.watch('a', () => observations.push(store.get('end')));
  store.set('a', 2);
  assert.equal(store.get('end'), 10);
  assert.equal(endComputes, 1);
  assert.deepEqual(observations, [10]);
});
test('nested batches coalesce changes and preserve pre-batch values', () => {
  const store = reactive(), seen = [];
  store.set('a', 0); store.set('b', 0);
  store.derived('sum', ['a', 'b'], (a, b) => a + b);
  store.watch('*', (value, key, prev) => seen.push([key, value, prev]));
  store.batch(() => {
    store.set('a', 1);
    store.batch(() => {store.set('a', 2); store.set('b', 3);});
    assert.equal(seen.length, 0);
    store.set('b', 4);
  });
  assert.deepEqual(seen, [['a', 2, 0], ['b', 4, 0], ['sum', 6, 0]]);
});
test('batch exceptions flush changes and restore batching for subsequent writes', () => {
  const store = reactive(); const seen = [];
  store.watch('a', value => seen.push(value));
  assert.throws(() => store.batch(() => {store.set('a', 1); throw Error('stop');}), /stop/);
  store.set('a', 2);
  assert.deepEqual(seen, [1, 2]);
});
test('cycle rejection preserves previous definitions and stale disposers cannot delete replacements', () => {
  const store = reactive(); store.set('a', 2);
  const disposeOld = store.derived('b', ['a'], a => a * 2);
  store.derived('b', ['a'], a => a * 3); disposeOld();
  assert.throws(() => store.derived('a', ['b'], b => b), /cycle/);
  assert.throws(() => store.derived('self', ['self'], value => value), /cycle/);
  store.set('a', 3);
  assert.equal(store.get('b'), 9);
  assert.equal(store.keys().includes('self'), false);
});
test('observer writes are processed without recursively interrupting a notification round', () => {
  const store = reactive(), seen = [];
  store.watch('a', value => {seen.push('first:' + value); if (value === 1) store.set('a', 2);});
  store.watch('a', value => seen.push('second:' + value));
  store.set('a', 1);
  assert.deepEqual(seen, ['first:1', 'second:1', 'first:2', 'second:2']);
});

test('async cache evicts least-recently-used results without evicting shared pending work', async () => {
  const cache = load(['async-cache']).AppUIAsyncCache.create({ttlMs: Infinity, maxEntries: 2});
  let calls = 0;
  const get = key => cache.get(key, () => {calls++; return key;});
  await get('a'); await get('b'); await get('a'); await get('c'); await get('a');
  assert.equal(calls, 3);
  await get('b'); assert.equal(calls, 4);
  let resolve;
  const first = cache.get('pending', () => new Promise(yes => {resolve = yes;}));
  const second = cache.get('pending', () => {throw Error('must coalesce');});
  assert.equal(first, second);
  await Promise.resolve(); resolve(5); assert.equal(await first, 5);
});
test('async cache prunes unrelated expired entries during activity', async () => {
  let now = 0; const maps = [];
  class ObservedMap extends Map {constructor() {super(); maps.push(this);}}
  const sandbox = load(['async-cache'], {Map: ObservedMap, Date: {now: () => now}});
  const cache = sandbox.AppUIAsyncCache.create({ttlMs: 10});
  await cache.get('old', () => 'old');
  now = 11;
  await cache.get('new', () => 'new');
  assert.equal(maps[1].has('old'), false);
  assert.equal(maps[1].size, 1);
});
test('cache invalidation cannot be undone by a superseded pending response', async () => {
  const cache = load(['async-cache']).AppUIAsyncCache.create({ttlMs: Infinity});
  let resolve;
  const old = cache.get('key', () => new Promise(yes => {resolve = yes;}));
  await Promise.resolve(); cache.clear('key');
  await cache.get('key', () => 'new'); resolve('old'); await old;
  assert.equal(await cache.get('key', () => 'wrong'), 'new');
});
test('cache capacity zero disables completed-result retention', async () => {
  const cache = load(['async-cache']).AppUIAsyncCache.create({ttlMs: Infinity, maxEntries: 0});
  let count = 0;
  await cache.get('a', () => ++count); await cache.get('a', () => ++count);
  assert.equal(count, 2);
});

function scripts(append) {
  const elements = [];
  const sandbox = load(['script-loader'], {location: {href: 'https://example.test/page/'},
    document: {baseURI: 'https://example.test/page/',
      createElement: () => ({remove() {this.removed = true;}}),
      head: {appendChild(element) {elements.push(element); append?.(element, sandbox);}}}});
  return {sandbox, elements, loader: sandbox.AppUIScriptLoader};
}
test('script loading normalizes URLs, shares transport, and validates each requested export', async () => {
  const {loader, elements, sandbox} = scripts();
  const a = loader.load('../lib.js#one', 'A');
  const b = loader.load('https://example.test/lib.js#two', 'B');
  const missing = assert.rejects(loader.load('/lib.js', 'Missing'), /did not define Missing/);
  assert.equal(elements.length, 1);
  sandbox.A = false; sandbox.B = 42; elements[0].onload();
  assert.equal(await a, false); assert.equal(await b, 42); await missing;
  assert.equal(await loader.load('/lib.js', 'B'), 42);
});
test('script timeout removes the failed element, ignores late completion, and permits retry', async () => {
  const {loader, elements} = scripts();
  const pending = loader.load('/slow.js', null, {timeout: 10});
  const late = elements[0].onload;
  await assert.rejects(pending, /timed out/);
  assert.equal(elements[0].removed, true); late();
  const retry = loader.load('/slow.js');
  assert.equal(elements.length, 2); elements[1].onload(); await retry;
});
test('script errors and synchronous insertion failures permit retry', async () => {
  const {loader, elements} = scripts();
  const pending = loader.load('/bad.js'); elements[0].onerror();
  await assert.rejects(pending, /Failed to load/);
  const retry = loader.load('/bad.js'); elements[1].onload(); await retry;
  const broken = scripts(() => {throw Error('insertion failed');});
  await assert.rejects(broken.loader.load('/fail.js'), /insertion failed/);
  assert.equal(broken.elements[0].removed, true);
});

const streamFiles = ['stream-events', 'core-stream'];
test('SSE framing handles every split position, BOM, CRLF, comments, and multiline payloads', () => {
  const input = '\uFEFF:keepalive\r\nevent: tool_call\r\ndata: {"name":\r\ndata: "test"}\r\n\r\nevent: text\rdata: hello\rdata: world\r\r';
  for (let split = 0; split <= input.length; split++) {
    const sandbox = load(streamFiles), seen = [];
    const callbacks = {onToolCall: data => seen.push(['tool', data.name]), onText: text => seen.push(['text', text])};
    sandbox._AppUICoreStream.parseSSE(input.slice(0, split), callbacks);
    sandbox._AppUICoreStream.parseSSE(input.slice(split), callbacks);
    sandbox._AppUICoreStream.parseSSE.finish(callbacks);
    assert.deepEqual(seen, [['tool', 'test'], ['text', 'hello\nworld']]);
  }
});
test('SSE callback exceptions are not mistaken for JSON parse failures or called twice', () => {
  const sandbox = load(streamFiles); let calls = 0;
  const callbacks = {onToolCall() {calls++; throw Error('consumer failed');}};
  assert.throws(() => sandbox._AppUICoreStream.parseSSE('event: tool_call\ndata: {}\n\n', callbacks), /consumer failed/);
  assert.equal(calls, 1);
});
function chat(response) {
  const sandbox = load(streamFiles, {fetch: async () => response});
  const events = [];
  return {events, run: options => sandbox._AppUICoreStream.streamChat({prompt: 'test',
    onText: token => events.push(['text', token]), onDone: () => events.push(['done']),
    onError: error => events.push(['error', error]), ...options})};
}
test('HTTP and JSON application failures reject without text or successful completion', async () => {
  for (const response of [new Response('{"error":"unavailable"}', {status: 503, headers: {'content-type': 'application/json'}}),
    new Response('{"error":"denied"}', {headers: {'content-type': 'application/json'}}),
    new Response('{"ok":false,"error":"denied"}', {headers: {'content-type': 'application/json'}})]) {
    const c = chat(response); await assert.rejects(c.run(), /unavailable|denied/);
    assert.equal(c.events.length, 1); assert.equal(c.events[0][0], 'error');
  }
});
test('JSON success and SSE metadata retain their public completion payloads', async () => {
  const json = chat(new Response('{"response":"hello","session_id":"session"}', {headers: {'content-type': 'application/json'}}));
  assert.equal((await json.run()).session_id, 'session');
  assert.deepEqual(json.events, [['text', 'hello'], ['done']]);
  let completed;
  const sse = chat(new Response('event: meta\ndata: {"session_id":"s1"}\n\ndata: "hello"\n\nevent: done\ndata: {"session_id":"s2","total_ms":123}\n\n',
    {headers: {'content-type': 'text/event-stream'}}));
  assert.equal((await sse.run({onDone: result => {completed = result;}})).session_id, 's2');
  assert.equal(completed.text, 'hello');
  assert.equal(completed.session_id, 's2');
  assert.equal(completed.total_ms, 123);
});
test('a failed reader preserves the transport error and releases its lock', async () => {
  const body = new ReadableStream({start(controller) {controller.error(Error('transport lost'));}});
  const c = chat(new Response(body, {headers: {'content-type': 'text/event-stream'}}));
  await assert.rejects(c.run(), /transport lost/);
  assert.deepEqual(c.events, [['error', 'transport lost']]);
  assert.equal(body.locked, false);
});
test('streaming error is terminal and cancels/releases its reader', async () => {
  let cancelled = 0;
  const body = new ReadableStream({start(controller) {
    controller.enqueue(new TextEncoder().encode('event: error\ndata: unavailable\n\ndata: [DONE]\n\n'));
  }, cancel() {cancelled++;}});
  const c = chat(new Response(body, {headers: {'content-type': 'text/event-stream'}}));
  await assert.rejects(c.run(), /unavailable/);
  assert.deepEqual(c.events, [['error', 'unavailable']]);
  assert.equal(cancelled, 1); assert.equal(body.locked, false);
});
test('explicit completion ignores trailing events and cancels an otherwise open stream', async () => {
  let cancelled = 0;
  const body = new ReadableStream({start(controller) {
    controller.enqueue(new TextEncoder().encode('data: "hi"\n\ndata: [DONE]\n\ndata: "late"\n\nevent: error\ndata: late\n\n'));
  }, cancel() {cancelled++;}});
  const c = chat(new Response(body, {headers: {'content-type': 'text/event-stream'}}));
  assert.equal((await c.run()).text, 'hi');
  assert.deepEqual(c.events, [['text', 'hi'], ['done']]);
  assert.equal(cancelled, 1); assert.equal(body.locked, false);
});
test('split UTF-8 and a final unterminated frame complete correctly at EOF', async () => {
  const bytes = new TextEncoder().encode('data: "한글"');
  const body = new ReadableStream({start(controller) {
    for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close();
  }});
  const c = chat(new Response(body, {headers: {'content-type': 'text/event-stream'}}));
  assert.equal((await c.run()).text, '한글');
  assert.deepEqual(c.events, [['text', '한글'], ['done']]);
  assert.equal(body.locked, false);
});
test('abort during a pending read terminates once and releases its reader', async () => {
  let cancelled = 0;
  const body = new ReadableStream({cancel() {cancelled++;}});
  const controller = new AbortController();
  const c = chat(new Response(body, {headers: {'content-type': 'text/event-stream'}}));
  const pending = c.run({signal: controller.signal});
  setTimeout(() => controller.abort(), 5);
  await assert.rejects(pending, {name: 'AbortError'});
  assert.equal(c.events.length, 1); assert.equal(c.events[0][0], 'error');
  assert.equal(cancelled, 1); assert.equal(body.locked, false);
});
test('abort in a text callback prevents buffered completion from reporting success', async () => {
  const controller = new AbortController();
  const body = new ReadableStream({start(source) {
    source.enqueue(new TextEncoder().encode('data: "hi"\n\ndata: [DONE]\n\n'));
  }});
  const c = chat(new Response(body, {headers: {'content-type': 'text/event-stream'}}));
  await assert.rejects(c.run({signal: controller.signal, onText: () => controller.abort()}), {name: 'AbortError'});
  assert.equal(c.events.length, 1); assert.equal(c.events[0][0], 'error');
  assert.equal(body.locked, false);
});
test('throwing text and completion callbacks release readers with one terminal notification', async () => {
  for (const at of ['onText', 'onDone']) {
    let cancelled = 0, errors = 0, done = 0;
    const body = new ReadableStream({start(controller) {
      controller.enqueue(new TextEncoder().encode('data: "hi"\n\ndata: [DONE]\n\n'));
    }, cancel() {cancelled++;}});
    const c = chat(new Response(body, {headers: {'content-type': 'text/event-stream'}}));
    await assert.rejects(c.run({onText() {if (at === 'onText') throw Error('callback');},
      onDone() {done++; if (at === 'onDone') throw Error('callback');}, onError() {errors++;}}), /callback/);
    assert.equal(done + errors, 1);
    assert.equal(cancelled, 1); assert.equal(body.locked, false);
  }
});
